import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { recordRound } from '../src/game/gameStats';
import { sanitizeAppState } from '../src/data/appState';
import { CURRENT_SCHEMA_VERSION, Migration, MIGRATIONS, runMigrations } from '../src/data/migrations';
import { CORRUPT_DATA_MESSAGE, KeyValueStore, loadFrom, LoadOptions, READ_ERROR_MESSAGE, removeSetAsideCopies } from '../src/data/persistence';
import { isPreserved, withUnknownFields } from '../src/data/preserve';
import { createLog } from '../src/data/puffLogic';
import { defaultPepLibrary } from '../src/pepRally/model';
import { defaultPlan } from '../src/plan/model';
import { deleteRecordingFiles, planRecordingDeletion } from '../src/data/recordings';
import { KEPT_ON_RESET, RESET_KEYS, resetValues } from '../src/data/reset';
import { defaultSavings } from '../src/data/savings';
import { STORAGE_KEYS, USER_DATA_KEYS } from '../src/data/storageKeys';
import { DEFAULT_SETTINGS } from '../src/data/types';

class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  failReads = false;
  failMultiSet = false;
  writes = 0;

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  async getItem(key: string) {
    if (this.failReads) throw new Error('storage unavailable');
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    this.writes += 1;
    this.data.set(key, value);
  }
  async multiSet(pairs: ReadonlyArray<readonly [string, string]>) {
    if (this.failMultiSet) throw new Error('disk full');
    for (const [key, value] of pairs) await this.setItem(key, value);
  }
  async getAllKeys() {
    if (this.failReads) throw new Error('storage unavailable');
    return [...this.data.keys()];
  }
  async multiRemove(keys: readonly string[]) {
    for (const key of keys) this.data.delete(key);
  }
  snapshot() {
    return new Map(this.data);
  }
  keysStartingWith(prefix: string) {
    return [...this.data.keys()].filter((key) => key.startsWith(prefix));
  }
  json(key: string) {
    const raw = this.data.get(key);
    return raw == null ? undefined : JSON.parse(raw);
  }
}

const NOW = new Date('2026-10-10T06:00:00.000Z');
const LATER = new Date('2026-10-12T06:00:00.000Z');
const load = (store: KeyValueStore, options: Partial<LoadOptions> = {}) => loadFrom(store, { currency: 'USD', now: NOW, ...options });

/** Exactly what version 0.1.0 of Puphii writes, before the schema was versioned. */
const LEGACY = {
  [STORAGE_KEYS.logs]: [
    { id: 'mgk1-1-abc123', timestamp: '2026-10-08T22:15:00.000Z' },
    { id: 'mgk2-2-def456', timestamp: '2026-10-09T09:30:00.000Z' },
  ],
  [STORAGE_KEYS.settings]: {
    mode: 'dramatic',
    soundEnabled: true,
    hapticsEnabled: false,
    remindersEnabled: true,
    reminderHour: 21,
    reminderMinute: 30,
  },
  [STORAGE_KEYS.savings]: {
    ...defaultSavings('JPY'),
    productType: 'vapePods',
    reductionPercent: 75,
    goalName: 'Trip to Okinawa',
    goalAmount: 80000,
    products: {
      ...defaultSavings('JPY').products,
      vapePods: { price: 1200, unitsPerPurchase: 2, basis: 'rate', rate: 3, lastsDays: null },
    },
  },
  [STORAGE_KEYS.game]: { roundsCompleted: 12, bestScore: 41 },
};

describe('legacy data migration', () => {
  test('an install from before versioning keeps every value and gains lifecycle state', async () => {
    const store = new MemoryStore(LEGACY);
    const before = store.snapshot();
    const result = await load(store);

    assert.equal(result.error, null);
    assert.equal(result.canSave, true);
    assert.deepEqual(result.logs, LEGACY[STORAGE_KEYS.logs]);
    assert.deepEqual(result.settings, LEGACY[STORAGE_KEYS.settings]);
    assert.deepEqual(result.savings, LEGACY[STORAGE_KEYS.savings]);
    assert.deepEqual(result.gameStats, LEGACY[STORAGE_KEYS.game]);
    for (const key of USER_DATA_KEYS) assert.equal(store.data.get(key), before.get(key), `${key} is untouched`);

    assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(store.json(STORAGE_KEYS.schema), { version: CURRENT_SCHEMA_VERSION, updatedAt: NOW.toISOString() });
    assert.equal(result.appState?.firstLaunchSource, 'existingInstall');
    assert.equal(result.appState?.firstLaunchAt, NOW.toISOString());
    assert.deepEqual(store.json(STORAGE_KEYS.appState), result.appState);
    assert.equal(store.keysStartingWith('@puphii/').length, Object.keys(LEGACY).length + 2, 'no backup copies or plan were written');
    assert.equal(result.plan.goal, 'track');
  });

  test('a fresh install is recorded as one, without writing any user data', async () => {
    const store = new MemoryStore();
    const result = await load(store);
    assert.equal(result.appState?.firstLaunchSource, 'freshInstall');
    assert.deepEqual(result.settings, DEFAULT_SETTINGS);
    assert.deepEqual([...store.data.keys()].sort(), [STORAGE_KEYS.appState, STORAGE_KEYS.schema].sort());
  });

  test('later launches change nothing and keep the first launch time', async () => {
    const store = new MemoryStore(LEGACY);
    const first = await load(store);
    const settled = store.snapshot();
    const writes = store.writes;
    const second = await load(store, { now: LATER });
    assert.deepEqual(second.appState, first.appState);
    assert.equal(store.writes, writes);
    assert.deepEqual(store.snapshot(), settled);
  });

  test('if saving the migration is interrupted, the next launch finishes it with the same result', async () => {
    const store = new MemoryStore(LEGACY);
    store.failMultiSet = true;
    const interrupted = await load(store);
    assert.equal(interrupted.error, null);
    assert.equal(store.data.get(STORAGE_KEYS.schema), undefined);
    store.failMultiSet = false;
    const resumed = await load(store, { now: LATER });
    assert.equal(resumed.appState?.firstLaunchSource, 'existingInstall');
    assert.equal(store.json(STORAGE_KEYS.schema).version, CURRENT_SCHEMA_VERSION);
    assert.deepEqual(resumed.logs, LEGACY[STORAGE_KEYS.logs]);
  });

  test('every migration is a single step and runs again safely on its own output', () => {
    for (let version = 1; version < CURRENT_SCHEMA_VERSION; version += 1) {
      assert.equal(MIGRATIONS.filter((migration) => migration.from === version && migration.to === version + 1).length, 1);
    }
    const raw = {
      logs: [],
      settings: null,
      savings: null,
      game: null,
      appState: null,
      plan: null,
      pepRallies: null,
      skips: null,
      skipMilestones: null,
    };
    const once = runMigrations(raw, 1, { now: NOW });
    const twice = runMigrations(once.data, 1, { now: LATER });
    assert.deepEqual(twice.data, once.data);
    assert.throws(() => runMigrations(raw, 1, { now: NOW }, [], 2), /No migration from schema version 1/);
  });

  test('a migration that rewrites existing data keeps the original copy first', async () => {
    const store = new MemoryStore({ ...LEGACY, [STORAGE_KEYS.schema]: { version: 2, updatedAt: NOW.toISOString() } });
    await load(store);
    const original = store.data.get(STORAGE_KEYS.savings);
    const splitGoals: Migration = {
      from: 2,
      to: 3,
      description: 'Example: moves the single goal into a list.',
      migrate: (data) => {
        const savings = data.savings as Record<string, unknown>;
        if ('goals' in savings) return data;
        return { ...data, savings: { ...savings, goals: [{ name: savings.goalName, amount: savings.goalAmount }] } };
      },
    };
    const result = await load(store, { migrations: [...MIGRATIONS, splitGoals], targetVersion: 3 });
    assert.equal(result.schemaVersion, 3);
    assert.deepEqual((result.savings as unknown as { goals: unknown }).goals, [{ name: 'Trip to Okinawa', amount: 80000 }]);
    const [backup] = store.keysStartingWith(`${STORAGE_KEYS.savings}-premigration-`);
    assert.equal(store.data.get(backup), original);
    assert.equal(store.json(STORAGE_KEYS.schema).version, 3);
  });
});

describe('round-trip preservation', () => {
  const NEWER = {
    [STORAGE_KEYS.logs]: [
      { id: 'a', timestamp: '2026-10-08T06:00:00.000Z', context: { trigger: 'coffee' } },
      { id: 'b', timestamp: '2026-10-08T07:00:00.000Z' },
    ],
    [STORAGE_KEYS.settings]: { ...LEGACY[STORAGE_KEYS.settings], voiceCoach: { recordingId: 'r1' } },
    [STORAGE_KEYS.savings]: {
      ...LEGACY[STORAGE_KEYS.savings],
      goals: [{ name: 'Bike', amount: 300 }],
      products: {
        ...LEGACY[STORAGE_KEYS.savings].products,
        heatedTobacco: { price: 600 },
        cigarettes: { ...LEGACY[STORAGE_KEYS.savings].products.cigarettes, brand: 'x' },
      },
    },
    [STORAGE_KEYS.game]: { roundsCompleted: 3, bestScore: 9, longestStreak: 4 },
  };

  test('fields this version does not know about are kept when data is read and saved again', async () => {
    const store = new MemoryStore(NEWER);
    const result = await load(store);
    assert.deepEqual(result.logs, NEWER[STORAGE_KEYS.logs]);
    assert.deepEqual(result.settings, NEWER[STORAGE_KEYS.settings]);
    assert.deepEqual(result.savings, NEWER[STORAGE_KEYS.savings]);
    assert.deepEqual(result.gameStats, NEWER[STORAGE_KEYS.game]);

    const resaved = new MemoryStore({
      [STORAGE_KEYS.logs]: JSON.stringify(result.logs),
      [STORAGE_KEYS.settings]: JSON.stringify({ ...result.settings, soundEnabled: false }),
      [STORAGE_KEYS.savings]: JSON.stringify({ ...result.savings, reductionPercent: 50 }),
      [STORAGE_KEYS.game]: JSON.stringify(recordRound(result.gameStats, 12)),
    });
    const reloaded = await load(resaved);
    assert.deepEqual(reloaded.logs, NEWER[STORAGE_KEYS.logs]);
    assert.deepEqual(reloaded.settings, { ...NEWER[STORAGE_KEYS.settings], soundEnabled: false });
    assert.deepEqual(reloaded.savings, { ...NEWER[STORAGE_KEYS.savings], reductionPercent: 50 });
    assert.deepEqual(reloaded.gameStats, { roundsCompleted: 4, bestScore: 12, longestStreak: 4 });
  });

  test('data from a newer schema is read without downgrading its version', async () => {
    const store = new MemoryStore({ ...NEWER, [STORAGE_KEYS.schema]: { version: 9, updatedAt: NOW.toISOString() } });
    const result = await load(store);
    assert.equal(result.schemaVersion, 9);
    assert.equal(store.json(STORAGE_KEYS.schema).version, 9);
    assert.deepEqual(result.logs, NEWER[STORAGE_KEYS.logs]);
  });

  test('new logs and edits keep earlier unknown fields', () => {
    const restored = withUnknownFields({ id: 'x', timestamp: 't', mood: 2 }, { id: 'x', timestamp: 't' });
    assert.deepEqual(restored, { id: 'x', timestamp: 't', mood: 2 });
    const log = createLog(NOW);
    assert.deepEqual(Object.keys(log).sort(), ['id', 'timestamp']);
  });

  test('a stored "__proto__" field stays plain data', () => {
    const raw = JSON.parse('{"mode":"minimal","__proto__":{"polluted":true}}');
    const restored = withUnknownFields(raw, { mode: 'minimal' }) as Record<string, unknown>;
    assert.equal(({} as Record<string, unknown>).polluted, undefined);
    assert.equal(Object.getPrototypeOf(restored), Object.prototype);
    assert.ok(isPreserved(raw, restored));
  });
});

describe('malformed data', () => {
  test('unreadable JSON is set aside once and the other data still loads', async () => {
    const store = new MemoryStore({ ...LEGACY, [STORAGE_KEYS.logs]: '[{"id":"a",' });
    const result = await load(store);
    assert.equal(result.error, CORRUPT_DATA_MESSAGE);
    assert.deepEqual(result.logs, []);
    assert.deepEqual(result.settings, LEGACY[STORAGE_KEYS.settings]);
    const copies = store.keysStartingWith(`${STORAGE_KEYS.logs}-corrupt-`);
    assert.equal(copies.length, 1);
    assert.equal(store.data.get(copies[0]), '[{"id":"a",');
    assert.equal(store.data.get(STORAGE_KEYS.logs), '[{"id":"a",', 'the original is not overwritten at load');

    await load(store, { now: LATER });
    assert.equal(store.keysStartingWith(`${STORAGE_KEYS.logs}-corrupt-`).length, 1, 'no duplicate copy on the next launch');
  });

  test('entries and values that have to be dropped or corrected are kept in a copy first', async () => {
    const logs = [{ id: 'a', timestamp: '2026-10-08T06:00:00.000Z' }, { id: 'b', timestamp: 'never' }, null, 'junk'];
    const settings = { ...LEGACY[STORAGE_KEYS.settings], reminderHour: 99, mode: 'zen' };
    const store = new MemoryStore({ ...LEGACY, [STORAGE_KEYS.logs]: logs, [STORAGE_KEYS.settings]: settings });
    const result = await load(store);

    assert.deepEqual(result.logs.map((log) => log.id), ['a']);
    assert.equal(result.settings.reminderHour, DEFAULT_SETTINGS.reminderHour);
    assert.equal(result.settings.mode, DEFAULT_SETTINGS.mode);
    assert.equal(result.error, null);
    const [logCopy] = store.keysStartingWith(`${STORAGE_KEYS.logs}-invalid-`);
    const [settingsCopy] = store.keysStartingWith(`${STORAGE_KEYS.settings}-invalid-`);
    assert.deepEqual(store.json(logCopy), logs);
    assert.deepEqual(store.json(settingsCopy), settings);
    assert.equal(store.keysStartingWith(`${STORAGE_KEYS.savings}-invalid-`).length, 0, 'valid data is not copied');

    await load(store, { now: LATER });
    assert.equal(store.keysStartingWith(`${STORAGE_KEYS.logs}-invalid-`).length, 1);
  });

  test('values of the wrong type fall back safely', async () => {
    const store = new MemoryStore({
      [STORAGE_KEYS.logs]: { not: 'a list' },
      [STORAGE_KEYS.settings]: JSON.stringify('dramatic'),
      [STORAGE_KEYS.savings]: [1, 2],
      [STORAGE_KEYS.game]: 7,
      [STORAGE_KEYS.plan]: [3],
      [STORAGE_KEYS.pepRallies]: JSON.stringify('rallies'),
      [STORAGE_KEYS.skips]: { skips: 3 },
      [STORAGE_KEYS.skipMilestones]: { seen: 'nope' },
    });
    const result = await load(store);
    assert.deepEqual(result.logs, []);
    assert.deepEqual(result.skips, []);
    assert.deepEqual(result.skipMilestones, { seen: [] });
    assert.deepEqual(result.settings, DEFAULT_SETTINGS);
    assert.deepEqual(result.gameStats, { roundsCompleted: 0, bestScore: 0 });
    assert.deepEqual(result.plan, defaultPlan());
    assert.deepEqual(result.pepRallies, defaultPepLibrary());
    for (const key of USER_DATA_KEYS) assert.equal(store.keysStartingWith(`${key}-invalid-`).length, 1);
  });

  test('unusable lifecycle state is recreated without alarming the user', async () => {
    const store = new MemoryStore({ ...LEGACY, [STORAGE_KEYS.appState]: '{oops', [STORAGE_KEYS.schema]: { version: 2 } });
    const result = await load(store);
    assert.equal(result.error, null);
    assert.equal(result.appState?.firstLaunchSource, 'recreated');
    assert.equal(sanitizeAppState({ firstLaunchAt: 'yesterday' }), null);
    assert.deepEqual(sanitizeAppState({ firstLaunchAt: NOW.toISOString(), experiments: { offer: { variant: 'b' } } })?.experiments, {});
  });

  test('if storage cannot be read, nothing is written or deleted', async () => {
    const store = new MemoryStore(LEGACY);
    const before = store.snapshot();
    store.failReads = true;
    const result = await load(store);
    assert.equal(result.error, READ_ERROR_MESSAGE);
    assert.equal(result.canSave, false);
    assert.equal(result.appState, null);
    store.failReads = false;
    assert.deepEqual(store.snapshot(), before);
  });
});

describe('reset', () => {
  test('resets user data and its copies, but keeps lifecycle state and other apps’ keys', async () => {
    const store = new MemoryStore({
      ...LEGACY,
      [STORAGE_KEYS.skips]: [{ id: 's1', timestamp: NOW.toISOString() }],
      [`${STORAGE_KEYS.skips}-invalid-5`]: '{}',
      [`${STORAGE_KEYS.logs}-corrupt-1`]: 'x',
      [`${STORAGE_KEYS.settings}-invalid-2`]: '{}',
      [`${STORAGE_KEYS.savings}-premigration-3`]: '{}',
      [STORAGE_KEYS.plan]: { ...defaultPlan(), homeInvite: { dismissedAt: NOW.toISOString() } },
      [`${STORAGE_KEYS.plan}-invalid-4`]: '{}',
      '@other-library/cache': 'keep',
    });
    const before = await load(store);

    const reset = resetValues('USD');
    await store.multiSet([
      [STORAGE_KEYS.logs, JSON.stringify(reset.logs)],
      [STORAGE_KEYS.settings, JSON.stringify(reset.settings)],
      [STORAGE_KEYS.savings, JSON.stringify(reset.savings)],
      [STORAGE_KEYS.game, JSON.stringify(reset.gameStats)],
      [STORAGE_KEYS.plan, JSON.stringify(reset.plan)],
      [STORAGE_KEYS.pepRallies, JSON.stringify(defaultPepLibrary())],
      [STORAGE_KEYS.skips, JSON.stringify(reset.skips)],
      [STORAGE_KEYS.skipMilestones, JSON.stringify(reset.skipMilestones)],
    ]);
    await removeSetAsideCopies(store, RESET_KEYS);

    assert.deepEqual(
      [...store.data.keys()].sort(),
      [...USER_DATA_KEYS, ...KEPT_ON_RESET, '@other-library/cache'].sort(),
    );
    const after = await load(store, { now: LATER });
    assert.deepEqual(after.logs, []);
    assert.deepEqual(after.skips, []);
    assert.deepEqual(after.settings, DEFAULT_SETTINGS);
    assert.deepEqual(after.savings, defaultSavings('USD'));
    assert.deepEqual(after.gameStats, { roundsCompleted: 0, bestScore: 0 });
    assert.deepEqual(after.plan, defaultPlan());
    assert.deepEqual(after.appState, before.appState);
  });

  test('recording deletion only targets files Puphii listed, inside its own folder', () => {
    const directory = 'file:///data/Documents/recordings/';
    const plan = planRecordingDeletion(directory, [
      { id: '1', fileName: 'voice-1.m4a' },
      { id: '1b', fileName: 'voice-1.m4a' },
      { id: '2', fileName: '../Documents.m4a' },
      { id: '3', fileName: 'nested/voice.m4a' },
      { id: '4', fileName: '.hidden.m4a' },
      { id: '5', fileName: 'notes.txt' },
      { id: '6', fileName: '' },
      { id: '7', fileName: 'voice..m4a' },
    ]);
    assert.deepEqual(plan.uris, [`${directory}voice-1.m4a`]);
    assert.deepEqual(plan.skipped.map((entry) => entry.id), ['2', '3', '4', '5', '6', '7']);

    for (const bad of ['', '/data/recordings/', 'file:///data/recordings', 'file:///data/../recordings/', 'https://x/']) {
      assert.deepEqual(planRecordingDeletion(bad, [{ id: '1', fileName: 'voice-1.m4a' }]).uris, [], bad);
    }
  });

  test('recording deletion removes files one by one and reports failures', async () => {
    const directory = 'file:///data/Documents/recordings/';
    const touched: string[] = [];
    const result = await deleteRecordingFiles(
      directory,
      [
        { id: '1', fileName: 'a.m4a' },
        { id: '2', fileName: 'b.m4a' },
        { id: '3', fileName: '../escape.m4a' },
      ],
      async (uri) => {
        touched.push(uri);
        if (uri.endsWith('b.m4a')) throw new Error('busy');
      },
    );
    assert.deepEqual(touched, [`${directory}a.m4a`, `${directory}b.m4a`]);
    assert.ok(!touched.includes(directory));
    assert.deepEqual(result.deleted, [`${directory}a.m4a`]);
    assert.deepEqual(result.failed, [`${directory}b.m4a`]);
    assert.deepEqual(result.skipped.map((entry) => entry.id), ['3']);
  });
});
