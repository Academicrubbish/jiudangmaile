// Older cloud deployments may return only preferences.daily and a boolean grant.
// Normalize optional sections before rendering; do not invent subscription support.
export function normalizeHomeState(value) {
  const source = value || {};
  const user = source.user || {};
  const pref = user.preferences;
  const budget = source.automaticBudget || {};
  const capabilities = source.capabilities || {};
  const reminders = source.reminders || {};
  const subscriptionReady =
    !!user.id &&
    typeof reminders.intentExpiresAt === 'number' &&
    Number.isSafeInteger(reminders.revision) &&
    !!capabilities.templateId;
  return {
    ...source,
    user: {
      ...user,
      preferences: pref
        ? {
            ...pref,
            habits:
              Array.isArray(pref.habits) && pref.habits.length
                ? pref.habits
                : [pref.habit || 'milk_tea']
          }
        : null
    },
    automaticBudget: {
      ...budget,
      limit: budget.limit ?? pref?.daily ?? null
    },
    capabilities: {
      ...capabilities,
      subscriptionNeedsUpdate:
        !!capabilities.subscription && !subscriptionReady,
      subscription: !!capabilities.subscription && subscriptionReady,
      templateId: capabilities.templateId || ''
    },
    reminders: {
      enabled: false,
      available: false,
      remaining: 0,
      intent: '',
      intentExpiresAt: 0,
      version: 0,
      revision: 0,
      ...reminders
    }
  };
}
