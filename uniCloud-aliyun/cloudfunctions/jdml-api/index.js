'use strict';
const {
  createRuntime,
  createCloudStore,
  loadConfig,
  BusinessError
} = require('jdml-core');
exports.main = async (event = {}, context = {}) => {
  try {
    const config = loadConfig();
    const runtime = createRuntime(
      createCloudStore(uniCloud.database()),
      config
    );
    if (event.action === 'preview')
      return { code: 0, data: await runtime.preview(event.input?.token) };
    const auth = require('uni-id-common').createInstance({ context });
    const checked = await auth.checkToken(event.uniIdToken);
    if (checked.errCode || !checked.uid)
      return { code: 'LOGIN_REQUIRED', message: '登录状态已过期，请重新登录' };
    const data = await runtime.call(
      checked.uid,
      event.action,
      event.input,
      event.requestId
    );
    return {
      code: 0,
      data,
      ...(checked.token
        ? { token: checked.token, tokenExpired: checked.tokenExpired }
        : {})
    };
  } catch (error) {
    if (error instanceof BusinessError)
      return { code: error.code, message: error.message };
    console.error('jdml-api failed', { name: error.name, code: error.code });
    return {
      code: 'SERVICE_UNAVAILABLE',
      message: '小店暂时忙不过来，请稍后重试；已提交的记录不会重复增加'
    };
  }
};
