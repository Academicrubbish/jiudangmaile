const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  createService
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/service');
const D = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/domain');
const { createMemoryStore } = require('./memory-store.cjs');
function fixture() {
  let now = Date.parse('2026-09-15T02:00:00Z'),
    i = 0;
  const store = createMemoryStore(),
    s = createService(store, () => now);
  return {
    s,
    store,
    setNow: (v) => (now = Date.parse(v)),
    call: (uid, act, input = {}, key) =>
      s.run(
        uid,
        act,
        input,
        key || 'operation_' + (++i).toString().padStart(6, '0')
      )
  };
}
async function setup(f, uid = 'a', daily = 2000) {
  await f.call(uid, 'settings', { daily, habit: 'milk_tea' });
}
test('北京时间日界正确', () => {
  assert.equal(D.dateKey(Date.parse('2026-09-15T16:00:00Z')), '2026-09-16');
  assert.equal(
    D.dayEnd(Date.parse('2026-09-15T02:00:00Z')),
    Date.parse('2026-09-15T16:00:00Z')
  );
});
test('金额仅接受整数分及受限设置', () => {
  for (const n of [NaN, Infinity, -1, 0, 1.01, 100001])
    assert.throws(() => D.assertAmount(n));
  assert.throws(() => D.preferences({ daily: 150, habit: 'milk_tea' }));
  assert.throws(() => D.preferences({ daily: 2000, habit: 'unknown' }));
});
test('日额度共用，刷新不创建新事件，转存确认不会重记', async () => {
  const f = fixture();
  await setup(f);
  const e = await f.call('a', 'create', { kind: 'self' });
  assert.equal(e.amount, 1000);
  assert.equal((await f.call('a', 'create', { kind: 'self' })).id, e.id);
  await f.call('a', 'accept', { id: e.id });
  await Promise.all([
    f.call('a', 'confirm', { id: e.id, amount: 1200 }),
    f.call('a', 'confirm', { id: e.id, amount: 1200 })
  ]);
  const e2 = await f.call('a', 'create', { kind: 'self' });
  assert.equal(e2.amount, 800);
  assert.equal((await f.call('a', 'bootstrap')).todayConfirmed, 1200);
  await f.call('a', 'accept', { id: e2.id });
  await f.call('a', 'confirm', { id: e2.id, amount: 800 });
  await assert.rejects(f.call('a', 'create', {}), { code: 'DAILY_ENOUGH' });
});
test('相同操作编号重放结果，改变参数被拒绝', async () => {
  const f = fixture();
  await setup(f);
  const key = 'fixed_operation_123';
  const e = await f.call('a', 'create', { kind: 'self' }, key);
  await f.call('a', 'skip', { id: e.id });
  assert.equal((await f.call('a', 'create', { kind: 'self' }, key)).id, e.id);
  await assert.rejects(f.call('a', 'create', { kind: 'treat' }, key), {
    code: 'REQUEST_CONFLICT'
  });
});
test('预览不占名额，自领失败，并发最多一人成功', async () => {
  const f = fixture();
  await setup(f);
  const e = await f.call('a', 'create', { kind: 'treat' });
  assert.equal((await f.s.preview(e.token)).status, 'pending');
  await assert.rejects(f.call('a', 'claim', { token: e.token }), {
    code: 'SELF_CLAIM'
  });
  const r = await Promise.allSettled(
    ['b', 'c', 'd'].map((uid) => f.call(uid, 'claim', { token: e.token }))
  );
  assert.equal(r.filter((v) => v.status === 'fulfilled').length, 1);
  const recipient = Object.values(f.store.snapshot().invites)[0].recipient;
  const received = await f.call(recipient, 'detail', { id: e.id });
  assert.equal(received.role, 'recipient');
  assert.equal(received.token, undefined);
  assert.equal(received.deposit, undefined);
  assert.equal((await f.call(recipient, 'bootstrap')).todayConfirmed, 0);
  await assert.rejects(
    f.call(recipient, 'confirm', { id: e.id, amount: 1000 }),
    { code: 'NOT_FOUND' }
  );
  assert.equal((await f.s.history(recipient, 0)).events.length, 1);
});
test('过期邀请不可领取，额度释放', async () => {
  const f = fixture();
  await setup(f);
  const e = await f.call('a', 'create', { kind: 'treat' });
  f.setNow('2026-09-16T03:00:00Z');
  await assert.rejects(f.call('b', 'claim', { token: e.token }), {
    code: 'INVITE_CLOSED'
  });
  assert.equal((await f.s.preview(e.token)).status, 'expired');
  assert.notEqual((await f.call('a', 'create', { kind: 'self' })).id, e.id);
});
test('撤销请客释放额度，朋友无法接受', async () => {
  const f = fixture();
  await setup(f);
  const e = await f.call('a', 'create', { kind: 'treat' });
  await f.call('a', 'cancel', { id: e.id });
  await assert.rejects(f.call('b', 'claim', { token: e.token }), {
    code: 'INVITE_CLOSED'
  });
  assert.equal((await f.call('a', 'bootstrap')).available, 2000);
});
test('确认与撤销跨天正确归属', async () => {
  const f = fixture();
  await setup(f);
  const e = await f.call('a', 'create', { kind: 'self' });
  await f.call('a', 'accept', { id: e.id });
  f.setNow('2026-09-16T01:00:00Z');
  await f.call('a', 'confirm', { id: e.id, amount: 500 });
  assert.equal((await f.call('a', 'bootstrap')).todayConfirmed, 500);
  await f.call('a', 'undo', { id: e.id });
  assert.equal((await f.call('a', 'bootstrap')).todayConfirmed, 0);
  await f.call('a', 'confirm', { id: e.id, amount: 600 });
  assert.equal((await f.call('a', 'bootstrap')).todayConfirmed, 600);
});
test('未领取的请客不可确认；他人不得读取私有事件', async () => {
  const f = fixture();
  await setup(f);
  const e = await f.call('a', 'create', { kind: 'treat' });
  await assert.rejects(f.call('a', 'confirm', { id: e.id, amount: 1000 }), {
    code: 'EVENT_CLOSED'
  });
  await assert.rejects(f.call('b', 'detail', { id: e.id }), {
    code: 'FORBIDDEN'
  });
  assert.equal((await f.s.history('b', 0)).events.length, 0);
});
test('跳过不生成替补，只有主动创建才有新小事', async () => {
  const f = fixture();
  await setup(f);
  const e = await f.call('a', 'create', { kind: 'self' });
  await f.call('a', 'skip', { id: e.id });
  const state = await f.call('a', 'bootstrap');
  assert.equal(state.current, null);
  assert.equal(state.available, 2000);
});
test('未登录拒绝写入，失败事务不留半份邀请', async () => {
  const f = fixture();
  await assert.rejects(f.call('', 'create', {}), { code: 'LOGIN_REQUIRED' });
  await setup(f);
  await assert.rejects(f.call('a', 'create', { kind: 'treat', habit: 'bad' }), {
    code: 'INVALID_ITEM'
  });
  assert.equal(Object.keys(f.store.snapshot().events).length, 0);
  assert.equal(Object.keys(f.store.snapshot().invites).length, 0);
});
