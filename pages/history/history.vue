<template>
  <view class="shell"
    ><TopBar back /><view class="eyebrow">买过什么，为什么想买</view
    ><view class="title"><text class="highlight">消费记录</text></view
    ><view class="muted" style="margin-bottom: 20px"
      >给自己买的、请朋友的、朋友请你的，都在这里。点开一条，看看当时的小票。</view
    ><view class="pills"
      ><button
        class="pill"
        :class="{ active: tab === 'events' }"
        @click="tab = 'events'"
      >
        全部记录</button
      ><button
        class="pill"
        :class="{ active: tab === 'items' }"
        @click="tab = 'items'"
      >
        买过的物品
      </button></view
    ><view class="spacer"></view
    ><view v-if="error" class="error"
      >{{ error
      }}<button class="link" :disabled="busy" @click="load">
        重新加载记录
      </button></view
    ><view v-if="tab === 'events'" class="stack"
      ><button
        v-for="e in events"
        :key="e.id"
        class="card"
        style="text-align: left"
        @click="go('receipt', 'id=' + e.id)"
      >
        <view class="row"
          ><text style="font-weight: 800">{{ e.item }}</text
          ><text class="badge">{{ role(e) }}</text></view
        ><view class="muted" style="margin: 8px 0">{{ e.reason }}</view
        ><view class="row muted"
          ><text>{{ status(e) }}</text
          ><text>假装 ¥{{ money(e.amount) }} →</text></view
        >
      </button></view
    ><view v-else class="stack"
      ><button
        v-for="group in groups"
        :key="group.key"
        class="card"
        style="text-align: left"
        @click="filter = filter === group.key ? '' : group.key"
      >
        <view class="row"
          ><text class="small-title">{{ group.item }}</text
          ><text>× {{ group.events.length }}</text></view
        ><view class="muted">{{ group.label }} · 已成立的虚构体验</view
        ><view v-if="filter === group.key"
          ><view
            v-for="e in group.events"
            :key="e.id"
            class="link"
            style="text-align: left"
            @click.stop="go('receipt', 'id=' + e.id)"
            >{{ e.reason }} →</view
          ></view
        >
      </button></view
    ><view
      v-if="
        !(tab === 'events' ? events.length : groups.length) && !busy && !error
      "
      class="empty muted"
    >
      {{
        tab === 'events'
          ? '还没有消费记录，先给自己安排一笔吧。'
          : '还没有买下的物品。未决定和跳过的小事，可以在全部记录里查看。'
      }}
      <button class="secondary" @click="home">回小店逛逛 ↗</button> </view
    ><button
      v-if="next !== null"
      class="secondary"
      :disabled="busy"
      @click="load"
    >
      {{ busy ? '正在翻小票…' : '再翻一些小事' }}</button
    ><view class="footer"
      >物品数量按已加载的小事汇总。<text class="line-break"> </text
      >收到的请客不会增加你的转存金额。</view
    ></view
  >
</template>
<script setup>
import { ref, computed } from 'vue';
import { onShow } from '@dcloudio/uni-app';
import TopBar from '../../components/jdml/TopBar.vue';
import { api, go, money, home } from '../../services/api';
const events = ref([]),
  tab = ref('events'),
  next = ref(0),
  busy = ref(false),
  error = ref(''),
  filter = ref('');
onShow(() => {
  events.value = [];
  next.value = 0;
  load();
});
async function load() {
  if (busy.value || next.value === null) return;
  busy.value = true;
  error.value = '';
  try {
    const r = await api('history', { cursor: next.value });
    const ids = new Set(events.value.map((e) => e.id));
    events.value.push(...r.events.filter((e) => !ids.has(e.id)));
    next.value = r.next;
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
  }
}
function role(e) {
  return e.role === 'recipient'
    ? '朋友请我'
    : e.role === 'sender'
      ? '我请朋友'
      : '给自己买';
}
function status(e) {
  if (e.role === 'recipient') return '心意已收到';
  if (e.deposit && !e.deposit.revokedAt)
    return '本人确认 ¥' + money(e.deposit.amount);
  return (
    {
      offered: '还没决定',
      pending: e.expiresAt < Date.now() ? '请客已过期' : '等朋友接受',
      accepted: '待自行转存',
      play_only: '这次只玩梗',
      cancelled: '已撤销',
      skipped: '这次跳过'
    }[e.state] || '已留下小票'
  );
}
const groups = computed(() => {
  const map = {};
  for (const e of events.value) {
    if (!['accepted', 'confirmed', 'play_only'].includes(e.state)) continue;
    const key = e.habit + ':' + e.role;
    if (!map[key]) map[key] = { key, item: e.item, label: role(e), events: [] };
    map[key].events.push(e);
  }
  return Object.values(map);
});
</script>
