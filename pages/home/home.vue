<template>
  <view class="shell"
    ><view v-if="isPreview()" class="preview"
      >本地体验 · 数据仅保存在预览服务，不会转账</view
    ><TopBar more @more="menu = true" /><view v-if="error" class="error"
      >{{ error }}<button class="link" @click="load">重新连接小店</button></view
    ><view v-if="state"
      ><view class="row"
        ><text class="eyebrow">{{ persona }}</text
        ><text class="badge">虚构场景</text></view
      ><template v-if="event"
        ><view class="title"
          ><text class="highlight">{{ event.title }}</text></view
        ><view class="body">{{ event.reason }}</view
        ><ItemArt :habit="event.habit" /><view class="price"
          >¥{{ money(event.amount) }}
          <text>/ {{ event.unit }} · 假装花</text></view
        ><button class="primary" :disabled="busy" @click="act">
          {{
            busy
              ? '稍等一下…'
              : event.state === 'pending'
                ? '看看我的请客卡 ↗'
                : event.state === 'accepted'
                  ? '看看这张小票 ↗'
                  : (event.actionLabel || '这份算我买了') + ' ↗'
          }}</button
        ><button
          v-if="event.state === 'offered'"
          class="link"
          :disabled="busy"
          @click="skip"
        >
          今天先不买</button
        ><button
          v-if="event.state === 'pending'"
          class="link"
          :disabled="busy"
          @click="cancel"
        >
          撤销这份请客
        </button></template
      ><template v-else
        ><view class="title"
          >今天挺清闲，<text class="line-break"> </text
          ><text class="highlight">找点小乐子。</text></view
        ><ItemArt :habit="state.user.preferences.habit" /><view
          class="muted"
          style="text-align: center"
          >{{
            state.available >= 100
              ? '一件小事，也值得好好演。'
              : '今天这些就挺好，明天再来玩。'
          }}</view
        ><button
          class="primary"
          :disabled="busy || state.available < 100"
          @click="create('self')"
        >
          我想花一笔 ↗</button
        ><button
          class="secondary"
          :disabled="busy || state.available < 100"
          @click="treat = true"
        >
          请朋友一份
        </button></template
      ><button class="link" @click="go('history')">
        今天记了 ¥{{ money(state.todayConfirmed) }} · 本人确认 →
      </button></view
    ><view v-else-if="!error" class="empty">正在打开小店…</view
    ><view class="footer">东西是虚构的。钱留给自己。</view>
    <view v-if="menu" class="sheet-cover" @click.self="menu = false"
      ><view class="sheet"
        ><view class="row"
          ><text class="small-title">小店的另一面</text
          ><button class="tiny-button" @click="menu = false">×</button></view
        ><button class="secondary" @click="open('history')">
          我的小事与物品</button
        ><button class="secondary" @click="open('profile')">昵称与头像</button
        ><button
          class="secondary"
          @click="
            menu = false;
            go('setup', 'edit=1');
          "
        >
          修改花钱人设</button
        ><button
          v-if="state?.capabilities.subscription"
          class="secondary"
          :disabled="busy"
          @click="subscribe"
        >
          有新小事时，提醒我一次</button
        ><button
          v-if="state?.reminders.enabled"
          class="link"
          :disabled="busy"
          @click="pauseReminders"
        >
          暂停提醒</button
        ><view class="muted"
          >{{
            !state?.capabilities.subscription
              ? '消息提醒暂不可用，站内小事照常。'
              : state?.reminders.available
                ? '已申请一次提醒，实际发送以微信许可为准。'
                : '需要你主动允许，才会尝试提醒。'
          }}<text class="line-break"> </text>所有转存记录均由本人确认。</view
        ></view
      ></view
    >
    <view v-if="treat" class="sheet-cover" @click.self="treat = false"
      ><view class="sheet"
        ><view class="row"
          ><text class="small-title">想请朋友点什么？</text
          ><button class="tiny-button" @click="treat = false">×</button></view
        ><view class="spacer"></view
        ><view class="pills"
          ><button
            v-for="h in habits"
            :key="h.key"
            class="pill"
            :class="{ active: treatHabit === h.key }"
            @click="treatHabit = h.key"
          >
            {{ h.name }}
          </button></view
        ><view class="spacer"></view
        ><view class="muted"
          >一张卡请一个人，24 小时有效。<text class="line-break"> </text
          >虚构请客金额会占用今天的参考额度。</view
        ><button class="primary" :disabled="busy" @click="create('treat')">
          生成一份请客卡 ↗
        </button></view
      ></view
    ></view
  >
</template>
<script setup>
import { ref, computed } from 'vue';
import {
  onLoad,
  onShow,
  onHide,
  onUnload,
  onShareAppMessage
} from '@dcloudio/uni-app';
import TopBar from '../../components/jdml/TopBar.vue';
import ItemArt from '../../components/jdml/ItemArt.vue';
import { api, money, go, notify, habits, isPreview } from '../../services/api';
let linkedEvent = '';
onLoad((q) => {
  linkedEvent = q.eventId || '';
});
const state = ref(null),
  error = ref(''),
  busy = ref(false),
  menu = ref(false),
  treat = ref(false),
  treatHabit = ref('milk_tea');
const event = computed(() => state.value?.current);
const persona = computed(
  () =>
    habits.find((h) => h.key === state.value?.user.preferences?.habit)?.label ||
    '今天的人设'
);
async function load() {
  error.value = '';
  try {
    const s = await api('bootstrap');
    if (!s.user.preferences) {
      uni.redirectTo({ url: '/pages/welcome/welcome' });
      return;
    }
    state.value = s;
    if (linkedEvent) {
      if (s.current?.id !== linkedEvent)
        notify(new Error('这件小事已经过去了，看看今天的吧'));
      linkedEvent = '';
    }
  } catch (e) {
    error.value = e.message;
  }
}
let refreshTimer;
onShow(() => {
  load();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!busy.value && !menu.value && !treat.value) load();
  }, 90000);
});
onHide(() => clearInterval(refreshTimer));
onUnload(() => clearInterval(refreshTimer));
onShareAppMessage(() => ({
  title: '东西是虚构的，钱留给自己。来「就当买了」演一笔。',
  path: '/pages/home/home'
}));
async function perform(fn) {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
  } catch (e) {
    notify(e);
  } finally {
    busy.value = false;
  }
}
function act() {
  perform(async () => {
    if (event.value.state === 'offered')
      await api('accept', { id: event.value.id });
    go('receipt', 'id=' + event.value.id);
  });
}
function skip() {
  perform(async () => {
    await api('skip', { id: event.value.id });
    await load();
  });
}
function cancel() {
  perform(async () => {
    await api('cancel', { id: event.value.id });
    await load();
  });
}
function create(kind) {
  perform(async () => {
    const e = await api('create', {
      kind,
      ...(kind === 'treat' ? { habit: treatHabit.value } : {})
    });
    treat.value = false;
    await load();
    if (kind === 'treat') go('receipt', 'id=' + e.id);
  });
}
function open(p) {
  menu.value = false;
  go(p);
}
function subscribe() {
  if (busy.value || !state.value?.capabilities.subscription) return;
  const templateId = state.value.capabilities.templateId,
    intent = state.value.reminders.intent;
  if (!intent) {
    perform(load);
    return;
  }
  // #ifdef MP-WEIXIN
  busy.value = true;
  uni.requestSubscribeMessage({
    tmplIds: [templateId],
    success: async (result) => {
      try {
        await api('subscription', { intent, result: result[templateId] });
        await load();
        uni.showToast({
          title:
            result[templateId] === 'accept'
              ? '记住你的提醒意愿了'
              : '不提醒，也可以继续玩',
          icon: 'none'
        });
      } catch (e) {
        notify(e);
      } finally {
        busy.value = false;
      }
    },
    fail: () => {
      busy.value = false;
      notify(new Error('这次没有开启提醒，仍可正常玩'));
    }
  });
  // #endif
  // #ifndef MP-WEIXIN
  notify(new Error('请在微信小程序内申请提醒'));
  // #endif
}
function pauseReminders() {
  perform(async () => {
    await api('pauseReminders');
    await load();
  });
}
</script>
