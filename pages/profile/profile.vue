<template><view class="shell"><TopBar back/><view class="eyebrow">请客卡上，这就是你</view><view class="title">留一个，<text class="line-break"> </text><text class="highlight">你的样子。</text></view><text class="label">选一个头像</text><view class="pills avatar-options"><button v-for="a in avatars" :key="a.key" class="avatar-option" :class="{active:avatar===a.key}" @click="avatar=a.key">{{a.icon}}</button></view><text class="label">怎么称呼你？</text><view class="field"><input class="field-input" v-model="nickname" maxlength="16" placeholder="路过的好朋友"/></view><view class="muted">昵称会显示给接受你请客的朋友。<text class="line-break"> </text>已发出的请客卡保留当时的昵称。</view><button class="primary" :disabled="busy" @click="save">{{busy?'正在保存…':'就叫这个 ↗'}}</button><view v-if="error" class="error">{{error}}</view></view></template>
<script setup>
import {ref} from 'vue';import {onLoad} from '@dcloudio/uni-app';import TopBar from '../../components/jdml/TopBar.vue';import {api,notify} from '../../services/api';const avatars=[{key:'leaf',icon:'♧'},{key:'star',icon:'✧'},{key:'cup',icon:'☕'},{key:'cloud',icon:'☁'}];const nickname=ref(''),avatar=ref('leaf'),busy=ref(false),error=ref('');onLoad(async()=>{try{const s=await api('bootstrap');nickname.value=s.user.nickname;avatar.value=s.user.avatar;}catch(e){error.value=e.message;}});async function save(){if(busy.value)return;busy.value=true;try{await api('profile',{nickname:nickname.value,avatar:avatar.value});uni.showToast({title:'记住你了',icon:'none'});uni.navigateBack();}catch(e){error.value=e.message;}finally{busy.value=false;}}
</script>

<style scoped>
.avatar-options {
  gap: 12px;
}
.avatar-option {
  box-sizing: border-box;
  flex: 0 0 56px;
  width: 56px;
  height: 56px;
  min-width: 56px;
  min-height: 56px;
  padding: 0;
  border: 1px solid #bbc5a9;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  line-height: 1;
}
.avatar-option.active {
  background: #1c2520;
  color: #d6ff66;
  border-color: #1c2520;
}
</style>
