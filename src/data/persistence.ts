import { DEFAULT_GAME_STATS, GameStats, sanitizeGameStats } from '../game/gameStats';
import { defaultPlan, PlanRecord, sanitizePlan } from '../plan/model';
import { AppState, createAppState, sanitizeAppState } from './appState';
import { CURRENT_SCHEMA_VERSION, Migration, RawData, readSchemaVersion, runMigrations, SchemaMarker } from './migrations';
import { isPreserved } from './preserve';
import { sanitizeLogs, sanitizeSettings } from './puffLogic';
import { defaultSavings, sanitizeSavings, SavingsSettings } from './savings';
import { SetAsideReason, setAsideKey, setAsideKeysFor, StorageKey, STORAGE_KEYS, USER_DATA_KEYS } from './storageKeys';
import { DEFAULT_SETTINGS, PuffLog, Settings } from './types';

/** The subset of AsyncStorage that persistence uses, so it can run against an in-memory store in tests. */
export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  multiSet(pairs: ReadonlyArray<readonly [string, string]>): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
  multiRemove(keys: readonly string[]): Promise<void>;
}

export const CORRUPT_DATA_MESSAGE = 'Some saved data was unreadable. A backup was kept and Puphii started fresh.';
export const READ_ERROR_MESSAGE = "Couldn't read saved data on this device. New logs may not be saved.";

export type LoadResult = {
  logs: PuffLog[];
  settings: Settings;
  savings: SavingsSettings;
  gameStats: GameStats;
  /** Tracking only when no plan was ever saved. */
  plan: PlanRecord;
  /** Null only when storage couldn't be read at all. */
  appState: AppState | null;
  /** Schema version of the data as loaded (higher than current if a newer Puphii wrote it). */
  schemaVersion: number;
  /** Human-readable problem, if any data could not be read. */
  error: string | null;
  /** False when storage couldn't be read, so saving now could overwrite data that is still there. */
  canSave: boolean;
};

type DataName = keyof RawData;

const DATA_KEYS: Record<DataName, StorageKey> = {
  logs: STORAGE_KEYS.logs,
  settings: STORAGE_KEYS.settings,
  savings: STORAGE_KEYS.savings,
  game: STORAGE_KEYS.game,
  appState: STORAGE_KEYS.appState,
  plan: STORAGE_KEYS.plan,
};
const DATA_NAMES = Object.keys(DATA_KEYS) as DataName[];

/** Keeps a copy of `raw` under a set-aside key, unless an identical copy for the same reason already exists. */
async function setAside(store: KeyValueStore, key: StorageKey, reason: SetAsideReason, raw: string, now: number) {
  for (const existing of setAsideKeysFor(await store.getAllKeys(), [key], [reason])) {
    if ((await store.getItem(existing)) === raw) return;
  }
  await store.setItem(setAsideKey(key, reason, now), raw);
}

export type LoadOptions = {
  currency: string;
  now?: Date;
  migrations?: readonly Migration[];
  targetVersion?: number;
};

export async function loadFrom(store: KeyValueStore, options: LoadOptions): Promise<LoadResult> {
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const targetVersion = options.targetVersion ?? CURRENT_SCHEMA_VERSION;
  try {
    const texts = await Promise.all(DATA_NAMES.map((name) => store.getItem(DATA_KEYS[name])));
    const schemaText = await store.getItem(STORAGE_KEYS.schema);

    const parsed = {} as RawData;
    const unreadable = new Set<DataName>();
    for (const [index, name] of DATA_NAMES.entries()) {
      const text = texts[index];
      parsed[name] = null;
      if (text == null) continue;
      try {
        parsed[name] = JSON.parse(text);
      } catch {
        unreadable.add(name);
        await setAside(store, DATA_KEYS[name], 'corrupt', text, nowMs).catch(() => undefined);
      }
    }
    let markerVersion: number | null = null;
    try {
      markerVersion = schemaText == null ? null : readSchemaVersion(JSON.parse(schemaText));
    } catch {
      markerVersion = null;
    }

    const isFreshInstall = schemaText == null && texts.every((text) => text == null);
    const storedVersion = markerVersion ?? (isFreshInstall ? targetVersion : 1);
    const writes: [string, string][] = [];

    let data = parsed;
    let version = storedVersion;
    let migrationSaved = true;
    if (storedVersion < targetVersion) {
      const result = runMigrations(parsed, storedVersion, { now }, options.migrations, targetVersion);
      for (const [index, name] of DATA_NAMES.entries()) {
        const next = result.data[name];
        if (next === parsed[name] || next == null) continue;
        const original = texts[index];
        if (original != null) {
          try {
            await setAside(store, DATA_KEYS[name], 'premigration', original, nowMs);
          } catch {
            migrationSaved = false;
          }
        }
        writes.push([DATA_KEYS[name], JSON.stringify(next)]);
      }
      data = result.data;
      version = result.version;
    }
    if (!migrationSaved) writes.length = 0;

    const restored: Record<DataName, unknown> = {
      logs: sanitizeLogs(data.logs),
      settings: sanitizeSettings(data.settings),
      savings: sanitizeSavings(data.savings, options.currency),
      game: sanitizeGameStats(data.game),
      appState: sanitizeAppState(data.appState),
      plan: sanitizePlan(data.plan),
    };
    for (const name of DATA_NAMES) {
      if (data[name] == null || isPreserved(data[name], restored[name])) continue;
      await setAside(store, DATA_KEYS[name], 'invalid', JSON.stringify(data[name]), nowMs).catch(() => undefined);
    }

    let appState = restored.appState as AppState | null;
    if (!appState) {
      appState = createAppState(now, isFreshInstall ? 'freshInstall' : 'recreated');
      if (migrationSaved) writes.push([STORAGE_KEYS.appState, JSON.stringify(appState)]);
    }
    if (migrationSaved && markerVersion !== version) {
      const marker: SchemaMarker = { version, updatedAt: now.toISOString() };
      writes.push([STORAGE_KEYS.schema, JSON.stringify(marker)]);
    }
    // The schema marker is last, so an interrupted write leaves the old version recorded and the migration runs again.
    if (writes.length) await store.multiSet(writes).catch(() => undefined);

    const userDataUnreadable = [...unreadable].some((name) => name !== 'appState');
    return {
      logs: restored.logs as PuffLog[],
      settings: restored.settings as Settings,
      savings: restored.savings as SavingsSettings,
      gameStats: restored.game as GameStats,
      plan: restored.plan as PlanRecord,
      appState,
      schemaVersion: version,
      error: userDataUnreadable ? CORRUPT_DATA_MESSAGE : null,
      canSave: true,
    };
  } catch {
    return {
      logs: [],
      settings: { ...DEFAULT_SETTINGS },
      savings: defaultSavings(options.currency),
      gameStats: { ...DEFAULT_GAME_STATS },
      plan: defaultPlan(),
      appState: null,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      error: READ_ERROR_MESSAGE,
      canSave: false,
    };
  }
}

/** Deletes set-aside copies of `keys` so clearing really removes every stored record. */
export async function removeSetAsideCopies(store: KeyValueStore, keys: readonly StorageKey[] = USER_DATA_KEYS): Promise<void> {
  const doomed = setAsideKeysFor(await store.getAllKeys(), keys);
  if (doomed.length) await store.multiRemove(doomed);
}
