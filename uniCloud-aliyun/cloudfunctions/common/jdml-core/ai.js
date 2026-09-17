'use strict';
const { postJSON } = require('./http');
const { GENERATE, REVIEW, VERSION } = require('./prompts');
const { itemFor, dateKey, ITEMS } = require('./domain');
const { validSceneSummary } = require('./subscription-template');
const crypto = require('crypto');
const digest = (text) => crypto.createHash('sha256').update(text).digest('hex');
const SIZE = (text) => [...text].length;
const BAD =
  /倒霉|生病|受伤|摔倒|骨折|死亡|故人|最后一程|防灾|消灾|驱邪|安息|祭奠|葬礼|灾[祸难]|丢失|被骗|受骗|被盗|罚款|赔偿|争吵|冲突|羞辱|狗屎|破财|转运|挨饿|乞丐|可怜|必须|赶快|最后机会|不[买付存].{0,8}就|中奖|赌博|贷款|借贷|收益|治失眠|提神醒脑|已[经]?存入|已到账|已捐|代扣|https?:|www\.|<[^>]*>|二维码|微信号|支付宝账号|\d{5,}|[¥￥]|[0-9零一二三四五六七八九十百千]+\s*(元|块钱|人民币)|(?:花了?|省了?|付了?|卖|收)[0-9零一二三四五六七八九十百千]+\s*块/i;
// Reject the discarded "imaginary goods" style independently of model review.
function hasImaginaryNarration(text) {
  return /假装|虚拟|虚构|脑补|精神消费|想象|空气(?:商品|奶茶|香烟|烟|小酒|槟榔|咖啡|零食|薯片|新笔|桌牌|抱枕|杯子)|不存在的(?:商品|奶茶|香烟)/.test(
    String(text || '')
  );
}
function storyItem(event) {
  return ITEMS[event.habit]?.name || event.item;
}
function needsStyleRepair(event) {
  return (
    event?.kind === 'self' &&
    !event.token &&
    !event.recipient &&
    !event.deposit &&
    ['offered', 'planned'].includes(event.state) &&
    [
      event.item,
      event.title,
      event.reason,
      event.sceneSummary,
      event.actionLabel
    ].some(hasImaginaryNarration)
  );
}
function similar(a, b) {
  const pairs = (s) => {
    const t = s.replace(/[\s，。！？、]/g, '');
    return new Set([...t].slice(1).map((_, i) => t.slice(i, i + 2)));
  };
  const x = pairs(a),
    y = pairs(b);
  let intersection = 0;
  for (const pair of x) if (y.has(pair)) intersection++;
  return intersection / Math.max(1, x.size + y.size - intersection) > 0.82;
}
function validateScene(scene, input, recent = []) {
  const expected = [
    'action_label',
    'amount_cents',
    'body',
    'motif',
    'summary',
    'title'
  ];
  if (
    !scene ||
    typeof scene !== 'object' ||
    Object.keys(scene).sort().join() !== expected.join()
  )
    throw new Error('SCENE_SHAPE');
  for (const [key, min, max] of [
    ['title', 4, 12],
    ['body', 30, 90],
    ['action_label', 4, 10]
  ]) {
    if (
      typeof scene[key] !== 'string' ||
      SIZE(scene[key]) < min ||
      SIZE(scene[key]) > max ||
      /[\r\n]/.test(scene[key])
    )
      throw new Error('SCENE_LENGTH');
  }
  if (!validSceneSummary(scene.summary)) throw new Error('SCENE_SUMMARY');
  if (
    !Number.isSafeInteger(scene.amount_cents) ||
    scene.amount_cents !== input.amount_cents
  )
    throw new Error('SCENE_AMOUNT');
  if (!/^[a-z][a-z_]{1,40}$/.test(scene.motif)) throw new Error('SCENE_MOTIF');
  const content = scene.title + scene.body + scene.summary + scene.action_label;
  if (hasImaginaryNarration(content)) throw new Error('SCENE_STYLE');
  if (BAD.test(content) || !scene.body.includes(input.item_name))
    throw new Error('SCENE_CONTENT');
  if (
    recent.some(
      (r) => similar(r.body || '', scene.body) || r.motif === scene.motif
    )
  )
    throw new Error('SCENE_DUPLICATE');
  return scene;
}
function sceneInput(event, recent = []) {
  const hour = new Date(
    (event.dueAt || event.createdAt) + 8 * 3600000
  ).getUTCHours();
  const n = parseInt(digest(event.id).slice(0, 4), 16);
  return {
    persona: event.habitName || event.habit,
    scene_source: event.sceneSource || 'habit',
    story_taste: event.storyTaste || 'balanced',
    item_name: storyItem(event),
    item_unit: event.unit,
    interaction_mode: event.kind === 'treat' ? 'treat' : 'self',
    amount_cents: event.amount,
    time_band: hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening',
    scene_kind:
      event.kind === 'treat'
        ? 'kindness'
        : event.sceneSource === 'discovery'
          ? 'daily_joy'
          : 'habit',
    writing_seed: [
      '为一个不值得的小细节找了很充分的理由',
      '给自己定的规矩找一个可笑的例外',
      '把一句随口的话当成购买的充分依据',
      '想买的东西突然有了没必要的用途',
      '试图证明自己很有原则，决定却反了过来',
      '一本正经地给自己已经想买的东西找理由'
    ][n % 6],
    recent_motifs: recent
      .slice(-10)
      .map((r) => r.motif)
      .filter(Boolean)
  };
}
function fallback(event) {
  const item = itemFor({
    key: event.habit,
    name: event.habitName || event.item
  });
  const treat = event.kind === 'treat';
  const name = storyItem(event);
  return {
    title: treat ? '维护一下口碑' : item.title,
    body: treat
      ? `朋友说我最近挺会过日子，我想请他一份${name}。这么有眼光的人，值得让他下次继续说。`
      : item.reason.split(item.name).join(name),
    summary: treat ? '朋友这么有眼光，值得请一份' : item.summary,
    action_label: treat ? '这份我来请' : item.action,
    amount_cents: event.amount,
    motif: 'fallback_' + event.habit
  };
}

function createScenePipeline(
  store,
  config,
  { clock = Date.now, post = postJSON } = {}
) {
  async function quota(uid) {
    return store.transaction(async (tx) => {
      const day = dateKey(clock()),
        uidKey = digest(uid + ':' + day),
        globalKey = 'global-' + day;
      const u = (await tx.get('aiUsage', uidKey)) || {
        id: uidKey,
        owner: uid,
        date: day,
        calls: 0,
        createdAt: clock()
      };
      const g = (await tx.get('aiUsage', globalKey)) || {
        id: globalKey,
        date: day,
        calls: 0,
        createdAt: clock()
      };
      if (
        u.calls >= config.ai.maxCallsPerUserDay ||
        g.calls >= config.ai.maxCallsGlobalDay
      )
        return false;
      u.calls++;
      g.calls++;
      await tx.put('aiUsage', uidKey, u);
      await tx.put('aiUsage', globalKey, g);
      return true;
    });
  }
  async function chat(uid, messages, deadline, temperature) {
    const remaining = deadline - clock();
    if (remaining < 150 || !(await quota(uid))) throw new Error('AI_BUDGET');
    const payload = {
      model: config.ai.model,
      messages,
      temperature,
      max_tokens: 512,
      stream: false,
      response_format: { type: 'json_object' },
      thinking: { type: config.ai.thinking ? 'enabled' : 'disabled' }
    };
    const response = await post(config.ai.endpoint, payload, {
      headers: { Authorization: 'Bearer ' + config.ai.apiKey },
      timeoutMs: Math.max(100, deadline - clock())
    });
    if (clock() >= deadline) throw new Error('AI_TIMEOUT');
    const choice = response.choices?.[0];
    if (
      choice?.finish_reason !== 'stop' ||
      typeof choice.message?.content !== 'string'
    )
      throw new Error('AI_RESPONSE');
    try {
      return JSON.parse(choice.message.content);
    } catch (_) {
      throw new Error('AI_JSON');
    }
  }
  async function publish(eventId, scene, status, elapsedMs) {
    return store.transaction(async (tx) => {
      const event = await tx.get('events', eventId);
      if (!event || event.generation?.state === 'ready') return event;
      const editable = ['offered', 'pending', 'planned'].includes(event.state);
      const chosen = editable ? scene : fallback(event);
      event.item = storyItem(event);
      event.title = chosen.title;
      event.reason = chosen.body;
      event.sceneSummary = chosen.summary;
      event.actionLabel = chosen.action_label;
      event.generation = {
        state: 'ready',
        mode: editable ? status : 'fallback',
        promptVersion: VERSION,
        model: config.ai.model,
        motif: chosen.motif,
        bodyHash: digest(chosen.body),
        elapsedMs,
        finishedAt: clock()
      };
      event.source =
        editable && status === 'ai' ? 'zhipu-ai' : 'reviewed-library-v2';
      await tx.put('events', eventId, event);
      if (event.token) {
        const inv = await tx.get('invites', digest(event.token));
        if (inv && inv.state === 'pending') {
          inv.reason = event.reason;
          await tx.put('invites', inv.id, inv);
        }
      }
      const user = await tx.get('users', event.owner);
      if (user) {
        user.recentScenes = [
          ...(user.recentScenes || []),
          { motif: chosen.motif, body: chosen.body, at: clock() }
        ]
          .filter((r) => r.at > clock() - 7 * 86400000)
          .slice(-10);
        await tx.put('users', user.id, user);
      }
      return event;
    });
  }
  async function ensureReady(
    eventId,
    { background = false, forceFallback = false } = {}
  ) {
    const start = clock(),
      budget = background
        ? config.ai.backgroundBudgetMs
        : config.ai.interactiveBudgetMs,
      deadline = start + budget;
    const lockId = crypto.randomBytes(12).toString('hex');
    const claim = await store.transaction(async (tx) => {
      const e = await tx.get('events', eventId);
      if (
        needsStyleRepair(e) &&
        e.generation?.state === 'ready' &&
        e.expiresAt > start
      ) {
        // Repair only an unaccepted personal scene. Shared invitations and completed
        // receipts keep their original snapshot; never charge again or call AI on read.
        const oldVersion = e.generation.promptVersion || 'legacy';
        const repaired = fallback(e);
        e.item = storyItem(e);
        e.title = repaired.title;
        e.reason = repaired.body;
        e.sceneSummary = repaired.summary;
        e.actionLabel = repaired.action_label;
        e.generation = {
          ...e.generation,
          mode: 'fallback',
          promptVersion: VERSION,
          motif: repaired.motif,
          bodyHash: digest(repaired.body),
          repairedFromVersion: oldVersion,
          styleRepairedAt: start
        };
        e.source = 'reviewed-library-v3';
        await tx.put('events', eventId, e);
      }
      if (!e || !e.generation || e.generation.state === 'ready')
        return { event: e, locked: false };
      if (e.generation.leaseUntil > start) return { event: e, locked: false };
      e.generation = { ...e.generation, leaseUntil: deadline, lease: lockId };
      await tx.put('events', e.id, e);
      return { event: e, locked: true };
    });
    const e = claim.event;
    if (!e || !e.generation || e.generation.state === 'ready') return e;
    // Another invocation owns generation. Freeze a safe fallback rather than launch a duplicate request.
    if (
      !claim.locked ||
      !config.ai.enabled ||
      forceFallback ||
      !['offered', 'pending', 'planned'].includes(e.state)
    )
      return publish(e.id, fallback(e), 'fallback', clock() - start);
    const user = await store.get('users', e.owner),
      recent = (user?.recentScenes || []).filter(
        (r) => r.at > start - 7 * 86400000
      );
    const input = sceneInput(e, recent);
    let reason = 'fallback';
    for (let attempt = 0; attempt < 2 && clock() < deadline - 150; attempt++) {
      try {
        const candidate = validateScene(
          await chat(
            e.owner,
            [
              { role: 'system', content: GENERATE },
              { role: 'user', content: JSON.stringify(input) }
            ],
            deadline,
            0.9
          ),
          input,
          recent
        );
        const review = await chat(
          e.owner,
          [
            { role: 'system', content: REVIEW },
            {
              role: 'user',
              content: JSON.stringify({ input, scene: candidate })
            }
          ],
          deadline,
          0
        );
        if (
          !review ||
          Object.keys(review).join() !== 'safe' ||
          review.safe !== true
        )
          throw new Error('SEMANTIC_REJECTED');
        return publish(e.id, candidate, 'ai', clock() - start);
      } catch (error) {
        reason =
          /^(SCENE_|AI_|SEMANTIC_|HTTP_|TIMEOUT|NETWORK_|INVALID_JSON)/.test(
            error.message
          )
            ? error.message
            : 'AI_FAILED';
      }
    }
    const output = await publish(
      e.id,
      fallback(e),
      'fallback',
      clock() - start
    );
    // Store only a bounded reason code; never provider response bodies, prompts with secrets, or headers.
    await store.transaction(async (tx) => {
      const auditId = digest(e.id + ':generation');
      await tx.put('aiAudit', auditId, {
        id: auditId,
        eventId: e.id,
        reason,
        createdAt: clock()
      });
    });
    return output;
  }
  return { ensureReady };
}
module.exports = {
  createScenePipeline,
  validateScene,
  sceneInput,
  fallback,
  similar,
  hasImaginaryNarration,
  needsStyleRepair
};
