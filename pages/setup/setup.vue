<template>
  <view class="shell"
    ><TopBar back /><view class="eyebrow">选好习惯，再选点剧情口味</view>
    <view class="title"
      >给日子，<text class="line-break"></text
      ><text class="highlight">加一点戏。</text></view
    >
    <text class="label">每天随机安排多少？</text
    ><view class="pills"
      ><button
        v-for="n in [10, 20, 30]"
        :key="n"
        class="pill"
        :class="{ active: daily === String(n) }"
        @click="daily = String(n)"
      >
        ¥{{ n }}
      </button></view
    >
    <view class="spacer"></view
    ><view class="field"
      ><input
        class="field-input"
        type="number"
        v-model="daily"
        maxlength="3"
        placeholder="每日随机事件总额，1–200 元"
    /></view>
    <view class="muted"
      >只限制系统每天安排的金额，主动花钱和请客不设每日上限。</view
    >
    <text class="label">AI 推荐偏好 · 可多选</text
    ><view class="pills"
      ><button
        v-for="h in options"
        :key="h.key"
        class="pill"
        :class="{ active: selected.includes(h.key) }"
        @click="toggle(h.key)"
      >
        {{ selected.includes(h.key) ? '✓ ' : '' }}{{ h.name }}
      </button></view
    >
    <view class="custom-add"
      ><view class="field"
        ><input
          class="field-input"
          v-model="customName"
          maxlength="12"
          placeholder="自定义：咖啡、买花、零食…" /></view
      ><button class="pill" @click="addHabit">添加</button></view
    >
    <view class="muted"
      >至少选一个，最多 12 个，只用于 AI
      推荐。主动消费和请客可以任选商品。</view
    >
    <view v-for="h in selectedOptions" :key="h.key" class="card habit-card">
      <view class="row"
        ><text>{{ h.name }} · AI 推荐金额</text
        ><button
          v-if="h.key.startsWith('custom_')"
          class="link"
          @click="removeHabit(h.key)"
        >
          删除
        </button></view
      >
      <view class="range-row"
        ><view class="field"
          ><input
            class="field-input"
            type="digit"
            v-model="h.minText"
            maxlength="7"
            placeholder="最低金额" /></view
        ><text>至</text
        ><view class="field"
          ><input
            class="field-input"
            type="digit"
            v-model="h.maxText"
            maxlength="7"
            placeholder="最高金额" /></view
        ><text>元</text></view
      >
    </view>
    <view v-if="rangeAboveBudget" class="muted"
      >有些习惯的最低金额高于每日随机额度，系统不会安排超出随机额度的事件；主动消费时可自行定金额。</view
    >
    <view class="muted" style="margin-top: 16px"
      >单次范围 1–1000
      元。随机小事不够最低金额就不安排，不会把价格压到范围外。</view
    >
    <text class="label">剧情口味</text>
    <view class="taste-options">
      <button
        v-for="taste in storyTastes"
        :key="taste.key"
        class="taste-option"
        :class="{ active: storyTaste === taste.key }"
        :aria-label="taste.label + '，' + taste.description"
        @click="storyTaste = taste.key"
      >
        <view class="row"
          ><text class="taste-title">{{ taste.label }}</text
          ><text>{{ storyTaste === taste.key ? '✓' : '○' }}</text></view
        >
        <view class="taste-description">{{ taste.description }}</view>
      </button>
    </view>
    <view class="muted"
      >只影响系统随机小事。生活小插曲每次约 5–30
      元，也算在每日随机额度里。</view
    >
    <button class="primary" :disabled="busy" @click="save">
      {{
        busy ? '正在保存…' : editing ? '保存我的习惯 ↗' : '开始假装花钱 ↗'
      }}</button
    ><view v-if="error" class="error">{{ error }}</view>
  </view>
</template>
<script setup>
import { ref, computed } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import TopBar from '../../components/jdml/TopBar.vue';
import {
  api,
  habits,
  storyTastes,
  home,
  money,
  parseMoney,
  notify
} from '../../services/api';
const daily = ref('20'),
  storyTaste = ref('balanced'),
  selected = ref(['milk_tea']),
  options = ref(habits.map((h) => ({ ...h, minText: '10', maxText: '20' }))),
  customName = ref(''),
  busy = ref(false),
  error = ref(''),
  editing = ref(false);
const selectedOptions = computed(() =>
  options.value.filter((h) => selected.value.includes(h.key))
);
const rangeAboveBudget = computed(() =>
  selectedOptions.value.some((h) => Number(h.minText) > Number(daily.value))
);
onLoad(async (q) => {
  editing.value = q.edit === '1';
  if (!editing.value) return;
  try {
    const s = await api('bootstrap'),
      p = s.user.preferences;
    daily.value = String(p.daily / 100);
    storyTaste.value = p.storyTaste || 'balanced';
    selected.value = p.habits || [p.habit];
    const saved = p.habitOptions || [];
    options.value = [
      ...habits.map((h) => {
        const old = saved.find((o) => o.key === h.key);
        return {
          ...h,
          minText: old ? money(old.min) : '10',
          maxText: old ? money(old.max) : '20'
        };
      }),
      ...saved
        .filter((h) => h.key.startsWith('custom_'))
        .map((h) => ({ ...h, minText: money(h.min), maxText: money(h.max) }))
    ];
  } catch (e) {
    error.value = e.message;
  }
});
function toggle(key) {
  if (selected.value.includes(key)) {
    if (selected.value.length === 1) {
      notify(new Error('至少留一个小习惯吧'));
      return;
    }
    selected.value = selected.value.filter((h) => h !== key);
  } else selected.value = [...selected.value, key];
}
function addHabit() {
  const name = customName.value.trim();
  if (!name) {
    notify(new Error('先写一个花钱小习惯'));
    return;
  }
  if (options.value.length >= 12) {
    notify(new Error('最多设置 12 个习惯'));
    return;
  }
  if (options.value.some((h) => h.name === name)) {
    notify(new Error('这个习惯已经在列表里了'));
    return;
  }
  const key =
    'custom_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 8);
  options.value.push({ key, name, minText: '10', maxText: '20' });
  selected.value.push(key);
  customName.value = '';
}
function removeHabit(key) {
  if (selected.value.length === 1 && selected.value.includes(key)) {
    notify(new Error('至少留一个小习惯吧'));
    return;
  }
  selected.value = selected.value.filter((h) => h !== key);
  options.value = options.value.filter((h) => h.key !== key);
}
async function save() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const habitOptions = selectedOptions.value.map((h) => {
      const min = parseMoney(h.minText),
        max = parseMoney(h.maxText);
      if (min < 100 || max > 100000 || min > max)
        throw new Error(h.name + '：金额需在 1–1000 元，最低不能高于最高');
      return { key: h.key, name: h.name, min, max };
    });
    await api('settings', {
      daily: parseMoney(daily.value),
      habits: selected.value,
      habitOptions,
      storyTaste: storyTaste.value
    });
    home();
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
</script>
<style scoped>
.taste-options {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 12px 0;
}
.taste-option {
  width: 100%;
  min-width: 0;
  text-align: left;
  padding: 14px 16px;
  border: 1px solid #ccd2c2;
  border-radius: 14px;
  background: #faf9f2;
  color: #1d2820;
  line-height: 1.5;
  white-space: normal;
}
.taste-option::after {
  border: 0;
}
.taste-option.active {
  border: 2px solid #34482e;
  padding: 13px 15px;
  background: #d6ff6633;
}
.taste-title {
  font-size: 16px;
  font-weight: 700;
}
.taste-description {
  margin-top: 5px;
  font-size: 12px;
  color: #65735d;
}

.custom-add {
  display: flex;
  gap: 10px;
  align-items: center;
  margin: 18px 0 10px;
}
.custom-add .field {
  flex: 1;
  min-width: 0;
}
.custom-add .pill {
  flex-shrink: 0;
}
.habit-card {
  margin-top: 14px;
}
.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
}
.range-row .field {
  flex: 1;
  min-width: 0;
  padding: 0 10px;
}
</style>
