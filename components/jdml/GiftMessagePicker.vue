<template>
  <view>
    <view class="row">
      <text class="small-title">给朋友捎句话</text>
      <button class="tiny-button" :disabled="busy" @click="$emit('back')">
        返回
      </button>
    </view>
    <view class="muted gift-product"
      >请一份{{ item }} · ¥{{ money(input.amount) }}</view
    >
    <view class="gift-toolbar">
      <text class="muted">挑一句，也可以改成你的口气。</text>
      <button
        class="gift-refresh"
        :disabled="loading || busy"
        @click="generate"
      >
        {{ loading ? '正在想…' : '换一批 ↻' }}
      </button>
    </view>
    <view v-if="loading && !options.length" class="muted gift-status"
      >正在想三句适合这份礼物的话，你也可以先自己写。</view
    >
    <button
      v-for="option in options"
      :key="option.tone"
      class="gift-option"
      :class="{ selected: draft === option.text && !custom }"
      :disabled="busy"
      @click="select(option)"
    >
      <view class="gift-option-title"
        ><text>{{ option.label }}</text
        ><text v-if="draft === option.text && !custom">✓ 已选</text></view
      >
      <text class="gift-option-text">{{ option.text }}</text>
    </button>
    <view v-if="hint" class="muted gift-status">{{ hint }}</view>
    <button
      class="gift-custom"
      :class="{ selected: custom }"
      :disabled="busy"
      @click="writeOwn"
    >
      ＋ 自己写
    </button>
    <view v-if="editing" class="gift-editor">
      <text class="label">{{
        custom ? '想跟朋友说点什么？' : '选好了，还可以改一改'
      }}</text>
      <textarea
        v-model="draft"
        class="gift-textarea"
        :disabled="busy"
        :maxlength="80"
        :auto-height="true"
        :cursor-spacing="24"
        placeholder="比如：好久没见了，下次咱们坐下来吃。"
      />
      <view class="muted gift-count">{{ draftLength }}/80</view>
    </view>
    <button class="primary" :disabled="busy || !draft.trim()" @click="confirm">
      {{ busy ? '正在装进请客卡…' : '就带这句话，请朋友 ↗' }}
    </button>
    <view class="muted gift-status"
      >一张卡请一个人，24 小时有效。留言会随这份礼物一起送出。</view
    >
  </view>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { api, money, notify } from '../../services/api';
const props = defineProps({
  input: { type: Object, required: true },
  item: { type: String, required: true },
  busy: { type: Boolean, default: false }
});
const emit = defineEmits(['back', 'confirm']);
const options = ref([]),
  draft = ref(''),
  loading = ref(false),
  hint = ref('');
const editing = ref(false),
  custom = ref(false);
const draftLength = computed(() => [...draft.value].length);
let active = true,
  recent = [];
const localFallback = [
  {
    tone: 'teasing',
    label: '嘴欠一点',
    text: '请客的态度我拿出来了，实力下次再说。'
  },
  { tone: 'warm', label: '暖心一点', text: '东西是假的，刚刚想到你是真的。' },
  {
    tone: 'poetic',
    label: '诗意一点',
    text: '各自赶路也挺好，路过彼此的时候，记得坐一会儿。'
  }
];
onBeforeUnmount(() => {
  active = false;
});
onMounted(generate);
async function generate() {
  if (loading.value || props.busy) return;
  loading.value = true;
  hint.value = '';
  try {
    const result = await api('giftMessages', {
      ...props.input,
      exclude: recent
    });
    if (!active) return;
    if (
      !Array.isArray(result.options) ||
      result.options.length !== 3 ||
      result.options.some(
        (o) => !o || typeof o.text !== 'string' || !o.text.trim()
      )
    )
      throw new Error('留言暂时没准备好');
    options.value = result.options;
    recent = [
      ...new Set([...recent, ...result.options.map((o) => o.text)])
    ].slice(-12);
    hint.value =
      result.mode === 'fallback' ? '先挑一句小店备好的话，也可以自己写。' : '';
  } catch (_) {
    if (!active) return;
    if (!options.value.length) options.value = localFallback;
    hint.value = '新留言暂时没取到，可以先选下面的，也可以自己写。';
  } finally {
    if (active) loading.value = false;
  }
  // Generating or refreshing choices never replaces a selected or edited draft.
}
function select(option) {
  draft.value = option.text;
  custom.value = false;
  editing.value = true;
}
function writeOwn() {
  // Keep an existing draft so switching modes cannot discard somebody's words.
  custom.value = true;
  editing.value = true;
}
function confirm() {
  if (props.busy) return;
  const text = draft.value.trim();
  if (
    !text ||
    [...text].length > 80 ||
    /[<>\u0000-\u001f\u007f-\u009f\u2028\u2029]/.test(text)
  ) {
    notify(new Error('留言请写 1–80 个字，不要换行'));
    return;
  }
  emit('confirm', text);
}
</script>

<style scoped>
.gift-product {
  margin: 12px 0 18px;
  overflow-wrap: anywhere;
}
.gift-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  justify-content: space-between;
}
.gift-toolbar > text {
  min-width: 0;
}
.gift-refresh {
  flex-shrink: 0;
  padding: 10px 0 10px 8px;
  font-size: 14px;
  color: #4f6042;
}
.gift-option {
  display: block;
  width: 100%;
  margin-top: 12px;
  padding: 14px;
  border: 1px solid #cdd0c3;
  border-radius: 14px;
  text-align: left;
  background: #fffef7;
  white-space: normal;
}
.gift-option.selected,
.gift-custom.selected {
  border-color: #465c35;
  background: #eff7d6;
}
.gift-option-title {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 7px;
  font-size: 12px;
  color: #65715e;
}
.gift-option-text {
  font-size: 16px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.gift-custom {
  width: 100%;
  margin-top: 12px;
  border: 1px dashed #77806f;
  border-radius: 12px;
  min-height: 44px;
  font-size: 15px;
}
.gift-textarea {
  width: 100%;
  box-sizing: border-box;
  min-height: 90px;
  padding: 12px;
  border: 1px solid #bdc8a9;
  border-radius: 12px;
  background: #fffef7;
  font-size: 16px;
  line-height: 1.6;
}
.gift-count {
  text-align: right;
  margin-top: 6px;
}
.gift-status {
  margin-top: 12px;
  line-height: 1.6;
}
</style>
