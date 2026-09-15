'use strict';
exports.main = async (event = {}, context = {}) => {
  // This is platform context, not event.Type, which clients can forge.
  if (!['timing', 'server'].includes(context.SOURCE))
    return { code: 'FORBIDDEN', message: '仅允许定时器或云端管理控制台调用' };
  const { createRuntime, createCloudStore, loadConfig } = require('jdml-core');
  const { getAccessToken } = require('uni-open-bridge-common');
  try {
    const runtime = createRuntime(
      createCloudStore(uniCloud.database()),
      loadConfig(),
      { getAccessToken }
    );
    return { code: 0, data: await runtime.tick() };
  } catch (error) {
    console.error('jdml-worker failed', { name: error.name, code: error.code });
    return { code: 'WORKER_FAILED' };
  }
};
