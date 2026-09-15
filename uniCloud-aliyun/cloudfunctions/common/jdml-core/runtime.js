'use strict';
const { createService } = require('./service');
const { createScenePipeline } = require('./ai');
const { createNotifier } = require('./notifications');
const D = require('./domain');
const { isQuiet } = require('./schedule');
const ALLOWED = new Set([
  'bootstrap',
  'settings',
  'create',
  'accept',
  'skip',
  'playOnly',
  'cancel',
  'confirm',
  'undo',
  'claim',
  'detail',
  'profile',
  'history',
  'subscription',
  'pauseReminders',
  'presence'
]);
function createRuntime(store, config, deps = {}) {
  const clock = deps.clock || Date.now;
  const options = {
    scenes: true,
    ai: config.ai.enabled,
    scheduler: config.scheduler.enabled,
    enabledHabits: config.enabledHabits,
    subscription: config.subscription.enabled,
    templateId: config.subscription.templateId
  };
  const service = createService(store, clock, options),
    workerService = createService(store, clock, { ...options, internal: true });
  const pipeline = createScenePipeline(store, config, deps),
    notifier = createNotifier(store, config, deps);
  async function refreshed(
    uid,
    event,
    { background = false, forceFallback = false } = {}
  ) {
    if (!event) return null;
    if (event.sceneReady) return event;
    const ready = await pipeline.ensureReady(event.id, {
      background,
      forceFallback
    });
    return ready ? D.publicEvent(ready, uid) : null;
  }
  async function call(uid, action, input = {}, requestId = '') {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      D.fail('INVALID_INPUT', '操作参数格式无效');
    if (!ALLOWED.has(action)) D.fail('UNKNOWN_ACTION', '暂不支持这个操作');
    if (action === 'history') {
      const result = await service.history(uid, input.cursor);
      result.events = await Promise.all(
        result.events.map((e) => refreshed(uid, e, { forceFallback: true }))
      );
      return result;
    }
    const result = await service.run(uid, action, input, requestId);
    if (action === 'bootstrap')
      result.current = await refreshed(uid, result.current);
    else if (result?.id && result?.item) return refreshed(uid, result);
    return result;
  }
  async function tick() {
    if (!config.scheduler.enabled) return { state: 'disabled', processed: 0 };
    if (isQuiet(clock())) return { state: 'quiet', processed: 0 };
    const started = clock(),
      users = await store.dueUsers(started, config.scheduler.batchSize);
    let processed = 0,
      prepared = 0,
      notices = 0,
      failed = 0;
    for (const user of users) {
      if (clock() - started > 85000) break;
      try {
        const result = await workerService.run(user.id, 'tick');
        if (result.event) {
          await refreshed(user.id, result.event, { background: true });
          prepared++;
        }
        if (result.notify && result.event) {
          const r = await notifier.send(user.id, result.event.id);
          if (r.state === 'accepted') notices++;
        }
        processed++;
      } catch (_) {
        failed++;
      }
    }
    return { state: 'processed', processed, prepared, notices, failed };
  }
  return { call, tick, preview: service.preview };
}
module.exports = { createRuntime, ALLOWED };
