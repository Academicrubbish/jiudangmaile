const test = require('node:test'),
  assert = require('node:assert/strict');
const {
  createCloudStore
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/cloud-store');
const {
  createService
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/service');
// An SDK contract double: normal reads return arrays, transaction reads objects.
// Optimistic version conflicts intentionally exercise the adapter retry path.
function sdk() {
  const data = {},
    versions = {};
  let commits = 0,
    conflicts = 0;
  const clone = (x) => (x == null ? null : structuredClone(x));
  return {
    command: { set: (value) => ({ __set: clone(value) }) },
    stats: () => ({ commits, conflicts }),
    collection(name) {
      return {
        doc(id) {
          return {
            async get() {
              return {
                data: data[name + ':' + id]
                  ? [clone(data[name + ':' + id])]
                  : []
              };
            }
          };
        }
      };
    },
    async startTransaction() {
      const seen = {},
        writes = {};
      return {
        collection(name) {
          return {
            doc(id) {
              const key = name + ':' + id;
              return {
                async get() {
                  seen[key] = versions[key] || 0;
                  return { data: clone(writes[key] || data[key]) };
                },
                async update(value) {
                  const previous = writes[key] || data[key] || {};
                  writes[key] = { ...previous };
                  for (const [field, item] of Object.entries(value)) {
                    writes[key][field] =
                      item && Object.hasOwn(item, '__set')
                        ? clone(item.__set)
                        : item &&
                            typeof item === 'object' &&
                            !Array.isArray(item)
                          ? { ...previous[field], ...clone(item) }
                          : clone(item);
                  }
                }
              };
            },
            async add(value) {
              const key = name + ':' + value._id;
              seen[key] ??= versions[key] || 0;
              if (data[key]) throw new Error('duplicate');
              writes[key] = clone(value);
            }
          };
        },
        async commit() {
          for (const key in seen)
            if (seen[key] !== (versions[key] || 0)) {
              conflicts++;
              throw new Error('transaction conflict');
            }
          for (const key in writes) {
            data[key] = writes[key];
            versions[key] = (versions[key] || 0) + 1;
          }
          commits++;
        },
        async rollback() {}
      };
    }
  };
}
test('云适配器正确解包事务对象，并在真实式写冲突后重试', async () => {
  const db = sdk(),
    service = createService(createCloudStore(db), () =>
      Date.parse('2026-09-15T02:00:00Z')
    );
  let i = 0;
  const call = (u, a, v) => service.run(u, a, v, 'sdk_operation_' + ++i);
  await call('a', 'settings', { daily: 2000, habit: 'milk_tea' });
  const e = await call('a', 'create', { kind: 'treat' });
  const result = await Promise.allSettled([
    call('b', 'claim', { token: e.token }),
    call('c', 'claim', { token: e.token })
  ]);
  assert.equal(result.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(db.stats().conflicts > 0);
  assert.equal((await service.preview(e.token)).status, 'claimed');
});

test('云更新必须覆盖嵌套额度映射，释放后不残留旧占用', async () => {
  const db = sdk(),
    service = createService(createCloudStore(db), () =>
      Date.parse('2026-09-15T02:00:00Z')
    );
  let i = 0;
  const call = (a, v) => service.run('a', a, v, 'replace_test_' + ++i);
  await call('settings', { daily: 2000, habit: 'milk_tea' });
  const e = await call('create', { kind: 'self' });
  await call('accept', { id: e.id });
  await call('confirm', { id: e.id, amount: 1000 });
  assert.equal((await call('bootstrap', {})).available, 1000);
  await call('undo', { id: e.id });
  await call('playOnly', { id: e.id });
  assert.equal((await call('bootstrap', {})).available, 2000);
});
