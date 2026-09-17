const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  createService
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/service');
const { createMemoryStore } = require('./memory-store.cjs');
const modulePromise = import(
  'data:text/javascript;base64,' +
    Buffer.from(
      fs.readFileSync(
        path.join(__dirname, '../services/subscriptions.js'),
        'utf8'
      )
    ).toString('base64')
);
const settle = async () => {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
};
async function fixture() {
  const { createSubscriptionController } = await modulePromise;
  let now = Date.parse('2026-09-17T02:00:00Z'),
    sequence = 0;
  const templateId = 'client-test-template',
    store = createMemoryStore();
  const service = createService(store, () => now, {
    subscription: true,
    templateId
  });
  const storage = new Map(),
    requestIds = new Map(),
    native = [],
    errors = [],
    results = [];
  const f = {
    dropResponse: false,
    pauseOffline: false,
    settings: {},
    last: null,
    working: false
  };
  const api = async (action, input = {}) => {
    const key = action + JSON.stringify(input);
    if (!requestIds.has(key))
      requestIds.set(key, 'client_request_' + ++sequence);
    if (action === 'pauseReminders' && f.pauseOffline)
      throw new Error('offline');
    const result = await service.run('a', action, input, requestIds.get(key));
    if (action === 'subscription' && f.dropResponse) {
      f.dropResponse = false;
      throw new Error('response lost');
    }
    requestIds.delete(key);
    return result;
  };
  const platform = {
    getStorageSync: (key) => storage.get(key),
    setStorageSync: (key, value) => storage.set(key, structuredClone(value)),
    removeStorageSync: (key) => storage.delete(key),
    getSetting: (options) =>
      options.success({ subscriptionsSetting: f.settings }),
    requestSubscribeMessage: (options) => native.push(options)
  };
  const make = () =>
    createSubscriptionController({
      api,
      platform,
      now: () => now,
      onChange: (value) => {
        f.last = value;
      },
      onBusy: (value) => {
        f.working = value;
      },
      onError: (error) => errors.push(error),
      onResult: (result) => results.push(result)
    });
  Object.assign(f, {
    controller: make(),
    make,
    api,
    store,
    platform,
    native,
    errors,
    results,
    storage,
    templateId,
    later: () => {
      now += 1100;
    },
    refresh: async () => {
      f.controller.configure(await api('bootstrap'));
      await settle();
    },
    reply: async (result = 'accept') => {
      native.at(-1).success({ [templateId]: result });
      await settle();
    }
  });
  await f.refresh();
  return f;
}
test('只有显式允许且微信记住 accept 后，真实点击才能同步触发一次补充', async () => {
  const f = await fixture();
  assert.equal(f.controller.request(), false);
  f.controller.request({ explicit: true });
  assert.equal(f.native.length, 1); // native API runs before an await/network call
  await f.reply();
  assert.equal(f.last.remaining, 1);
  f.later();
  assert.equal(f.controller.request(), false); // accepting once does not imply remember
  f.settings = { mainSwitch: true, itemSettings: { [f.templateId]: 'accept' } };
  await f.refresh();
  assert.equal(f.native.length, 1); // refresh and settings queries never authorize
  assert.equal(f.controller.request(), true);
  assert.equal(f.native.length, 2);
  assert.equal(f.controller.request(), false); // concurrent taps
  await f.reply();
  assert.equal(f.last.remaining, 2);
  assert.equal(f.controller.request(), false); // debounce after synchronous completion
});
test('拒绝被记住时不会自动申请，设置关闭同步暂停并清理估算', async () => {
  const f = await fixture();
  f.controller.request({ explicit: true });
  await f.reply();
  f.settings = { itemSettings: { [f.templateId]: 'reject' } };
  await f.refresh();
  assert.equal(f.last.enabled, false);
  assert.equal(f.last.remaining, 0);
  f.later();
  assert.equal(f.controller.request(), false);
  assert.equal(f.native.length, 1);
  f.controller.request({ explicit: true });
  await f.reply('reject');
  assert.equal(f.last.remaining, 0);
});
test('暂停后迟到的 accept 不上报，刷新或普通操作不能自行重启', async () => {
  const f = await fixture();
  f.controller.request({ explicit: true });
  const old = f.native[0];
  await f.controller.pause();
  old.success({ [f.templateId]: 'accept' });
  await settle();
  f.settings = { itemSettings: { [f.templateId]: 'accept' } };
  await f.refresh();
  f.later();
  assert.equal(f.last.enabled, false);
  assert.equal(f.controller.request(), false);
  assert.equal(f.store.snapshot().users.a.subscriptionCredits, 0);
});
test('授权落库响应丢失后，重建页面恢复同一请求，不再次调用微信或重复计数', async () => {
  const f = await fixture();
  f.dropResponse = true;
  f.controller.request({ explicit: true });
  await f.reply();
  assert.equal(f.store.snapshot().users.a.subscriptionCredits, 1);
  assert.ok(f.storage.has('jdml-subscription-pending:a'));
  f.controller = f.make();
  await f.refresh();
  assert.equal(f.last.remaining, 1);
  assert.equal(f.native.length, 1);
  assert.equal(f.storage.has('jdml-subscription-pending:a'), false);
});
test('暂停断网后本地保持暂停，下次进入自动重试暂停而不是申请新授权', async () => {
  const f = await fixture();
  f.controller.request({ explicit: true });
  await f.reply();
  f.pauseOffline = true;
  await assert.rejects(f.controller.pause());
  f.settings = { itemSettings: { [f.templateId]: 'accept' } };
  f.controller = f.make();
  await f.refresh();
  f.later();
  assert.equal(f.last.enabled, false);
  assert.equal(f.controller.request(), false);
  f.pauseOffline = false;
  await f.refresh();
  assert.equal(f.store.snapshot().users.a.reminderEnabled, false);
  assert.equal(f.storage.has('jdml-subscription-paused:a'), false);
  assert.equal(f.native.length, 1);
});
test('getSetting 失败或只包含其他模板时，不推断为记住允许', async () => {
  const f = await fixture();
  f.controller.request({ explicit: true });
  await f.reply();
  f.settings = { itemSettings: { 'other-template': 'accept' } };
  await f.refresh();
  f.later();
  assert.equal(f.controller.request(), false);
  f.platform.getSetting = (options) => options.fail(new Error('offline'));
  await f.refresh();
  assert.equal(f.controller.request(), false);
});
test('微信调用失败和未知返回值均不累计；稍后显式重试正常', async () => {
  const f = await fixture();
  f.controller.request({ explicit: true });
  f.native[0].fail();
  await settle();
  assert.equal(f.last.remaining, 0);
  f.later();
  f.controller.request({ explicit: true });
  await f.reply('filter');
  assert.equal(f.last.remaining, 0);
  f.later();
  f.controller.request({ explicit: true });
  await f.reply();
  assert.equal(f.last.remaining, 1);
});

test('微信总开关关闭优先于模板 accept，延迟旧设置不能覆盖暂停', async () => {
  const f = await fixture();
  f.controller.request({ explicit: true });
  await f.reply();
  f.settings = {
    mainSwitch: false,
    itemSettings: { [f.templateId]: 'accept' }
  };
  await f.refresh();
  assert.equal(f.last.enabled, false);
  assert.equal(f.controller.request(), false);
  let resolveSettings;
  f.platform.getSetting = (options) => {
    resolveSettings = options.success;
  };
  f.controller.refreshSettings();
  await f.controller.pause();
  resolveSettings({
    subscriptionsSetting: {
      mainSwitch: true,
      itemSettings: { [f.templateId]: 'accept' }
    }
  });
  await settle();
  f.later();
  assert.equal(f.controller.request(), false);
});
