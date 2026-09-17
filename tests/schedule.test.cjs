const test = require('node:test'),
  assert = require('node:assert/strict');
const core = '../uniCloud-aliyun/cloudfunctions/common/jdml-core/';
const { makePlan, isQuiet, active } = require(core + 'schedule');
const { createService } = require(core + 'service');
const { createMemoryStore } = require('./memory-store.cjs');
const D = require(core + 'domain');
function fixture() {
  let t = Date.parse('2026-09-15T00:00:00Z'),
    i = 0;
  const store = createMemoryStore(),
    s = createService(store, () => t, {
      scheduler: true,
      scenes: true,
      internal: true
    });
  return {
    store,
    s,
    clock: () => t,
    time: (n) => (t = n),
    call: (action, input = {}) =>
      s.run(
        'a',
        action,
        action === 'settings' ? { storyTaste: 'familiar', ...input } : input,
        'request_' + (++i).toString().padStart(8, '0')
      )
  };
}
const user = { id: 'a', preferences: { daily: 2000, habit: 'milk_tea' } };
test('计划稳定、最多两件、间隔三小时、绝不进入免打扰时段', () => {
  const now = Date.parse('2026-09-15T00:00:00Z');
  for (let i = 0; i < 500; i++) {
    const u = { ...user, id: String(i) },
      p = makePlan(u, now);
    assert.deepEqual(p, makePlan(u, now));
    assert.ok(p.length <= 2);
    for (const slot of p) assert.equal(isQuiet(slot.dueAt), false);
    if (p.length === 2) assert.ok(p[1].dueAt - p[0].dueAt >= 3 * 3600000);
  }
});
test('三个自然日不活跃就暂停，夜间首件计划不会绕过免打扰', () => {
  const seen = Date.parse('2026-09-15T00:00:00Z');
  assert.equal(
    active({ ...user, lastSeenAt: seen }, Date.parse('2026-09-18T00:00:00Z')),
    false
  );
  const at = Date.parse('2026-09-15T15:30:00Z'),
    p = makePlan(user, at, { first: true });
  assert.equal(p.length, 1);
  assert.equal(p[0].dueAt, at);
  assert.equal(isQuiet(p[0].dueAt), true);
});
test('首件自动事件立即到达，后续提前准备，到点只入账一次', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  const first = (await f.call('tick')).event;
  assert.equal(first.state, 'offered');
  assert.equal((await f.call('bootstrap')).unreadCount, 1);
  await f.call('skip', { id: first.id });
  const slot = Object.values(f.store.snapshot().days)[0].plan.find(
    (s) => s.state === 'waiting'
  );
  f.time(slot.dueAt - 10 * 60000);
  const prepared = (await f.call('tick')).event;
  assert.equal(prepared.state, 'planned');
  assert.equal((await f.call('bootstrap')).randomEvent, null);
  f.time(slot.dueAt);
  const delivered = await f.call('tick');
  assert.equal(delivered.event.id, prepared.id);
  assert.equal((await f.call('tick')).event, null);
  assert.equal((await f.call('bootstrap')).automaticBudget.spent, 2000);
});
test('主动消费不替换预生成事件，也不挤占其自动额度', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  const first = (await f.call('tick')).event;
  await f.call('skip', { id: first.id });
  const slot = Object.values(f.store.snapshot().days)[0].plan.find(
    (s) => s.state === 'waiting'
  );
  f.time(slot.dueAt - 10 * 60000);
  const prepared = (await f.call('tick')).event;
  const manual = await f.call('create', { kind: 'self' });
  await f.call('accept', { id: manual.id });
  await f.call('confirm', { id: manual.id, amount: 100000 });
  const gift = await f.call('create', { kind: 'treat' });
  f.time(slot.dueAt);
  assert.equal((await f.call('tick')).event.id, prepared.id);
  const state = await f.call('bootstrap');
  assert.equal(state.current.id, gift.id);
  assert.equal(state.randomEvent.id, prepared.id);
  assert.equal(state.automaticBudget.spent, 2000);
});
test('定时任务不会刷新用户活跃时间，长期不活跃取消唤醒', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  const old = await f.store.get('users', 'a');
  f.time(Date.parse('2026-09-18T02:00:00Z'));
  await f.call('tick');
  const after = await f.store.get('users', 'a');
  assert.equal(after.lastSeenAt, old.lastSeenAt);
  assert.equal(after.nextJobAt, null);
});
test('定时云函数拒绝伪造 Type=Timer 的客户端调用', async () => {
  const worker = require('../uniCloud-aliyun/cloudfunctions/jdml-worker');
  const r = await worker.main({ Type: 'Timer' }, { SOURCE: 'client' });
  assert.equal(r.code, 'FORBIDDEN');
});

test('跳过、改设置、确认和撤销均不退还已推出随机事件的额度', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  const first = (await f.call('tick')).event;
  await f.call('skip', { id: first.id });
  await f.call('settings', { daily: 2000, habits: ['milk_tea', 'smoke'] });
  let day = Object.values(f.store.snapshot().days)[0];
  assert.equal(day.automaticCount, 1);
  assert.equal(day.automaticSpent, 1000);
  f.time(day.plan[0].dueAt);
  const next = (await f.call('tick')).event;
  await f.call('accept', { id: next.id });
  await f.call('confirm', { id: next.id, amount: 1 });
  await f.call('undo', { id: next.id });
  await f.call('playOnly', { id: next.id });
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  day = Object.values(f.store.snapshot().days)[0];
  assert.equal(day.automaticSpent, 2000);
  assert.equal(day.automaticCount, 2);
  assert.equal(day.plan.length, 0);
  assert.ok((await f.call('create', { kind: 'self' })).id);
});
test('习惯范围高于预算时可安排生活小事，主动仍按完整范围生成', async () => {
  const f = fixture(),
    key = 'custom_flower_01';
  await f.call('settings', {
    daily: 1000,
    habits: [key],
    habitOptions: [{ key, name: '买花', min: 1200, max: 1500 }]
  });
  const free = (await f.call('tick')).event;
  assert.equal(free.sceneSource, 'discovery');
  assert.ok(free.amount >= 500 && free.amount <= 1000);
  assert.equal((await f.call('bootstrap')).automaticBudget.spent, free.amount);
  const manual = await f.call('create', { kind: 'self', habit: key });
  assert.ok(manual.amount >= 1200 && manual.amount <= 1500);
});
test('多选非首选习惯可预生成，删除习惯会取消旧草稿且不退已用预算', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habits: ['milk_tea', 'smoke'] });
  const first = (await f.call('tick')).event;
  await f.call('skip', { id: first.id });
  await f.store.transaction(async (tx) => {
    const u = await tx.get('users', 'a');
    u.lastRandomItem = 'milk_tea';
    await tx.put('users', 'a', u);
  });
  const slot = Object.values(f.store.snapshot().days)[0].plan.find(
    (s) => s.state === 'waiting'
  );
  f.time(slot.dueAt - 10 * 60000);
  const prepared = (await f.call('tick')).event;
  assert.equal(prepared.habit, 'smoke');
  await f.call('settings', { daily: 2000, habit: 'drink' });
  assert.equal((await f.store.get('events', prepared.id)).state, 'cancelled');
  assert.equal((await f.call('bootstrap')).automaticBudget.spent, 1000);
});
test('并发定时执行只推出一个事件，旧版预算能迁移且不重复收费', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  await Promise.all([f.call('tick'), f.call('tick')]);
  const day = Object.values(f.store.snapshot().days)[0];
  assert.equal(day.automaticSpent, 1000);
  await f.store.transaction(async (tx) => {
    delete day.automaticSpent;
    await tx.put('days', day.id, day);
  });
  assert.equal((await f.call('bootstrap')).automaticBudget.spent, 1000);
  assert.equal((await f.call('bootstrap')).automaticBudget.spent, 1000);
});

test('非免打扰时段至少安排一个候选，不因抽到已过的低概率时段而空缺', () => {
  for (const time of [
    '2026-09-15T00:00:00Z',
    '2026-09-15T13:30:00Z',
    '2026-09-15T13:59:40Z'
  ]) {
    const now = Date.parse(time);
    for (let i = 0; i < 500; i++) {
      const plan = makePlan({ ...user, id: String(i) }, now);
      assert.ok(plan.length >= 1);
      assert.ok(plan[0].dueAt >= now);
      assert.equal(isQuiet(plan[0].dueAt), false);
    }
  }
});

test('当天第一件即使任务迟到一小时也会补齐，不直接跳过', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  f.time(f.clock() + 2 * 3600000);
  const result = await f.call('tick');
  assert.equal(result.event.state, 'offered');
  assert.equal(result.notify, true);
  assert.equal(Object.values(f.store.snapshot().days)[0].automaticCount, 1);
});

test('已开启提醒且当前模板有授权时持续安排，不因三天没打开而停止', () => {
  const seen = Date.parse('2026-09-15T00:00:00Z'),
    now = seen + 10 * 86400000;
  const subscribed = {
    ...user,
    lastSeenAt: seen,
    reminderEnabled: true,
    subscriptionTemplateId: 't',
    subscriptionCredits: 3
  };
  assert.equal(active(subscribed, now, 't'), true);
  assert.equal(active(subscribed, now, 'changed-template'), false);
  assert.equal(
    active({ ...subscribed, subscriptionCredits: 0 }, now, 't'),
    false
  );
  assert.equal(
    active({ ...subscribed, reminderEnabled: false }, now, 't'),
    false
  );
});
