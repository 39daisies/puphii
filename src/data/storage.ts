import AsyncStorage from '@react-native-async-storage/async-storage';
import { DEFAULT_GAME_STATS, GameStats, sanitizeGameStats } from '../game/gameStats';
import { sanitizeLogs, sanitizeSettings } from './puffLogic';
import { defaultSavings, deviceCurrency, sanitizeSavings, SavingsSettings } from './savings';
import { corruptBackupKey, corruptBackupKeysFor, StorageKey, STORAGE_KEYS } from './storageKeys';
import { DEFAULT_SETTINGS, PuffLog, Settings } from './types';

export { STORAGE_KEYS } from './storageKeys';

export const CORRUPT_DATA_MESSAGE = 'Some saved data was unreadable. A backup was kept and Puphii started fresh.';

export type LoadResult = {
  logs: PuffLog[];
  settings: Settings;
  savings: SavingsSettings;
  gameStats: GameStats;
  /** Human-readable problem, if any data could not be read. */
  error: string | null;
};

async function readJson(key: StorageKey): Promise<{ value: unknown; corrupt: boolean }> {
  const raw = await AsyncStorage.getItem(key);
  if (raw == null) return { value: null, corrupt: false };
  try {
    return { value: JSON.parse(raw), corrupt: false };
  } catch {
    // Keep the unreadable payload so the next save can't destroy it irrecoverably.
    await AsyncStorage.setItem(corruptBackupKey(key), raw).catch(() => undefined);
    return { value: null, corrupt: true };
  }
}

export async function loadPersistedState(): Promise<LoadResult> {
  try {
    const [logs, settings, savings, game] = await Promise.all([
      readJson(STORAGE_KEYS.logs),
      readJson(STORAGE_KEYS.settings),
      readJson(STORAGE_KEYS.savings),
      readJson(STORAGE_KEYS.game),
    ]);
    const corrupt = logs.corrupt || settings.corrupt || savings.corrupt || game.corrupt;
    return {
      logs: sanitizeLogs(logs.value),
      settings: sanitizeSettings(settings.value),
      savings: sanitizeSavings(savings.value, deviceCurrency()),
      gameStats: sanitizeGameStats(game.value),
      error: corrupt ? CORRUPT_DATA_MESSAGE : null,
    };
  } catch {
    return {
      logs: [],
      settings: { ...DEFAULT_SETTINGS },
      savings: defaultSavings(deviceCurrency()),
      gameStats: { ...DEFAULT_GAME_STATS },
      error: "Couldn't read saved data on this device. New logs may not be saved.",
    };
  }
}

export function writeJson<T>(key: StorageKey) {
  return (value: T) => AsyncStorage.setItem(key, JSON.stringify(value));
}

/** Deletes set-aside copies of unreadable data so clearing really removes every stored record. */
export async function removeCorruptBackups(keys: readonly StorageKey[]): Promise<void> {
  const doomed = corruptBackupKeysFor(await AsyncStorage.getAllKeys(), keys);
  if (doomed.length) await AsyncStorage.multiRemove(doomed);
}
