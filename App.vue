<script>
import { api } from './services/api';
let presenceTimer;
export default {
  onShow() {
    clearInterval(presenceTimer);
    presenceTimer = setInterval(() => {
      if (uni.getStorageSync('uni_id_token')) api('presence').catch(() => {});
    }, 90000);
  },
  onHide() {
    clearInterval(presenceTimer);
  }
};
</script>
<style>
.line-break {
  display: block;
  height: 0;
}
page {
  background: #f4f2e9;
  color: #1c2520;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC',
    'Microsoft YaHei', sans-serif;
  font-size: 15px;
  line-height: 1.6;
}
view,
text,
button,
input {
  box-sizing: border-box;
}
button {
  font: inherit;
  border-radius: 0;
  padding: 0;
  margin: 0;
  background: transparent;
  color: inherit;
  line-height: inherit;
}
button::after {
  border: 0;
}
button[disabled] {
  opacity: 0.5;
  color: #1c2520;
}
input {
  font: inherit;
  min-width: 0;
}
.shell {
  max-width: 480px;
  margin: 0 auto;
  min-height: 100vh;
  padding: calc(env(safe-area-inset-top) + 22px) 24px
    calc(env(safe-area-inset-bottom) + 30px);
  background-image: radial-gradient(#cdd0c3 0.7px, transparent 0.7px);
  background-size: 20px 20px;
}
/* #ifdef MP-WEIXIN */
.shell {
  padding-top: 0;
}
/* #endif */
.brand {
  font-weight: 800;
  letter-spacing: 1px;
  display: flex;
  align-items: center;
  gap: 9px;
}
.brand-mark {
  background: #1c2520;
  color: #d6ff66;
  border-radius: 8px;
  width: 27px;
  height: 27px;
  text-align: center;
  line-height: 27px;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 2px;
  color: #727b6a;
}
.title {
  font-size: 40px;
  font-weight: 900;
  line-height: 1.15;
  letter-spacing: -2px;
  white-space: pre-line;
  overflow-wrap: anywhere;
  margin: 20px 0;
}
.highlight {
  background: linear-gradient(
    transparent 65%,
    #d6ff66 65%,
    #d6ff66 95%,
    transparent 95%
  );
}
.muted {
  color: #77806f;
  font-size: 13px;
}
.body {
  line-height: 1.9;
  font-size: 15px;
}
.primary {
  width: 100%;
  min-height: 56px;
  padding: 13px 15px;
  background: #d6ff66;
  border: 2px solid #1c2520;
  border-radius: 17px;
  box-shadow: 4px 5px 0 #1c2520;
  font-weight: 800;
  text-align: center;
  font-size: 17px;
  margin: 16px 0 12px;
}
.secondary {
  width: 100%;
  padding: 12px;
  border: 1px solid #bfc6b0;
  border-radius: 15px;
  margin: 12px 0;
  text-align: center;
}
.link {
  font-size: 13px;
  text-align: center;
  padding: 12px;
  color: #65715e;
}
.tiny-button {
  padding: 8px;
  min-width: 42px;
  font-size: 20px;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.stack {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.pills {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pill {
  padding: 8px 15px;
  border: 1px solid #bbc5a9;
  border-radius: 30px;
  font-size: 13px;
}
.pill.active {
  background: #1c2520;
  color: #d6ff66;
  border-color: #1c2520;
}
.card {
  padding: 20px;
  border: 1px solid #c6cbbd;
  border-radius: 18px;
  background: #f9f8f1;
}
.field {
  display: flex;
  align-items: center;
  padding: 0 14px;
  background: #faf9f4;
  border: 1px solid #b8c1ad;
  border-radius: 12px;
  height: 50px;
  width: 100%;
}
.field-input {
  flex: 1;
  width: 100%;
  min-width: 0;
  height: 24px;
  line-height: 24px;
  padding: 0;
  font-size: 15px;
}
.label {
  display: block;
  font-size: 17px;
  font-weight: 700;
  margin: 22px 0 12px;
}
.footer {
  text-align: center;
  font-size: 11px;
  color: #89917e;
  margin-top: 34px;
}
.error {
  padding: 16px;
  border: 1px solid #c4b78b;
  border-radius: 14px;
  background: #fff8de;
  font-size: 13px;
  margin: 16px 0;
}
.preview {
  font-size: 10px;
  text-align: center;
  color: #687958;
  margin-bottom: 10px;
}
.price {
  text-align: center;
  font-size: 24px;
  font-weight: 800;
  margin: 10px 0 20px;
}
.price text {
  font-size: 12px;
  font-weight: 400;
}
.badge {
  font-size: 11px;
  border: 1px solid #bbc5a9;
  border-radius: 30px;
  padding: 4px 10px;
}
.receipt {
  background: #fffdf7;
  padding: 26px 22px;
  box-shadow: 0 8px 24px #1c252012;
  border-top: 5px solid #1c2520;
  border-bottom: 2px dashed #c9cfbc;
}
.dash {
  border-top: 1px dashed #bfc7b1;
  margin: 22px 0;
}
.stamp {
  display: inline-block;
  transform: rotate(-7deg);
  border: 2px solid #566947;
  color: #566947;
  padding: 4px 12px;
  font-weight: 800;
  font-size: 20px;
}
.empty {
  padding: 45px 0;
  text-align: center;
}
.spacer {
  height: 24px;
}
.small-title {
  font-size: 24px;
  font-weight: 800;
  line-height: 1.4;
}
.sheet-cover {
  position: fixed;
  inset: 0;
  background: #1c252055;
  z-index: 9;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}
.sheet {
  width: 100%;
  max-width: 480px;
  max-height: 85vh;
  overflow-y: auto;
  background: #f4f2e9;
  border-radius: 24px 24px 0 0;
  padding: 22px 24px calc(env(safe-area-inset-bottom) + 24px);
}
@media (max-width: 350px) {
  .shell {
    padding-left: 18px;
    padding-right: 18px;
  }
  .title {
    font-size: 34px;
  }
  .pill {
    padding: 7px 12px;
  }
}
@media (min-width: 600px) {
  .shell {
    margin-top: 24px;
    margin-bottom: 24px;
    border: 1px solid #d7dacd;
    border-radius: 28px;
    min-height: calc(100vh - 48px);
  }
}
</style>
