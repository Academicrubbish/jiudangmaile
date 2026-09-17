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
        templateId: '4CJkjeI05NBQ5JSjXbUyD3DWlJ-EiP6CxgUuSAauw9k'
      }
    });
  const service = createService(store, () => now, {
    scheduler: true,
    internal: true,
    subscription: true,
    templateId: config.subscription.templateId
  });
  const call = (a, v = {}) => service.run('a', a, v, 'notice_request_' + ++i);
  await call('settings', { daily: 2000, habit: 'milk_tea' });
  const e = (await call('tick')).event;
  const state = await call('bootstrap');
  await call('subscription', {
    intent: state.reminders.intent,
    result: 'accept'
  });
  now += 4 * 60000;
  return { store, config, e, call, clock: () => now, time: (n) => (now = n) };
}
test('一次许可、同一事件并发只能发送一次；accepted 不等于已送达', async () => {
  const f = await fixture();
  let calls = 0;
  const notifier = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test-token' }),
    post: async (url, payload) => {
      calls++;
      assert.equal(payload.touser, 'openid-a');
      assert.deepEqual(payload.data, {
        thing27: { value: '喝奶茶了' },
        amount21: { value: '￥' + (f.e.amount / 100).toFixed(2) },
        thing4: { value: '只是虚构消费，不会扣款' },
        thing3: { value: f.store.snapshot().events[f.e.id].sceneSummary }
      });
      assert.equal(payload.template_id, f.config.subscription.templateId);
      assert.equal(payload.page, 'pages/home/home?eventId=' + f.e.id);
      assert.equal(payload.miniprogram_state, 'developer');
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

test('已读的站内随机事件不再发送外部提醒，主动消费不抢占随机消息', async () => {
  const f = await fixture();
  await f.call('create', { kind: 'treat' });
  await f.call('seen', { id: f.e.id });
  f.time(f.clock() + 4 * 60000);
  let calls = 0;
  const n = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test-token' }),
    post: async () => {
      calls++;
      return { errcode: 0 };
    }
  });
  assert.equal((await n.send('a', f.e.id)).state, 'skipped');
  assert.equal(calls, 0);
});

const { buildSubscriptionData } = require(core + 'subscription-template');
test('事件名称取已复核的剧情标题，金额由整数分生成，短字段不含完整故事', () => {
  const config = normalizeConfig().subscription;
  const e = {
    title: '善心大发',
    reason: '这段完整剧情不应进入通知',
    sceneSummary: '今天想大方一下，假装请朋友一份',
    amount: 1234,
    generation: { mode: 'ai' }
  };
  assert.equal(buildSubscriptionData(config, e).thing27.value, '善心大发');
  assert.equal(buildSubscriptionData(config, e).thing3.value, e.sceneSummary);
  assert.deepEqual(Object.keys(buildSubscriptionData(config, e)), [
    'thing27',
    'amount21',
    'thing3',
    'thing4'
  ]);
  assert.equal(buildSubscriptionData(config, e).amount21.value, '￥12.34');
  assert.equal(
    JSON.stringify(buildSubscriptionData(config, e)).includes(e.reason),
    false
  );
  for (const [amount, expected] of [
    [1, '￥0.01'],
    [100, '￥1.00'],
    [100000, '￥1000.00']
  ])
    assert.equal(
      buildSubscriptionData(config, { ...e, amount }).amount21.value,
      expected
    );
  for (const amount of [0, -1, 1.2, 100001, NaN, Infinity, '1000'])
    assert.equal(buildSubscriptionData(config, { ...e, amount }), null);
});
test('备用事件按习惯命名，自定义习惯可用，长标题与控制字符不会突破字段限制', () => {
  const config = normalizeConfig().subscription;
  const e = { amount: 1000, habit: 'smoke', generation: { mode: 'fallback' } };
  assert.equal(buildSubscriptionData(config, e).thing27.value, '烟瘾犯了');
  assert.equal(
    buildSubscriptionData(config, {
      ...e,
      habit: 'custom_coffee',
      habitName: '咖啡'
    }).thing27.value,
    '想买咖啡了'
  );
  const long = buildSubscriptionData(config, {
    ...e,
    title: '\n奶茶' + '😀'.repeat(30),
    generation: { mode: 'ai' }
  }).thing27.value;
  assert.ok(long.length <= 20);
  assert.equal(long.includes('\n'), false);
  assert.ok(!/[\ud800-\udbff]$/.test(long));
});
test('模板字段错配、静态金额、空白或超长文案会关闭订阅', () => {
  const base = normalizeConfig().subscription;
  for (const data of [
    {},
    { thing1: '测试' },
    { ...base.data, amount21: '￥10' },
    { ...base.data, thing4: '好'.repeat(21) },
    { ...base.data, thing3: ' ' },
    { ...base.data, thing3: '点开\n看看' }
  ]) {
    assert.equal(
      normalizeConfig({ subscription: { enabled: true, data } }).subscription
        .enabled,
      false
    );
  }
  assert.equal(
    normalizeConfig({ subscription: { enabled: true } }).subscription.enabled,
    true
  );
});
test('发送前读取最新事件金额，无效金额不消耗许可或创建发送记录', async () => {
  for (const amount of [1234, -1]) {
    const f = await fixture();
    let calls = 0;
    const n = createNotifier(f.store, f.config, {
      clock: f.clock,
      getAccessToken: async () => {
        await f.store.transaction(async (tx) => {
          const event = await tx.get('events', f.e.id);
          event.amount = amount;
          await tx.put('events', event.id, event);
        });
        return { access_token: 'test-token' };
      },
      post: async (url, payload) => {
        calls++;
        assert.equal(payload.data.amount21.value, '￥12.34');
        return { errcode: 0 };
      }
    });
    assert.equal(
      (await n.send('a', f.e.id)).state,
      amount > 0 ? 'accepted' : 'invalid_event'
    );
    assert.equal(calls, amount > 0 ? 1 : 0);
    if (amount < 0) {
      assert.equal(f.store.snapshot().users.a.subscriptionGrant, true);
      assert.equal(Object.keys(f.store.snapshot().notices).length, 0);
    }
  }
});

test('旧事件没有梗概时使用完整短句，长句不截断为半句话', () => {
  const config = normalizeConfig().subscription;
  const e = {
    amount: 1000,
    reason: '刚刚看到别人喝奶茶，有点馋，我也想假装买一杯。'
  };
  assert.equal(
    buildSubscriptionData(config, e).thing3.value,
    '刚刚看到别人喝奶茶'
  );
  assert.equal(
    buildSubscriptionData(config, {
      ...e,
      reason: '长'.repeat(25) + '，后来想喝奶茶'
    }).thing3.value,
    '今天想给自己安排一点小快乐'
  );
});
test('换模板后旧许可不可用，旧页面的授权意图不能套用新模板', async () => {
  const f = await fixture();
  const before = await f.call('bootstrap');
  const next = createService(f.store, f.clock, {
    subscription: true,
    templateId: 'replacement-template'
  });
  await assert.rejects(
    next.run(
      'a',
      'subscription',
      { intent: before.reminders.intent, result: 'accept' },
      'replacement_request_1'
    ),
    { code: 'CONSENT_EXPIRED' }
  );
  const state = await next.run('a', 'bootstrap', {}, 'replacement_request_2');
  assert.equal(state.reminders.available, false);
  assert.notEqual(state.reminders.intent, before.reminders.intent);
  const accepted = await next.run(
    'a',
    'subscription',
    { intent: state.reminders.intent, result: 'accept' },
    'replacement_request_3'
  );
  assert.equal(accepted.available, true);
});

test('累计多次授权发送仅扣一次，未知结果保留扣减且不重发', async () => {
  for (const timeout of [false, true]) {
    const f = await fixture();
    let state = (await f.call('bootstrap')).reminders;
    for (let i = 0; i < 2; i++)
      state = await f.call('subscription', {
        intent: state.intent,
        result: 'accept'
      });
    f.time(f.clock() + 4 * 60000);
    let calls = 0;
    const n = createNotifier(f.store, f.config, {
      clock: f.clock,
      getAccessToken: async () => ({ access_token: 'test' }),
      post: async () => {
        calls++;
        if (timeout) throw new Error('timeout');
        return { errcode: 0 };
      }
    });
    await Promise.all([n.send('a', f.e.id), n.send('a', f.e.id)]);
    assert.equal(calls, 1);
    assert.equal(f.store.snapshot().users.a.subscriptionCredits, 2);
  }
});
test('微信 43101 校正旧额度，发送期间新获取的授权不会误清理', async () => {
  for (const concurrentGrant of [false, true]) {
    const f = await fixture();
    let state = (await f.call('bootstrap')).reminders;
    state = await f.call('subscription', {
      intent: state.intent,
      result: 'accept'
    });
    f.time(f.clock() + 4 * 60000);
    const n = createNotifier(f.store, f.config, {
      clock: f.clock,
      getAccessToken: async () => ({ access_token: 'test' }),
      post: async () => {
        if (concurrentGrant)
          await f.call('subscription', {
            intent: state.intent,
            result: 'accept'
          });
        return { errcode: 43101 };
      }
    });
    assert.equal((await n.send('a', f.e.id)).state, 'failed');
    assert.equal(
      f.store.snapshot().users.a.subscriptionCredits,
      concurrentGrant ? 1 : 0
    );
  }
});

test('累计额度可跨天使用，同一事件不重发且次日不清空剩余授权', async () => {
  const f = await fixture();
  const state = (await f.call('bootstrap')).reminders;
  await f.call('subscription', { intent: state.intent, result: 'accept' });
  f.time(f.clock() + 4 * 60000);
  const n = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test' }),
    post: async () => ({ errcode: 0 })
  });
  assert.equal((await n.send('a', f.e.id)).state, 'accepted');
  assert.equal((await n.send('a', f.e.id)).state, 'skipped');
  assert.equal(f.store.snapshot().users.a.subscriptionCredits, 1);
  f.time(f.clock() + 86400000);
  await f.store.transaction(async (tx) => {
    const old = await tx.get('events', f.e.id);
    const next = {
      ...old,
      id: 'tomorrow-event',
      expiresAt: f.clock() + 3600000
    };
    await tx.put('events', next.id, next);
    const user = await tx.get('users', 'a');
    user.randomEventId = next.id;
    await tx.put('users', 'a', user);
  });
  assert.equal((await n.send('a', 'tomorrow-event')).state, 'accepted');
  assert.equal(f.store.snapshot().users.a.subscriptionCredits, 0);
});

test('同一天的两个不同事件均可发送，各扣一次；同一事件仍不能重发', async () => {
  const f = await fixture();
  const state = (await f.call('bootstrap')).reminders;
  await f.call('subscription', { intent: state.intent, result: 'accept' });
  f.time(f.clock() + 4 * 60000);
  let calls = 0;
  const n = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test' }),
    post: async () => {
      calls++;
      return { errcode: 0 };
    }
  });
  assert.equal((await n.send('a', f.e.id)).state, 'accepted');
  await f.store.transaction(async (tx) => {
    const old = await tx.get('events', f.e.id);
    await tx.put('events', 'second-event', { ...old, id: 'second-event' });
    const user = await tx.get('users', 'a');
    user.randomEventId = 'second-event';
    await tx.put('users', 'a', user);
  });
  assert.equal((await n.send('a', 'second-event')).state, 'accepted');
  assert.equal((await n.send('a', 'second-event')).state, 'skipped');
  assert.equal(calls, 2);
  assert.equal(f.store.snapshot().users.a.subscriptionCredits, 0);
});

test('旧版按天的发送记录只拦原事件，不误拦当天的新事件', async () => {
  const crypto = require('crypto');
  const { dateKey } = require(core + 'domain');
  const f = await fixture();
  const legacyId = crypto
    .createHash('sha256')
    .update('a:' + dateKey(f.clock()))
    .digest('hex');
  await f.store.transaction((tx) =>
    tx.put('notices', legacyId, {
      id: legacyId,
      owner: 'a',
      eventId: f.e.id,
      state: 'unknown'
    })
  );
  const n = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test' }),
    post: async () => ({ errcode: 0 })
  });
  assert.equal((await n.send('a', f.e.id)).state, 'skipped');
  await f.store.transaction(async (tx) => {
    const legacy = await tx.get('notices', legacyId);
    legacy.eventId = 'an-earlier-event';
    await tx.put('notices', legacyId, legacy);
  });
  assert.equal((await n.send('a', f.e.id)).state, 'accepted');
});

test('仍有授权的订阅用户长时间未打开，也可收到新的每日事件', async () => {
  const f = await fixture();
  f.time(f.clock() + 10 * 86400000);
  await f.store.transaction(async (tx) => {
    const event = await tx.get('events', f.e.id);
    event.expiresAt = f.clock() + 3600000;
    await tx.put('events', f.e.id, event);
  });
  const n = createNotifier(f.store, f.config, {
    clock: f.clock,
    getAccessToken: async () => ({ access_token: 'test' }),
    post: async () => ({ errcode: 0 })
  });
  assert.equal((await n.send('a', f.e.id)).state, 'accepted');
});
