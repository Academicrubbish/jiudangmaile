const test = require('node:test');
const assert = require('node:assert/strict');
const core = '../uniCloud-aliyun/cloudfunctions/common/jdml-core/';
const Gift = require(core + 'gift-messages');
const { createRuntime } = require(core + 'runtime');
const { createService } = require(core + 'service');
const { normalizeConfig } = require(core + 'config');
const { createMemoryStore } = require('./memory-store.cjs');
const NOW = Date.parse('2026-09-17T05:00:00Z');
const input = { kind: 'treat', habit: 'milk_tea', amount: 1800 };
const candidate = {
  teasing: '奶茶我请了，海底捞那边你看着安排。',
  warm: '今天路过奶茶店，突然想起好久没跟你坐坐了。',
  poetic: '各自赶路也挺好，路过彼此的时候，记得坐一会儿。'
};
const response = (body) => ({
  choices: [
    { finish_reason: 'stop', message: { content: JSON.stringify(body) } }
  ]
});
async function fixture(ai = {}, deps = {}) {
  const store = createMemoryStore();
  const config = normalizeConfig({
    ai: { enabled: false, apiKey: 'test-secret', ...ai },
    scheduler: { enabled: false }
  });
  const runtime = createRuntime(store, config, { clock: () => NOW, ...deps });
  let sequence = 0;
  const call = (action, data = {}, uid = 'sender', requestId) =>
    runtime.call(uid, action, data, requestId || 'gift_request_' + ++sequence);
  await call('settings', { daily: 100, habits: ['milk_tea'] });
  return { store, runtime, config, call };
}

test('留言按字符限长，允许自定义和表情，拒绝空白、换行、控制符与超长内容', () => {
  assert.equal(Gift.message('  下次见！🍵  '), '下次见！🍵');
  assert.equal(Gift.message('🍵'.repeat(80)).length, 160);
  assert.equal(Gift.message(undefined, { optional: true }), '');
  for (const value of [
    '',
    '   ',
    null,
    123,
    {},
    '字'.repeat(81),
    '你\n好',
    '你\u0000好',
    '你\u2028好',
    '<script>'
  ])
    assert.throws(() => Gift.message(value), { code: 'INVALID_GIFT_MESSAGE' });
});

test('三个不同语气候选必须完整，不接受重复、上一批原句或非法输出', () => {
  assert.deepEqual(
    Gift.validateCandidates(candidate).map((o) => o.tone),
    ['teasing', 'warm', 'poetic']
  );
  for (const value of [
    null,
    [],
    {},
    { ...candidate, extra: 'x' },
    { ...candidate, warm: candidate.teasing },
    { ...candidate, warm: '请点击https://example.test领取' }
  ])
    assert.throws(() => Gift.validateCandidates(value));
  assert.throws(() => Gift.validateCandidates(candidate, [candidate.warm]));
  assert.throws(() => Gift.exclusions(Array(13).fill('一段话')));
});

test('备用留言每批三种语气，避开最近十二句，商品专属文字匹配自定义商品', () => {
  let recent = [];
  for (let round = 0; round < 8; round++) {
    const options = Gift.fallbackMessages('电影票', recent, () => 0);
    assert.equal(options.length, 3);
    assert.equal(new Set(options.map((o) => o.text)).size, 3);
    assert.ok(options.every((o) => !recent.includes(o.text)));
    options.forEach((o) => Gift.message(o.text));
    if (round === 0) assert.match(options[0].text, /电影票/);
    recent = [...recent, ...options.map((o) => o.text)].slice(-12);
  }
});

test('选定留言保存到邀请和双方历史，重试、领取、改昵称和转存都不改原话', async () => {
  const f = await fixture();
  const data = {
    ...input,
    giftMessage: '  下次见面别说改天了，咱俩的改天已经攒好多了。  '
  };
  const first = await f.call('create', data, 'sender', 'gift_create_retry_01');
  assert.equal(first.giftMessage, data.giftMessage.trim());
  const retry = await f.call('create', data, 'sender', 'gift_create_retry_01');
  assert.equal(first.id, retry.id);
  assert.equal(
    (await f.runtime.preview(first.token)).giftMessage,
    first.giftMessage
  );
  await f.call('profile', { nickname: '换个昵称', avatar: 'star' });
  const received = await f.call('claim', { token: first.token }, 'friend');
  assert.equal(received.giftMessage, first.giftMessage);
  await f.call('confirm', { id: first.id, amount: 1800 });
  for (const uid of ['sender', 'friend']) {
    assert.equal(
      (await f.call('detail', { id: first.id }, uid)).giftMessage,
      first.giftMessage
    );
    assert.equal(
      (await f.call('history', {}, uid)).events[0].giftMessage,
      first.giftMessage
    );
  }
  assert.equal((await f.call('bootstrap', {}, 'friend')).todayConfirmed, 0);
  await assert.rejects(f.call('detail', { id: first.id }, 'stranger'), {
    code: 'FORBIDDEN'
  });
  await assert.rejects(f.call('claim', { token: first.token }, 'another'));
});

test('旧请客兼容无留言，自购不带请客留言，非法留言不创建事件或替换当前事件', async () => {
  const f = await fixture();
  const before = await f.call('create', input);
  assert.equal(before.giftMessage, '');
  const count = Object.keys(f.store.snapshot().events).length;
  for (const giftMessage of ['', null, '字'.repeat(81), '请你\n吃饭'])
    await assert.rejects(f.call('create', { ...input, giftMessage }), {
      code: 'INVALID_GIFT_MESSAGE'
    });
  assert.equal(Object.keys(f.store.snapshot().events).length, count);
  assert.equal((await f.call('bootstrap')).current.id, before.id);
  const own = await f.call('create', {
    ...input,
    kind: 'self',
    giftMessage: '不应该出现在自购里'
  });
  assert.equal(own.giftMessage, '');
  // Truly old stored records have no field at all.
  await f.store.transaction(async (tx) => {
    const event = await tx.get('events', before.id);
    delete event.giftMessage;
    await tx.put('events', before.id, event);
  });
  assert.equal((await f.call('detail', { id: before.id })).giftMessage, '');
});

test('生成候选不发出请客，不占随机预算，不改变当前事件', async () => {
  const f = await fixture();
  const current = await f.call('create', { ...input, kind: 'self' });
  const before = await f.call('bootstrap');
  const result = await f.call('giftMessages', {
    ...input,
    habit: undefined,
    customItem: { name: '烤红薯' }
  });
  assert.equal(result.item, '烤红薯');
  assert.equal(result.options.length, 3);
  const after = await f.call('bootstrap');
  assert.equal(after.current.id, current.id);
  assert.deepEqual(before.automaticBudget, after.automaticBudget);
  assert.equal(Object.keys(f.store.snapshot().events).length, 1);
  assert.equal(Object.keys(f.store.snapshot().invites).length, 0);
});

test('生成与独立复核共用调用限额，只给模型商品和候选，同请求重试命中缓存', async () => {
  const payloads = [];
  const f = await fixture(
    { enabled: true },
    {
      post: async (_, payload) => {
        payloads.push(payload);
        return response(payloads.length % 2 ? candidate : { safe: true });
      }
    }
  );
  const first = await f.call(
    'giftMessages',
    input,
    'sender',
    'gift_cached_request_01'
  );
  const repeated = await f.call(
    'giftMessages',
    input,
    'sender',
    'gift_cached_request_01'
  );
  assert.equal(first.mode, 'ai');
  assert.deepEqual(first, repeated);
  assert.equal(payloads.length, 2);
  const given = JSON.parse(payloads[0].messages[1].content);
  assert.deepEqual(Object.keys(given).sort(), ['exclude', 'item', 'variation']);
  assert.equal(given.item, '奶茶');
  assert.ok(!JSON.stringify(payloads).includes('test-secret'));
  const usage = Object.values(f.store.snapshot().aiUsage).find(
    (row) => row.owner === 'sender'
  );
  assert.equal(usage.calls, 2);
  await assert.rejects(
    f.call(
      'giftMessages',
      { ...input, amount: 2000 },
      'sender',
      'gift_cached_request_01'
    ),
    { code: 'REQUEST_CONFLICT' }
  );
});

test('换一批请求传入排除句子，模型复述旧句时采用不同备用文案', async () => {
  const payloads = [];
  const f = await fixture(
    { enabled: true },
    {
      post: async (_, payload) => {
        payloads.push(payload);
        const data = JSON.parse(payload.messages[1].content);
        return response(data.options ? { safe: true } : candidate);
      }
    }
  );
  const first = await f.call('giftMessages', input);
  const exclude = first.options.map((o) => o.text);
  const next = await f.call('giftMessages', { ...input, exclude });
  assert.equal(next.mode, 'fallback');
  assert.ok(next.options.every((o) => !exclude.includes(o.text)));
  assert.deepEqual(
    JSON.parse(payloads[2].messages[1].content).exclude,
    exclude
  );
});

test('复核拒绝、输出异常或网络失败都回落备用，不泄露未审核文案或供应商错误', async () => {
  for (const mode of ['rejected', 'invalid', 'failed']) {
    let calls = 0;
    const f = await fixture(
      { enabled: true },
      {
        post: async () => {
          calls++;
          if (mode === 'failed')
            throw new Error('provider secret: test-secret');
          if (mode === 'invalid') return response({ teasing: '不完整' });
          return response(calls === 1 ? candidate : { safe: false });
        }
      }
    );
    const result = await f.call('giftMessages', input);
    assert.equal(result.mode, 'fallback');
    assert.equal(result.options.length, 3);
    assert.ok(!JSON.stringify(f.store.snapshot()).includes('test-secret'));
  }
});

test('未启用或额度用尽不调用模型，候选仍可用', async () => {
  for (const config of [
    { enabled: false },
    { enabled: true, maxCallsPerUserDay: 0 }
  ]) {
    const f = await fixture(config, {
      post: async () => {
        assert.fail('Should not call model');
      }
    });
    const result = await f.call('giftMessages', input);
    assert.equal(result.mode, 'fallback');
    assert.equal(result.options.length, 3);
  }
});

test('并发重试只启动一次生成，迟到输出不覆盖已返回的一批留言', async () => {
  let release,
    calls = 0;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const f = await fixture(
    { enabled: true },
    {
      post: async () => {
        calls++;
        if (calls === 1) {
          await wait;
          return response(candidate);
        }
        return response({ safe: true });
      }
    }
  );
  const slow = f.call('giftMessages', input, 'sender', 'gift_concurrent_01');
  while (!calls) await new Promise((resolve) => setImmediate(resolve));
  const fast = await f.call(
    'giftMessages',
    input,
    'sender',
    'gift_concurrent_01'
  );
  release();
  const late = await slow;
  assert.equal(calls, 2);
  assert.equal(fast.mode, 'fallback');
  assert.deepEqual(late, fast);
});

test('超过前台时间预算不复核或发布迟到生成的文案', async () => {
  let now = NOW,
    calls = 0;
  const f = await fixture(
    { enabled: true, interactiveBudgetMs: 500 },
    {
      clock: () => now,
      post: async () => {
        calls++;
        now += 1000;
        return response(candidate);
      }
    }
  );
  const result = await f.call('giftMessages', input);
  assert.equal(calls, 1);
  assert.equal(result.mode, 'fallback');
});

test('候选接口验证身份、商品、金额和排除列表，非法请求不消耗模型额度', async () => {
  const f = await fixture(
    { enabled: true },
    { post: async () => assert.fail('No provider call') }
  );
  await assert.rejects(f.call('giftMessages', input, ''), {
    code: 'LOGIN_REQUIRED'
  });
  for (const data of [
    { ...input, kind: 'self' },
    { ...input, habit: 'unknown' },
    { ...input, amount: undefined },
    { ...input, amount: 0 },
    { ...input, exclude: 'bad' },
    { ...input, exclude: Array(13).fill('你好') }
  ])
    await assert.rejects(f.call('giftMessages', data));
  assert.equal(Object.keys(f.store.snapshot().aiUsage).length, 0);
});

test('故事生成不覆盖留言，选中的原话不需要来自候选列表', async () => {
  const f = await fixture();
  const raw = createService(f.store, () => NOW, { scenes: true });
  const e = await raw.run(
    'sender',
    'create',
    { ...input, giftMessage: '我自己写的，下周来家里吃饭！' },
    'gift_before_scene_01'
  );
  const ready = await f.call('detail', { id: e.id });
  assert.equal(ready.sceneReady, true);
  assert.equal(ready.giftMessage, e.giftMessage);
  assert.equal((await f.runtime.preview(e.token)).giftMessage, e.giftMessage);
});
