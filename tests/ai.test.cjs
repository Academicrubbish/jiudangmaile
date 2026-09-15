const test = require('node:test'),
  assert = require('node:assert/strict');
const core = '../uniCloud-aliyun/cloudfunctions/common/jdml-core/';
const { createService } = require(core + 'service');
const { createScenePipeline, validateScene, sceneInput } = require(core + 'ai');
const { normalizeConfig } = require(core + 'config');
const { createMemoryStore } = require('./memory-store.cjs');
const now = Date.parse('2026-09-15T05:00:00Z');
const scene = {
  title: '窗边有个小位置',
  body: '想象你路过一家小店，窗边刚好空着。假装点一杯空气奶茶，坐一小会儿，给普通的一天留一点甜。',
  action_label: '这杯算我喝了',
  amount_cents: 1000,
  motif: 'window_seat_tea'
};
const response = (body) => ({
  choices: [
    { finish_reason: 'stop', message: { content: JSON.stringify(body) } }
  ]
});
async function fixture(extra = {}) {
  const store = createMemoryStore(),
    config = normalizeConfig({
      ai: {
        enabled: true,
        apiKey: 'test-only-secret',
        model: 'glm-5.2',
        ...extra
      }
    });
  const service = createService(store, () => now, { scenes: true });
  await service.run(
    'a',
    'settings',
    { daily: 2000, habit: 'milk_tea' },
    'setup_request_123'
  );
  const e = await service.run(
    'a',
    'create',
    { kind: 'self' },
    'create_request_123'
  );
  return { store, config, e };
}
test('AI 通过独立复核后保存，刷新不重调，不向模型提供个人资料', async () => {
  const f = await fixture();
  let calls = 0;
  const messages = [];
  const p = createScenePipeline(f.store, f.config, {
    clock: () => now,
    post: async (url, payload, opts) => {
      calls++;
      messages.push(payload);
      assert.equal(opts.headers.Authorization, 'Bearer test-only-secret');
      return response(calls % 2 ? scene : { safe: true });
    }
  });
  const a = await p.ensureReady(f.e.id),
    b = await p.ensureReady(f.e.id);
  assert.equal(calls, 2);
  assert.equal(a.source, 'zhipu-ai');
  assert.equal(a.reason, scene.body);
  assert.equal(b.reason, a.reason);
  const input = JSON.parse(messages[0].messages[1].content);
  assert.equal(input.nickname, undefined);
  assert.equal(input.owner, undefined);
  assert.equal(input.apiKey, undefined);
  assert.equal(input.amount_cents, 1000);
});
test('金额篡改、额外字段、倒霉、链接、已到账均被结构检查拒绝', () => {
  const input = { amount_cents: 1000, item_name: '空气奶茶' };
  for (const changed of [
    { ...scene, amount_cents: 999 },
    { ...scene, extra: 'hi' },
    {
      ...scene,
      body: '想象今天走路摔倒了，去小店假装买一杯空气奶茶，希望这一点小甜头可以转运。'
    },
    { ...scene, body: scene.body + 'https://example.test' },
    { ...scene, title: '已到账一杯奶茶' }
  ])
    assert.throws(() => validateScene(changed, input));
  assert.equal(validateScene(scene, input).title, scene.title);
});
test('语义审核拒绝后使用预审故事，不输出危险候选', async () => {
  const f = await fixture();
  let calls = 0;
  const p = createScenePipeline(f.store, f.config, {
    clock: () => now,
    post: async () => response(++calls % 2 ? scene : { safe: false })
  });
  const e = await p.ensureReady(f.e.id);
  assert.equal(e.source, 'reviewed-library-v2');
  assert.notEqual(e.reason, scene.body);
  assert.equal(calls, 4);
});
test('接口失败最多重试一次并保留兜底，审计不保存密钥或服务响应', async () => {
  const f = await fixture();
  let calls = 0;
  const p = createScenePipeline(f.store, f.config, {
    clock: () => now,
    post: async () => {
      calls++;
      throw new Error('untrusted upstream: test-only-secret');
    }
  });
  const e = await p.ensureReady(f.e.id);
  assert.equal(calls, 2);
  assert.equal(e.generation.mode, 'fallback');
  assert.ok(!JSON.stringify(f.store.snapshot()).includes('test-only-secret'));
});
test('并发生成只发起一条链路，已固定兜底不被迟到结果改写', async () => {
  const f = await fixture();
  let resolveFirst;
  const wait = new Promise((r) => (resolveFirst = r));
  let calls = 0;
  const p = createScenePipeline(f.store, f.config, {
    clock: () => now,
    post: async () => {
      calls++;
      if (calls === 1) {
        await wait;
        return response(scene);
      }
      return response({ safe: true });
    }
  });
  const slow = p.ensureReady(f.e.id);
  while (calls === 0) await new Promise((r) => setImmediate(r));
  const frozen = await p.ensureReady(f.e.id);
  resolveFirst();
  const late = await slow;
  assert.equal(frozen.generation.mode, 'fallback');
  assert.equal(late.reason, frozen.reason);
  assert.equal(calls, 2);
});
test('未开启模型或额度用尽时不调用供应商', async () => {
  const f = await fixture({ maxCallsPerUserDay: 0 });
  let calls = 0;
  const e = await createScenePipeline(f.store, f.config, {
    clock: () => now,
    post: async () => {
      calls++;
      return response(scene);
    }
  }).ensureReady(f.e.id);
  assert.equal(calls, 0);
  assert.equal(e.generation.mode, 'fallback');
});
test('供应商超时后不进行审核，不发布迟到文本', async () => {
  const f = await fixture();
  f.config.ai.interactiveBudgetMs = 1000;
  let clock = now,
    calls = 0;
  const e = await createScenePipeline(f.store, f.config, {
    clock: () => clock,
    post: async () => {
      calls++;
      clock += 5000;
      return response(scene);
    }
  }).ensureReady(f.e.id);
  assert.equal(calls, 1);
  assert.equal(e.generation.mode, 'fallback');
});
test('预先生成按照到期时段写作，不按提前准备的时段', () => {
  const input = sceneInput({
    id: 'sample',
    createdAt: Date.parse('2026-09-15T03:50:00Z'),
    dueAt: Date.parse('2026-09-15T04:10:00Z'),
    habit: 'milk_tea',
    item: '空气奶茶',
    unit: '杯',
    amount: 1000,
    kind: 'self'
  });
  assert.equal(input.time_band, 'afternoon');
});
