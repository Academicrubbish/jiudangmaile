const test = require('node:test'),
  assert = require('node:assert/strict');
const core = '../uniCloud-aliyun/cloudfunctions/common/jdml-core/';
const { createService } = require(core + 'service');
const { sceneInput } = require(core + 'ai');
const { createMemoryStore } = require('./memory-store.cjs');
async function fixture() {
  const store = createMemoryStore();
  let seq = 0;
  const service = createService(
    store,
    () => Date.parse('2026-09-17T02:00:00Z'),
    { scheduler: true, internal: true }
  );
  const call = (action, input = {}, uid = 'a', id) =>
    service.run(uid, action, input, id || 'shop_request_' + ++seq);
  await call('settings', {
    daily: 100,
    habits: ['milk_tea'],
    storyTaste: 'balanced',
    habitOptions: [{ key: 'milk_tea', min: 2000, max: 2500 }]
  });
  return { store, call, service };
}
test('只选奶茶也能看到完整商品库，主动消费可选择未勾选的内置和生活商品', async () => {
  const f = await fixture(),
    before = await f.call('bootstrap');
  assert.equal(before.capabilities.manualShop, true);
  for (const key of [
    'milk_tea',
    'smoke',
    'drink',
    'betel',
    'surprise_coffee',
    'surprise_snack',
    'surprise_pen',
    'surprise_cup'
  ])
    assert.ok(before.shopOptions.some((h) => h.key === key));
  for (const kind of ['self', 'treat'])
    for (const habit of ['smoke', 'surprise_coffee']) {
      const e = await f.call('create', { kind, habit, amount: 1875 });
      assert.equal(e.habit, habit);
      assert.equal(e.amount, 1875);
      assert.equal(e.sceneSource, 'manual');
    }
  const after = await f.call('bootstrap');
  assert.deepEqual(after.user.preferences, before.user.preferences);
  assert.deepEqual(after.automaticBudget, before.automaticBudget);
});
test('本次金额可以低于人设范围或高于每日随机额度，不会修改推荐范围', async () => {
  const f = await fixture();
  for (const amount of [100, 1599, 100000]) {
    const e = await f.call('create', {
      kind: 'self',
      habit: 'milk_tea',
      amount
    });
    assert.equal(e.amount, amount);
  }
  const state = await f.call('bootstrap');
  assert.equal(state.user.preferences.habitOptions[0].min, 2000);
  assert.equal(state.user.preferences.habitOptions[0].max, 2500);
  assert.equal(state.automaticBudget.spent, 0);
});
test('临时自定义商品只保存消费快照和稳定物品编号，重试不会重复创建', async () => {
  const f = await fixture();
  const input = {
    kind: 'self',
    customItem: { name: '  烤红薯  ', key: 'smoke' },
    amount: 1280
  };
  const first = await f.call('create', input, 'a', 'custom_retry_001');
  const again = await f.call('create', input, 'a', 'custom_retry_001');
  assert.equal(again.id, first.id);
  assert.equal(first.item, '烤红薯');
  assert.equal(first.amount, 1280);
  assert.match(first.habit, /^custom_manual_/);
  const raw = await f.store.get('events', first.id);
  assert.equal(sceneInput(raw).item_name, '烤红薯');
  assert.equal(sceneInput(raw).amount_cents, 1280);
  const next = await f.call('create', { ...input, amount: 1800 });
  assert.equal(next.habit, first.habit);
  assert.equal(
    (await f.call('bootstrap')).user.preferences.habitOptions.length,
    1
  );
  const history = await f.service.history('a');
  assert.ok(
    history.events.some((e) => e.item === '烤红薯' && e.amount === 1280)
  );
});
test('自定义商品请客仍是单人卡，双方保存相同名称金额，修改人设不改快照', async () => {
  const f = await fixture();
  const gift = await f.call('create', {
    kind: 'treat',
    customItem: { name: '电影票' },
    amount: 3990
  });
  const preview = await f.service.preview(gift.token);
  assert.equal(preview.item, '电影票');
  assert.equal(preview.amount, 3990);
  await f.call('settings', { daily: 2000, habits: ['drink'] });
  const recipient = await f.call('claim', { token: gift.token }, 'b');
  assert.equal(recipient.item, gift.item);
  assert.equal(recipient.amount, gift.amount);
  await assert.rejects(f.call('claim', { token: gift.token }, 'c'));
  assert.equal((await f.service.history('b')).events[0].item, '电影票');
  assert.equal((await f.call('detail', { id: gift.id })).item, '电影票');
});
test('非法商品或金额请求不替换当前事件，也不改推荐偏好', async () => {
  const f = await fixture();
  const current = await f.call('create', {
    kind: 'self',
    habit: 'milk_tea',
    amount: 2000
  });
  const pref = (await f.call('bootstrap')).user.preferences;
  const invalid = [
    ...[0, 99, 100001, 1.5, '1200', null].map((amount) => ({
      habit: 'milk_tea',
      amount
    })),
    { habit: 'not-in-catalog', amount: 1000 },
    { habit: 'custom_other_user', amount: 1000 },
    { customItem: { name: '' }, amount: 1000 },
    { customItem: { name: '字'.repeat(13) }, amount: 1000 },
    { customItem: { name: '<script>' }, amount: 1000 },
    { customItem: { name: '电影票' } },
    { customItem: { name: '电影票' }, habit: 'milk_tea', amount: 1000 },
    { customItem: [], amount: 1000 }
  ];
  for (const input of invalid)
    await assert.rejects(f.call('create', { kind: 'self', ...input }));
  const after = await f.call('bootstrap');
  assert.equal(after.current.id, current.id);
  assert.deepEqual(after.user.preferences, pref);
});
test('服务端停用商品不会出现在商品库，也不能通过已知编号创建', async () => {
  const f = await fixture();
  const restricted = createService(f.store, Date.now, {
    enabledHabits: ['milk_tea']
  });
  const state = await restricted.run('a', 'bootstrap');
  assert.ok(!state.shopOptions.some((h) => h.key === 'smoke'));
  assert.ok(state.shopOptions.some((h) => h.key === 'surprise_coffee'));
  await assert.rejects(
    restricted.run(
      'a',
      'create',
      { kind: 'self', habit: 'smoke', amount: 1000 },
      'disabled_shop_001'
    ),
    { code: 'INVALID_ITEM' }
  );
});
