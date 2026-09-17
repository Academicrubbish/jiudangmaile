<template>
  <view class="shell home-shell">
    <TopBar more @more="menu = true" />
    <view v-if="error" class="error"
      >{{ error }}<button class="link" @click="load">重新连接小店</button></view
    >
    <template v-if="state">
      <view class="row home-tools"
        ><text class="eyebrow">{{ persona }}</text
        ><button class="reminder-entry" @click="reminderPanel = true">
          消息提醒 ↗
        </button></view
      >
      <button
        v-if="state.randomEvent"
        class="inbox-card"
        :disabled="busy"
        @click="openRandom"
      >
        <view class="row"
          ><text class="inbox-title"
            ><text v-if="state.unreadCount" class="unread-dot"></text
            >{{
              state.unreadCount ? '收到一条未知小事' : '今天的随机小事'
            }}</text
          ><text>↗</text></view
        >
        <view class="muted">{{
          state.unreadCount
            ? '拆开看看，今天又有什么小剧情？'
            : '已经看过，随时回来继续这件小事。'
        }}</view>
      </button>
      <template v-if="event">
        <view class="title"
          ><text class="highlight">{{ event.title }}</text></view
        >
        <view class="body">{{ event.reason }}</view
        ><ItemArt :habit="event.habit" />
        <view class="price"
          >¥{{ money(event.amount) }}
          <text>/ {{ event.unit }} · 假装花</text></view
        >
        <button class="primary" :disabled="busy" @click="act">
          {{
            busy
              ? '稍等一下…'
              : event.state === 'pending'
                ? '看看我的请客卡 ↗'
                : event.state === 'accepted'
                  ? '看看这张小票 ↗'
                  : (event.actionLabel || '这份算我买了') + ' ↗'
          }}
        </button>
        <button
          v-if="event.state === 'offered'"
          class="link"
          :disabled="busy"
          @click="change('skip')"
        >
          这次先不买
        </button>
        <button
          v-if="event.state === 'pending'"
          class="link"
          :disabled="busy"
          @click="change('cancel')"
        >
          撤销这份请客
        </button>
      </template>
      <template v-else>
        <view class="title"
          >今天想给自己，<text class="line-break"></text
          ><text class="highlight">加点什么戏？</text></view
        >
        <ItemArt :habit="state.user.preferences.habits[0]" />
        <view class="muted center"
          >随机小事来了会告诉你，也可以现在主动花一笔。</view
        >
      </template>
      <button class="history-summary" :disabled="busy" @click="go('history')">
        <view class="history-summary-copy">
          <text class="history-summary-title">消费记录</text>
          <text class="muted"
            >今天本人确认转存 ¥{{ money(state.todayConfirmed) }}</text
          >
        </view>
        <text class="history-summary-arrow">查看全部 ↗</text>
      </button>
    </template>
    <view v-else-if="!error" class="empty">正在打开小店…</view>
    <view class="footer">东西是虚构的。钱留给自己。</view>

    <view class="home-navigation">
      <view class="home-navigation-inner">
        <button
          class="navigation-action"
          :disabled="busy || !state?.user?.preferences"
          @click="openPurchase('self')"
        >
          <text class="navigation-symbol">＋</text><text>花一笔</text>
        </button>
        <button
          class="navigation-action"
          :disabled="busy || !state?.user?.preferences"
          @click="openPurchase('treat')"
        >
          <text class="navigation-symbol">↗</text><text>请朋友</text>
        </button>
        <button
          class="navigation-action records-action"
          :disabled="busy"
          @click="go('history')"
        >
          <text class="navigation-symbol">≡</text><text>消费记录</text>
        </button>
      </view>
    </view>

    <view v-if="menu" class="sheet-cover"
      ><view class="sheet-backdrop" @click="menu = false"></view
      ><view class="sheet" @click.stop>
        <view class="row"
          ><text class="small-title">小店的另一面</text
          ><button class="tiny-button" @click="menu = false">×</button></view
        >
        <button class="secondary" @click="open('history')">
          消费记录与物品
        </button>
        <button class="secondary" @click="open('profile')">昵称与头像</button>
        <button class="secondary" @click="open('setup', 'edit=1')">
          习惯与剧情口味
        </button>
        <button
          class="secondary"
          @click="
            menu = false;
            reminderPanel = true;
          "
        >
          消息提醒
        </button>
      </view></view
    >

    <view v-if="purchase" class="sheet-cover"
      ><view class="sheet-backdrop" @click="closePurchase"></view
      ><view class="sheet" @click.stop>
        <GiftMessagePicker
          v-if="giftDraft"
          :input="giftDraft.input"
          :item="giftDraft.item"
          :busy="busy"
          @back="giftDraft = null"
          @confirm="createGift"
        />
        <template v-else>
          <view class="row"
            ><text class="small-title">{{
              purchase === 'treat' ? '想请朋友点什么？' : '这次想花在哪儿？'
            }}</text
            ><button
              class="tiny-button"
              :disabled="busy"
              @click="closePurchase"
            >
              ×
            </button></view
          >
          <view class="spacer"></view
          ><view class="pills"
            ><button
              v-for="h in purchaseOptions"
              :key="h.key"
              class="pill"
              :class="{ active: chosenHabit === h.key }"
              :disabled="busy"
              @click.stop="chooseProduct(h.key)"
            >
              {{ h.name }}</button
            ><button
              class="pill"
              :class="{ active: chosenHabit === 'custom' }"
              :disabled="busy || !state?.capabilities?.manualShop"
              @click.stop="chooseProduct('custom')"
            >
              ＋自己写
            </button></view
          >
          <view v-if="chosenHabit === 'custom'">
            <text class="label">这次买什么？</text>
            <view class="field"
              ><input
                class="field-input"
                v-model="customProduct"
                :disabled="busy"
                maxlength="12"
                placeholder="比如：烤红薯、鲜花、电影票"
            /></view>
          </view>
          <text class="label">本次金额</text>
          <view class="field"
            ><text>¥</text
            ><input
              class="field-input"
              type="digit"
              v-model="purchaseAmount"
              :disabled="busy"
              maxlength="7"
              placeholder="1–1000 元"
          /></view>
          <view class="muted" style="margin-top: 12px"
            >想买什么自己选，不限人设，也不占每日随机额度。这次选择不会改变 AI
            推荐偏好。</view
          >
          <view
            v-if="!state?.capabilities?.manualShop"
            class="muted"
            style="margin-top: 12px"
            >商品库暂未准备好，请稍后重新进入。</view
          >
          <view
            v-if="purchase === 'treat'"
            class="muted"
            style="margin-top: 12px"
            >一张卡请一个人，24 小时有效。已有请客卡仍可领取。</view
          >
          <button
            class="primary"
            :disabled="busy || !state?.capabilities?.manualShop"
            @click="create"
          >
            {{
              busy
                ? '正在安排…'
                : purchase === 'treat'
                  ? '下一步，捎句话 ↗'
                  : '给我安排这一份 ↗'
            }}
          </button>
        </template>
      </view></view
    >

    <view v-if="reminderPanel" class="sheet-cover"
      ><view class="sheet-backdrop" @click="reminderPanel = false"></view
      ><view class="sheet" @click.stop>
        <view class="row"
          ><text class="small-title">小事来了，告诉我</text
          ><button class="tiny-button" @click="reminderPanel = false">
            ×
          </button></view
        >
        <view class="body" style="margin: 16px 0"
          >进入小店后，新到的随机事件会显示未读提示，点开就能看。</view
        >
        <view class="card"
          ><text class="label" style="margin: 0 0 8px">微信消息提醒</text>
          <view class="muted">{{
            !state?.capabilities?.subscription
              ? state?.capabilities?.subscriptionNeedsUpdate
                ? '提醒服务需要更新，请更新云函数后重试。站内小事照常可看。'
                : '微信提醒还在准备中，暂时无法开启。站内未读小事照常可看。'
              : !state?.reminders?.enabled
                ? '开启后，小事来了可以通过微信告诉你。'
                : state?.reminders?.available
                  ? `已累计 ${state.reminders.remaining} 次提醒机会，实际发送以微信许可为准。`
                  : '提醒机会暂时用完了，可以再允许一次。'
          }}</view>
          <button
            class="primary"
            :disabled="
              busy || subscribing || !state?.capabilities?.subscription
            "
            @click="subscribe"
          >
            {{
              !state?.capabilities?.subscription
                ? '微信提醒暂未开放'
                : subscribing
                  ? '正在同步…'
                  : state?.reminders?.enabled
                    ? '再允许一次提醒'
                    : '开启剧情提醒'
            }}
          </button>
          <view class="muted" style="margin-top: 12px">
            勾选微信弹窗里的“总是保持以上选择”并允许后，拆小事、购买和发起请客时会顺带补充提醒机会。随时可以暂停。
          </view>
          <button
            v-if="state?.reminders?.enabled"
            class="link"
            :disabled="busy"
            @click="pauseReminders"
          >
            暂停微信提醒
          </button>
          <button class="link" @click="openNotificationSettings">
            查看微信授权设置 ↗
          </button>
        </view>
        <view
          v-if="state?.automaticBudget?.limit != null"
          class="muted"
          style="margin-top: 16px"
          >每天自动安排的虚构金额最多 ¥{{
            money(state?.automaticBudget?.limit)
          }}，主动花钱和请客另算。看过小事不代表已经存钱。</view
        >
      </view></view
    >
  </view>
</template>
<script setup>
import { computed, ref } from 'vue';
import {
  onLoad,
  onShow,
  onHide,
  onUnload,
  onShareAppMessage
} from '@dcloudio/uni-app';
import TopBar from '../../components/jdml/TopBar.vue';
import ItemArt from '../../components/jdml/ItemArt.vue';
import GiftMessagePicker from '../../components/jdml/GiftMessagePicker.vue';
import { normalizeHomeState } from '../../services/home-state';
import { createSubscriptionController } from '../../services/subscriptions';
import { api, money, parseMoney, go, notify } from '../../services/api';
const state = ref(null),
  error = ref(''),
  busy = ref(false),
  subscribing = ref(false),
  menu = ref(false),
  reminderPanel = ref(false),
  purchase = ref(''),
  giftDraft = ref(null),
  chosenHabit = ref('milk_tea'),
  customProduct = ref(''),
  purchaseAmount = ref('10'),
  viewingRandom = ref(false);
let subscriptions;
// #ifdef MP-WEIXIN
subscriptions = createSubscriptionController({
  api,
  platform: uni,
  onChange: (reminders) => {
    if (state.value) state.value.reminders = reminders;
  },
  onBusy: (value) => {
    subscribing.value = value;
  },
  onError: (e) => {
    notify(e);
    load();
  },
  onResult: (result) =>
    uni.showToast({
      title:
        result === 'accept' ? '已补充一次提醒机会' : '不提醒，也可以继续玩',
      icon: 'none'
    })
});
// #endif
let linkedEvent = '',
  refreshTimer;
onLoad((q) => {
  linkedEvent = q.eventId || '';
});
const event = computed(() =>
  viewingRandom.value ? state.value?.randomEvent : state.value?.current
);
const persona = computed(() =>
  event.value?.triggerSource === 'active'
    ? event.value.habitName || event.value.item
    : event.value?.sceneSource === 'discovery'
      ? '生活随机小插曲'
      : (state.value?.habitOptions || []).map((h) => h.name).join(' · ') ||
        '今天的人设'
);
const purchaseOptions = computed(() => state.value?.shopOptions || []);
function chooseProduct(key) {
  if (busy.value) return;
  chosenHabit.value = key;
  if (key !== 'custom') {
    const option = purchaseOptions.value.find((h) => h.key === key);
    purchaseAmount.value = money(option?.min || 1000);
  }
}
function closePurchase() {
  if (!busy.value) {
    purchase.value = '';
    giftDraft.value = null;
  }
}
async function load() {
  error.value = '';
  try {
    const s = normalizeHomeState(await api('bootstrap'));
    if (!s.user.preferences) {
      uni.redirectTo({ url: '/pages/welcome/welcome' });
      return;
    }
    state.value = s;
    subscriptions?.configure(s);
    if (!s.randomEvent) viewingRandom.value = false;
    if (linkedEvent) {
      if (s.randomEvent?.id === linkedEvent) await revealRandom();
      else if (s.current?.id !== linkedEvent)
        notify(new Error('这件小事已经过去了，看看今天的吧'));
      linkedEvent = '';
    }
  } catch (e) {
    error.value = e.message;
  }
}
onShow(() => {
  load();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(() => {
    if (!busy.value && !menu.value && !purchase.value && !reminderPanel.value)
      load();
  }, 90000);
});
onHide(() => {
  clearInterval(refreshTimer);
  subscriptions?.suspend();
});
onUnload(() => {
  clearInterval(refreshTimer);
  subscriptions?.suspend();
});
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
async function revealRandom() {
  const e = state.value?.randomEvent;
  if (!e) return;
  if (e.unread) {
    state.value.randomEvent = await api('seen', { id: e.id });
    state.value.unreadCount = 0;
  }
  viewingRandom.value = true;
}
function openRandom() {
  if (!busy.value && state.value?.randomEvent?.unread) subscriptions?.request();
  perform(revealRandom);
}
function act() {
  if (!busy.value && event.value?.state === 'offered') subscriptions?.request();
  perform(async () => {
    const id = event.value.id;
    if (event.value.state === 'offered') await api('accept', { id });
    go('receipt', 'id=' + id);
  });
}
function change(action) {
  perform(async () => {
    await api(action, { id: event.value.id });
    await load();
  });
}
function openPurchase(kind) {
  if (busy.value || !state.value?.user?.preferences) return;
  purchase.value = kind;
  giftDraft.value = null;
  customProduct.value = '';
  chooseProduct(purchaseOptions.value[0]?.key || 'custom');
}
function create() {
  if (busy.value || !state.value?.capabilities?.manualShop) return;
  let input;
  try {
    const amount = parseMoney(purchaseAmount.value);
    if (amount < 100 || amount > 100000)
      throw new Error('本次金额为 1–1000 元');
    if (chosenHabit.value === 'custom') {
      const name = customProduct.value.trim();
      if (!name || [...name].length > 12)
        throw new Error('请用 1–12 个字写下商品名称');
      input = { kind: purchase.value, customItem: { name }, amount };
    } else {
      if (!purchaseOptions.value.some((h) => h.key === chosenHabit.value))
        throw new Error('先选一个商品');
      input = { kind: purchase.value, habit: chosenHabit.value, amount };
    }
  } catch (e) {
    notify(e);
    return;
  }
  if (input.kind === 'treat') {
    // Older deployments must not silently drop the chosen words on creation.
    if (!state.value?.capabilities?.giftMessages) {
      notify(new Error('请客留言还在准备中，请稍后重新进入小店'));
      return;
    }
    giftDraft.value = {
      input,
      item:
        input.customItem?.name ||
        purchaseOptions.value.find((h) => h.key === input.habit).name
    };
    return;
  }
  submitPurchase(input);
}
function createGift(giftMessage) {
  if (busy.value || !giftDraft.value) return;
  submitPurchase({ ...giftDraft.value.input, giftMessage });
}
function submitPurchase(input) {
  subscriptions?.request();
  perform(async () => {
    const e = await api('create', input);
    purchase.value = '';
    giftDraft.value = null;
    viewingRandom.value = false;
    await load();
    if (input.kind === 'treat') go('receipt', 'id=' + e.id);
  });
}
function open(page, query = '') {
  menu.value = false;
  go(page, query);
}
function subscribe() {
  if (busy.value) return;
  if (!subscriptions) {
    notify(new Error('请在微信小程序内申请提醒'));
    return;
  }
  subscriptions.request({ explicit: true });
}
function openNotificationSettings() {
  // #ifdef MP-WEIXIN
  subscriptions?.suspend();
  uni.openSetting({
    success: () => load(),
    fail: () => notify(new Error('请在小程序设置中查看通知授权'))
  });
  // #endif
}
function pauseReminders() {
  perform(async () => {
    await subscriptions?.pause();
    await load();
  });
}
</script>
<style scoped>
.sheet-backdrop {
  position: absolute;
  inset: 0;
}
.sheet {
  position: relative;
}

.home-shell {
  padding-bottom: calc(env(safe-area-inset-bottom) + 120px);
}
.home-navigation {
  position: fixed;
  z-index: 7;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 10px 18px calc(env(safe-area-inset-bottom) + 10px);
  background: #f4f2e9;
  border-top: 1px solid #cdd0c3;
}
.home-navigation-inner {
  display: flex;
  gap: 8px;
  max-width: 432px;
  margin: 0 auto;
}
.navigation-action {
  flex: 1;
  min-width: 0;
  min-height: 58px;
  padding: 5px 4px;
  border-radius: 13px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.4;
}
.navigation-symbol {
  font-size: 22px;
  line-height: 1.1;
  margin-bottom: 4px;
}
.records-action {
  background: #eaf1d9;
  border: 1px solid #bdc8a9;
}
.history-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  width: 100%;
  min-height: 72px;
  margin-top: 20px;
  padding: 16px 0;
  border-top: 1px dashed #bdc5b1;
  text-align: left;
}
.history-summary-copy {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}
.history-summary-title {
  font-size: 15px;
  font-weight: 700;
}
.history-summary-arrow {
  flex-shrink: 0;
  font-size: 12px;
  color: #65715e;
}

.home-tools {
  align-items: flex-start;
  margin-bottom: 16px;
}
.reminder-entry {
  flex-shrink: 0;
  font-size: 12px;
  border-bottom: 1px solid #77806f;
}
.inbox-card {
  width: 100%;
  padding: 16px;
  border: 1px dashed #65715e;
  border-radius: 16px;
  background: #edf3db;
  text-align: left;
}
.inbox-title {
  font-weight: 700;
  font-size: 15px;
}
.unread-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ce6044;
  margin-right: 8px;
}
.center {
  text-align: center;
}
</style>
