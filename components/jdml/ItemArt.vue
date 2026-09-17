<template>
  <view class="art" :class="[habit, { small }]" aria-hidden="true"
    ><view class="orbit"></view><view class="spark">✧</view
    ><view class="label-note">实物不存在</view
    ><view v-if="habit === 'smoke'" class="air-pack"
      ><text class="pack-symbol">空</text><view class="pack-line"></view></view
    ><view
      v-else-if="
        habit === 'betel' ||
        habit.startsWith('custom_') ||
        (habit.startsWith('surprise_') &&
          !['surprise_coffee', 'surprise_cup'].includes(habit))
      "
      class="air-pack betel-pack"
      ><text class="pack-symbol">≈</text><view class="pack-line"></view></view
    ><view v-else class="cup"
      ><view class="straw"></view><view class="rim"></view
      ><view class="cup-body"
        ><view class="tea"></view><view class="pearl p1"></view
        ><view class="pearl p2"></view
        ><view class="pearl p3"></view></view></view
    ><view class="shadow"></view
    ><view class="caption">含量：100% 想象</view></view
  >
</template>
<script setup>
defineProps({ habit: { type: String, default: 'milk_tea' }, small: Boolean });
</script>
<style scoped>
.art {
  height: 240px;
  position: relative;
  width: 100%;
  max-width: 330px;
  margin: 4px auto 0;
}
.cup {
  position: absolute;
  top: 62px;
  left: 50%;
  width: 130px;
  transform: translateX(-50%) rotate(-4deg);
}
.straw {
  position: absolute;
  left: 82px;
  top: -50px;
  width: 16px;
  height: 65px;
  border: 2px dashed #34482e;
  transform: rotate(20deg);
}
.rim {
  height: 14px;
  width: 145px;
  position: relative;
  left: -7px;
  border: 2px dashed #34482e;
  background: #f4f2e9;
  z-index: 2;
}
.cup-body {
  height: 126px;
  border: 2px dashed #34482e;
  border-top: 0;
  transform: perspective(180px) rotateX(-12deg);
  position: relative;
  overflow: hidden;
}
.tea {
  position: absolute;
  inset: 37px 0 0;
  background: #d6ff6633;
  border-top: 2px dashed #63734a;
}
.pearl {
  position: absolute;
  border: 2px dashed #435a31;
  border-radius: 50%;
  width: 15px;
  height: 17px;
  bottom: 16px;
}
.p1 {
  left: 24px;
  transform: rotate(20deg);
}
.p2 {
  left: 59px;
  bottom: 9px;
}
.p3 {
  right: 16px;
  bottom: 20px;
}
.shadow {
  position: absolute;
  bottom: 28px;
  left: 50%;
  transform: translateX(-50%);
  height: 10px;
  width: 172px;
  border-radius: 50%;
  background: #dce2cb;
}
.caption {
  position: absolute;
  bottom: 7px;
  font-size: 9px;
  letter-spacing: 3px;
  color: #82916e;
  text-align: center;
  width: 100%;
}
.label-note {
  position: absolute;
  right: 1px;
  top: 33px;
  padding: 3px 8px;
  font-size: 11px;
  border: 1px solid #34482e;
  transform: rotate(9deg);
  letter-spacing: 2px;
}
.spark {
  position: absolute;
  left: 26px;
  top: 92px;
  font-size: 34px;
  color: #748561;
}
.air-pack {
  position: absolute;
  left: 50%;
  top: 47px;
  transform: translateX(-50%) rotate(-7deg);
  height: 142px;
  width: 103px;
  border: 2px dashed #34482e;
  background: #d6ff6629;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pack-symbol {
  font-size: 48px;
  font-weight: 800;
  color: #52643d;
}
.pack-line {
  position: absolute;
  top: 24px;
  left: 0;
  right: 0;
  border-top: 2px dashed #34482e;
}
.betel-pack {
  border-radius: 16px 6px 16px 6px;
}
.drink .straw {
  display: none;
}
.drink .cup {
  width: 112px;
}
.drink .rim {
  width: 122px;
  left: -5px;
}
.small {
  height: 140px;
  transform: scale(0.65);
  transform-origin: top center;
  margin-bottom: -34px;
}
</style>
