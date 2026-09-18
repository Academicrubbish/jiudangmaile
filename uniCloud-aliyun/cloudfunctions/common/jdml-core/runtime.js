'use strict';
const { createService } = require('./service');
const { createScenePipeline, needsStyleRepair } = require('./ai');
const { createNotifier } = require('./notifications');
const D = require('./domain');
const { isQuiet } = require('./schedule');
const ALLOWED = new Set([
  'bootstrap',
  'settings',
  'create',
  'giftMessages',
  'accept',
  'seen',
  'skip',
  'playOnly',
  'cancel',
  'confirm',
  'undo',
  'claim',
  'detail',
  'profile',
  'history',
  'stats',
  'subscription',
  'pauseReminders',
  'subscriptionSettings',
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
    { background = false, forceFallback = false, deadlineAt } = {}
  ) {
    if (!event) return null;
    if (event.sceneReady && !needsStyleRepair(event)) return event;
    const ready = await pipeline.ensureReady(event.id, {
      background,
      forceFallback,
      deadlineAt
    });
    return ready ? D.publicEvent(ready, uid) : null;
  }
  async function call(uid, action, input = {}, requestId = '') {
    const deadlineAt = clock() + 22000;
    if (!input || typeof input !== 'object' || Array.isArray(input))
      D.fail('INVALID_INPUT', '操作参数格式无效');
    if (!ALLOWED.has(action)) D.fail('UNKNOWN_ACTION', '暂不支持这个操作');
    if (action === 'stats') return service.stats(uid);
    if (action === 'history') {
      const result = await service.history(uid, input.cursor);
      result.events = await Promise.all(
        result.events.map((e) => refreshed(uid, e, { forceFallback: true }))
      );
      return result;
    }
    let result = await service.run(uid, action, input, requestId);
    if (action === 'giftMessages')
      return pipeline.giftMessages(uid, requestId, result);
    // Entering the app may catch up an already-due event, even without a recent worker run.
    if (action === 'bootstrap' && config.scheduler.enabled) {
      await workerService.run(uid, 'tick');
      result = await service.run(uid, 'bootstrap');
    }
    if (action === 'bootstrap') {
      result.current = await refreshed(uid, result.current, { deadlineAt });
      result.randomEvent = await refreshed(uid, result.randomEvent, {
        deadlineAt
      });
    } else if (result?.id && result?.item)
      return refreshed(uid, result, { deadlineAt });
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
      if (
        clock() - started >
        Math.max(0, 100000 - config.ai.backgroundBudgetMs)
      )
        break;
      try {
        const result = await workerService.run(user.id, 'tick');
        if (result.event) {
          await refreshed(user.id, result.event, { background: true });
          prepared++;
        }
        // Also retry an unseen event deferred while the user was in the app.
        // Per-event send records prevent re-sends after an accepted/unknown attempt.
        const currentUser = await store.get('users', user.id);
        const pending = currentUser?.randomEventId
          ? await store.get('events', currentUser.randomEventId)
          : null;
        if (
          config.subscription.enabled &&
          pending?.state === 'offered' &&
          !pending.seenAt &&
          pending.expiresAt > clock()
        ) {
          await refreshed(user.id, D.publicEvent(pending, user.id), {
            background: true
          });
          const r = await notifier.send(user.id, pending.id);
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
