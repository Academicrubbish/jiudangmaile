'use strict';
const crypto = require('crypto');
// This is a local estimate reported by the client, never proof of WeChat permission.
function remaining(user, templateId) {
  if (!user || user.subscriptionTemplateId !== templateId) return 0;
  if (Number.isSafeInteger(user.subscriptionCredits))
    return Math.max(0, user.subscriptionCredits);
  return user.subscriptionGrant ? 1 : 0;
}
function setRemaining(user, templateId, count) {
  user.subscriptionTemplateId = templateId;
  user.subscriptionCredits = Math.max(0, count);
  // Preserve compatibility with older deployments without using this boolean for counting.
  user.subscriptionGrant = user.subscriptionCredits > 0;
  user.subscriptionRevision = (user.subscriptionRevision || 0) + 1;
}
function issueIntent(user, templateId, now) {
  user.subscriptionIntent = crypto.randomBytes(16).toString('hex');
  user.subscriptionIntentTemplateId = templateId;
  user.subscriptionIntentVersion = user.reminderVersion || 0;
  user.intentExpiresAt = now + 15 * 60000;
}
function status(user, templateId) {
  const count = remaining(user, templateId);
  return {
    enabled: !!user.reminderEnabled,
    available: count > 0,
    remaining: count,
    intent: user.subscriptionIntent || '',
    intentExpiresAt: user.intentExpiresAt || 0,
    version: user.reminderVersion || 0,
    revision: user.subscriptionRevision || 0
  };
}
function stop(user, templateId) {
  user.reminderEnabled = false;
  setRemaining(user, templateId, 0);
  user.reminderVersion = (user.reminderVersion || 0) + 1;
  user.subscriptionIntent = '';
  user.intentExpiresAt = 0;
}
function noticeKey(uid, eventId) {
  return crypto
    .createHash('sha256')
    .update('event:' + uid + ':' + eventId)
    .digest('hex');
}
async function alreadyAttempted(tx, uid, eventId, date) {
  if (await tx.get('notices', noticeKey(uid, eventId))) return true;
  const legacyKey = crypto
    .createHash('sha256')
    .update(uid + ':' + date)
    .digest('hex');
  const legacy = await tx.get('notices', legacyKey);
  return legacy?.eventId === eventId;
}
module.exports = {
  remaining,
  setRemaining,
  issueIntent,
  status,
  stop,
  noticeKey,
  alreadyAttempted
};
