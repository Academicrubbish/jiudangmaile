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
  summary: '窗边位置空着，准备先坐下',
  body: '路过奶茶店，平时抢不到的窗边位置刚好空着。准备买杯奶茶坐下，今天的位置比我本人更需要这杯。',
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
    {
      daily: 2000,
      habit: 'milk_tea',
      habitOptions: [{ key: 'milk_tea', min: 1000, max: 1000 }]
    },
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
  assert.equal(a.sceneSummary, scene.summary);
  assert.equal(b.sceneSummary, a.sceneSummary);
  const reviewedScene = JSON.parse(messages[1].messages[1].content).scene;
  assert.equal(reviewedScene.summary, scene.summary);
  assert.equal(b.reason, a.reason);
  const input = JSON.parse(messages[0].messages[1].content);
  assert.equal(input.nickname, undefined);
  assert.equal(input.owner, undefined);
  assert.equal(input.apiKey, undefined);
  assert.equal(input.amount_cents, 1000);
});
test('金额篡改、额外字段、倒霉、链接、已到账均被结构检查拒绝', () => {
  const input = { amount_cents: 1000, item_name: '奶茶' };
  for (const changed of [
    { ...scene, amount_cents: 999 },
    { ...scene, extra: 'hi' },
    {
      ...scene,
      body: '想象今天走路摔倒了，去小店假装买一杯奶茶，希望这一点小甜头可以转运。'
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
    item: '奶茶',
    unit: '杯',
    amount: 1000,
    kind: 'self'
  });
  assert.equal(input.time_band, 'afternoon');
});

test('自定义习惯传入模型保持物品与金额快照，模型关闭时仍可生成小事', async () => {
  const f = await fixture(),
    key = 'custom_coffee_01';
  const svc = createService(f.store, () => now, { scenes: true });
  await svc.run(
    'a',
    'settings',
    {
      daily: 1000,
      habits: [key],
      habitOptions: [{ key, name: '咖啡', min: 1800, max: 1800 }]
    },
    'custom_settings_01'
  );
  const e = await svc.run(
    'a',
    'create',
    { kind: 'self', habit: key },
    'custom_create_001'
  );
  const raw = await f.store.get('events', e.id),
    input = sceneInput(raw);
  assert.equal(input.persona, '咖啡');
  assert.equal(input.item_name, '咖啡');
  assert.equal(input.amount_cents, 1800);
  const pipeline = createScenePipeline(
    f.store,
    normalizeConfig({ ai: { enabled: false } }),
    { clock: () => now }
  );
  const ready = await pipeline.ensureReady(e.id);
  assert.ok(ready.reason.includes('咖啡'));
  assert.equal(ready.amount, 1800);
  assert.equal(ready.generation.state, 'ready');
});

test('剧情梗概必须完整且不超过模板长度，危险内容即使只出现在梗概也会被拦截', () => {
  const input = { amount_cents: 1000, item_name: '奶茶' };
  for (const summary of [
    undefined,
    '',
    '字'.repeat(21),
    '今天\n想喝奶茶',
    '😀'.repeat(11),
    '刚刚摔倒了，快来买杯奶茶',
    '这笔钱已到账了',
    '假装花十二块买杯奶茶',
    '送空气槟榔最后一程',
    '丑到能防灾了'
  ])
    assert.throws(() => validateScene({ ...scene, summary }, input));
});
test('备用故事也保存简短梗概，后续刷新不改写', async () => {
  const f = await fixture({ enabled: false });
  const p = createScenePipeline(f.store, f.config, { clock: () => now });
  const a = await p.ensureReady(f.e.id);
  assert.equal(a.generation.mode, 'fallback');
  assert.ok(a.sceneSummary.length >= 4 && a.sceneSummary.length <= 20);
  assert.equal((await p.ensureReady(f.e.id)).sceneSummary, a.sceneSummary);
});

test('空气商品与假装点单在四个文案字段都会被硬拦截，不误伤自然空气', () => {
  const { hasImaginaryNarration } = require(core + 'ai');
  const input = { amount_cents: 1000, item_name: '奶茶' };
  for (const changed of [
    { title: '买杯空气奶茶' },
    {
      body: '下午三点脑子开始糊，干脆下楼绕一圈。走到街角那家假装点了杯空气奶茶，捧着慢慢晃回来。'
    },
    { summary: '假装点杯奶茶，先坐一会' },
    { action_label: '假装点一杯' }
  ])
    assert.throws(() => validateScene({ ...scene, ...changed }, input), {
      message: 'SCENE_STYLE'
    });
  assert.equal(
    hasImaginaryNarration('店外空气很好，准备买杯奶茶边走边喝'),
    false
  );
  assert.equal(hasImaginaryNarration('空气净化器'), false);
  assert.equal(hasImaginaryNarration('空气凤梨'), false);
});
test('模型继续产出空气奶茶时，即使可返回 safe 也不放行，最终使用真实叙事备用文案', async () => {
  const f = await fixture();
  let calls = 0;
  const p = createScenePipeline(f.store, f.config, {
    clock: () => now,
    post: async () => {
      calls++;
      return response({
        ...scene,
        body: '下午三点脑子开始糊，干脆下楼绕一圈。走到街角那家假装点了杯空气奶茶，捧着慢慢晃回来。'
      });
    }
  });
  const e = await p.ensureReady(f.e.id);
  assert.equal(calls, 2); // two rejected generations, no review of invalid text
  assert.equal(e.generation.mode, 'fallback');
  assert.doesNotMatch(e.reason, /空气奶茶|假装|想象/);
  assert.equal(
    Object.values(f.store.snapshot().aiAudit)[0].reason,
    'SCENE_STYLE'
  );
});
test('旧商品快照不会继续把空气奶茶传给模型或注入备用故事', () => {
  const { fallback } = require(core + 'ai');
  const e = {
    id: 'legacy-item',
    habit: 'milk_tea',
    item: '空气奶茶',
    amount: 1000,
    kind: 'self',
    createdAt: now
  };
  assert.equal(sceneInput(e).item_name, '奶茶');
  assert.doesNotMatch(fallback(e).body, /空气奶茶|假装/);
});
test('未接受的旧个人事件原地修复，不重调模型、不改变金额或事件编号', async () => {
  const f = await fixture();
  await f.store.transaction(async (tx) => {
    const e = await tx.get('events', f.e.id);
    Object.assign(e, {
      item: '空气奶茶',
      reason: '下午三点假装点了杯空气奶茶。',
      generation: { state: 'ready', promptVersion: 'jdml-scene-2.2' }
    });
    await tx.put('events', e.id, e);
  });
  const p = createScenePipeline(f.store, f.config, {
    clock: () => now,
    post: async () => {
      throw new Error('must not call model');
    }
  });
  const e = await p.ensureReady(f.e.id);
  assert.equal(e.id, f.e.id);
  assert.equal(e.amount, f.e.amount);
  assert.equal(e.item, '奶茶');
  assert.equal(e.generation.promptVersion, 'jdml-scene-5.1');
  assert.equal(e.generation.repairedFromVersion, 'jdml-scene-2.2');
  assert.doesNotMatch(e.reason, /空气奶茶|假装/);
  assert.deepEqual(await p.ensureReady(f.e.id), e);
});
test('已接受的小票和已分享的请客事件不因风格更新而改写', async () => {
  for (const changes of [
    { state: 'accepted' },
    { state: 'confirmed' },
    { kind: 'treat', state: 'pending', token: 'shared' }
  ]) {
    const f = await fixture();
    await f.store.transaction(async (tx) => {
      const e = await tx.get('events', f.e.id);
      Object.assign(e, changes, {
        reason: '原来的空气奶茶故事',
        generation: { state: 'ready', promptVersion: 'old' }
      });
      await tx.put('events', e.id, e);
    });
    const before = await f.store.get('events', f.e.id);
    const p = createScenePipeline(f.store, f.config, { clock: () => now });
    assert.deepEqual(await p.ensureReady(f.e.id), before);
  }
});
