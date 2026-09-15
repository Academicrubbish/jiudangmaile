const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  createRuntime
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/runtime');
const {
  normalizeConfig
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/config');
const { createMemoryStore } = require('./memory-store.cjs');
test('业务入口完成 AI 生成，后台预生成的故事到点沿用，不重新调用模型', async () => {
  let now = Date.parse('2026-09-15T00:00:00Z'),
    i = 0,
    calls = 0,
    generations = 0;
  const store = createMemoryStore(),
    config = normalizeConfig({
      ai: { enabled: true, apiKey: 'test-only-secret', model: 'glm-5.2' }
    });
  const runtime = createRuntime(store, config, {
    clock: () => now,
    post: async (url, payload) => {
      calls++;
      const input = JSON.parse(payload.messages[1].content);
      const body = input.scene
        ? { safe: true }
        : {
            title: '今天的小小停顿',
            body: '想象你路过一家小店，窗边刚好空着。假装点一杯空气奶茶，坐一小会儿，给普通的一天留一点甜。',
            action_label: '这杯算我喝了',
            amount_cents: input.amount_cents,
            motif: 'scene_' + String.fromCharCode(97 + generations++)
          };
      if (!input.scene && generations > 1)
        body.body =
          '想象你翻开小店的菜单，挑了一份空气奶茶。换一个喜欢的杯子，在今天的空白里写下一点小小的开心。';
      return {
        choices: [
          { finish_reason: 'stop', message: { content: JSON.stringify(body) } }
        ]
      };
    }
  });
  const call = (a, v = {}) => runtime.call('a', a, v, 'runtime_request_' + ++i);
  await call('settings', { daily: 2000, habit: 'milk_tea' });
  const first = await call('create', { kind: 'self' });
  assert.equal(first.title, '今天的小小停顿');
  assert.equal(first.sceneReady, true);
  assert.equal(calls, 2);
  const refreshed = await call('bootstrap');
  assert.equal(refreshed.current.title, first.title);
  assert.equal(calls, 2);
  assert.equal(refreshed.capabilities?.apiKey, undefined);
  await call('accept', { id: first.id });
  await call('confirm', { id: first.id, amount: 1000 });
  const slot = Object.values(store.snapshot().days)[0].plan.find(
    (s) => s.state === 'waiting'
  );
  now = slot.dueAt - 10 * 60000;
  await runtime.tick();
  assert.equal(calls, 4);
  const prepared = Object.values(store.snapshot().events).find(
    (e) => e.state === 'planned'
  );
  assert.equal(prepared.source, 'zhipu-ai');
  now = slot.dueAt;
  await runtime.tick();
  const shown = (await call('bootstrap')).current;
  assert.equal(shown.reason, prepared.reason);
  assert.equal(calls, 4);
});
