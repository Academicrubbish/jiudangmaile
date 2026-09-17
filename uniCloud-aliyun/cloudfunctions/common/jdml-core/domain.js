'use strict';
const DAY = 86400000;
const { TASTES, DISCOVERIES } = require('./story-flavor');
const ITEMS = {
  milk_tea: {
    name: '奶茶',
    unit: '杯',
    persona: '奶茶常客',
    title: '奶茶是赠品',
    action: '把杯套安排上',
    reason:
      '本来没想喝奶茶，看见杯套上印了只丑猫，又觉得可以买了。钱是给猫的，奶茶算它请我。',
    summary: '看上丑猫杯套，奶茶成了赠品'
  },
  smoke: {
    name: '香烟',
    unit: '包',
    persona: '老烟客',
    title: '不能让它白来',
    action: '这包算我买了',
    reason:
      '出门特意带了打火机，到了楼下才发现没带香烟。准备买一包。不能让打火机觉得，这个家只有它在做准备。',
    summary: '打火机都带了，不能让它白来'
  },
  drink: {
    name: '小酒',
    unit: '杯',
    persona: '小酌爱好者',
    title: '事情要做全',
    action: '这杯算我买了',
    reason:
      '刚学会一个开酒瓶的小技巧，决定买瓶小酒试试。视频都认真看完了，总不能最后只学会截图。',
    summary: '学了开瓶技巧，总得试试'
  },
  betel: {
    name: '槟榔',
    unit: '份',
    persona: '槟榔爱好者',
    title: '嘴先参加',
    action: '这份算我买了',
    reason:
      '跟熟人聊天，聊到第三句就没话了。决定买包槟榔备着，下次就算接不上话，至少嘴看起来还在参与。',
    summary: '下次聊天，至少让嘴参与'
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
const BUILTIN_NAMES = {
  milk_tea: '奶茶',
  smoke: '香烟',
  drink: '小酒',
  betel: '槟榔'
};
function habitOption(raw) {
  if (!raw || typeof raw !== 'object') fail('INVALID_SETTINGS', '习惯格式无效');
  const builtin = Object.prototype.hasOwnProperty.call(ITEMS, raw.key);
  if (!builtin && !/^custom_[a-zA-Z0-9_]{6,40}$/.test(raw.key || ''))
    fail('INVALID_SETTINGS', '自定义习惯编号无效');
  const name = builtin ? BUILTIN_NAMES[raw.key] : String(raw.name || '').trim();
  if (
    !name ||
    [...name].length > 12 ||
    /[<>\r\n]|https?:|www\.|赌博|毒品|自残|自杀|摔伤|生病|赔偿|罚款/.test(name)
  )
    fail('INVALID_SETTINGS', '请用 1–12 个字描述轻松日常的小习惯');
  const min = assertAmount(raw.min === undefined ? 1000 : raw.min);
  const max = assertAmount(raw.max === undefined ? 2000 : raw.max);
  if (min < 100 || min > max)
    fail('INVALID_SETTINGS', '金额范围为 1–1000 元，最低金额不能高于最高金额');
  return { key: raw.key, name, min, max };
}
function preferences(input) {
  const daily = assertAmount(input.daily, 20000);
  const storyTaste =
    input.storyTaste === undefined ? 'balanced' : input.storyTaste;
  if (
    typeof storyTaste !== 'string' ||
    !Object.prototype.hasOwnProperty.call(TASTES, storyTaste)
  )
    fail('INVALID_SETTINGS', '请选择一种剧情口味');
  const selected = input.habits === undefined ? [input.habit] : input.habits;
  if (
    daily < 100 ||
    daily % 100 ||
    !Array.isArray(selected) ||
    !selected.length ||
    selected.length > 12
  )
    fail(
      'INVALID_SETTINGS',
      '每日随机事件总额为 1–200 元整数，请至少选择一个习惯'
    );
  const supplied = input.habitOptions === undefined ? [] : input.habitOptions;
  if (!Array.isArray(supplied) || supplied.length > 12)
    fail('INVALID_SETTINGS', '最多设置 12 个习惯');
  const definitions = supplied.map(habitOption);
  if (new Set(definitions.map((h) => h.key)).size !== definitions.length)
    fail('INVALID_SETTINGS', '习惯编号重复');
  const habits = [...new Set(selected)];
  const habitOptions = habits.map((key) => {
    if (typeof key !== 'string') fail('INVALID_SETTINGS', '习惯格式无效');
    const found = definitions.find((h) => h.key === key);
    if (found) return found;
    if (Object.prototype.hasOwnProperty.call(ITEMS, key))
      return habitOption({ key });
    fail('INVALID_SETTINGS', '请填写自定义习惯和金额范围');
  });
  return { daily, habits, habit: habits[0], habitOptions, storyTaste };
}
function selectedHabits(pref) {
  return pref.habits || [pref.habit];
}
function itemFor(option) {
  if (Object.prototype.hasOwnProperty.call(ITEMS, option.key))
    return ITEMS[option.key];
  const discovered = DISCOVERIES.find((h) => h.key === option.key);
  if (discovered) return { ...discovered, name: discovered.itemName };
  return {
    name: option.name,
    unit: '份',
    persona: option.name,
    title: '这份小快乐，\n当我买了。',
    action: '这份算我买了',
    reason:
      '本来只是随便看看，发现这份' +
      option.name +
      '越看越顺眼。准备买下来，毕竟挑了这么久，总得对自己的眼光有点信心。',
    summary: '越看越顺眼，得相信自己的眼光'
  };
}

function habitEnabled(key, enabled) {
  return key.startsWith('custom_') || !enabled || enabled.includes(key);
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
    actionLabel: actionLabel || ITEMS[habit]?.action || '这份算我买了',
    giftMessage: kind === 'treat' ? e.giftMessage || '' : '',
    triggerSource: e.triggerSource || 'active',
    sceneSource: e.sceneSource || 'habit',
    habitName: e.habitName || '',
    seenAt: e.seenAt || null,
    unread:
      e.triggerSource === 'scheduled' && e.state === 'offered' && !e.seenAt,
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
  selectedHabits,
  habitOption,
  itemFor,
  habitEnabled,
  nextAmount,
  activeReservation,
  publicEvent
};
