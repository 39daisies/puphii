// Keys are unchanged from the first prototype so existing on-device history is kept.
export const STORAGE_KEYS = {
  logs: '@puphii/puff-logs-v1',
  settings: '@puphii/settings-v1',
  savings: '@puphii/savings-v1',
  game: '@puphii/bubble-break-v1',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

export function corruptBackupKey(key: StorageKey, now = Date.now()): string {
  return `${key}-corrupt-${now}`;
}

/** Keys holding unreadable copies of `keys` that were set aside during loading. */
export function corruptBackupKeysFor(allKeys: readonly string[], keys: readonly StorageKey[]): string[] {
  return allKeys.filter((candidate) => keys.some((key) => candidate.startsWith(`${key}-corrupt-`)));
}
