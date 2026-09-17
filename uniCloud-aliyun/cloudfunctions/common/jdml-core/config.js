'use strict';
const defaults = require('./config.example.json');
const { validSubscriptionData } = require('./subscription-template');
function normalizeConfig(input = {}) {
  const config = {
    ai: { ...defaults.ai, ...input.ai },
    scheduler: { ...defaults.scheduler, ...input.scheduler },
    subscription: { ...defaults.subscription, ...input.subscription },
    enabledHabits: (input.enabledHabits || defaults.enabledHabits).filter((h) =>
      defaults.enabledHabits.includes(h)
    )
  };
  // Migrate the old shared six-call default. Explicit legacy disable remains a disable.
  const oldLimit = input.ai?.maxCallsPerUserDay;
  if (oldLimit !== undefined && Number(oldLimit) !== 6) {
    if (input.ai?.maxSceneCallsPerUserDay === undefined)
      config.ai.maxSceneCallsPerUserDay = oldLimit;
    if (
      Number(oldLimit) === 0 &&
      input.ai?.maxGiftCallsPerUserDay === undefined
    )
      config.ai.maxGiftCallsPerUserDay = 0;
  }
  delete config.ai.maxCallsPerUserDay;
  for (const [key, min, max] of [
    ['interactiveBudgetMs', 500, 15000],
    ['backgroundBudgetMs', 500, 60000],
    ['maxSceneCallsPerUserDay', 0, 200],
    ['maxGiftCallsPerUserDay', 0, 200],
    ['maxCallsGlobalDay', 0, 10000]
  ]) {
    const n = Number(config.ai[key]);
    config.ai[key] = Number.isFinite(n)
      ? Math.max(min, Math.min(max, Math.floor(n)))
      : defaults.ai[key];
  }
  config.scheduler.enabled = config.scheduler.enabled === true;
  config.scheduler.batchSize = Math.max(
    1,
    Math.min(10, Number(config.scheduler.batchSize) || 10)
  );
  config.ai.enabled =
    config.ai.enabled === true && !!config.ai.apiKey && !!config.ai.model;
  if (
    config.ai.endpoint !==
    'https://open.bigmodel.cn/api/paas/v4/chat/completions'
  )
    config.ai.enabled = false;
  config.subscription.enabled =
    config.subscription.enabled === true &&
    typeof config.subscription.templateId === 'string' &&
    /^[A-Za-z0-9_-]+$/.test(config.subscription.templateId) &&
    !!config.subscription.dcloudAppid &&
    validSubscriptionData(config.subscription.data);
  if (
    !['developer', 'trial', 'formal'].includes(
      config.subscription.miniprogramState
    )
  )
    config.subscription.enabled = false;
  return config;
}
function loadConfig() {
  let local = {};
  try {
    local = require('./config.local.json');
  } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND')
      throw new Error('Invalid private configuration');
  }
  if (process.env.JDML_ZHIPU_API_KEY)
    local = {
      ...local,
      ai: { ...local.ai, apiKey: process.env.JDML_ZHIPU_API_KEY, enabled: true }
    };
  return normalizeConfig(local);
}
module.exports = { loadConfig, normalizeConfig };
