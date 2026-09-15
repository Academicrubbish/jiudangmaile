<template><view class="header"><button class="brand" @click="back ? navigateBack() : home()"><text class="brand-mark">≈</text><text>{{back ? '返回小店' : '就当买了'}}</text></button><text v-if="tag" class="badge">{{tag}}</text><button v-if="more" class="tiny-button" aria-label="更多" @click="$emit('more')">···</button></view></template>
<script setup>
import {home} from '../../services/api';defineProps({back:Boolean,more:Boolean,tag:String});defineEmits(['more']);function navigateBack(){if(getCurrentPages().length>1)uni.navigateBack();else home();}
</script>
