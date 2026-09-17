const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const core = '../uniCloud-aliyun/cloudfunctions/common/jdml-core/';
const { createScenePipeline, validateScene, sceneInput } = require(core + 'ai');
const { createService } = require(core + 'service');
const { normalizeConfig } = require(core + 'config');
const { choices } = require(core + 'scene-library');
const { ITEMS, dateKey } = require(core + 'domain');
const { DISCOVERIES } = require(core + 'story-flavor');
const { createMemoryStore } = require('./memory-store.cjs');
const NOW = Date.parse('2026-09-17T05:00:00Z');
const digest = (s) => crypto.createHash('sha256').update(s).digest('hex');
const response = (body) => ({
  choices: [
    { finish_reason: 'stop', message: { content: JSON.stringify(body) } }
  ]
});
const gift = {
  teasing: '奶茶我请了，海底捞那边你看着安排。',
  warm: '东西是假的，刚刚想到你是真的。',
  poetic: '各自赶路也挺好，路过彼此的时候，记得坐一会儿。'
};
const subjects = [
  ...Object.entries(ITEMS).map(([key, row]) => ({ key, name: row.name })),
  ...DISCOVERIES.map((row) => ({ key: row.key, name: row.itemName })),
  { key: 'custom_manual_sample', name: '烤红薯' },
  { key: 'custom_manual_longname', name: '字'.repeat(12) }
];
async function fixture(ai = {}, deps = {}) {
  const store = createMemoryStore();
  const config = normalizeConfig({
    ai: { enabled: false, apiKey: 'test-secret', ...ai }
  });
  const service = createService(store, () => NOW, { scenes: true });
  let n = 0;
  const call = (action, input = {}) =>
    service.run('a', action, input, 'variety_request_' + ++n);
  await call('settings', { daily: 1000, habit: 'milk_tea' });
  const pipeline = createScenePipeline(store, config, {
    clock: () => NOW,
    ...deps
  });
  const create = async (habit = 'surprise_cat', kind = 'self') =>
    call('create', { habit, kind, amount: 1000 });
  const messages = async () => {
    const requestId = 'gift_variety_' + ++n;
    const context = await service.run(
      'a',
      'giftMessages',
      { kind: 'treat', habit: 'milk_tea', amount: 1000 },
      requestId
    );
    return pipeline.giftMessages('a', requestId, context);
  };
  return { store, config, service, call, pipeline, create, messages };
}
function model(_, payload) {
  const input = JSON.parse(payload.messages[1].content);
  if (input.scene || input.options) return response({ safe: true });
  if (input.item) return response(gift);
  return response(
    choices({
      id: 'model-sample',
      habit: 'surprise_cat',
      item: input.item_name,
      kind: input.interaction_mode || 'self',
      amount: input.amount_cents
    })[0]
  );
}

test('旧六次默认迁移为故事四十次和留言二十次，各自可调且显式关闭仍生效', () => {
  const old = normalizeConfig({ ai: { maxCallsPerUserDay: 6 } }).ai;
  assert.equal(old.maxSceneCallsPerUserDay, 40);
  assert.equal(old.maxGiftCallsPerUserDay, 20);
  assert.equal(old.maxCallsPerUserDay, undefined);
  const separate = normalizeConfig({
    ai: {
      maxCallsPerUserDay: 6,
      maxSceneCallsPerUserDay: 90,
      maxGiftCallsPerUserDay: 30
    }
  }).ai;
  assert.equal(separate.maxSceneCallsPerUserDay, 90);
  assert.equal(separate.maxGiftCallsPerUserDay, 30);
  const disabled = normalizeConfig({ ai: { maxCallsPerUserDay: 0 } }).ai;
  assert.equal(disabled.maxSceneCallsPerUserDay, 0);
  assert.equal(disabled.maxGiftCallsPerUserDay, 0);
  assert.equal(old.interactiveBudgetMs, 15000);
  assert.equal(old.backgroundBudgetMs, 40000);
});

test('任一用途的个人额度耗尽都不占用另一个用途的额度', async () => {
  for (const first of ['scene', 'gift']) {
    const f = await fixture(
      { enabled: true, maxSceneCallsPerUserDay: 2, maxGiftCallsPerUserDay: 2 },
      { post: model }
    );
    const scene = async () => f.pipeline.ensureReady((await f.create()).id);
    const run = (purpose) => (purpose === 'gift' ? f.messages() : scene());
    const firstResult = await run(first);
    assert.equal(
      first === 'gift' ? firstResult.mode : firstResult.generation.mode,
      'ai'
    );
    const exhausted = await run(first);
    assert.equal(
      first === 'gift' ? exhausted.mode : exhausted.generation.mode,
      'fallback'
    );
    const other = await run(first === 'gift' ? 'scene' : 'gift');
    assert.equal(first === 'gift' ? other.generation.mode : other.mode, 'ai');
    const usage = Object.values(f.store.snapshot().aiUsage).find(
      (row) => row.owner === 'a'
    );
    assert.equal(usage.sceneCalls, 2);
    assert.equal(usage.giftCalls, 2);
    assert.equal(usage.calls, 4);
  }
});

test('全局调用上限仍涵盖两种用途，回退有明确原因', async () => {
  const f = await fixture(
    { enabled: true, maxCallsGlobalDay: 2 },
    { post: model }
  );
  assert.equal((await f.messages()).mode, 'ai');
  const result = await f.pipeline.ensureReady((await f.create()).id);
  assert.equal(result.generation.fallbackReason, 'AI_GLOBAL_QUOTA');
  assert.equal(
    Object.values(f.store.snapshot().aiAudit)[0].reason,
    'AI_GLOBAL_QUOTA'
  );
  assert.equal(
    Object.values(f.store.snapshot().aiUsage).find((row) => !row.owner).calls,
    2
  );
});

test('旧版当天调用数保守迁入故事额度，不清零全局、不挤占新增留言额度', async () => {
  const f = await fixture({ enabled: true }, { post: model });
  const date = dateKey(NOW),
    userId = digest('a:' + date),
    globalId = 'global-' + date;
  await f.store.transaction(async (tx) => {
    await tx.put('aiUsage', userId, {
      id: userId,
      owner: 'a',
      date,
      calls: 6,
      createdAt: NOW
    });
    await tx.put('aiUsage', globalId, {
      id: globalId,
      date,
      calls: 6,
      createdAt: NOW
    });
  });
  assert.equal((await f.messages()).mode, 'ai');
  const usage = await f.store.get('aiUsage', userId);
  assert.equal(usage.sceneCalls, 6);
  assert.equal(usage.giftCalls, 2);
  assert.equal(usage.calls, 8);
  assert.equal((await f.store.get('aiUsage', globalId)).calls, 8);
});

test('丑猫抱枕六条不同备用情节先用完再轮换，同一小票重开保持原话', async () => {
  const f = await fixture();
  const results = [];
  for (let i = 0; i < 7; i++)
    results.push(await f.pipeline.ensureReady((await f.create()).id));
  assert.equal(new Set(results.slice(0, 6).map((e) => e.reason)).size, 6);
  assert.equal(results[6].reason, results[0].reason);
  assert.ok(results.every((e) => !e.reason.includes('镜子旁边')));
  const historySize = f.store.snapshot().users.a.recentScenes.length;
  assert.equal(
    (await f.pipeline.ensureReady(results[0].id)).reason,
    results[0].reason
  );
  assert.equal(f.store.snapshot().users.a.recentScenes.length, historySize);
});

test('内置商品和自由商品都有至少四种备用动机，请客和自定义商品各有六种', () => {
  for (const item of subjects) {
    for (const kind of ['self', 'treat']) {
      const scenes = choices({
        id: 'test',
        habit: item.key,
        item: item.name,
        kind,
        amount: 1000
      });
      assert.ok(scenes.length >= 4);
      assert.equal(new Set(scenes.map((s) => s.motif)).size, scenes.length);
      for (const scene of scenes)
        validateScene(scene, { item_name: item.name, amount_cents: 1000 });
      if (kind === 'treat' || item.key.startsWith('custom_'))
        assert.equal(scenes.length, 6);
    }
  }
});

test('并发创建不同事件时，备用故事按最新历史选择，不会同时抽到同一条', async () => {
  const f = await fixture();
  const a = await f.create('surprise_cat', 'treat'),
    b = await f.create('surprise_cat', 'treat');
  const [one, two] = await Promise.all([
    f.pipeline.ensureReady(a.id),
    f.pipeline.ensureReady(b.id)
  ]);
  assert.notEqual(one.reason, two.reason);
  assert.equal(f.store.snapshot().users.a.recentScenes.length, 2);
});

test('传入近期正文且优先带同商品历史，避免最近角度，重试换一个创作方向', () => {
  const event = {
    id: 'variety',
    createdAt: NOW,
    habit: 'surprise_cat',
    item: '丑猫抱枕',
    amount: 1000,
    kind: 'self'
  };
  const initial = sceneInput(event);
  const recent = [
    {
      item: '丑猫抱枕',
      body: '之前已经把丑猫放镜子旁边当参照物了。',
      motif: 'mirror_cat',
      creativeAngle: initial.creative_angle,
      at: NOW
    }
  ];
  const input = sceneInput(event, recent),
    retry = sceneInput(event, recent, 1);
  assert.equal(input.recent_scenes[0].body, recent[0].body);
  assert.notEqual(input.creative_angle, initial.creative_angle);
  assert.notEqual(input.creative_angle, retry.creative_angle);
  assert.ok(input.setting_hint && input.relationship_hint);
  assert.equal(input.owner, undefined);
});

test('换商品名重用同一段故事，即使笑点标签换了也被识别', () => {
  const old = choices({
    id: 'old',
    habit: 'custom_sample',
    item: '烤红薯',
    kind: 'self',
    amount: 1000
  })[0];
  const same = {
    ...old,
    body: old.body.replaceAll('烤红薯', '电影票'),
    motif: 'new_label'
  };
  assert.throws(
    () =>
      validateScene(same, { item_name: '电影票', amount_cents: 1000 }, [
        { ...old, item: '烤红薯' }
      ]),
    { message: 'SCENE_DUPLICATE' }
  );
});

test('AI 发布时再次检查最新历史，两个并发相同结果只发布一次，另一条改用不同备用', async () => {
  let written = 0,
    release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(
    { enabled: true },
    {
      post: async (url, payload) => {
        const data = JSON.parse(payload.messages[1].content);
        if (!data.scene) {
          written++;
          if (written === 2) release();
          await gate;
        }
        return model(url, payload);
      }
    }
  );
  const a = await f.create('surprise_cat', 'treat'),
    b = await f.create('surprise_cat', 'treat');
  const results = await Promise.all([
    f.pipeline.ensureReady(a.id),
    f.pipeline.ensureReady(b.id)
  ]);
  assert.equal(results.filter((e) => e.generation.mode === 'ai').length, 1);
  assert.notEqual(results[0].reason, results[1].reason);
  assert.equal(
    results.find((e) => e.generation.mode === 'fallback').generation
      .fallbackReason,
    'SCENE_DUPLICATE'
  );
});

test('模型关闭、只读兜底和个人配额回退都写入事件与审计，不记录供应商原文', async () => {
  for (const [config, options, expected] of [
    [{ enabled: false }, {}, 'AI_DISABLED'],
    [{ enabled: true }, { forceFallback: true }, 'READ_FALLBACK'],
    [{ enabled: true, maxSceneCallsPerUserDay: 0 }, {}, 'AI_SCENE_QUOTA']
  ]) {
    const f = await fixture(config, {
      post: async () => assert.fail('No provider call')
    });
    const e = await f.pipeline.ensureReady((await f.create()).id, options);
    assert.equal(e.generation.fallbackReason, expected);
    assert.equal(Object.values(f.store.snapshot().aiAudit)[0].reason, expected);
  }
  const f = await fixture(
    { enabled: true },
    {
      post: async () => {
        throw new Error('AI_BUDGET: private test-secret');
      }
    }
  );
  const e = await f.pipeline.ensureReady((await f.create()).id);
  assert.equal(e.generation.fallbackReason, 'AI_FAILED');
  assert.ok(!JSON.stringify(f.store.snapshot()).includes('test-secret'));
});

test('外层请求剩余时间限制模型等待，预算已耗尽时直接使用轮换文案', async () => {
  let calls = 0;
  const f = await fixture(
    { enabled: true },
    {
      post: async () => {
        calls++;
        return response(gift);
      }
    }
  );
  const e = await f.pipeline.ensureReady((await f.create()).id, {
    deadlineAt: NOW
  });
  assert.equal(calls, 0);
  assert.equal(e.generation.fallbackReason, 'AI_TIMEOUT');
});

test('历史小票和已经发出的请客卡不会因新版库而改写', async () => {
  const f = await fixture();
  for (const kind of ['self', 'treat']) {
    const e = await f.create('surprise_cat', kind);
    const first = await f.pipeline.ensureReady(e.id);
    if (kind === 'self') await f.call('accept', { id: e.id });
    const current = await f.store.get('events', e.id);
    current.generation.promptVersion = 'jdml-scene-5.1';
    await f.store.transaction(async (tx) => tx.put('events', e.id, current));
    assert.equal((await f.pipeline.ensureReady(e.id)).reason, first.reason);
    if (kind === 'treat')
      assert.equal((await f.service.preview(first.token)).reason, first.reason);
  }
});

test('备用选择也避开只换了措辞或标签的近期模型故事', () => {
  const { fallback } = require(core + 'ai');
  const event = {
    id: 'similar-library',
    habit: 'surprise_cat',
    item: '丑猫抱枕',
    kind: 'self',
    amount: 1000
  };
  const initial = fallback(event);
  const next = fallback(event, [
    {
      item: event.item,
      motif: 'different_model_label',
      body: initial.body + '我觉得行。',
      at: NOW
    }
  ]);
  assert.notEqual(next.motif, initial.motif);
});
