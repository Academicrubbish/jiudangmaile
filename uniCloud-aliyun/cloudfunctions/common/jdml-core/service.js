'use strict';
const crypto = require('crypto');
const D = require('./domain');
const Schedule = require('./schedule');
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const id = () => crypto.randomBytes(16).toString('hex');
const TABLES = {
  users: 'jdml-users',
  events: 'jdml-events',
  days: 'jdml-days',
  invites: 'jdml-invites',
  requests: 'jdml-requests',
  aiUsage: 'jdml-ai-usage',
  aiAudit: 'jdml-ai-audit',
  notices: 'jdml-notices'
};
function createService(store, clock = Date.now, options = {}) {
  async function preview(token) {
    if (!/^[a-f0-9]{48}$/.test(token || ''))
      D.fail('NOT_FOUND', '这张请客卡找不到了');
    const invitation = await store.get('invites', hash(token));
    if (!invitation) D.fail('NOT_FOUND', '这张请客卡找不到了');
    const status =
      invitation.state === 'pending' && invitation.expiresAt <= clock()
        ? 'expired'
        : invitation.state;
    return {
      token,
      status,
      senderName: invitation.senderName,
      senderAvatar: invitation.senderAvatar,
      habit: invitation.habit,
      item: invitation.item,
      amount: invitation.amount,
      reason: invitation.reason,
      expiresAt: invitation.expiresAt
    };
  }
  async function run(uid, action, input = {}, requestId = '') {
    if (!uid) D.fail('LOGIN_REQUIRED', '请先登录');
    const now = clock(),
      today = D.dateKey(now);
    const internal = action === 'tick';
    if (internal && !options.internal)
      D.fail('FORBIDDEN', '不能从客户端调用定时任务');
    const writes = ![
      'bootstrap',
      'detail',
      'history',
      'tick',
      'presence'
    ].includes(action);
    if (writes && !/^[a-zA-Z0-9_-]{12,100}$/.test(requestId))
      D.fail('INVALID_REQUEST', '操作编号无效，请重新打开页面');
    return store.transaction(async (tx) => {
      const rid = hash(uid + ':' + requestId);
      if (writes) {
        const previous = await tx.get('requests', rid);
        if (previous) {
          if (
            previous.action !== action ||
            previous.signature !== hash(JSON.stringify(input))
          )
            D.fail('REQUEST_CONFLICT', '这次操作参数发生变化，请重新提交');
          return previous.result;
        }
      }
      let user = await tx.get('users', uid);
      if (!user) {
        user = {
          id: uid,
          nickname: '路过的好朋友',
          avatar: 'leaf',
          preferences: null,
          currentId: '',
          createdAt: now,
          updatedAt: now
        };
        await tx.put('users', uid, user);
      }
      if (!internal) user.lastSeenAt = now;
      const dayId = hash(uid + ':' + today);
      let day = (await tx.get('days', dayId)) || {
        id: dayId,
        owner: uid,
        date: today,
        reserved: {},
        confirmed: {},
        createdAt: now
      };
      if (options.scheduler && user.preferences && !day.plan)
        day.plan = Schedule.makePlan(user, now, {
          first: !!user.needsFirstEvent
        });
      async function cleanup() {
        for (const eid of Object.keys(day.reserved)) {
          const e = await tx.get('events', eid);
          if (
            !e ||
            ['skipped', 'cancelled', 'play_only'].includes(e.state) ||
            !D.activeReservation(e, now)
          )
            delete day.reserved[eid];
        }
      }
      await cleanup();
      const occupied = () =>
        Object.values(day.reserved).reduce((a, b) => a + b, 0) +
        Object.values(day.confirmed).reduce((a, b) => a + b, 0);
      async function ownEvent() {
        const e = await tx.get('events', String(input.id || ''));
        if (!e || e.owner !== uid) D.fail('NOT_FOUND', '这件小事找不到了');
        return e;
      }
      async function saveEvent(e) {
        await tx.put('events', e.id, e);
      }
      async function release(e) {
        delete day.reserved[e.id];
        if (e.budgetDate !== today) {
          const oldId = hash(uid + ':' + e.budgetDate),
            old = await tx.get('days', oldId);
          if (old) {
            delete old.reserved[e.id];
            await tx.put('days', oldId, old);
          }
        }
        if (user.currentId === e.id) user.currentId = '';
      }
      async function create(kind, scheduled = false, slot = null) {
        if (!user.preferences) D.fail('SETUP_REQUIRED', '先给自己安排一个人设');
        const current =
          user.currentId && (await tx.get('events', user.currentId));
        if (
          !scheduled &&
          current &&
          ['offered', 'pending', 'accepted'].includes(current.state) &&
          D.activeReservation(current, now)
        ) {
          if (current.kind !== kind)
            D.fail('HAS_PENDING_EVENT', '先处理眼前这件小事，再换一种玩法');
          return D.publicEvent(current, uid);
        }
        if (!scheduled) user.currentId = '';
        const available = user.preferences.daily - occupied();
        if (available < 100)
          D.fail('DAILY_ENOUGH', '今天这些就挺好，明天再来玩');
        const habit =
          kind === 'treat'
            ? input.habit || user.preferences.habit
            : user.preferences.habit;
        if (!D.ITEMS[habit]) D.fail('INVALID_ITEM', '请选择一件物品');
        if (options.enabledHabits && !options.enabledHabits.includes(habit))
          D.fail('THEME_DISABLED', '这个人设暂时休息，换一个试试');
        const item = D.ITEMS[habit],
          amount = D.nextAmount(user.preferences.daily, available),
          eid = id();
        const e = {
          id: eid,
          owner: uid,
          members: [uid],
          recipient: '',
          kind,
          habit,
          item: item.name,
          unit: item.unit,
          title: item.title,
          reason:
            kind === 'treat'
              ? '没什么特别的理由，就是想请你一份。东西是想象的，心意算数。'
              : item.reason,
          amount,
          state: scheduled
            ? 'planned'
            : kind === 'treat'
              ? 'pending'
              : 'offered',
          createdAt: now,
          expiresAt: kind === 'treat' ? now + D.DAY : D.dayEnd(now),
          budgetDate: today,
          senderName: user.nickname,
          senderAvatar: user.avatar,
          recipientName: '',
          source: scheduled ? 'scheduled' : 'active',
          triggerSource: scheduled ? 'scheduled' : 'active',
          generation: options.scenes
            ? { state: 'pending' }
            : { state: 'ready', mode: 'fallback' },
          deposit: null
        };
        if (kind === 'treat') {
          const token = crypto.randomBytes(24).toString('hex');
          e.token = token;
          await tx.put('invites', hash(token), {
            id: hash(token),
            eventId: eid,
            owner: uid,
            recipient: '',
            state: 'pending',
            senderName: user.nickname,
            senderAvatar: user.avatar,
            habit,
            item: item.name,
            amount,
            reason: e.reason,
            expiresAt: e.expiresAt,
            createdAt: now
          });
        }
        if (scheduled) {
          slot.eventId = eid;
          slot.state = 'prepared';
          e.dueAt = slot.dueAt;
        } else {
          // A manual story consumes one future slot instead of adding a third automatic demand.
          const replaced = (day.plan || []).find((s) =>
            ['waiting', 'prepared'].includes(s.state)
          );
          if (replaced) {
            if (replaced.eventId) {
              const old = await tx.get('events', replaced.eventId);
              if (old && old.state === 'planned') {
                old.state = 'cancelled';
                await saveEvent(old);
              }
            }
            replaced.state = 'replaced';
          }
          day.reserved[eid] = amount;
          user.currentId = eid;
          if (user.needsFirstEvent)
            day.automaticCount = (day.automaticCount || 0) + 1;
          user.needsFirstEvent = false;
        }
        await saveEvent(e);
        return D.publicEvent(e, uid);
      }
      let result;
      switch (action) {
        case 'bootstrap': {
          if (
            options.subscription &&
            (!user.subscriptionIntent || user.intentExpiresAt <= now)
          ) {
            user.subscriptionIntent = id();
            user.intentExpiresAt = now + 15 * 60000;
          }
          const current = user.currentId
            ? await tx.get('events', user.currentId)
            : null;
          const visible =
            current &&
            D.activeReservation(current, now) &&
            ['offered', 'accepted', 'pending'].includes(current.state);
          result = {
            user: {
              nickname: user.nickname,
              avatar: user.avatar,
              preferences: user.preferences
            },
            current: visible ? D.publicEvent(current, uid) : null,
            todayConfirmed: Object.values(day.confirmed).reduce(
              (a, b) => a + b,
              0
            ),
            available: user.preferences
              ? Math.max(0, user.preferences.daily - occupied())
              : 0,
            reminders: {
              enabled: !!user.reminderEnabled,
              available: !!user.subscriptionGrant,
              intent: user.subscriptionIntent || ''
            },
            capabilities: {
              ai: !!options.ai,
              subscription: !!options.subscription,
              templateId: options.subscription ? options.templateId : ''
            }
          };
          break;
        }
        case 'presence': {
          result = { active: true };
          break;
        }
        case 'settings': {
          const pref = D.preferences(input);
          const current =
            user.currentId && (await tx.get('events', user.currentId));
          if (
            current &&
            ['offered', 'pending'].includes(current.state) &&
            D.activeReservation(current, now)
          )
            D.fail('HAS_PENDING_EVENT', '先跳过当前小事或撤销请客，再修改设置');
          const first = !user.preferences;
          user.preferences = pref;
          if (options.scheduler) {
            for (const s of day.plan || []) {
              if (s.eventId) {
                const old = await tx.get('events', s.eventId);
                if (old && old.state === 'planned') {
                  old.state = 'cancelled';
                  await saveEvent(old);
                }
              }
            }
            day.plan = Schedule.makePlan(user, now, { first }).slice(
              0,
              Math.max(
                0,
                (pref.daily < 1000 ? 1 : 2) - (day.automaticCount || 0)
              )
            );
            user.needsFirstEvent = first;
          }
          result = { preferences: pref };
          break;
        }
        case 'tick': {
          result = { event: null, notify: false };
          if (!options.scheduler || !Schedule.active(user, now)) {
            user.nextJobAt = null;
            break;
          }
          if (Schedule.isQuiet(now)) {
            user.nextJobAt =
              Schedule.localHour(now) < 7
                ? D.dayEnd(now) - D.DAY + 7 * 3600000
                : D.dayEnd(now) + 7 * 3600000;
            break;
          }
          const slot = (day.plan || []).find(
            (s) =>
              ['waiting', 'prepared'].includes(s.state) &&
              s.dueAt - Schedule.PREPARE_AHEAD <= now
          );
          if (!slot) break;
          if (
            (day.automaticCount || 0) >= (user.preferences.daily < 1000 ? 1 : 2)
          ) {
            slot.state = 'skipped';
            if (slot.eventId) {
              const old = await tx.get('events', slot.eventId);
              if (old?.state === 'planned') {
                old.state = 'cancelled';
                await saveEvent(old);
              }
            }
            break;
          }
          const current =
            user.currentId && (await tx.get('events', user.currentId));
          if (
            now >= slot.dueAt &&
            current &&
            D.activeReservation(current, now) &&
            ['offered', 'pending', 'accepted'].includes(current.state)
          ) {
            slot.state = 'skipped';
            if (slot.eventId) {
              const old = await tx.get('events', slot.eventId);
              if (old && old.state === 'planned') {
                old.state = 'cancelled';
                await saveEvent(old);
              }
            }
            break;
          }
          if (slot.state === 'waiting') {
            if (
              slot.first ||
              now - slot.dueAt > 60 * 60000 ||
              user.preferences.daily - occupied() < 100
            ) {
              slot.state = 'skipped';
              break;
            }
            await create('self', true, slot);
          }
          const prepared = await tx.get('events', slot.eventId);
          if (!prepared || prepared.state !== 'planned') {
            slot.state = 'skipped';
            break;
          }
          result.event = D.publicEvent(prepared, uid);
          if (now >= slot.dueAt) {
            if (
              prepared.amount > user.preferences.daily - occupied() ||
              prepared.habit !== user.preferences.habit
            ) {
              prepared.state = 'cancelled';
              slot.state = 'skipped';
              result.event = null;
            } else {
              prepared.state = 'offered';
              day.reserved[prepared.id] = prepared.amount;
              user.currentId = prepared.id;
              slot.state = 'delivered';
              day.automaticCount = (day.automaticCount || 0) + 1;
              result.event = D.publicEvent(prepared, uid);
              result.notify = true;
            }
            await saveEvent(prepared);
          }
          break;
        }
        case 'subscription': {
          if (!options.subscription)
            D.fail('CHANNEL_UNAVAILABLE', '提醒渠道尚未配置好');
          if (
            input.intent !== user.subscriptionIntent ||
            user.intentExpiresAt <= now
          )
            D.fail('CONSENT_EXPIRED', '页面停留较久，请重新打开后再申请');
          if (!['accept', 'reject', 'ban'].includes(input.result))
            D.fail('INVALID_CONSENT', '提醒状态无效');
          user.subscriptionIntent = '';
          user.intentExpiresAt = 0;
          user.reminderEnabled = input.result === 'accept';
          user.subscriptionGrant = input.result === 'accept';
          user.subscriptionTemplateId = options.templateId;
          user.consentAt = now;
          result = {
            enabled: user.reminderEnabled,
            available: user.subscriptionGrant
          };
          break;
        }
        case 'pauseReminders': {
          user.reminderEnabled = false;
          user.subscriptionGrant = false;
          user.reminderVersion = (user.reminderVersion || 0) + 1;
          result = { enabled: false, available: false };
          break;
        }
        case 'create':
          result = await create(input.kind === 'treat' ? 'treat' : 'self');
          break;
        case 'accept': {
          const e = await ownEvent();
          if (e.state !== 'offered' || e.expiresAt <= now)
            D.fail('EVENT_CLOSED', '这件小事已经过去了');
          e.state = 'accepted';
          await saveEvent(e);
          result = D.publicEvent(e, uid);
          break;
        }
        case 'skip':
        case 'playOnly':
        case 'cancel': {
          const e = await ownEvent();
          const allowed =
            action === 'skip'
              ? e.state === 'offered'
              : action === 'cancel'
                ? e.kind === 'treat' && e.state === 'pending'
                : e.state === 'accepted';
          if (!allowed) D.fail('EVENT_CLOSED', '这件小事的状态已改变');
          e.state =
            action === 'skip'
              ? 'skipped'
              : action === 'cancel'
                ? 'cancelled'
                : 'play_only';
          if (action === 'cancel') {
            const inv = await tx.get('invites', hash(e.token));
            inv.state = 'cancelled';
            await tx.put('invites', inv.id, inv);
          }
          await release(e);
          await saveEvent(e);
          result = D.publicEvent(e, uid);
          break;
        }
        case 'confirm': {
          const e = await ownEvent();
          if (e.deposit && !e.deposit.revokedAt) {
            result = D.publicEvent(e, uid);
            break;
          }
          if (e.state !== 'accepted')
            D.fail('EVENT_CLOSED', '先完成这件小事，再确认转存');
          const amount = D.assertAmount(input.amount);
          e.deposit = {
            amount,
            confirmedAt: now,
            date: today,
            revokedAt: null
          };
          e.state = 'confirmed';
          await release(e);
          day.confirmed[e.id] = amount;
          // Any other displayed offer is cancelled explicitly; never silently change its price.
          const other =
            user.currentId && (await tx.get('events', user.currentId));
          if (
            other &&
            other.id !== e.id &&
            occupied() > (user.preferences?.daily || 0) &&
            ['offered', 'pending'].includes(other.state)
          ) {
            other.state = 'cancelled';
            if (other.token) {
              const inv = await tx.get('invites', hash(other.token));
              inv.state = 'cancelled';
              await tx.put('invites', inv.id, inv);
            }
            await release(other);
            await saveEvent(other);
          }
          await saveEvent(e);
          result = D.publicEvent(e, uid);
          break;
        }
        case 'undo': {
          const e = await ownEvent();
          if (!e.deposit || e.deposit.revokedAt)
            D.fail('NOT_CONFIRMED', '这件小事没有有效的转存确认');
          const depositDayId = hash(uid + ':' + e.deposit.date);
          if (e.deposit.date === today) delete day.confirmed[e.id];
          else {
            const old = await tx.get('days', depositDayId);
            if (old) {
              delete old.confirmed[e.id];
              await tx.put('days', depositDayId, old);
            }
          }
          e.deposit.revokedAt = now;
          e.state = 'accepted';
          if (e.budgetDate === today) day.reserved[e.id] = e.amount;
          await saveEvent(e);
          result = D.publicEvent(e, uid);
          break;
        }
        case 'claim': {
          const token = String(input.token || '');
          if (!/^[a-f0-9]{48}$/.test(token))
            D.fail('NOT_FOUND', '这张请客卡找不到了');
          const inv = await tx.get('invites', hash(token));
          if (!inv) D.fail('NOT_FOUND', '这张请客卡找不到了');
          if (inv.owner === uid)
            D.fail('SELF_CLAIM', '这是你请朋友的一份，留给朋友来领吧');
          if (inv.state === 'claimed' && inv.recipient === uid) {
            result = D.publicEvent(await tx.get('events', inv.eventId), uid);
            break;
          }
          if (inv.state !== 'pending' || inv.expiresAt <= now)
            D.fail('INVITE_CLOSED', '这份请客已被接受、撤销或过期');
          const e = await tx.get('events', inv.eventId);
          if (!e || e.state !== 'pending')
            D.fail('INVITE_CLOSED', '这份请客已经结束');
          inv.state = 'claimed';
          inv.recipient = uid;
          inv.claimedAt = now;
          e.recipient = uid;
          e.recipientName = user.nickname;
          e.members = [e.owner, uid];
          e.state = 'accepted';
          e.claimedAt = now;
          if (!user.preferences && !user.acquisition)
            user.acquisition = {
              invitation: inv.id,
              sender: inv.owner,
              at: now
            };
          await tx.put('invites', inv.id, inv);
          await saveEvent(e);
          result = D.publicEvent(e, uid);
          break;
        }
        case 'detail': {
          const e = await tx.get('events', String(input.id || ''));
          if (!e) D.fail('NOT_FOUND', '这件小事找不到了');
          result = D.publicEvent(e, uid);
          break;
        }
        case 'profile': {
          const name = String(input.nickname || '').trim();
          if (!name || [...name].length > 16 || /[<>\r\n]/.test(name))
            D.fail('INVALID_NAME', '昵称需要 1–16 个字');
          if (!['leaf', 'star', 'cup', 'cloud'].includes(input.avatar))
            D.fail('INVALID_AVATAR', '请选择一个头像');
          user.nickname = name;
          user.avatar = input.avatar;
          result = { nickname: name, avatar: user.avatar };
          break;
        }
        default:
          D.fail('UNKNOWN_ACTION', '暂不支持这个操作');
      }
      if (
        options.scheduler &&
        user.preferences &&
        (!internal || Schedule.active(user, now))
      ) {
        user.nextJobAt = Schedule.isQuiet(now)
          ? Schedule.localHour(now) < 7
            ? D.dayEnd(now) - D.DAY + 7 * 3600000
            : D.dayEnd(now) + 7 * 3600000
          : Schedule.nextWake(day, now);
      }
      user.updatedAt = now;
      await tx.put('users', uid, user);
      await tx.put('days', dayId, day);
      if (writes)
        await tx.put('requests', rid, {
          id: rid,
          owner: uid,
          action,
          signature: hash(JSON.stringify(input)),
          result,
          createdAt: now
        });
      return result;
    });
  }
  async function history(uid, cursor) {
    if (!uid) D.fail('LOGIN_REQUIRED', '请先登录');
    if (cursor != null && (!Number.isSafeInteger(cursor) || cursor < 0))
      D.fail('INVALID_CURSOR', '分页位置无效');
    const rows = await store.listEvents(uid, cursor || 0, 30);
    return {
      events: rows
        .filter(
          (e) =>
            e.state !== 'planned' &&
            !(e.triggerSource === 'scheduled' && e.state === 'cancelled')
        )
        .map((e) => D.publicEvent(e, uid)),
      next: rows.length === 30 ? (cursor || 0) + 30 : null
    };
  }
  return { run, preview, history };
}
module.exports = { createService, TABLES };
