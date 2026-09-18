<template>
  <view class="shell"
    ><TopBar back /><view class="eyebrow">假装花的账，真实留下的钱</view
    ><view class="title"><text class="highlight">我的战绩</text></view
    ><view class="muted" style="margin-bottom: 20px"
      >只统计你本人确认转存的部分。东西是虚构的，钱是真的。</view
    ><view v-if="error" class="error"
      >{{ error
      }}<button class="link" :disabled="busy" @click="load">
        重新加载战绩
      </button></view
    ><view v-if="busy && !stats" class="empty muted">正在翻战绩…</view
    ><template v-if="stats && !empty"
      ><view class="stack"
      ><view class="card hero"
        ><view class="muted">已给自己留下</view
        ><view class="hero-amount">¥{{ money(stats.savedTotal) }}</view
        ><view class="muted hero-sub"
          >{{
            stats.savedCount
              ? '本人确认转存 ' +
                stats.savedCount +
                ' 次 · 一共假装花了 ¥' +
                money(stats.fakeSpentTotal)
              : '已经假装花了 ¥' +
                money(stats.fakeSpentTotal) +
                '，确认转存后会出现在这里'
          }}</view
        ></view
      ><view class="card"
        ><view class="small-title">这笔钱等于</view
        ><view v-for="e in equivalents" :key="e.label" class="row equal-row"
          ><text>{{ e.label }}</text
          ><text class="equal-text"
            ><text class="equal-count">{{ e.text }}</text>
            <text class="muted">{{ e.joke }}</text></text
          ></view
        ><view class="su7"
          ><view class="row"
            ><text>小米SU7 标准版</text
            ><text class="equal-count">{{ su7.percentLabel }}</text></view
          ><view class="track"
            ><view class="fill" :style="{ width: su7.percent + '%' }"></view></view
          ><view class="muted"
            >{{ su7.caption }} · 照这个存法，迟早开上</view
          ></view
        ></view
      ><view class="card"
        ><view class="row dim-row"
          ><text>连续留钱</text><text>{{ stats.streakDays }} 天</text></view
        ><view class="row dim-row"
          ><text>办成的小事</text
          ><text
            >{{ stats.momentsTotal }} 件 · 只玩梗 {{ stats.playOnlyCount }}
            次</text
          ></view
        ><view class="row dim-row"
          ><text>请朋友</text
          ><text>{{ stats.treatsSent }} 次 · 被请 {{ stats.treatsReceived }} 次</text></view
        ><view class="row dim-row"
          ><text>入伙以来</text><text>{{ stats.spanDays }} 天</text></view
        ></view
      ><view v-if="stats.habitBreakdown.length" class="card"
        ><view class="small-title">我的画风</view
        ><view
          v-for="b in stats.habitBreakdown"
          :key="b.key"
          class="bucket"
        >
          <view class="row"
            ><text>{{ b.name }}</text
            ><text class="muted"
              >× {{ b.count }} · ¥{{ money(b.amount) }}</text
            ></view
          ><view class="track"
            ><view class="fill" :style="{ width: barWidth(b.count) }"></view></view
          >
        </view
        ><view class="muted"
          >只算你自己办成的小事；随机小插曲记进「意外之喜」。</view
        ></view
      ></view
      ><button class="primary" open-type="share" @click="sharePreview">
        晒一下战绩 ↗</button
      ><view v-if="stats.truncated" class="muted truncated"
        >小事太多，仅统计最近 5000 件。</view
      ></template
    ><view v-if="empty && !busy && !error" class="empty muted"
      >第一笔假装消费，就是第一笔存款。
      <button class="secondary" @click="home">回小店逛逛 ↗</button></view
    ><view class="footer"
      >换算是策划梗，仅供娱乐。<text class="line-break"> </text
      >本人确认转存不代表账户余额。</view
    ></view
  >
</template>
<script setup>
import { ref, computed } from 'vue';
import { onShow, onShareAppMessage } from '@dcloudio/uni-app';
import TopBar from '../../components/jdml/TopBar.vue';
import { api, money, home, notify } from '../../services/api';
import {
  formatEquivalents,
  su7Progress,
  buildShareTitles,
  DEFAULT_SHARE_TITLE
} from '../../services/stats-copy';
const stats = ref(null),
  busy = ref(false),
  error = ref(''),
  shareTitle = ref(DEFAULT_SHARE_TITLE);
const empty = computed(
  () =>
    stats.value &&
    stats.value.savedCount === 0 &&
    stats.value.fakeSpentTotal === 0
);
const equivalents = computed(() =>
  formatEquivalents(stats.value?.savedTotal)
);
const su7 = computed(() => su7Progress(stats.value?.savedTotal));
onShow(() => {
  load();
});
async function load() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const r = await api('stats');
    stats.value = r;
    const titles = buildShareTitles(r);
    shareTitle.value = titles.length
      ? titles[Math.floor(Math.random() * titles.length)]
      : DEFAULT_SHARE_TITLE;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function barWidth(count) {
  const max = stats.value?.habitBreakdown[0]?.count || count || 1;
  return Math.max(6, Math.round((count / max) * 100)) + '%';
}
function sharePreview() {
  // #ifdef H5
  notify(new Error('请在微信小程序中分享战绩'));
  // #endif
}
onShareAppMessage(() => ({ title: shareTitle.value, path: '/pages/home/home' }));
</script>

<style scoped>
.hero {
  text-align: center;
}
.hero-amount {
  font-size: 46px;
  font-weight: 900;
  letter-spacing: -1px;
  margin: 10px 0 6px;
}
.hero-sub {
  line-height: 1.6;
}
.equal-row {
  margin: 12px 0;
}
.equal-text {
  text-align: right;
}
.equal-count {
  font-weight: 800;
}
.su7 {
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px dashed #bfc7b1;
}
.track {
  height: 14px;
  margin: 8px 0;
  border: 2px solid #1c2520;
  border-radius: 8px;
  background: #ece9dc;
  overflow: hidden;
}
.fill {
  height: 100%;
  background: #d6ff66;
  border-radius: 6px;
}
.dim-row {
  padding: 9px 0;
  border-bottom: 1px dashed #d9ddcd;
}
.dim-row:last-of-type {
  border-bottom: none;
}
.bucket {
  margin: 12px 0;
}
.bucket .track {
  height: 10px;
}
.truncated {
  text-align: center;
}
</style>
