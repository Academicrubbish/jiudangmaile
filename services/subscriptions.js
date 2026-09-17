// Only request() calls the native authorization API, synchronously from a real tap.
// Loading, refreshing settings and retrying a saved result never ask for permission.
export function createSubscriptionController({
  api,
  platform,
  onChange = () => {},
  onBusy = () => {},
  onError = () => {},
  onResult = () => {},
  now = Date.now
}) {
  let uid = '',
    templateId = '',
    channel = false,
    reminders = {};
  let remembered = false,
    working = false,
    epoch = 0,
    settingsEpoch = 0;
  let pending = null,
    lastTap = -Infinity;
  const storageKey = () => 'jdml-subscription-pending:' + uid;
  const pauseKey = () => 'jdml-subscription-paused:' + uid;
  function busy(value) {
    working = value;
    onBusy(value);
  }
  function apply(value) {
    if (!value) return;
    if ((value.revision || 0) < (reminders.revision || 0)) {
      onChange({ ...reminders });
      return;
    }
    reminders = { ...value };
    onChange({ ...reminders });
  }
  function savePending(value) {
    pending = value;
    if (value) platform.setStorageSync(storageKey(), value);
    else platform.removeStorageSync(storageKey());
  }
  async function refreshSettings() {
    remembered = false;
    const version = ++settingsEpoch,
      session = epoch;
    if (!channel || !platform.getSetting) return;
    try {
      const result = await new Promise((resolve, reject) =>
        platform.getSetting({
          withSubscriptions: true,
          success: resolve,
          fail: reject
        })
      );
      if (version !== settingsEpoch || session !== epoch) return;
      const settings = result.subscriptionsSetting || {};
      const choice = settings.itemSettings?.[templateId];
      const blocked =
        settings.mainSwitch === false || ['reject', 'ban'].includes(choice);
      remembered = !blocked && choice === 'accept';
      if (blocked && reminders.enabled && !working) {
        busy(true);
        // Stop locally immediately, even if synchronization later fails.
        const revision = reminders.revision || 0;
        reminders = { ...reminders, enabled: false };
        onChange({ ...reminders });
        try {
          const result = await api('subscriptionSettings', {
            templateId,
            blocked: true,
            revision
          });
          if (session === epoch) apply(result);
        } catch (_) {
          // The next page refresh will synchronize again. Never infer an allow.
        } finally {
          if (session === epoch) busy(false);
        }
      }
    } catch (_) {
      /* Unknown settings disable automatic requests only. */
    }
  }
  async function submit(explicit = false) {
    if (!pending || working) return false;
    const session = epoch,
      record = pending;
    busy(true);
    try {
      const result = await api('subscription', record.input);
      if (session !== epoch) return false;
      savePending(null);
      apply(result);
      if (explicit) onResult(record.input.result);
      return true;
    } catch (error) {
      if (session !== epoch) return false;
      if (error.code && error.code !== 'SERVICE_UNAVAILABLE') {
        savePending(null);
        reminders.intent = '';
        onChange({ ...reminders });
      }
      if (explicit) onError(error);
      return false;
    } finally {
      if (session === epoch) {
        busy(false);
        refreshSettings();
      }
    }
  }
  function configure(state) {
    const nextUid = state?.user?.id || '',
      nextTemplate = state?.capabilities?.templateId || '';
    if (uid !== nextUid || templateId !== nextTemplate) {
      epoch++;
      settingsEpoch++;
      remembered = false;
      reminders = {};
      pending = null;
      uid = nextUid;
      templateId = nextTemplate;
      busy(false);
      const saved = uid && platform.getStorageSync(storageKey());
      if (saved?.templateId === templateId) pending = saved;
    }
    channel = !!uid && !!templateId && !!state?.capabilities?.subscription;
    apply(state?.reminders);
    if (!channel) {
      remembered = false;
      return;
    }
    if (platform.getStorageSync(pauseKey())) {
      reminders = { ...reminders, enabled: false, intent: '' };
      onChange({ ...reminders });
      if (!working) pause().catch(() => {});
      return;
    }
    if (pending && !working) submit();
    else refreshSettings();
  }
  function request({ explicit = false } = {}) {
    if (!channel || working || !platform.requestSubscribeMessage) return false;
    if (platform.getStorageSync(pauseKey())) return false;
    if (pending) {
      submit(explicit);
      return false;
    }
    if (!explicit && (!reminders.enabled || !remembered)) return false;
    if (!reminders.intent || reminders.intentExpiresAt <= now()) {
      if (explicit) onError(new Error('提醒信息需刷新，请稍后再点一次'));
      return false;
    }
    // Guard double taps; do not bind this to a bubbling page container.
    if (now() - lastTap < 1000) return false;
    lastTap = now();
    const session = epoch;
    const input = { intent: reminders.intent, automatic: !explicit };
    busy(true);
    ++settingsEpoch;
    try {
      platform.requestSubscribeMessage({
        tmplIds: [templateId],
        success(result) {
          if (session !== epoch) return;
          const choice = result[templateId];
          if (!['accept', 'reject', 'ban'].includes(choice)) {
            busy(false);
            remembered = false;
            if (explicit)
              onError(new Error('这次没有获得提醒授权，可以继续玩'));
            return;
          }
          if (choice !== 'accept') remembered = false;
          savePending({ templateId, input: { ...input, result: choice } });
          busy(false);
          submit(explicit);
        },
        fail() {
          if (session !== epoch) return;
          busy(false);
          remembered = false;
          if (explicit) onError(new Error('这次没有开启提醒，仍可正常玩'));
        }
      });
      return true;
    } catch (_) {
      busy(false);
      remembered = false;
      if (explicit) onError(new Error('这次没有开启提醒，仍可正常玩'));
      return false;
    }
  }
  async function pause() {
    // Invalidate callbacks before the server round trip. An old accept cannot re-enable.
    epoch++;
    settingsEpoch++;
    remembered = false;
    savePending(null);
    platform.setStorageSync(pauseKey(), true);
    const session = epoch;
    reminders = { ...reminders, enabled: false, intent: '' };
    onChange({ ...reminders });
    busy(true);
    try {
      const result = await api('pauseReminders');
      if (session === epoch) {
        platform.removeStorageSync(pauseKey());
        apply(result);
      }
    } finally {
      if (session === epoch) busy(false);
    }
  }
  function suspend() {
    remembered = false;
    ++settingsEpoch;
  }
  return { configure, request, pause, suspend, refreshSettings };
}
