const test = require('node:test'),
  assert = require('node:assert/strict');
const core = '../uniCloud-aliyun/cloudfunctions/common/jdml-core/';
const { createNotifier } = require(core + 'notifications');
const { createService } = require(core + 'service');
const { createRuntime } = require(core + 'runtime');
const { normalizeConfig } = require(core + 'config');
const { createMemoryStore } = require('./memory-store.cjs');
async function fixture() {
  let now = Date.parse('2026-09-15T02:00:00Z'),
    i = 0;
  const store = createMemoryStore(),
    config = normalizeConfig({
      subscription: {
        enabled: true,
        templateId: 'template-test',
        data: { thing1: '有一件小事等你看看' }
      }
    });
  const service = createService(store, () => now, {
    subscription: true,
    templateId: config.subscription.templateId
  });
  const call = (a, v = {}) => service.run('a', a, v, 'notice_request_' + ++i);
  await call('settings', { daily: 2000, habit: 'milk_tea' });
  const e = await call('create', { kind: 'self' });
  const state = await call('bootstrap');
  await call('subscription', {
    intent: state.reminders.intent,
    result: 'accept'
  });
  now += 4 * 60000;
  return { store, config, e, call, clock: () => now, time: (n) => (now = n) };
}
test('一次许可、每天一次、并发只能发送一次；accepted 不等于已送达', async () => {
  const f = await fixture();
  let calls = 0;
  const notifier = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test-token' }),
    post: async (url, payload) => {
      calls++;
      assert.equal(payload.touser, 'openid-a');
      assert.equal(payload.data.thing1.value, '有一件小事等你看看');
      return { errcode: 0 };
    }
  });
  const result = await Promise.all([
    notifier.send('a', f.e.id),
    notifier.send('a', f.e.id)
  ]);
  assert.equal(calls, 1);
  assert.equal(result.filter((r) => r.state === 'accepted').length, 1);
  await notifier.send('a', f.e.id);
  assert.equal(calls, 1);
  assert.equal(Object.values(f.store.snapshot().notices)[0].state, 'accepted');
});
test('发送超时状态未知，后续执行绝不重发', async () => {
  const f = await fixture();
  let calls = 0;
  const notifier = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test-token' }),
    post: async () => {
      calls++;
      throw new Error('TIMEOUT');
    }
  });
  assert.equal((await notifier.send('a', f.e.id)).state, 'unknown');
  await notifier.send('a', f.e.id);
  assert.equal(calls, 1);
});
test('暂停、前台活跃和夜间都不调用消息接口', async () => {
  const f = await fixture();
  let calls = 0;
  const notifier = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test-token' }),
    post: async () => {
      calls++;
      return { errcode: 0 };
    }
  });
  await f.call('presence');
  await notifier.send('a', f.e.id);
  await f.call('pauseReminders');
  f.time(f.clock() + 4 * 60000);
  await notifier.send('a', f.e.id);
  f.time(Date.parse('2026-09-15T15:00:00Z'));
  assert.equal((await notifier.send('a', f.e.id)).state, 'quiet');
  assert.equal(calls, 0);
});
test('获取凭据期间暂停，会在真正发送前被拦截', async () => {
  const f = await fixture();
  let calls = 0;
  const n = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => {
      await f.call('pauseReminders');
      return { access_token: 'test-token' };
    },
    post: async () => {
      calls++;
      return { errcode: 0 };
    }
  });
  await n.send('a', f.e.id);
  assert.equal(calls, 0);
});
test('订阅意图只能消费一次，不能用旧意图伪造无限许可', async () => {
  const f = await fixture();
  const s = await f.call('bootstrap');
  await f.call('subscription', {
    intent: s.reminders.intent,
    result: 'reject'
  });
  await assert.rejects(
    f.call('subscription', { intent: s.reminders.intent, result: 'accept' }),
    { code: 'CONSENT_EXPIRED' }
  );
});
test('未配置模板保持关闭，公共业务入口拒绝 tick', async () => {
  const config = normalizeConfig({
    subscription: { enabled: true, templateId: '', data: {} }
  });
  assert.equal(config.subscription.enabled, false);
  const runtime = createRuntime(createMemoryStore(), config);
  await assert.rejects(runtime.call('a', 'tick', {}), {
    code: 'UNKNOWN_ACTION'
  });
});
