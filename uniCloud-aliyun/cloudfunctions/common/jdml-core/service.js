'use strict';
const crypto = require('crypto');
const D = require('./domain');
const Schedule = require('./schedule');
const Subscriptions = require('./subscriptions');
const Shop = require('./shop');
const Gift = require('./gift-messages');
const { DISCOVERIES, chooseAutomatic } = require('./story-flavor');
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
      giftMessage: invitation.giftMessage || '',
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
      'stats',
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
      if (user.preferences) user.preferences = D.preferences(user.preferences);
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
      // Only issued automatic events consume this budget. Saving, skipping and manual purchases do not.
      if (day.automaticSpent === undefined) {
        let spent = 0,
          identified = 0;
        for (const slot of day.plan || []) {
          if (slot.state === 'delivered' && slot.eventId) {
            const old = await tx.get('events', slot.eventId);
            if (old) {
              spent += old.amount;
              identified++;
            }
          }
        }
        // Older versions counted the welcome event without storing it in the plan.
        spent +=
          Math.max(0, (day.automaticCount || 0) - identified) *
          D.nextAmount(
            user.preferences?.daily || 0,
            user.preferences?.daily || 0
          );
        day.automaticSpent = spent;
      }
      const automaticRemaining = () =>
        Math.max(0, (user.preferences?.daily || 0) - day.automaticSpent);
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
        if (user.randomEventId === e.id) user.randomEventId = '';
      }
      function automaticPools() {
        const remaining = automaticRemaining();
        const habits = user.preferences.habitOptions.filter(
          (h) =>
            D.habitEnabled(h.key, options.enabledHabits) && h.min <= remaining
        );
        const discoveries = DISCOVERIES.filter(
          (h) =>
            h.min <= remaining &&
            !user.preferences.habitOptions.some(
              (own) => own.name === h.name || own.name === h.itemName
            )
        );
        return { habits, discoveries };
      }
      async function create(kind, scheduled = false, slot = null) {
        if (!user.preferences) D.fail('SETUP_REQUIRED', '先给自己安排一个人设');
        const giftMessage =
          kind === 'treat'
            ? Gift.message(input.giftMessage, { optional: true })
            : '';
        let chosen, mix;
        if (scheduled) {
          mix = chooseAutomatic(
            {
              ...automaticPools(),
              taste: user.preferences.storyTaste,
              credit: user.storyMixCredit,
              lastItem: user.lastRandomItem
            },
            crypto.randomInt
          );
          if (!mix)
            D.fail('NO_ELIGIBLE_HABIT', '剩余随机额度不足，仍可主动花一笔');
          chosen = mix.option;
        } else {
          chosen = Shop.manualChoice(
            input,
            user.preferences,
            options.enabledHabits,
            crypto.randomInt,
            user.lastSceneHabit
          );
        }
        const habit = chosen.key,
          item = D.itemFor(chosen);
        let upper = chosen.max;
        if (scheduled)
          upper = Math.min(
            upper,
            automaticRemaining(),
            Math.max(
              chosen.min,
              D.nextAmount(user.preferences.daily, automaticRemaining())
            )
          );
        const step = chosen.min % 100 === 0 && upper % 100 === 0 ? 100 : 1;
        const amount =
          chosen.min +
          crypto.randomInt(Math.floor((upper - chosen.min) / step) + 1) * step;
        const eid = id();
        if (kind === 'self' && !scheduled) user.lastSceneHabit = habit;
        if (!scheduled) {
          const previous =
            user.currentId && (await tx.get('events', user.currentId));
          // Keep accepted receipts and invitations independently accessible in history.
          if (previous?.kind === 'self' && previous.state === 'offered') {
            previous.state = 'skipped';
            await release(previous);
            await saveEvent(previous);
          }
        }
        const e = {
          id: eid,
          owner: uid,
          members: [uid],
          recipient: '',
          kind,
          habit,
          habitName: chosen.name,
          sceneSource: mix?.source || 'manual',
          storyTaste: scheduled ? user.preferences.storyTaste : null,
          storyMixCreditAfter: mix ? mix.creditAfter : null,
          priceRange: { min: chosen.min, max: chosen.max },
          item: item.name,
          unit: item.unit,
          title: item.title,
          reason:
            kind === 'treat'
              ? '朋友说我最近挺会过日子，我想请他一份' +
                item.name +
                '。这么有眼光的人，值得让他下次继续说。'
              : item.reason,
          sceneSummary:
            kind === 'treat' ? '朋友这么有眼光，值得请一份' : item.summary,
          amount,
          giftMessage,
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
            giftMessage: e.giftMessage,
            expiresAt: e.expiresAt,
            createdAt: now
          });
        }
        if (scheduled) {
          slot.eventId = eid;
          slot.state = 'prepared';
          e.dueAt = slot.dueAt;
        } else {
          user.currentId = eid;
        }
        await saveEvent(e);
        return D.publicEvent(e, uid);
      }
      let result;
      switch (action) {
        case 'bootstrap': {
          if (
            options.subscription &&
            (!user.subscriptionIntent ||
              user.intentExpiresAt <= now ||
              user.subscriptionIntentTemplateId !== options.templateId ||
              user.subscriptionIntentVersion !== (user.reminderVersion || 0))
          ) {
            Subscriptions.issueIntent(user, options.templateId, now);
          }
          let current = user.currentId
            ? await tx.get('events', user.currentId)
            : null;
          if (current?.triggerSource === 'scheduled') {
            user.randomEventId = user.randomEventId || current.id;
            user.currentId = '';
            current = null;
          }
          const random = user.randomEventId
            ? await tx.get('events', user.randomEventId)
            : null;
          const randomVisible =
            random &&
            D.activeReservation(random, now) &&
            ['offered', 'accepted'].includes(random.state);
          const visible =
            current &&
            D.activeReservation(current, now) &&
            ['offered', 'accepted', 'pending'].includes(current.state);
          result = {
            user: {
              id: uid,
              nickname: user.nickname,
              avatar: user.avatar,
              preferences: user.preferences
            },
            current: visible ? D.publicEvent(current, uid) : null,
            randomEvent: randomVisible ? D.publicEvent(random, uid) : null,
            unreadCount:
              randomVisible && random.state === 'offered' && !random.seenAt
                ? 1
                : 0,
            habitOptions: user.preferences?.habitOptions || [],
            shopOptions: Shop.catalog(user.preferences, options.enabledHabits),
            todayConfirmed: Object.values(day.confirmed).reduce(
              (a, b) => a + b,
              0
            ),
            available: automaticRemaining(),
            automaticBudget: {
              limit: user.preferences?.daily || 0,
              spent: day.automaticSpent,
              remaining: automaticRemaining()
            },
            reminders: Subscriptions.status(user, options.templateId),
            capabilities: {
              ai: !!options.ai,
              manualShop: true,
              giftMessages: true,
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
          const pref = D.preferences({
            ...input,
            storyTaste:
              input.storyTaste === undefined
                ? user.preferences?.storyTaste
                : input.storyTaste
          });
          if (
            options.enabledHabits &&
            pref.habits.some((h) => !D.habitEnabled(h, options.enabledHabits))
          )
            D.fail('THEME_DISABLED', '有选中的人设暂时休息，请换一个试试');
          const current =
            user.randomEventId && (await tx.get('events', user.randomEventId));
          if (current?.state === 'offered') {
            current.state = 'skipped';
            await release(current);
            await saveEvent(current);
          }
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
          if (
            !options.scheduler ||
            !Schedule.active(
              user,
              now,
              options.subscription ? options.templateId : ''
            )
          ) {
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
            user.randomEventId && (await tx.get('events', user.randomEventId));
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
              (now - slot.dueAt > 60 * 60000 &&
                (day.automaticCount || 0) > 0) ||
              !Object.values(automaticPools()).some((pool) => pool.length)
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
              prepared.amount > automaticRemaining() ||
              (prepared.sceneSource === 'discovery'
                ? !automaticPools().discoveries.some(
                    (h) => h.key === prepared.habit
                  )
                : !D.selectedHabits(user.preferences).includes(
                    prepared.habit
                  ) || !D.habitEnabled(prepared.habit, options.enabledHabits))
            ) {
              prepared.state = 'cancelled';
              slot.state = 'skipped';
              result.event = null;
            } else {
              prepared.state = 'offered';
              if (Number.isInteger(prepared.storyMixCreditAfter))
                user.storyMixCredit = prepared.storyMixCreditAfter;
              user.lastRandomItem = prepared.habit;
              day.automaticSpent += prepared.amount;
              user.randomEventId = prepared.id;
              user.needsFirstEvent = false;
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
            !input.intent ||
            input.intent !== user.subscriptionIntent ||
            user.subscriptionIntentTemplateId !== options.templateId ||
            user.subscriptionIntentVersion !== (user.reminderVersion || 0) ||
            user.intentExpiresAt <= now
          )
            D.fail('CONSENT_EXPIRED', '提醒信息已更新，请重新打开后再申请');
          if (!['accept', 'reject', 'ban'].includes(input.result))
            D.fail('INVALID_CONSENT', '提醒状态无效');
          if (input.automatic && !user.reminderEnabled)
            D.fail('REMINDERS_PAUSED', '请先主动开启剧情提醒');
          if (input.result === 'accept') {
            Subscriptions.setRemaining(
              user,
              options.templateId,
              Subscriptions.remaining(user, options.templateId) + 1
            );
            user.reminderEnabled = true;
          } else {
            Subscriptions.stop(user, options.templateId);
          }
          user.consentAt = now;
          // Consume this nonce and return the next one. Replays cannot add another credit.
          Subscriptions.issueIntent(user, options.templateId, now);
          result = Subscriptions.status(user, options.templateId);
          break;
        }
        case 'subscriptionSettings': {
          if (!options.subscription || input.templateId !== options.templateId)
            D.fail('CHANNEL_UNAVAILABLE', '提醒渠道尚未配置好');
          // Only explicit denial/main-switch-off is reported. A stale settings response
          // must not override a newer grant or a pause/re-enable on another device.
          if (input.blocked !== true || !Number.isSafeInteger(input.revision))
            D.fail('INVALID_CONSENT', '提醒状态无效');
          if (input.revision === (user.subscriptionRevision || 0))
            Subscriptions.stop(user, options.templateId);
          result = Subscriptions.status(user, options.templateId);
          break;
        }
        case 'pauseReminders': {
          Subscriptions.stop(user, options.templateId);
          result = Subscriptions.status(user, options.templateId);
          break;
        }
        case 'giftMessages': {
          if (!user.preferences)
            D.fail('SETUP_REQUIRED', '先给自己安排一个人设');
          if (
            input.kind !== 'treat' ||
            input.amount === undefined ||
            (input.habit === undefined && input.customItem === undefined)
          )
            D.fail('INVALID_ITEM', '先选好请客的商品和金额');
          const chosen = Shop.manualChoice(
            input,
            user.preferences,
            options.enabledHabits,
            crypto.randomInt
          );
          result = {
            item: D.itemFor(chosen).name,
            exclude: Gift.exclusions(input.exclude)
          };
          break;
        }
        case 'create':
          result = await create(input.kind === 'treat' ? 'treat' : 'self');
          break;
        case 'seen': {
          const e = await ownEvent();
          if (
            e.triggerSource !== 'scheduled' ||
            e.state !== 'offered' ||
            e.expiresAt <= now
          )
            D.fail('EVENT_CLOSED', '这条随机小事已经过去了');
          e.seenAt = e.seenAt || now;
          await saveEvent(e);
          result = D.publicEvent(e, uid);
          break;
        }
        case 'accept': {
          const e = await ownEvent();
          if (e.state !== 'offered' || e.expiresAt <= now)
            D.fail('EVENT_CLOSED', '这件小事已经过去了');
          e.state = 'accepted';
          e.seenAt = e.seenAt || now;
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
          if (
            e.owner === uid &&
            e.triggerSource === 'scheduled' &&
            e.state === 'offered' &&
            !e.seenAt
          ) {
            e.seenAt = now;
            await saveEvent(e);
            result = D.publicEvent(e, uid);
          }
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
        (!internal ||
          Schedule.active(
            user,
            now,
            options.subscription ? options.templateId : ''
          ))
      ) {
        user.nextJobAt = Schedule.isQuiet(now)
          ? Schedule.localHour(now) < 7
            ? D.dayEnd(now) - D.DAY + 7 * 3600000
            : D.dayEnd(now) + 7 * 3600000
          : Schedule.nextWake(day, now);
        // Foreground suppression or a temporary credential failure must not lose
        // today's reminder. Revisit the unseen event without regenerating its story.
        if (
          !Schedule.isQuiet(now) &&
          options.subscription &&
          user.reminderEnabled &&
          Subscriptions.remaining(user, options.templateId) > 0 &&
          user.randomEventId
        ) {
          const pending = await tx.get('events', user.randomEventId);
          if (
            pending?.state === 'offered' &&
            !pending.seenAt &&
            pending.expiresAt > now &&
            !(await Subscriptions.alreadyAttempted(tx, uid, pending.id, today))
          ) {
            user.nextJobAt = Math.min(user.nextJobAt, now + 5 * 60000);
          }
        }
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
  async function stats(uid) {
    if (!uid) D.fail('LOGIN_REQUIRED', '请先登录');
    const now = clock(),
      PAGE = (options.stats && options.stats.page) || 500,
      MAX = (options.stats && options.stats.max) || 5000,
      SETTLED = ['accepted', 'confirmed', 'play_only'];
    const all = [];
    let skip = 0,
      truncated = false;
    for (;;) {
      const rows = await store.listEvents(uid, skip, PAGE);
      all.push(...rows);
      if (rows.length < PAGE) break;
      skip += PAGE;
      if (all.length >= MAX) {
        all.length = MAX;
        truncated = true;
        break;
      }
    }
    const out = {
      savedTotal: 0,
      savedCount: 0,
      fakeSpentTotal: 0,
      momentsTotal: 0,
      streakDays: 0,
      treatsSent: 0,
      treatsReceived: 0,
      playOnlyCount: 0,
      habitBreakdown: [],
      firstEventAt: null,
      spanDays: 0,
      truncated
    };
    const dates = new Set(),
      buckets = new Map();
    let first = Infinity;
    for (const e of all) {
      if (e.state === 'planned') continue;
      if (e.triggerSource === 'scheduled' && e.state === 'cancelled')
        continue;
      if (e.owner === uid) {
        first = Math.min(first, e.createdAt || Infinity);
        if (e.deposit && !e.deposit.revokedAt) {
          out.savedTotal += e.deposit.amount;
          out.savedCount++;
          dates.add(e.deposit.date);
        }
        if (SETTLED.includes(e.state)) {
          out.momentsTotal++;
          out.fakeSpentTotal += e.amount;
          if (e.kind === 'treat') out.treatsSent++;
          if (e.state === 'play_only') out.playOnlyCount++;
          const discovery = e.sceneSource === 'discovery',
            key = discovery ? '_discovery' : e.habit || '_other';
          const bucket =
            buckets.get(key) ||
            {
              key,
              count: 0,
              amount: 0,
              name: discovery
                ? '意外之喜'
                : e.habitName || e.habit || '其他'
            };
          bucket.count++;
          bucket.amount += e.amount;
          buckets.set(key, bucket);
        }
      } else if (e.recipient === uid && SETTLED.includes(e.state))
        out.treatsReceived++;
    }
    let cursor = D.dateKey(now);
    if (!dates.has(cursor)) cursor = D.dateKey(now - D.DAY);
    while (dates.has(cursor)) {
      out.streakDays++;
      cursor = D.dateKey(
        Date.parse(cursor + 'T00:00:00+08:00') - D.DAY
      );
    }
    if (first < Infinity) {
      out.firstEventAt = first;
      out.spanDays = Math.floor((now - first) / D.DAY) + 1;
    }
    out.habitBreakdown = [...buckets.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return out;
  }
  return { run, preview, history, stats };
}
module.exports = { createService, TABLES };
