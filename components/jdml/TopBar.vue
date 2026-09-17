<template>
  <view class="top-bar">
    <view v-if="isWeixin" :style="{ height: navigationHeight + 'px' }"></view>
    <view class="navigation" :class="{ 'navigation-fixed': isWeixin }" :style="navigationStyle">
      <view class="navigation-row" :style="rowStyle">
        <button class="brand navigation-brand" @click="back ? navigateBack() : home()">
          <text class="brand-mark navigation-mark">≈</text>
          <text class="navigation-title">{{ back ? '返回小店' : '就当买了' }}</text>
        </button>
        <text v-if="tag && !isWeixin" class="badge navigation-tag">{{ tag }}</text>
        <button v-if="more" class="tiny-button navigation-more" aria-label="更多" @click="$emit('more')">···</button>
      </view>
    </view>
    <view v-if="tag && isWeixin" class="navigation-subtitle"><text class="badge">{{ tag }}</text></view>
  </view>
</template>
<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { home } from '../../services/api';
defineProps({ back: Boolean, more: Boolean, tag: String });
defineEmits(['more']);
let isWeixin = false;
// #ifdef MP-WEIXIN
isWeixin = true;
// #endif
const statusHeight = ref(44), rowHeight = ref(44), rightInset = ref(109);
const navigationHeight = computed(() => statusHeight.value + rowHeight.value);
const navigationStyle = computed(() => isWeixin ? {
  paddingTop: statusHeight.value + 'px',
  paddingRight: rightInset.value + 'px'
} : {});
const rowStyle = computed(() => isWeixin ? { height: rowHeight.value + 'px' } : {});
function updateMetrics() {
  // #ifdef MP-WEIXIN
  let info = {};
  try { info = uni.getWindowInfo(); } catch (_) {}
  const width = info.windowWidth > 0 ? info.windowWidth : 375;
  statusHeight.value = Number.isFinite(info.statusBarHeight) ? Math.max(0, info.statusBarHeight) : 44;
  let capsule;
  try { capsule = uni.getMenuButtonBoundingClientRect(); } catch (_) {}
  if (capsule && capsule.width > 0 && capsule.height > 0 &&
      capsule.top >= statusHeight.value && capsule.left > 0 && capsule.right <= width) {
    rowHeight.value = Math.max(44, capsule.height + 2 * (capsule.top - statusHeight.value));
    rightInset.value = width - capsule.left + 12;
  } else {
    rowHeight.value = 44;
    rightInset.value = 109;
  }
  // #endif
}
updateMetrics();
onMounted(() => {
  // #ifdef MP-WEIXIN
  updateMetrics();
  uni.onWindowResize(updateMetrics);
  // #endif
});
onUnmounted(() => {
  // #ifdef MP-WEIXIN
  uni.offWindowResize(updateMetrics);
  // #endif
});
function navigateBack() {
  if (getCurrentPages().length > 1) uni.navigateBack();
  else home();
}
</script>
<style scoped>
.top-bar { margin-bottom: 40px; }
.navigation-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 44px; }
.navigation-fixed { position: fixed; top: 0; left: 0; right: 0; z-index: 8; padding-left: 24px; background: #f4f2e9; }
.navigation-brand { flex: 1; min-width: 0; height: 44px; justify-content: flex-start; }
.navigation-mark { flex-shrink: 0; }
.navigation-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.navigation-more { flex-shrink: 0; width: 44px; height: 44px; padding: 0; display: flex; align-items: center; justify-content: center; }
.navigation-tag { flex-shrink: 0; }
.navigation-subtitle { margin-top: 12px; }
@media (max-width: 350px) {
  .top-bar { margin-bottom: 28px; }
  .navigation-fixed { padding-left: 18px; }
  .navigation-row { gap: 6px; }
}
</style>
