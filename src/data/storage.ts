import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadFrom, LoadResult, removeSetAsideCopies } from './persistence';
import { deviceCurrency } from './savings';
import { StorageKey } from './storageKeys';

export { STORAGE_KEYS, USER_DATA_KEYS } from './storageKeys';
export { CORRUPT_DATA_MESSAGE } from './persistence';
export type { LoadResult } from './persistence';

export function loadPersistedState(): Promise<LoadResult> {
  return loadFrom(AsyncStorage, { currency: deviceCurrency() });
}

export function writeJson<T>(key: StorageKey) {
  return (value: T) => AsyncStorage.setItem(key, JSON.stringify(value));
}

/** Deletes set-aside copies of unreadable or replaced data so clearing really removes every stored record. */
export function removeCorruptBackups(keys: readonly StorageKey[]): Promise<void> {
  return removeSetAsideCopies(AsyncStorage, keys);
}
