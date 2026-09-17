const test = require('node:test');
const assert = require('node:assert/strict');
const core = '../uniCloud-aliyun/cloudfunctions/common/jdml-core/';
const { TASTES, DISCOVERIES, chooseAutomatic } = require(core + 'story-flavor');
const D = require(core + 'domain');
const { createService } = require(core + 'service');
const { createScenePipeline, sceneInput, validateScene } = require(core + 'ai');
const { normalizeConfig } = require(core + 'config');
const { createMemoryStore } = require('./memory-store.cjs');
function fixture() {
  let time = Date.parse('2026-09-17T00:00:00Z'),
    n = 0;
  const store = createMemoryStore();
  const service = createService(store, () => time, {
    scheduler: true,
    scenes: true,
    internal: true
  });
  return {
    store,
    clock: () => time,
    time: (v) => (time = v),
    call: (action, input = {}, requestId) =>
      service.run(
        'taste-user',
        action,
        input,
        requestId || 'taste_request_' + ++n
      )
  };
}
test('剧情口味默认各来一半，三档可保存，非法值不能进入生成逻辑', () => {
  const base = { daily: 2000, habits: ['milk_tea'] };
  assert.equal(D.preferences(base).storyTaste, 'balanced');
  for (const storyTaste of Object.keys(TASTES))
    assert.equal(D.preferences({ ...base, storyTaste }).storyTaste, storyTaste);
  for (const storyTaste of ['', null, 'other', 'constructor', 50])
    assert.throws(() => D.preferences({ ...base, storyTaste }), {
      code: 'INVALID_SETTINGS'
    });
});
test('可选场景足够时，三档长期比例准确，并尽量不重复同一商品', () => {
  for (const [taste, expected] of [
    ['familiar', 80],
    ['balanced', 50],
    ['adventurous', 20]
  ]) {
    let credit = 50,
      lastItem = '',
      habits = 0;
    for (let i = 0; i < 100; i++) {
      const chosen = chooseAutomatic(
        {
          habits: [{ key: 'a' }, { key: 'b' }],
          discoveries: [{ key: 'c' }, { key: 'd' }],
          taste,
          credit,
          lastItem
        },
        () => 0
      );
      assert.notEqual(chosen.option.key, lastItem);
      if (chosen.source === 'habit') habits++;
      credit = chosen.creditAfter;
      lastItem = chosen.option.key;
    }
    assert.equal(habits, expected);
  }
});
test('来源受预算限制时可换到有资格的一组，两组都不可用则跳过', () => {
  const base = { habits: [], discoveries: [{ key: 'c' }], taste: 'familiar' };
  assert.equal(chooseAutomatic(base, () => 0).source, 'discovery');
  assert.equal(
    chooseAutomatic({ ...base, discoveries: [] }, () => 0),
    null
  );
  assert.equal(
    chooseAutomatic(
      {
        ...base,
        taste: 'adventurous',
        habits: [{ key: 'a' }],
        discoveries: []
      },
      () => 0
    ).source,
    'habit'
  );
});
test('实际调度跨天保存比例，刷新、主动消费和跳过不重复记次数', async () => {
  for (const [storyTaste, expected] of [
    ['familiar', 16],
    ['balanced', 10],
    ['adventurous', 4]
  ]) {
    const f = fixture();
    let own = 0;
    const start = f.clock();
    for (let i = 0; i < 20; i++) {
      f.time(start + i * D.DAY);
      await f.call('settings', {
        daily: 10000,
        habits: ['milk_tea'],
        storyTaste
      });
      const day = Object.values(f.store.snapshot().days).find(
        (d) => d.date === D.dateKey(f.clock())
      );
      f.time(day.plan[0].dueAt);
      const e = (await f.call('tick')).event;
      assert.ok(e && e.state === 'offered');
      if (e.sceneSource === 'habit') own++;
      else assert.ok(e.amount >= 500 && e.amount <= 3000);
      const user = await f.store.get('users', 'taste-user');
      await f.call('bootstrap');
      await f.call('tick');
      const manual = await f.call('create', {
        kind: 'self',
        habit: 'milk_tea'
      });
      assert.equal(manual.sceneSource, 'manual');
      assert.equal(manual.habit, 'milk_tea');
      await f.call('skip', { id: e.id });
      assert.equal(
        (await f.store.get('users', 'taste-user')).storyMixCredit,
        user.storyMixCredit
      );
      const state = await f.call('bootstrap');
      assert.equal(state.automaticBudget.spent, e.amount);
      assert.equal(state.user.preferences.storyTaste, storyTaste);
    }
    assert.equal(own, expected);
  }
});
test('预生成不更新比例；改口味取消旧草稿但不退每日额度或重置比例', async () => {
  const f = fixture();
  await f.call('settings', {
    daily: 2000,
    habit: 'milk_tea',
    storyTaste: 'balanced'
  });
  const first = (await f.call('tick')).event;
  await f.call('skip', { id: first.id });
  const credit = (await f.store.get('users', 'taste-user')).storyMixCredit;
  const slot = Object.values(f.store.snapshot().days)[0].plan.find(
    (s) => s.state === 'waiting'
  );
  f.time(slot.dueAt - 5 * 60000);
  const draft = (await f.call('tick')).event;
  assert.equal(draft.state, 'planned');
  assert.equal(draft.sceneSource, 'discovery');
  assert.equal(
    (await f.store.get('users', 'taste-user')).storyMixCredit,
    credit
  );
  await f.call('settings', {
    daily: 2000,
    habit: 'milk_tea',
    storyTaste: 'adventurous'
  });
  assert.equal((await f.store.get('events', draft.id)).state, 'cancelled');
  assert.equal(
    (await f.store.get('users', 'taste-user')).storyMixCredit,
    credit
  );
  assert.equal((await f.call('bootstrap')).automaticBudget.spent, first.amount);
  await f.call('settings', { daily: 2000, habit: 'milk_tea' });
  assert.equal(
    (await f.call('bootstrap')).user.preferences.storyTaste,
    'adventurous'
  );
});
test('自由场景不越过自动预算，不引入未选的烟酒槟榔，主动请客照常', async () => {
  const f = fixture();
  await f.call('settings', {
    daily: 500,
    habit: 'milk_tea',
    storyTaste: 'adventurous'
  });
  const e = (await f.call('tick')).event;
  assert.equal(e.sceneSource, 'discovery');
  assert.equal(e.amount, 500);
  assert.ok(!['smoke', 'drink', 'betel'].includes(e.habit));
  assert.ok(DISCOVERIES.every((h) => !/香烟|小酒|槟榔/.test(h.itemName)));
  const gift = await f.call('create', { kind: 'treat', habit: 'milk_tea' });
  assert.equal(gift.kind, 'treat');
  assert.equal(gift.habit, 'milk_tea');
  assert.equal((await f.call('bootstrap')).automaticBudget.spent, 500);
  const tiny = fixture();
  await tiny.call('settings', {
    daily: 100,
    habit: 'milk_tea',
    storyTaste: 'adventurous'
  });
  assert.equal((await tiny.call('tick')).event, null);
});
test('选择过的咖啡不被算成自由场景；主动可从商品库选咖啡但不改变推荐偏好', async () => {
  const f = fixture();
  await f.call('settings', {
    daily: 2000,
    habits: ['custom_coffee'],
    habitOptions: [
      { key: 'custom_coffee', name: '咖啡', min: 1000, max: 1000 }
    ],
    storyTaste: 'adventurous'
  });
  const e = (await f.call('tick')).event;
  assert.equal(e.sceneSource, 'discovery');
  assert.notEqual(e.habit, 'surprise_coffee');
  const manual = await f.call('create', {
    kind: 'self',
    habit: 'surprise_coffee',
    amount: 1800
  });
  assert.equal(manual.item, '咖啡');
  assert.equal(manual.amount, 1800);
  assert.equal(manual.sceneSource, 'manual');
  assert.deepEqual((await f.call('bootstrap')).user.preferences.habits, [
    'custom_coffee'
  ]);
});
test('自由来源与普通商品传给 AI，备用故事也采用真实生活叙事', async () => {
  const f = fixture();
  await f.call('settings', {
    daily: 2000,
    habit: 'milk_tea',
    storyTaste: 'adventurous'
  });
  const e = (await f.call('tick')).event;
  const raw = await f.store.get('events', e.id);
  const input = sceneInput(raw);
  assert.equal(input.scene_source, 'discovery');
  assert.equal(input.scene_kind, 'daily_joy');
  assert.equal(input.story_taste, 'adventurous');
  assert.equal(input.item_name, raw.item);
  const pipeline = createScenePipeline(f.store, normalizeConfig(), {
    clock: f.clock
  });
  const ready = await pipeline.ensureReady(e.id);
  assert.ok(!/空气|假装|虚拟/.test(ready.reason));
  assert.ok(ready.reason.includes(raw.item));
  for (const option of [
    ...Object.keys(D.ITEMS).map((key) => ({ key })),
    ...DISCOVERIES
  ]) {
    const item = D.itemFor(option);
    assert.ok(!/空气|假装/.test(item.name + item.reason));
    assert.ok(item.summary.length <= 20);
    validateScene(
      {
        title: item.title,
        body: item.reason,
        summary: item.summary,
        action_label: item.action,
        amount_cents: 1000,
        motif: 'approved_story'
      },
      { amount_cents: 1000, item_name: item.name }
    );
  }
});
