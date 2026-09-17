'use strict';
const crypto = require('crypto');
const D = require('./domain');
const { DISCOVERIES } = require('./story-flavor');
function catalog(preferences, enabledHabits) {
  const own = (preferences?.habitOptions || []).filter((h) =>
    D.habitEnabled(h.key, enabledHabits)
  );
  const standard = Object.keys(D.ITEMS)
    .filter((key) => D.habitEnabled(key, enabledHabits))
    .map((key) => D.habitOption({ key }));
  const all = [...own, ...standard, ...DISCOVERIES];
  const seen = new Set();
  return all
    .filter((h) => {
      if (seen.has(h.key)) return false;
      seen.add(h.key);
      return true;
    })
    .map((h) => ({
      key: h.key,
      name: D.itemFor(h).name,
      min: h.min,
      max: h.max
    }));
}
function manualChoice(
  input,
  preferences,
  enabledHabits,
  randomIndex,
  lastItem
) {
  const hasAmount = input.amount !== undefined;
  if (hasAmount && D.assertAmount(input.amount) < 100)
    D.fail('INVALID_AMOUNT', '本次金额为 1–1000 元');
  if (input.customItem !== undefined) {
    if (
      input.habit !== undefined ||
      !input.customItem ||
      typeof input.customItem !== 'object' ||
      Array.isArray(input.customItem) ||
      typeof input.customItem.name !== 'string' ||
      !hasAmount
    )
      D.fail('INVALID_ITEM', '请填写商品名称与本次金额');
    const name = input.customItem.name.trim();
    const key =
      'custom_manual_' +
      crypto.createHash('sha256').update(name).digest('hex').slice(0, 16);
    return D.habitOption({ key, name, min: input.amount, max: input.amount });
  }
  let chosen;
  if (input.habit !== undefined) {
    chosen = catalog(preferences, enabledHabits).find(
      (h) => h.key === input.habit
    );
    if (!chosen) D.fail('INVALID_ITEM', '请选择商品库里的商品，或自己写一个');
  } else {
    // Older clients omit the item: preserve their selected-habit default.
    const candidates = preferences.habitOptions.filter((h) =>
      D.habitEnabled(h.key, enabledHabits)
    );
    if (!candidates.length) D.fail('NO_ELIGIBLE_HABIT', '请选择一个商品');
    const varied = candidates.filter((h) => h.key !== lastItem);
    const pool = varied.length ? varied : candidates;
    chosen = pool[randomIndex(pool.length)];
  }
  return hasAmount
    ? { ...chosen, min: input.amount, max: input.amount }
    : chosen;
}
module.exports = { catalog, manualChoice };
