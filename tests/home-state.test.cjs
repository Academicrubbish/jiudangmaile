const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const modulePromise = import(
  'data:text/javascript;base64,' +
    Buffer.from(
      fs.readFileSync(path.join(__dirname, '../services/home-state.js'), 'utf8')
    ).toString('base64')
);
test('旧云函数缺少 automaticBudget 时，提醒面板采用偏好里的额度且不崩溃', async () => {
  const { normalizeHomeState } = await modulePromise;
  const s = normalizeHomeState({
    user: { preferences: { daily: 2000, habit: 'smoke' } }
  });
  assert.equal(s.automaticBudget.limit, 2000);
  assert.deepEqual(s.user.preferences.habits, ['smoke']);
  assert.equal(s.capabilities.subscription, false);
  assert.equal(s.reminders.remaining, 0);
});
test('空响应和缺失嵌套对象可安全展示；未知额度不假装为零', async () => {
  const { normalizeHomeState } = await modulePromise;
  for (const value of [
    undefined,
    null,
    {},
    { user: null, automaticBudget: null, capabilities: null, reminders: null }
  ]) {
    const s = normalizeHomeState(value);
    assert.equal(s.automaticBudget.limit, null);
    assert.equal(s.capabilities.subscription, false);
    assert.equal(s.reminders.enabled, false);
  }
});
test('旧订阅协议提示更新，新协议保留实际额度和合法零值', async () => {
  const { normalizeHomeState } = await modulePromise;
  const old = normalizeHomeState({
    user: {},
    capabilities: { subscription: true, templateId: 't' },
    reminders: { available: true }
  });
  assert.equal(old.capabilities.subscriptionNeedsUpdate, true);
  assert.equal(old.capabilities.subscription, false);
  const next = normalizeHomeState({
    user: {
      id: 'u',
      preferences: { daily: 1000, habits: ['milk_tea', 'smoke'] }
    },
    automaticBudget: { limit: 0, spent: 0 },
    capabilities: { subscription: true, templateId: 't' },
    reminders: {
      enabled: true,
      available: true,
      remaining: 3,
      intentExpiresAt: 100,
      revision: 2
    }
  });
  assert.equal(next.capabilities.subscription, true);
  assert.equal(next.automaticBudget.limit, 0);
  assert.equal(next.reminders.remaining, 3);
});
