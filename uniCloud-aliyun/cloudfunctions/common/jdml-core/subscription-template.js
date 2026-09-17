'use strict';
// Template 1646: 项目名称 thing27 / 金额 amount21 / 提醒内容 thing3 / 温馨提示 thing4.
const EVENT_NAMES = {
  milk_tea: '喝奶茶了',
  smoke: '烟瘾犯了',
  drink: '想小酌一杯',
  betel: '想嚼点槟榔'
};
function validSubscriptionData(data) {
  return (
    !!data &&
    typeof data === 'object' &&
    !Array.isArray(data) &&
    Object.keys(data).sort().join() === 'thing4' &&
    Object.values(data).every(
      (value) =>
        typeof value === 'string' &&
        value.trim().length > 0 &&
        value.length <= 20 &&
        !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    )
  );
}
function shortName(value) {
  if (typeof value !== 'string') return '';
  const clean = value
    .replace(
      /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g,
      ''
    )
    .trim();
  let result = '';
  // Conservatively count UTF-16 units, without splitting surrogate pairs.
  for (const char of clean) {
    if (result.length + char.length > 20) break;
    result += char;
  }
  return result;
}
function eventName(event) {
  // AI titles have already passed structural and independent semantic review.
  const reviewed = event.generation?.mode === 'ai' && shortName(event.title);
  if (reviewed) return reviewed;
  if (event.sceneSource === 'discovery' && shortName(event.title))
    return shortName(event.title);
  if (event.kind === 'treat') return '善心大发';
  if (Object.prototype.hasOwnProperty.call(EVENT_NAMES, event.habit))
    return EVENT_NAMES[event.habit];
  const custom = shortName(event.habitName);
  return custom ? shortName('想买' + custom + '了') : '想犒劳自己了';
}
function validSceneSummary(value) {
  return (
    typeof value === 'string' &&
    value.trim() === value &&
    value.length >= 4 &&
    value.length <= 20 &&
    !/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/.test(
      value
    )
  );
}
function sceneSummary(event) {
  if (validSceneSummary(event.sceneSummary)) return event.sceneSummary;
  // Old snapshots have no synopsis. Use a complete existing clause, never a cut-off sentence.
  const clauses =
    typeof event.reason === 'string' ? event.reason.split(/[，。！？；]/) : [];
  const first = (clauses[0] || '').trim();
  if (validSceneSummary(first)) return first;
  return '今天想给自己安排一点小快乐';
}
function buildSubscriptionData(subscription, event) {
  if (
    !validSubscriptionData(subscription.data) ||
    !event ||
    !Number.isSafeInteger(event.amount) ||
    event.amount < 1 ||
    event.amount > 100000
  )
    return null;
  const yuan = Math.floor(event.amount / 100);
  const cents = String(event.amount % 100).padStart(2, '0');
  return {
    thing27: { value: eventName(event) },
    amount21: { value: '￥' + yuan + '.' + cents },
    thing3: { value: sceneSummary(event) },
    thing4: { value: subscription.data.thing4 }
  };
}
module.exports = {
  validSubscriptionData,
  validSceneSummary,
  buildSubscriptionData
};
