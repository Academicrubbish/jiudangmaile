let loggingIn = null;
export const money = (value) =>
  (Number(value || 0) / 100).toFixed(2).replace(/\.00$/, '');
export function parseMoney(value) {
  const s = String(value).trim();
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s))
    throw new Error('请输入有效金额，最多两位小数');
  const [a, b = ''] = s.split('.');
  return Number(a) * 100 + Number(b.padEnd(2, '0'));
}
export function isPreview() {
  return false;
}
async function ensureLogin() {
  if (
    uni.getStorageSync('uni_id_token') &&
    uni.getStorageSync('uni_id_token_expired') > Date.now() + 30000
  )
    return;
  // #ifdef MP-WEIXIN
  if (!loggingIn)
    loggingIn = (async () => {
      const login = await uni.login({ provider: 'weixin' });
      const auth = uniCloud.importObject('uni-id-co', { customUI: true });
      const r = await auth.loginByWeixin({ code: login.code });
      if (r.errCode) throw new Error(r.errMsg || '登录失败');
      if (!r.newToken?.token) throw new Error('登录未返回有效凭证');
      uni.setStorageSync('uni_id_token', r.newToken.token);
      uni.setStorageSync('uni_id_token_expired', r.newToken.tokenExpired);
    })().finally(() => {
      loggingIn = null;
    });
  return loggingIn;
  // #endif
  // #ifndef MP-WEIXIN
  throw new Error('请在微信小程序中登录使用');
  // #endif
}
const readActions = ['bootstrap', 'history', 'detail', 'preview', 'presence'];
export async function api(action, input = {}) {
  const mutation = !readActions.includes(action),
    key = 'jdml-pending:' + action + ':' + JSON.stringify(input);
  let requestId = mutation ? uni.getStorageSync(key) : '';
  if (mutation && !requestId) {
    requestId =
      Date.now().toString(36) +
      '_' +
      Math.random().toString(36).slice(2) +
      '_' +
      Math.random().toString(36).slice(2);
    uni.setStorageSync(key, requestId);
  }
  let result;
  if (action !== 'preview') await ensureLogin();
  const response = await uniCloud.callFunction({
    name: 'jdml-api',
    data: {
      action,
      input,
      requestId,
      uniIdToken: uni.getStorageSync('uni_id_token')
    }
  });
  result = response.result;
  if (result.code) {
    if (result.code === 'LOGIN_REQUIRED') {
      uni.removeStorageSync('uni_id_token');
      uni.removeStorageSync('uni_id_token_expired');
    }
    if (mutation && result.code !== 'SERVICE_UNAVAILABLE')
      uni.removeStorageSync(key);
    const err = new Error(result.message || '暂时无法完成，请稍后再试');
    err.code = result.code;
    throw err;
  }
  if (mutation) uni.removeStorageSync(key);
  if (result.token) {
    uni.setStorageSync('uni_id_token', result.token);
    uni.setStorageSync('uni_id_token_expired', result.tokenExpired);
  }
  return result.data;
}
export function notify(error) {
  uni.showToast({
    title: error.message || '暂时无法完成',
    icon: 'none',
    duration: 3000
  });
}
export function go(page, query = '') {
  uni.navigateTo({ url: `/pages/${page}/${page}${query ? '?' + query : ''}` });
}
export function home() {
  uni.reLaunch({ url: '/pages/home/home' });
}
export const habits = [
  { key: 'milk_tea', name: '奶茶', label: '奶茶常客' },
  { key: 'smoke', name: '香烟', label: '虚构老烟客' },
  { key: 'drink', name: '小酒', label: '微醺想象家' },
  { key: 'betel', name: '槟榔', label: '槟榔爱好者' }
];

export const storyTastes = [
  {
    key: 'familiar',
    label: '贴近我的习惯',
    description: '八成是你爱买的，偶尔来点新鲜的'
  },
  {
    key: 'balanced',
    label: '各来一半',
    description: '一半小习惯，一半生活小插曲'
  },
  {
    key: 'adventurous',
    label: '多来点意外',
    description: '八成自由发挥，看看今天会想买什么'
  }
];
