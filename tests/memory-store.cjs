const {
  TABLES
} = require('../uniCloud-aliyun/cloudfunctions/common/jdml-core/service');
function createMemoryStore() {
  let records = Object.fromEntries(Object.keys(TABLES).map((k) => [k, {}]));
  let queue = Promise.resolve();
  const clone = (v) => (v == null ? null : structuredClone(v));
  return {
    get: async (t, id) => clone(records[t][id]),
    listEvents: async (uid, skip, limit) =>
      Object.values(records.events)
        .filter((e) => e.members.includes(uid))
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
        .slice(skip, skip + limit)
        .map(clone),
    identity: async (uid) => ({
      wx_openid: { mp___UNI__A2244B7: 'openid-' + uid }
    }),
    dueUsers: async (now, limit) =>
      Object.values(records.users)
        .filter((u) => u.nextJobAt > 0 && u.nextJobAt <= now)
        .sort((a, b) => a.nextJobAt - b.nextJobAt)
        .slice(0, limit)
        .map(clone),
    transaction(work) {
      const run = queue.then(async () => {
        const draft = clone(records);
        const result = await work({
          get: async (t, id) => clone(draft[t][id]),
          put: async (t, id, v) => {
            draft[t][id] = clone(v);
          }
        });
        records = draft;
        return result;
      });
      queue = run.catch(() => {});
      return run;
    },
    snapshot: () => clone(records)
  };
}
module.exports = { createMemoryStore };
