const test = require('node:test'),
  assert = require('node:assert/strict');
const fs = require('node:fs'),
  path = require('node:path');
const modulePromise = import(
  'data:text/javascript;base64,' +
    Buffer.from(
      fs.readFileSync(
        path.join(__dirname, '../services/stats-copy.js'),
        'utf8'
      )
    ).toString('base64')
);
test('等价物换算：满额显示数量，不满一杯显示差距', async () => {
  const { formatEquivalents } = await modulePromise;
  const none = formatEquivalents(0);
  assert.equal(none[0].text, '还差 ¥15');
  assert.equal(none[2].text, '还差 ¥299');
  const rich = formatEquivalents(63000);
  assert.equal(rich[0].text, '42 杯');
  assert.equal(rich[1].text, '14 张');
  assert.equal(rich[2].text, '2 个');
  assert.equal(rich[0].joke, '少喝的每一杯都算数');
});
test('小米SU7进度：小额保留一位小数，大额取整', async () => {
  const { su7Progress } = await modulePromise;
  assert.deepEqual(su7Progress(0), {
    percent: 0,
    percentLabel: '0%',
    caption: '已攒 ¥0 / ¥215,900'
  });
  const small = su7Progress(645000);
  assert.equal(small.percentLabel, '3.0%');
  assert.ok(Math.abs(small.percent - 2.989) < 0.01);
  const big = su7Progress(43000000);
  assert.equal(big.percentLabel, '100%');
  assert.equal(big.percent, 100);
});
test('分享文案按条件生成，空战绩返回空数组', async () => {
  const { buildShareTitles } = await modulePromise;
  assert.deepEqual(buildShareTitles(null), []);
  assert.deepEqual(buildShareTitles({}), []);
  const onlySpent = buildShareTitles({ fakeSpentTotal: 176000 });
  assert.equal(onlySpent.length, 1);
  assert.match(onlySpent[0], /假装花了 ¥1760/);
  const streak = buildShareTitles({ streakDays: 3, savedTotal: 1200 });
  assert.equal(streak.length, 1);
  assert.match(streak[0], /连续 3 天把钱留给自己，已攒 ¥12/);
  const milkTea = buildShareTitles({ savedTotal: 1500, streakDays: 2 });
  assert.equal(milkTea.length, 1);
  assert.match(milkTea[0], /1 杯奶茶没喝，变成了我手里的 ¥15/);
  const all = buildShareTitles({
    fakeSpentTotal: 30000,
    streakDays: 5,
    savedTotal: 30000
  });
  assert.equal(all.length, 3);
});
