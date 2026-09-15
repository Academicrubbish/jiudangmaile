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
      s.run('a', action, input, 'request_' + (++i).toString().padStart(8, '0'))
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
test('三个自然日不活跃就暂停，夜间首件可以现场出现', () => {
  const seen = Date.parse('2026-09-15T00:00:00Z');
  assert.equal(
    active({ ...user, lastSeenAt: seen }, Date.parse('2026-09-18T00:00:00Z')),
    false
  );
  const at = Date.parse('2026-09-15T15:30:00Z'),
    p = makePlan(user, at, { first: true });
  assert.equal(p.length, 1);
  assert.equal(p[0].dueAt, at);
});
test('首件占名额，未来提前准备、到点展示，定时重跑不重复', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  const first = await f.call('create', { kind: 'self' });
  await f.call('accept', { id: first.id });
  await f.call('confirm', { id: first.id, amount: first.amount });
  const day = Object.values(f.store.snapshot().days)[0],
    slot = day.plan.find((s) => s.state === 'waiting');
  assert.ok(slot);
  f.time(slot.dueAt - 10 * 60000);
  let result = await f.call('tick');
  assert.equal(result.event.state, 'planned');
  assert.equal(result.notify, false);
  assert.equal((await f.call('bootstrap')).current, null);
  f.time(slot.dueAt);
  result = await f.call('tick');
  assert.equal(result.event.state, 'offered');
  assert.equal(result.notify, true);
  const again = await f.call('tick');
  assert.equal(again.event, null);
  assert.equal(Object.keys(f.store.snapshot().events).length, 2);
});
test('主动消费替换已准备事件，不额外占用额度', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  const first = await f.call('create', { kind: 'self' });
  await f.call('accept', { id: first.id });
  await f.call('confirm', { id: first.id, amount: 1200 });
  const slot = Object.values(f.store.snapshot().days)[0].plan.find(
    (s) => s.state === 'waiting'
  );
  f.time(slot.dueAt - 10 * 60000);
  const prepared = (await f.call('tick')).event;
  assert.equal(prepared.amount, 800);
  const manual = await f.call('create', { kind: 'self' });
  assert.equal(manual.amount, 800);
  assert.notEqual(manual.id, prepared.id);
  f.time(slot.dueAt);
  assert.equal((await f.call('tick')).event, null);
  assert.equal((await f.call('bootstrap')).current.id, manual.id);
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

test('当天修改设置不重置已发生的自动事件计数', async () => {
  const f = fixture();
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  const first = await f.call('create', { kind: 'self' });
  await f.call('accept', { id: first.id });
  await f.call('confirm', { id: first.id, amount: 100 });
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  let day = Object.values(f.store.snapshot().days)[0];
  assert.equal(day.automaticCount, 1);
  assert.equal(day.plan.length, 1);
  const slot = day.plan[0];
  f.time(slot.dueAt);
  const e = (await f.call('tick')).event;
  await f.call('accept', { id: e.id });
  await f.call('confirm', { id: e.id, amount: 100 });
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  day = Object.values(f.store.snapshot().days)[0];
  assert.equal(day.automaticCount, 2);
  assert.equal(day.plan.length, 0);
});
