'use strict';
const DAY = 86400000;
const ITEMS = {
  milk_tea: {
    name: '空气奶茶',
    unit: '杯',
    persona: '奶茶常客',
    title: '这杯奶茶，\n当我喝了。',
    action: '这杯算我喝了',
    reason:
      '想象你路过一家小店，窗边正好空着。假装点一杯喜欢的奶茶，给今天留一点甜。'
  },
  smoke: {
    name: '空气烟',
    unit: '份',
    persona: '虚构老烟客',
    title: '这份空气，\n当我买了。',
    action: '这份算我买了',
    reason:
      '今天扮演街角小店的老熟客，假装挑一份空气烟。东西不用真买，给人设安排一点戏份。'
  },
  drink: {
    name: '空气小酒',
    unit: '杯',
    persona: '微醺想象家',
    title: '这杯小酒，\n当我碰了。',
    action: '这杯算我碰了',
    reason:
      '想象你给自己留了一张小桌，假装倒一杯空气小酒。举杯算完成，这笔钱留给明天的自己。'
  },
  betel: {
    name: '空气槟榔',
    unit: '份',
    persona: '空气嚼嚼客',
    title: '嚼了个寂寞，\n钱倒留下了。',
    action: '这份算我买了',
    reason:
      '在想象中的小店坐一会儿，给虚构人设安排一份空气槟榔。今天演到这里，东西就不真买了。'
  }
};
class BusinessError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
function fail(code, message) {
  throw new BusinessError(code, message);
}
function dateKey(now) {
  return new Date(now + 8 * 3600000).toISOString().slice(0, 10);
}
function dayEnd(now) {
  return Date.parse(dateKey(now) + 'T16:00:00Z');
}
function assertAmount(n, max = 100000) {
  if (!Number.isSafeInteger(n) || n < 1 || n > max)
    fail('INVALID_AMOUNT', '请输入有效金额，最多两位小数');
  return n;
}
function preferences(input) {
  const daily = assertAmount(input.daily, 20000);
  if (daily < 100 || daily % 100 || !ITEMS[input.habit])
    fail('INVALID_SETTINGS', '每日参考金额为 1–200 元整数，请选择一种人设');
  return { daily, habit: input.habit };
}
function nextAmount(daily, available) {
  return Math.min(
    available,
    daily < 1000 ? daily : Math.max(100, Math.floor(daily / 200) * 100)
  );
}
function activeReservation(e, now) {
  return e.expiresAt > now || ['accepted', 'confirmed'].includes(e.state);
}
function publicEvent(e, uid) {
  const own = e.owner === uid;
  const shared = e.recipient === uid;
  if (!own && !shared) fail('FORBIDDEN', '这件小事不属于你');
  const {
    id,
    kind,
    habit,
    item,
    unit,
    title,
    reason,
    amount,
    state,
    createdAt,
    expiresAt,
    recipient,
    senderName,
    senderAvatar,
    recipientName,
    actionLabel
  } = e;
  const out = {
    id,
    kind,
    habit,
    item,
    unit,
    title,
    reason,
    amount,
    state,
    createdAt,
    expiresAt,
    senderName,
    senderAvatar,
    recipientName,
    actionLabel: actionLabel || ITEMS[habit].action,
    role: own ? (kind === 'treat' ? 'sender' : 'self') : 'recipient',
    sceneReady: !e.generation || e.generation.state === 'ready',
    claimed: !!recipient
  };
  if (own) {
    out.deposit = e.deposit || null;
    out.token = e.token || '';
  }
  return out;
}
module.exports = {
  DAY,
  ITEMS,
  BusinessError,
  fail,
  dateKey,
  dayEnd,
  assertAmount,
  preferences,
  nextAmount,
  activeReservation,
  publicEvent
};
