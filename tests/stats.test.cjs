const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  createService
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/service');
const { createMemoryStore } = require('./memory-store.cjs');
let counter = 0;
function fixture(options) {
  let now = Date.parse('2026-09-15T02:00:00Z');
  const store = createMemoryStore(),
    s = createService(store, () => now, options);
  return {
    s,
    store,
    setNow: (v) => (now = Date.parse(v)),
    call: (uid, act, input = {}) =>
      s.run(uid, act, input, 'stats_op_' + (++counter).toString().padStart(6, '0'))
  };
}
async function setup(f, uid = 'a', daily = 2000) {
  await f.call(uid, 'settings', { daily, habit: 'milk_tea' });
}
async function settle(f, uid, kind, amount) {
  const e = await f.call(uid, 'create', { kind });
  if (kind === 'self') await f.call(uid, 'accept', { id: e.id });
  else {
    const other = uid === 'a' ? 'b' : 'a';
    await f.call(other, 'claim', { token: e.token });
  }
  await f.call(uid, 'confirm', { id: e.id, amount });
  return e;
}
async function inject(store, event) {
  await store.transaction(async (tx) => {
    await tx.put('events', event.id, event);
  });
}
function rawEvent(id, uid, overrides = {}) {
  return {
    id,
    owner: uid,
    members: [uid],
    recipient: '',
    kind: 'self',
    habit: 'milk_tea',
    habitName: '奶茶',
    sceneSource: 'habit',
    item: '奶茶',
    amount: 1500,
    state: 'confirmed',
    createdAt: Date.parse('2026-09-10T02:00:00Z'),
    expiresAt: Date.parse('2026-09-20T02:00:00Z'),
    budgetDate: '2026-09-10',
    senderName: '',
    senderAvatar: '',
    recipientName: '',
    triggerSource: 'active',
    deposit: {
      amount: 1500,
      confirmedAt: Date.parse('2026-09-10T02:05:00Z'),
      date: '2026-09-10',
      revokedAt: null
    },
    ...overrides
  };
}

test('多天确认累计，连续天数与假装花费分开统计', async () => {
  const f = fixture();
  await setup(f);
  const day1 = await settle(f, 'a', 'self', 500);
  f.setNow('2026-09-16T02:00:00Z');
  const day2 = await settle(f, 'a', 'self', 700);
  f.setNow('2026-09-17T02:00:00Z');
  const day3 = await settle(f, 'a', 'self', 900);
  const out = await f.s.stats('a');
  assert.equal(out.savedTotal, 2100);
  assert.equal(out.savedCount, 3);
  assert.equal(out.streakDays, 3);
  assert.equal(out.momentsTotal, 3);
  assert.equal(out.treatsSent, 0);
  assert.equal(
    out.fakeSpentTotal,
    day1.amount + day2.amount + day3.amount
  );
  assert.equal(out.spanDays, 3);
  assert.equal(out.firstEventAt, day1.createdAt);
  assert.equal(out.truncated, false);
});

test('撤销转存后从战绩剔除，再玩梗只计入玩梗数', async () => {
  const f = fixture();
  await setup(f);
  const e = await settle(f, 'a', 'self', 500);
  let out = await f.s.stats('a');
  assert.equal(out.savedTotal, 500);
  await f.call('a', 'undo', { id: e.id });
  out = await f.s.stats('a');
  assert.equal(out.savedTotal, 0);
  assert.equal(out.savedCount, 0);
  assert.equal(out.streakDays, 0);
  assert.equal(out.momentsTotal, 1);
  assert.equal(out.playOnlyCount, 0);
  await f.call('a', 'playOnly', { id: e.id });
  out = await f.s.stats('a');
  assert.equal(out.savedTotal, 0);
  assert.equal(out.playOnlyCount, 1);
  assert.equal(out.momentsTotal, 1);
  assert.equal(out.fakeSpentTotal, e.amount);
});

test('请客只算发起方的战绩，收礼方只记被请次数', async () => {
  const f = fixture();
  await setup(f);
  await settle(f, 'a', 'treat', 1000);
  const mine = await f.s.stats('a');
  assert.equal(mine.savedTotal, 1000);
  assert.equal(mine.treatsSent, 1);
  assert.equal(mine.momentsTotal, 1);
  assert.equal(mine.habitBreakdown.length, 1);
  const theirs = await f.s.stats('b');
  assert.equal(theirs.treatsReceived, 1);
  assert.equal(theirs.savedTotal, 0);
  assert.equal(theirs.momentsTotal, 0);
  assert.equal(theirs.fakeSpentTotal, 0);
  assert.deepEqual(theirs.habitBreakdown, []);
});

test('未领取和已取消的请客不计入战绩', async () => {
  const f = fixture();
  await setup(f);
  const pending = await f.call('a', 'create', { kind: 'treat' });
  const second = await f.call('a', 'create', { kind: 'treat' });
  const closed = await f.call('a', 'cancel', { id: second.id });
  const out = await f.s.stats('a');
  assert.equal(out.treatsSent, 0);
  assert.equal(out.momentsTotal, 0);
  assert.equal(out.fakeSpentTotal, 0);
  assert.ok(pending.state === 'pending' && closed.state === 'cancelled');
});

test('未决定、跳过、计划与取消的定时事件不入统计', async () => {
  const f = fixture();
  await setup(f);
  const offered = await f.call('a', 'create', { kind: 'self' });
  const second = await f.call('a', 'create', { kind: 'self' });
  const skipped = await f.call('a', 'skip', { id: second.id });
  await inject(f.store, rawEvent('planned_one', 'a',
    { state: 'planned', triggerSource: 'scheduled', deposit: null }));
  await inject(f.store, rawEvent('cancelled_scheduled', 'a',
    { state: 'cancelled', triggerSource: 'scheduled', deposit: null }));
  const out = await f.s.stats('a');
  assert.equal(out.savedTotal, 0);
  assert.equal(out.momentsTotal, 0);
  assert.equal(out.fakeSpentTotal, 0);
  assert.equal(out.spanDays, 1);
  assert.ok(offered.state === 'offered' && skipped.state === 'skipped');
});

test('随机小插曲归入意外之喜，按次数排序', async () => {
  const f = fixture();
  await setup(f);
  await settle(f, 'a', 'self', 500);
  await inject(f.store, rawEvent('discovery_one', 'a', {
    habit: 'surprise_pen',
    habitName: '文具',
    sceneSource: 'discovery',
    amount: 2200,
    deposit: {
      amount: 2200,
      confirmedAt: Date.parse('2026-09-15T03:00:00Z'),
      date: '2026-09-15',
      revokedAt: null
    }
  }));
  const out = await f.s.stats('a');
  assert.equal(out.habitBreakdown.length, 2);
  assert.equal(out.habitBreakdown[0].name, '奶茶');
  assert.equal(out.habitBreakdown[1].key, '_discovery');
  assert.equal(out.habitBreakdown[1].name, '意外之喜');
  assert.equal(out.habitBreakdown[1].amount, 2200);
});

test('连续天数锚定今天或昨天，过期即归零', async () => {
  const today = fixture();
  await setup(today);
  await settle(today, 'a', 'self', 500);
  assert.equal((await today.s.stats('a')).streakDays, 1);

  const yesterday = fixture();
  await setup(yesterday);
  await settle(yesterday, 'a', 'self', 500);
  yesterday.setNow('2026-09-16T02:00:00Z');
  assert.equal((await yesterday.s.stats('a')).streakDays, 1);

  const stale = fixture();
  await setup(stale);
  await settle(stale, 'a', 'self', 500);
  stale.setNow('2026-09-18T02:00:00Z');
  const out = await stale.s.stats('a');
  assert.equal(out.streakDays, 0);
  assert.equal(out.savedTotal, 500);
});

test('超出上限截断，只统计最近的事件', async () => {
  const f = fixture({ stats: { page: 2, max: 5 } });
  for (let i = 0; i < 7; i++) {
    await inject(f.store, rawEvent('cap_' + i, 'a', {
      createdAt: Date.parse('2026-09-0' + (i + 1) + 'T02:00:00Z'),
      deposit: {
        amount: 1000 + i,
        confirmedAt: Date.parse('2026-09-0' + (i + 1) + 'T02:05:00Z'),
        date: '2026-09-0' + (i + 1),
        revokedAt: null
      }
    }));
  }
  const out = await f.s.stats('a');
  assert.equal(out.truncated, true);
  assert.equal(out.savedCount, 5);
  assert.equal(out.savedTotal, 1002 + 1003 + 1004 + 1005 + 1006);
  assert.equal(out.momentsTotal, 5);
});

test('统计为纯读操作，不留操作编号记录', async () => {
  const f = fixture();
  await setup(f);
  await settle(f, 'a', 'self', 500);
  const before = Object.keys(f.store.snapshot().requests).length;
  const first = await f.s.stats('a');
  const second = await f.s.stats('a');
  assert.equal(first.savedTotal, second.savedTotal);
  assert.equal(Object.keys(f.store.snapshot().requests).length, before);
});

test('空账号返回零战绩', async () => {
  const f = fixture();
  const out = await f.s.stats('a');
  assert.equal(out.savedTotal, 0);
  assert.equal(out.momentsTotal, 0);
  assert.equal(out.firstEventAt, null);
  assert.equal(out.truncated, false);
});
