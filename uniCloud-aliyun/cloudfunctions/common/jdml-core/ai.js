'use strict';
const { postJSON } = require('./http');
const { GENERATE, REVIEW, VERSION } = require('./prompts');
const { dateKey, ITEMS } = require('./domain');
const { validSceneSummary } = require('./subscription-template');
const crypto = require('crypto');
const Gift = require('./gift-messages');
const Library = require('./scene-library');
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
  return intersection / Math.max(1, x.size + y.size - intersection) > 0.68;
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
      (r) =>
        similar(
          (r.body || '').split(r.item || input.item_name).join('商品'),
          scene.body.split(input.item_name).join('商品')
        ) || r.motif === scene.motif
    )
  )
    throw new Error('SCENE_DUPLICATE');
  return scene;
}
function sceneInput(event, recent = [], attempt = 0) {
  const hour = new Date(
    (event.dueAt || event.createdAt) + 8 * 3600000
  ).getUTCHours();
  const n = parseInt(digest(event.id).slice(0, 4), 16);
  const angles = [
    ['public_opinion', '别人随口的一句评价，引出一个出人意料的购买决定'],
    ['small_detail', '在普通细节里发现一个别人不会在意的用途'],
    ['self_rule', '给自己定过的规矩，今天被自己认真钻了空子'],
    ['conversation', '为了让一段普通聊天能继续，安排了一次小消费'],
    ['evidence', '想证明一个很小的观点，却认真买来做证据'],
    ['taste', '被别人看穿偏好，嘴上不承认，决定却很诚实'],
    ['preparation', '提前为一件还没确定的小事做了过分具体的准备'],
    ['wording', '认真咬文嚼字，把一句普通介绍理解成了购买理由'],
    ['camera', '一个拍照或画面的小细节，让人想安排这件东西'],
    ['comparison', '做了一个不太公平的小比较，还觉得自己的选择很客观'],
    ['unfinished', '为了给之前做过的一点功课一个交代，决定买下来'],
    ['reunion', '和熟人相处时的一点默契，变成了一个好笑的购买理由']
  ];
  const used = new Set(recent.slice(-6).map((r) => r.creativeAngle));
  const fresh = angles.filter(([key]) => !used.has(key));
  const pool = fresh.length ? fresh : angles;
  const angle = pool[(n + attempt) % pool.length];
  const sameItem = recent.filter((r) => r.item === storyItem(event)).slice(-5);
  const other = recent.filter((r) => !sameItem.includes(r)).slice(-5);
  const stories = [...other, ...sameItem].map((r) => ({
    item: String(r.item || '').slice(0, 24),
    body: String(r.body || '').slice(0, 180),
    motif: String(r.motif || '').slice(0, 60)
  }));
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
    creative_angle: angle[0],
    writing_seed: angle[1],
    setting_hint: [
      '路过街边小店',
      '整理房间时',
      '翻看商品页面',
      '朋友聊天时',
      '准备周末安排',
      '工作间隙'
    ][Math.floor(n / 13) % 6],
    relationship_hint: [
      '自己和自己的小规矩',
      '一个熟悉的朋友',
      '群聊里的随口一句',
      '来家里做客的朋友',
      '一起共事的同事'
    ][Math.floor(n / 79) % 5],
    recent_scenes: stories,
    recent_motifs: recent
      .slice(-10)
      .map((r) => r.motif)
      .filter(Boolean)
  };
}
function fallback(event, recent = []) {
  return Library.choose(event, recent, similar);
}
function failureCode(error) {
  const code = error?.message || '';
  return /^(SCENE_[A-Z_]+|AI_[A-Z_]+|GIFT_REVIEW|SEMANTIC_REJECTED|HTTP_[0-9]{3}|TIMEOUT|NETWORK_ERROR|INVALID_JSON)$/.test(
    code
  )
    ? code
    : 'AI_FAILED';
}
function recentFor(user, now) {
  return (user?.recentScenes || [])
    .filter((r) => r.at > now - 7 * 86400000)
    .slice(-30);
}

function createScenePipeline(
  store,
  config,
  { clock = Date.now, post = postJSON } = {}
) {
  async function quota(uid, purpose) {
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
      u.sceneCalls = u.sceneCalls ?? u.calls;
      u.giftCalls = u.giftCalls ?? 0;
      const field = purpose === 'gift' ? 'giftCalls' : 'sceneCalls';
      const limit =
        purpose === 'gift'
          ? config.ai.maxGiftCallsPerUserDay
          : config.ai.maxSceneCallsPerUserDay;
      if (g.calls >= config.ai.maxCallsGlobalDay) return 'AI_GLOBAL_QUOTA';
      if (u[field] >= limit)
        return purpose === 'gift' ? 'AI_GIFT_QUOTA' : 'AI_SCENE_QUOTA';
      u[field]++;
      u.calls++;
      g.calls++;
      await tx.put('aiUsage', uidKey, u);
      await tx.put('aiUsage', globalKey, g);
      return null;
    });
  }
  async function chat(uid, messages, deadline, temperature, purpose = 'scene') {
    const remaining = deadline - clock();
    if (remaining < 150) throw new Error('AI_TIMEOUT');
    const limitError = await quota(uid, purpose);
    if (limitError) throw new Error(limitError);
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
  async function publish(eventId, scene, status, elapsedMs, details = {}) {
    return store.transaction(async (tx) => {
      const event = await tx.get('events', eventId);
      if (!event || event.generation?.state === 'ready') return event;
      const editable = ['offered', 'pending', 'planned'].includes(event.state);
      const user = await tx.get('users', event.owner);
      const recent = recentFor(user, clock());
      let mode = editable ? status : 'fallback';
      let fallbackReason = editable ? details.reason : 'EVENT_CLOSED';
      if (mode === 'ai') {
        try {
          validateScene(
            scene,
            { item_name: storyItem(event), amount_cents: event.amount },
            recent
          );
        } catch (error) {
          mode = 'fallback';
          fallbackReason = failureCode(error);
        }
      }
      // Select inside the transaction, against the latest history, so simultaneous
      // events cannot freeze the same fallback when they read an older snapshot.
      const chosen = mode === 'ai' ? scene : fallback(event, recent);
      event.item = storyItem(event);
      event.title = chosen.title;
      event.reason = chosen.body;
      event.sceneSummary = chosen.summary;
      event.actionLabel = chosen.action_label;
      event.generation = {
        state: 'ready',
        mode,
        fallbackReason:
          mode === 'fallback' ? fallbackReason || 'AI_FAILED' : '',
        creativeAngle: mode === 'ai' ? details.angle || '' : chosen.motif,
        promptVersion: VERSION,
        model: config.ai.model,
        motif: chosen.motif,
        bodyHash: digest(chosen.body),
        elapsedMs,
        finishedAt: clock()
      };
      event.source = mode === 'ai' ? 'zhipu-ai' : 'reviewed-library-v4';
      await tx.put('events', eventId, event);
      if (event.token) {
        const inv = await tx.get('invites', digest(event.token));
        if (inv && inv.state === 'pending') {
          inv.reason = event.reason;
          await tx.put('invites', inv.id, inv);
        }
      }
      if (mode === 'fallback') {
        const auditId = digest(event.id + ':generation');
        await tx.put('aiAudit', auditId, {
          id: auditId,
          eventId: event.id,
          reason: event.generation.fallbackReason,
          createdAt: clock()
        });
      }
      if (user) {
        user.recentScenes = [
          ...(user.recentScenes || []),
          {
            eventId: event.id,
            item: event.item,
            motif: chosen.motif,
            body: chosen.body,
            creativeAngle: event.generation.creativeAngle,
            at: clock()
          }
        ]
          .filter((r) => r.at > clock() - 7 * 86400000)
          .slice(-30);
        await tx.put('users', user.id, user);
      }
      return event;
    });
  }
  async function ensureReady(
    eventId,
    { background = false, forceFallback = false, deadlineAt = Infinity } = {}
  ) {
    const start = clock(),
      budget = background
        ? config.ai.backgroundBudgetMs
        : config.ai.interactiveBudgetMs,
      deadline = Math.min(start + budget, deadlineAt);
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
        const owner = await tx.get('users', e.owner);
        const repaired = fallback(e, recentFor(owner, start));
        e.item = storyItem(e);
        e.title = repaired.title;
        e.reason = repaired.body;
        e.sceneSummary = repaired.summary;
        e.actionLabel = repaired.action_label;
        e.generation = {
          ...e.generation,
          mode: 'fallback',
          fallbackReason: 'STYLE_REPAIR',
          promptVersion: VERSION,
          motif: repaired.motif,
          bodyHash: digest(repaired.body),
          repairedFromVersion: oldVersion,
          styleRepairedAt: start
        };
        e.source = 'reviewed-library-v4';
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
      return publish(e.id, null, 'fallback', clock() - start, {
        reason: !claim.locked
          ? 'GENERATION_BUSY'
          : !config.ai.enabled
            ? 'AI_DISABLED'
            : forceFallback
              ? 'READ_FALLBACK'
              : 'EVENT_CLOSED'
      });
    const user = await store.get('users', e.owner),
      recent = recentFor(user, start);
    let reason = 'AI_TIMEOUT';
    for (let attempt = 0; attempt < 2 && clock() < deadline - 150; attempt++) {
      try {
        const input = sceneInput(e, recent, attempt);
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
        return publish(e.id, candidate, 'ai', clock() - start, {
          angle: input.creative_angle
        });
      } catch (error) {
        reason = failureCode(error);
        if (/^AI_.*QUOTA$|^AI_TIMEOUT$/.test(reason)) break;
      }
    }
    return publish(e.id, null, 'fallback', clock() - start, { reason });
  }

  async function giftMessages(uid, requestId, context) {
    const key = digest(uid + ':' + requestId);
    const start = clock(),
      deadline = start + config.ai.interactiveBudgetMs;
    // Use the authenticated operation record for retry caching and generation locking.
    const claim = await store.transaction(async (tx) => {
      const request = await tx.get('requests', key);
      if (
        !request ||
        request.owner !== uid ||
        request.action !== 'giftMessages'
      )
        throw new Error('GIFT_REQUEST');
      if (request.result.options) return { result: request.result };
      if (request.giftLeaseUntil > start) return { locked: false };
      request.giftLeaseUntil = deadline;
      await tx.put('requests', key, request);
      return { locked: true };
    });
    if (claim.result) return claim.result;
    let options = Gift.fallbackMessages(context.item, context.exclude),
      mode = 'fallback';
    let fallbackReason = !claim.locked
      ? 'GENERATION_BUSY'
      : !config.ai.enabled
        ? 'AI_DISABLED'
        : '';
    if (claim.locked && config.ai.enabled) {
      try {
        const input = {
          item: context.item,
          exclude: context.exclude,
          variation: crypto.randomBytes(8).toString('hex')
        };
        const candidate = Gift.validateCandidates(
          await chat(
            uid,
            [
              { role: 'system', content: Gift.GENERATE },
              { role: 'user', content: JSON.stringify(input) }
            ],
            deadline,
            0.95,
            'gift'
          ),
          context.exclude
        );
        const review = await chat(
          uid,
          [
            { role: 'system', content: Gift.REVIEW },
            {
              role: 'user',
              content: JSON.stringify({
                item: context.item,
                options: candidate
              })
            }
          ],
          deadline,
          0,
          'gift'
        );
        if (
          !review ||
          Object.keys(review).join() !== 'safe' ||
          review.safe !== true
        )
          throw new Error('GIFT_REVIEW');
        options = candidate;
        mode = 'ai';
      } catch (error) {
        fallbackReason = failureCode(error);
        // Timeout, unavailable provider, exhausted quota or rejected text: keep the safe choices.
      }
    }
    return store.transaction(async (tx) => {
      const request = await tx.get('requests', key);
      // A concurrent fallback or successful retry wins; late responses never replace it.
      if (request.result.options) return request.result;
      request.result = { item: context.item, options, mode };
      request.giftFallbackReason = mode === 'fallback' ? fallbackReason : '';
      if (mode === 'fallback') {
        const auditId = digest(key + ':gift');
        await tx.put('aiAudit', auditId, {
          id: auditId,
          requestId: key,
          purpose: 'gift',
          reason: fallbackReason,
          createdAt: clock()
        });
      }
      request.giftLeaseUntil = 0;
      await tx.put('requests', key, request);
      return request.result;
    });
  }
  return { ensureReady, giftMessages };
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
