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
            summary: '门口那杯奶茶越看越顺眼',
            body: `路过小店发现${input.item_name}摆在门口，越看越顺眼。准备带一份回去，总得对自己挑东西的眼光有点信心。`,
            action_label: '这杯算我喝了',
            amount_cents: input.amount_cents,
            motif: 'scene_' + String.fromCharCode(97 + generations++)
          };
      if (!input.scene && generations > 1)
        body.body = `今天忽然想安排一份${input.item_name}，朋友说这很像我的风格。准备认真维护一下自己的形象，挑完这一份就先回家。`;
      return {
        choices: [
          { finish_reason: 'stop', message: { content: JSON.stringify(body) } }
        ]
      };
    }
  });
  const call = (a, v = {}) => runtime.call('a', a, v, 'runtime_request_' + ++i);
  await call('settings', { daily: 2000, habit: 'milk_tea' });
  const first = (await call('bootstrap')).randomEvent;
  assert.equal(first.title, '今天的小小停顿');
  assert.equal(first.sceneReady, true);
  assert.equal(calls, 2);
  const refreshed = await call('bootstrap');
  assert.equal(refreshed.randomEvent.title, first.title);
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
  const shown = (await call('bootstrap')).randomEvent;
  assert.equal(shown.reason, prepared.reason);
  assert.equal(calls, 4);
});

test('进入小程序补发已到时间的事件，只查看列表不会清除未读', async () => {
  const store = createMemoryStore(),
    config = normalizeConfig({ ai: { enabled: false } });
  const runtime = createRuntime(store, config, {
    clock: () => Date.parse('2026-09-15T02:00:00Z')
  });
  await runtime.call(
    'u',
    'settings',
    { daily: 2000, habits: ['milk_tea'] },
    'setup_unread_001'
  );
  const a = await runtime.call('u', 'bootstrap');
  assert.equal(a.unreadCount, 1);
  assert.equal(a.randomEvent.unread, true);
  const b = await runtime.call('u', 'bootstrap');
  assert.equal(b.randomEvent.id, a.randomEvent.id);
  assert.equal(b.unreadCount, 1);
  await assert.rejects(
    runtime.call('other', 'seen', { id: a.randomEvent.id }, 'seen_other_001'),
    { code: 'NOT_FOUND' }
  );
  await runtime.call('u', 'seen', { id: a.randomEvent.id }, 'seen_own_0001');
  const c = await runtime.call('u', 'bootstrap');
  assert.equal(c.unreadCount, 0);
  assert.equal(c.randomEvent.state, 'offered');
  assert.equal(c.todayConfirmed, 0);
});

test('前台暂缓的未读小事离开后补发，同一天第二个事件仍能提醒且不重复生成', async () => {
  let now = Date.parse('2026-09-15T00:00:00Z'),
    seq = 0,
    sends = 0;
  const store = createMemoryStore();
  const runtime = createRuntime(
    store,
    normalizeConfig({
      ai: { enabled: false },
      subscription: { enabled: true }
    }),
    {
      clock: () => now,
      getAccessToken: async () => ({ access_token: 'test' }),
      post: async () => {
        sends++;
        return { errcode: 0 };
      }
    }
  );
  const call = (action, input = {}) =>
    runtime.call('a', action, input, 'daily_reminder_' + ++seq);
  await call('settings', { daily: 2000, habit: 'milk_tea' });
  const home = await call('bootstrap');
  let granted = await call('subscription', {
    intent: home.reminders.intent,
    result: 'accept'
  });
  await call('subscription', { intent: granted.intent, result: 'accept' });
  assert.equal(sends, 0);
  now += 6 * 60000;
  assert.equal((await runtime.tick()).notices, 1);
  const first = await store.get('events', home.randomEvent.id);
  assert.equal(first.reason, home.randomEvent.reason);
  now += 6 * 60000;
  await runtime.tick();
  assert.equal(sends, 1);
  await call('skip', { id: first.id });
  const slot = Object.values(store.snapshot().days)[0].plan.find(
    (s) => s.state === 'waiting'
  );
  now = slot.dueAt - 10 * 60000;
  await runtime.tick();
  now = slot.dueAt;
  assert.equal((await runtime.tick()).notices, 1);
  assert.equal(sends, 2);
  assert.equal(store.snapshot().users.a.subscriptionCredits, 0);
});

test('凭据暂不可用时保留待提醒事件，恢复后补发一次', async () => {
  let now = Date.parse('2026-09-15T00:00:00Z'),
    seq = 0,
    tokens = 0,
    sends = 0;
  const store = createMemoryStore();
  const runtime = createRuntime(
    store,
    normalizeConfig({
      ai: { enabled: false },
      subscription: { enabled: true }
    }),
    {
      clock: () => now,
      getAccessToken: async () => {
        tokens++;
        return tokens === 1 ? null : { access_token: 'test' };
      },
      post: async () => {
        sends++;
        return { errcode: 0 };
      }
    }
  );
  const call = (a, input = {}) =>
    runtime.call('a', a, input, 'retry_reminder_' + ++seq);
  await call('settings', { daily: 2000, habit: 'milk_tea' });
  const s = await call('bootstrap');
  await call('subscription', { intent: s.reminders.intent, result: 'accept' });
  now += 6 * 60000;
  assert.equal((await runtime.tick()).notices, 0);
  assert.equal(store.snapshot().users.a.subscriptionCredits, 1);
  now += 6 * 60000;
  assert.equal((await runtime.tick()).notices, 1);
  assert.equal(sends, 1);
  assert.equal(store.snapshot().users.a.randomEventId, s.randomEvent.id);
});

test('暂缓提醒后用户已读或暂停时，后台不会为凑每日一次而发消息', async () => {
  for (const stop of ['seen', 'pauseReminders']) {
    let now = Date.parse('2026-09-15T00:00:00Z'),
      seq = 0,
      sends = 0;
    const store = createMemoryStore();
    const runtime = createRuntime(
      store,
      normalizeConfig({
        ai: { enabled: false },
        subscription: { enabled: true }
      }),
      {
        clock: () => now,
        getAccessToken: async () => ({ access_token: 'test' }),
        post: async () => {
          sends++;
          return { errcode: 0 };
        }
      }
    );
    const call = (a, input = {}) =>
      runtime.call('a', a, input, 'stop_reminder_' + ++seq);
    await call('settings', { daily: 2000, habit: 'milk_tea' });
    const s = await call('bootstrap');
    await call('subscription', {
      intent: s.reminders.intent,
      result: 'accept'
    });
    await call(stop, stop === 'seen' ? { id: s.randomEvent.id } : {});
    now += 6 * 60000;
    await runtime.tick();
    assert.equal(sends, 0);
  }
});

test('首页读取已经 ready 的旧空气故事也会触发修复，不能被缓存早退绕过', async () => {
  const now = Date.parse('2026-09-17T05:00:00Z');
  const store = createMemoryStore();
  const runtime = createRuntime(
    store,
    normalizeConfig({ ai: { enabled: false } }),
    { clock: () => now }
  );
  await runtime.call(
    'a',
    'settings',
    { daily: 2000, habit: 'milk_tea' },
    'style_settings_001'
  );
  const first = (await runtime.call('a', 'bootstrap')).randomEvent;
  await store.transaction(async (tx) => {
    const e = await tx.get('events', first.id);
    e.reason = '下午出门假装点了杯空气奶茶。';
    e.generation.promptVersion = 'old';
    await tx.put('events', e.id, e);
  });
  const after = (await runtime.call('a', 'bootstrap')).randomEvent;
  assert.equal(after.id, first.id);
  assert.equal(after.amount, first.amount);
  assert.doesNotMatch(after.reason, /空气奶茶|假装/);
});

test('统计入口免操作编号，直接聚合不触发场景补全', async () => {
  let posts = 0;
  const store = createMemoryStore();
  const runtime = createRuntime(
    store,
    normalizeConfig({ ai: { enabled: true, apiKey: 'test-only-secret' } }),
    {
      clock: () => Date.parse('2026-09-15T02:00:00Z'),
      post: async () => {
        posts++;
        return {};
      }
    }
  );
  await runtime.call(
    'u',
    'settings',
    { daily: 2000, habit: 'milk_tea' },
    'stats_settings_0001'
  );
  const event = await runtime.call(
    'u',
    'create',
    { kind: 'self' },
    'stats_create_000001'
  );
  await runtime.call('u', 'accept', { id: event.id }, 'stats_accept_000001');
  await runtime.call(
    'u',
    'confirm',
    { id: event.id, amount: 1200 },
    'stats_confirm_000001'
  );
  const before = posts;
  const out = await runtime.call('u', 'stats', {}, '');
  assert.equal(out.savedTotal, 1200);
  assert.equal(out.savedCount, 1);
  assert.equal(out.momentsTotal, 1);
  assert.equal(posts, before);
});
