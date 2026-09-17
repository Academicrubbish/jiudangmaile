'use strict';
const TASTES = {
  familiar: { label: '贴近我的习惯', habitPercent: 80 },
  balanced: { label: '各来一半', habitPercent: 50 },
  adventurous: { label: '多来点意外', habitPercent: 20 }
};
// Everyday subjects only; tobacco/alcohol/betel stay in explicitly chosen habits.
const DISCOVERIES = [
  {
    key: 'surprise_pen',
    name: '文具',
    itemName: '新笔',
    unit: '支',
    title: '设备该更新了',
    action: '换支笔再试',
    reason:
      '想买支新笔。旧笔陪我写了那么多计划，一个都没完成，也该考虑一下是不是设备的问题了。',
    summary: '计划没完成，先换支笔试试'
  },
  {
    key: 'surprise_snack',
    name: '零食',
    itemName: '薯片',
    unit: '袋',
    title: '调查分享装',
    action: '买包研究一下',
    reason:
      '薯片包装上写着分享装，想买一包回去看看，到底够几个人吃。如果只够我一个，那就是包装写得不严谨。',
    summary: '买包薯片，调查分享装够谁吃'
  },
  {
    key: 'surprise_coffee',
    name: '咖啡',
    itemName: '咖啡',
    unit: '杯',
    title: '猫选中了我',
    action: '坐下喝一杯',
    reason:
      '咖啡店的猫过来蹭了我一下，决定买杯咖啡坐坐。它每天见那么多人，偏偏挑中我。店员说它谁都蹭，我没问她。',
    summary: '店里的猫蹭我，决定喝杯咖啡'
  },
  {
    key: 'surprise_desk',
    name: '小摆件',
    itemName: '桌牌',
    unit: '块',
    title: '先适应称呼',
    action: '先把桌牌安排上',
    reason:
      '看上一块写着董事长的桌牌，准备买回来摆电脑旁边。公司暂时没这个安排，不影响我先适应一下称呼。',
    summary: '买块董事长桌牌，先适应称呼'
  },
  {
    key: 'surprise_cat',
    name: '抱枕',
    itemName: '丑猫抱枕',
    unit: '个',
    title: '买个参照物',
    action: '把丑猫带回家',
    reason:
      '看中一个丑猫抱枕，正面丑，侧面也没放过。准备把它放镜子旁边，出门先看它，再看自己。今天又顺眼了不少。',
    summary: '丑猫放镜子旁，当个参照物'
  },
  {
    key: 'surprise_cup',
    name: '杯子',
    itemName: '杯子',
    unit: '个',
    title: '让杯子先说',
    action: '请杯子替我说',
    reason:
      '看上一只写着今天不想动的杯子，准备摆在桌子最前面。以后有人问我周末有什么安排，先给他倒杯水。',
    summary: '买个杯子，替我介绍周末安排'
  }
].map((item) => ({ ...item, min: 500, max: 3000 }));
function chooseAutomatic(
  { habits, discoveries, taste, credit = 50, lastItem },
  randomIndex
) {
  const weight = TASTES[taste || 'balanced'].habitPercent;
  const balance =
    (Number.isInteger(credit) && credit >= 0 && credit < 100 ? credit : 50) +
    weight;
  const desired = balance >= 100 ? 'habit' : 'discovery';
  let source = desired;
  let pool = desired === 'habit' ? habits : discoveries;
  if (!pool.length) {
    source = desired === 'habit' ? 'discovery' : 'habit';
    pool = source === 'habit' ? habits : discoveries;
  }
  if (!pool.length) return null;
  const varied = pool.filter((item) => item.key !== lastItem);
  if (varied.length) pool = varied;
  return {
    option: pool[randomIndex(pool.length)],
    source,
    creditAfter: balance % 100
  };
}
module.exports = { TASTES, DISCOVERIES, chooseAutomatic };
