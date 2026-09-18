export const EQUIVALENTS = [
  { label: '奶茶', price: 1500, unit: '杯', joke: '少喝的每一杯都算数' },
  { label: '电影票', price: 4500, unit: '张', joke: '一个人看，坐哪都行' },
  { label: 'Switch 游戏', price: 29900, unit: '个', joke: '买了不一定玩，钱一定在' }
];
export const SU7_PRICE = 21590000;
export const DEFAULT_SHARE_TITLE = '东西是虚构的，钱留给自己。';
const money = (value) =>
  (Number(value || 0) / 100).toFixed(2).replace(/\.00$/, '');

export function formatEquivalents(savedTotal) {
  const total = Number(savedTotal || 0);
  return EQUIVALENTS.map(({ label, price, unit, joke }) => {
    const count = Math.floor(total / price);
    return {
      label,
      joke,
      text:
        count >= 1
          ? `${count} ${unit}`
          : `还差 ¥${money(price - total)}`
    };
  });
}
export function su7Progress(savedTotal) {
  const total = Number(savedTotal || 0),
    percent = Math.min(100, (total / SU7_PRICE) * 100),
    percentLabel =
      total <= 0
        ? '0%'
        : percent >= 10
          ? Math.floor(percent) + '%'
          : percent.toFixed(1) + '%';
  return {
    percent,
    percentLabel,
    caption: `已攒 ¥${money(total)} / ¥215,900`
  };
}
export function buildShareTitles(stats) {
  const s = stats || {},
    titles = [];
  if (Number(s.fakeSpentTotal) > 0)
    titles.push(
      `我假装花了 ¥${money(s.fakeSpentTotal)}，这笔钱一分没动，都在我手里`
    );
  if (Number(s.streakDays) >= 3)
    titles.push(
      `连续 ${s.streakDays} 天把钱留给自己，已攒 ¥${money(s.savedTotal)}`
    );
  if (Number(s.savedTotal) >= 1500)
    titles.push(
      `${Math.floor(s.savedTotal / 1500)} 杯奶茶没喝，变成了我手里的 ¥${money(s.savedTotal)}`
    );
  return titles;
}
