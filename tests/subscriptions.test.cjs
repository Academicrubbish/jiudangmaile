const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createService
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/service');
const { createMemoryStore } = require('./memory-store.cjs');
const templateId = 'test-template';
function fixture() {
  let now = Date.parse('2026-09-17T02:00:00Z'),
    sequence = 0;
  const store = createMemoryStore();
  const service = createService(store, () => now, {
    subscription: true,
    templateId
  });
  const call = (
    action,
    input = {},
    requestId = 'subscribe_request_' + ++sequence
  ) => service.run('a', action, input, requestId);
  return {
    store,
    service,
    call,
    later: () => {
      now += 16 * 60000;
    }
  };
}
test('每次 accept 累加，旋转意图；同请求重试和不同请求重放不重复累计', async () => {
  const f = fixture();
  let s = (await f.call('bootstrap')).reminders;
  const input = { intent: s.intent, result: 'accept' };
  const first = await f.call('subscription', input, 'same_request_123');
  assert.equal(first.remaining, 1);
  assert.deepEqual(
    await f.call('subscription', input, 'same_request_123'),
    first
  );
  await assert.rejects(f.call('subscription', input), {
    code: 'CONSENT_EXPIRED'
  });
  for (let i = 2, r = first; i <= 4; i++) {
    r = await f.call('subscription', {
      intent: r.intent,
      result: 'accept',
      automatic: true
    });
    assert.equal(r.remaining, i);
  }
  assert.equal((await f.call('bootstrap')).reminders.remaining, 4);
});
test('并发提交同意图只记一次；过期和空意图不能增加次数', async () => {
  const f = fixture(),
    s = await f.call('bootstrap');
  const input = { intent: s.reminders.intent, result: 'accept' };
  const result = await Promise.allSettled([
    f.call('subscription', input),
    f.call('subscription', input)
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  const fresh = (await f.call('bootstrap')).reminders;
  f.later();
  await assert.rejects(
    f.call('subscription', { intent: fresh.intent, result: 'accept' }),
    { code: 'CONSENT_EXPIRED' }
  );
  await assert.rejects(
    f.call('subscription', { intent: '', result: 'accept' }),
    { code: 'CONSENT_EXPIRED' }
  );
});
test('暂停使在途授权失效，普通操作无法重新开启，显式订阅可以重新开始', async () => {
  const f = fixture();
  const s = await f.call('bootstrap');
  const granted = await f.call('subscription', {
    intent: s.reminders.intent,
    result: 'accept'
  });
  const stopped = await f.call('pauseReminders');
  assert.equal(stopped.remaining, 0);
  await assert.rejects(
    f.call('subscription', { intent: granted.intent, result: 'accept' }),
    { code: 'CONSENT_EXPIRED' }
  );
  const next = (await f.call('bootstrap')).reminders;
  await assert.rejects(
    f.call('subscription', {
      intent: next.intent,
      result: 'accept',
      automatic: true
    }),
    { code: 'REMINDERS_PAUSED' }
  );
  assert.equal(
    (await f.call('subscription', { intent: next.intent, result: 'accept' }))
      .remaining,
    1
  );
});
test('拒绝、封禁、微信设置关闭均清理本地估算，过时设置不能覆盖新授权', async () => {
  for (const result of ['reject', 'ban', 'settings']) {
    const f = fixture();
    const s = (await f.call('bootstrap')).reminders;
    const granted = await f.call('subscription', {
      intent: s.intent,
      result: 'accept'
    });
    const stale = await f.call('subscriptionSettings', {
      templateId,
      blocked: true,
      revision: 0
    });
    assert.equal(stale.remaining, 1);
    const stopped =
      result === 'settings'
        ? await f.call('subscriptionSettings', {
            templateId,
            blocked: true,
            revision: granted.revision
          })
        : await f.call('subscription', { intent: granted.intent, result });
    assert.equal(stopped.remaining, 0);
    assert.equal(stopped.enabled, false);
  }
});
test('旧版布尔许可迁移为一次，模板切换不沿用旧额度，不能挪用他人意图', async () => {
  const f = fixture();
  await f.call('bootstrap');
  await f.store.transaction(async (tx) => {
    const u = await tx.get('users', 'a');
    Object.assign(u, {
      subscriptionGrant: true,
      subscriptionTemplateId: templateId,
      reminderEnabled: true
    });
    await tx.put('users', 'a', u);
  });
  const old = (await f.call('bootstrap')).reminders;
  assert.equal(old.remaining, 1);
  const grant = await f.call('subscription', {
    intent: old.intent,
    result: 'accept'
  });
  assert.equal(grant.remaining, 2);
  await assert.rejects(
    f.service.run(
      'b',
      'subscription',
      { intent: grant.intent, result: 'accept' },
      'other_user_123'
    ),
    { code: 'CONSENT_EXPIRED' }
  );
  const next = createService(f.store, Date.now, {
    subscription: true,
    templateId: 'new-template'
  });
  const s = await next.run('a', 'bootstrap');
  assert.equal(s.reminders.remaining, 0);
  const r = await next.run(
    'a',
    'subscription',
    { intent: s.reminders.intent, result: 'accept' },
    'new_template_123'
  );
  assert.equal(r.remaining, 1);
});
