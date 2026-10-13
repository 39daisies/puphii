// Keys are unchanged from the first prototype so existing on-device history is kept.
// Never rename a key: add a migration that copies the data instead.
export const STORAGE_KEYS = {
  logs: '@puphii/puff-logs-v1',
  settings: '@puphii/settings-v1',
  savings: '@puphii/savings-v1',
  game: '@puphii/bubble-break-v1',
  appState: '@puphii/app-state-v1',
  schema: '@puphii/schema',
  /** Reduction plan. Absent until a plan is first changed; a missing key means tracking only. */
  plan: '@puphii/plan-v1',
  /** Voice Pep Rally metadata; the media itself is in files. Absent until the first one is saved. */
  pepRallies: '@puphii/pep-rallies-v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** The person's own data: what "Reset everything" deletes. */
export const USER_DATA_KEYS = [
  STORAGE_KEYS.logs,
  STORAGE_KEYS.settings,
  STORAGE_KEYS.savings,
  STORAGE_KEYS.game,
  STORAGE_KEYS.plan,
  STORAGE_KEYS.pepRallies,
] as const;

/**
 * Why a copy of stored data was set aside instead of being overwritten:
 * `corrupt` wasn't valid JSON, `invalid` held values this version had to drop or correct,
 * `premigration` is the value as it was before a schema migration changed it.
 */
export type SetAsideReason = 'corrupt' | 'invalid' | 'premigration';
const SET_ASIDE_REASONS: readonly SetAsideReason[] = ['corrupt', 'invalid', 'premigration'];

export function setAsideKey(key: StorageKey, reason: SetAsideReason, now = Date.now()): string {
  return `${key}-${reason}-${now}`;
}

export function corruptBackupKey(key: StorageKey, now = Date.now()): string {
  return setAsideKey(key, 'corrupt', now);
}

/** Keys holding set-aside copies of `keys`, for any reason. */
export function setAsideKeysFor(allKeys: readonly string[], keys: readonly StorageKey[], reasons = SET_ASIDE_REASONS): string[] {
  return allKeys.filter((candidate) => keys.some((key) => reasons.some((reason) => candidate.startsWith(`${key}-${reason}-`))));
}
