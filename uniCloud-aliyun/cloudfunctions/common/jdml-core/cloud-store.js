'use strict';
const { TABLES } = require('./service');
const { BusinessError } = require('./domain');
function createCloudStore(db) {
  const decode = (r) => (Array.isArray(r.data) ? r.data[0] : r.data) || null;
  const ref = (conn, table, id) => conn.collection(TABLES[table]).doc(id);
  return {
    async get(table, id) {
      return decode(await ref(db, table, id).get());
    },
    async listEvents(uid, skip, limit) {
      const r = await db
        .collection(TABLES.events)
        .where({ members: uid })
        .orderBy('createdAt', 'desc')
        .orderBy('_id', 'desc')
        .skip(skip)
        .limit(limit)
        .get();
      return r.data;
    },
    async dueUsers(now, limit) {
      const r = await db
        .collection(TABLES.users)
        .where({ nextJobAt: db.command.gt(0).and(db.command.lte(now)) })
        .orderBy('nextJobAt', 'asc')
        .limit(limit)
        .get();
      return r.data;
    },
    async identity(uid) {
      return decode(await db.collection('uni-id-users').doc(uid).get());
    },
    async transaction(work) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const transaction = await db.startTransaction();
        const known = new Map();
        const tx = {
          async get(table, id) {
            if (!id) return null;
            const record = decode(await ref(transaction, table, id).get());
            known.set(table + ':' + id, !!record);
            return record;
          },
          async put(table, id, value) {
            const key = table + ':' + id;
            if (!known.has(key)) await tx.get(table, id);
            const clean = { ...value };
            delete clean._id;
            if (known.get(key)) {
              const update = {};
              for (const [field, item] of Object.entries(clean)) {
                if (item !== undefined)
                  update[field] =
                    item !== null && typeof item === 'object'
                      ? db.command.set(item)
                      : item;
              }
              await ref(transaction, table, id).update(update);
            } else {
              await transaction
                .collection(TABLES[table])
                .add({ _id: id, ...clean });
              known.set(key, true);
            }
          }
        };
        try {
          const result = await work(tx);
          await transaction.commit();
          return result;
        } catch (error) {
          try {
            await transaction.rollback();
          } catch (_) {}
          if (error instanceof BusinessError || attempt === 2) throw error;
        }
      }
    }
  };
}
module.exports = { createCloudStore };
