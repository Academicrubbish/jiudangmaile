'use strict';
const crypto = require('crypto');
const { remaining } = require('./subscriptions');
const { DAY, dateKey, dayEnd } = require('./domain');
const HOUR = 3600000,
  PREPARE_AHEAD = 15 * 60000;
function randomFor(key) {
  let i = 0;
  return () =>
    parseInt(
      crypto
        .createHash('sha256')
        .update(key + ':' + i++)
        .digest('hex')
        .slice(0, 8),
      16
    ) / 0x100000000;
}
function localHour(now) {
  return new Date(now + 8 * HOUR).getUTCHours();
}
function isQuiet(now) {
  const h = localHour(now);
  return h < 7 || h >= 22;
}
function active(user, now, templateId = '') {
  return (
    !!user.preferences &&
    !!user.lastSeenAt &&
    (dateKey(now) <= dateKey(user.lastSeenAt + 2 * DAY) ||
      (!!templateId && user.reminderEnabled && remaining(user, templateId) > 0))
  );
}
function pickTime(start, earliest, rng) {
  const main = rng() < 0.95;
  const ranges = main
    ? [[start + 8 * HOUR, start + 21 * HOUR]]
    : [
        [start + 7 * HOUR, start + 8 * HOUR],
        [start + 21 * HOUR, start + 22 * HOUR]
      ];
  let candidates = ranges
    .map(([a, b]) => [Math.max(a, earliest), b])
    .filter(([a, b]) => b - a >= 60000);
  // A weighted time window may already have passed. Use the remaining daytime
  // window instead of randomly dropping today's first opportunity.
  if (!candidates.length) {
    const a = Math.max(start + 7 * HOUR, earliest),
      b = start + 22 * HOUR;
    if (a >= b) return null;
    candidates = [[a, b]];
  }
  const total = candidates.reduce((s, [a, b]) => s + b - a, 0);
  let offset = rng() * total;
  for (const [a, b] of candidates) {
    if (offset <= b - a)
      return Math.max(a, Math.floor((a + offset) / 60000) * 60000);
    offset -= b - a;
  }
  return null;
}
function makePlan(user, now, { first = false } = {}) {
  const start = dayEnd(now) - DAY,
    rng = randomFor(user.id + ':' + dateKey(now));
  const count = user.preferences.daily < 1000 ? 1 : 2,
    slots = [];
  let earliest = now;
  for (let i = 0; i < count; i++) {
    const dueAt = first && i === 0 ? now : pickTime(start, earliest, rng);
    if (dueAt === null) break;
    slots.push({
      id: dateKey(now) + '-' + i,
      dueAt,
      state: 'waiting',
      eventId: '',
      first: first && i === 0
    });
    earliest = dueAt + 3 * HOUR;
  }
  return slots;
}
function nextWake(day, now) {
  const next = (day.plan || [])
    .filter((s) => ['waiting', 'prepared'].includes(s.state))
    .map((s) =>
      s.state === 'waiting'
        ? Math.max(now + 60000, s.dueAt - PREPARE_AHEAD)
        : Math.max(now + 60000, s.dueAt)
    );
  return Math.min(dayEnd(now) + 60000, ...next);
}
module.exports = {
  HOUR,
  PREPARE_AHEAD,
  randomFor,
  localHour,
  isQuiet,
  active,
  makePlan,
  nextWake
};
