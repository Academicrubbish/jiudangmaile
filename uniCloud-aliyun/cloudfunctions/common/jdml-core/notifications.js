'use strict';
const crypto = require('crypto');
const { dateKey, DAY } = require('./domain');
const { isQuiet, active } = require('./schedule');
const { postJSON } = require('./http');
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex');
function createNotifier(
  store,
  config,
  { clock = Date.now, post = postJSON, getAccessToken } = {}
) {
  async function send(uid, eventId) {
    if (!config.subscription.enabled) return { state: 'unavailable' };
    const now = clock();
    if (isQuiet(now)) return { state: 'quiet' };
    const noticeId = hash(uid + ':' + dateKey(now));
    // Validate before retrieving provider credentials. Client-reported consent is an intent,
    // not proof of WeChat permission; the WeChat send response remains authoritative.
    const ready = await store.transaction(async (tx) => {
      const user = await tx.get('users', uid),
        e = await tx.get('events', eventId),
        old = await tx.get('notices', noticeId);
      if (old) return null;
      if (
        !user?.reminderEnabled ||
        !user.subscriptionGrant ||
        user.subscriptionTemplateId !== config.subscription.templateId ||
        !active(user, now) ||
        now - user.lastSeenAt < 3 * 60000
      )
        return null;
      if (
        !e ||
        e.owner !== uid ||
        e.state !== 'offered' ||
        e.expiresAt <= now ||
        user.currentId !== e.id ||
        e.generation?.state !== 'ready'
      )
        return null;
      return { version: user.reminderVersion || 0 };
    });
    if (!ready) return { state: 'skipped' };
    let accessToken, openid;
    try {
      const identity = await store.identity(uid);
      // Do not fall back to another application's openid.
      openid = identity?.wx_openid?.['mp_' + config.subscription.dcloudAppid];
      if (!openid) return { state: 'no_identity' };
      const token = await getAccessToken({
        dcloudAppid: config.subscription.dcloudAppid,
        platform: 'weixin-mp'
      });
      accessToken = token?.access_token;
      if (!accessToken) return { state: 'no_credential' };
    } catch (_) {
      return { state: 'credential_error' };
    }
    const claimed = await store.transaction(async (tx) => {
      const user = await tx.get('users', uid),
        event = await tx.get('events', eventId),
        old = await tx.get('notices', noticeId);
      const t = clock();
      if (
        old ||
        isQuiet(t) ||
        dateKey(t) !== dateKey(now) ||
        !user?.reminderEnabled ||
        !user.subscriptionGrant ||
        user.subscriptionTemplateId !== config.subscription.templateId ||
        !active(user, t) ||
        t - user.lastSeenAt < 3 * 60000 ||
        (user.reminderVersion || 0) !== ready.version ||
        !event ||
        event.state !== 'offered' ||
        event.expiresAt <= t ||
        user.currentId !== eventId
      )
        return false;
      user.subscriptionGrant = false;
      await tx.put('users', uid, user);
      await tx.put('notices', noticeId, {
        id: noticeId,
        owner: uid,
        eventId,
        state: 'sending',
        createdAt: t,
        templateId: config.subscription.templateId
      });
      return true;
    });
    if (!claimed) return { state: 'skipped' };
    // A pending/unknown send is never reclaimed, even after a worker crash.
    const data = {};
    for (const [key, value] of Object.entries(config.subscription.data))
      data[key] = { value };
    let state = 'unknown',
      providerCode = null;
    try {
      const response = await post(
        'https://api.weixin.qq.com/cgi-bin/message/subscribe/send?access_token=' +
          encodeURIComponent(accessToken),
        {
          touser: openid,
          template_id: config.subscription.templateId,
          page: 'pages/home/home?eventId=' + eventId,
          miniprogram_state: config.subscription.miniprogramState,
          lang: 'zh_CN',
          data
        },
        { timeoutMs: 5000 }
      );
      if (typeof response.errcode === 'number') {
        providerCode = response.errcode;
        state = response.errcode === 0 ? 'accepted' : 'failed';
      }
    } catch (_) {
      state = 'unknown';
    }
    await store.transaction(async (tx) => {
      const row = await tx.get('notices', noticeId);
      if (row) {
        row.state = state;
        row.providerCode = providerCode;
        row.finishedAt = clock();
        await tx.put('notices', noticeId, row);
      }
    });
    return { state };
  }
  return { send };
}
module.exports = { createNotifier };
