import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  addLocalDays,
  countOnDay,
  createLog,
  dailySeries,
  groupLogsByDay,
  latestRecordedLog,
  localDayKey,
  msUntilNextLocalMidnight,
  removeLogById,
  sanitizeLogs,
  sanitizeSettings,
  weeklySeries,
} from '../src/data/puffLogic';
import { corruptBackupKey, corruptBackupKeysFor, STORAGE_KEYS } from '../src/data/storageKeys';
import { DEFAULT_SETTINGS, PuffLog } from '../src/data/types';
import { createWriteQueue } from '../src/data/writeQueue';

const at = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min);
const logAt = (date: Date, id = `id-${date.getTime()}-${Math.random()}`): PuffLog => ({ id, timestamp: date.toISOString() });

describe('local calendar days', () => {
  test('day key follows the device-local calendar, not UTC', () => {
    // 23:30 local is the same local day regardless of what UTC date it maps to.
    const lateEvening = at(2026, 10, 8, 23, 30);
    assert.equal(localDayKey(lateEvening), '2026-10-08');
    const justAfterMidnight = at(2026, 10, 9, 0, 5);
    assert.equal(localDayKey(justAfterMidnight), '2026-10-09');
  });

  test('daily count resets at local midnight while earlier days are preserved', () => {
    const logs = [
      logAt(at(2026, 10, 8, 9)),
      logAt(at(2026, 10, 8, 23, 59)),
      logAt(at(2026, 10, 9, 0, 1)),
    ];
    assert.equal(countOnDay(logs, at(2026, 10, 8)), 2);
    assert.equal(countOnDay(logs, at(2026, 10, 9)), 1);
    assert.equal(countOnDay(logs, at(2026, 10, 10)), 0);
    assert.equal(logs.length, 3);
  });

  test('addLocalDays steps exactly one calendar day across DST changes', () => {
    let day = at(2026, 3, 1);
    const keys: string[] = [];
    for (let i = 0; i < 40; i += 1) {
      keys.push(localDayKey(day));
      day = addLocalDays(day, 1);
    }
    assert.equal(new Set(keys).size, 40, 'no duplicated or skipped dates');
    assert.equal(keys[7], '2026-03-08');
    assert.equal(keys[31], '2026-04-01');
    assert.equal(localDayKey(addLocalDays(at(2026, 11, 2, 0, 30), -1)), '2026-11-01');
  });

  test('msUntilNextLocalMidnight', () => {
    assert.equal(msUntilNextLocalMidnight(at(2026, 10, 8, 23, 59)), 60_000);
  });
});

describe('series and grouping', () => {
  const today = at(2026, 10, 8, 15);
  const logs = [
    logAt(at(2026, 10, 2, 8)),
    logAt(at(2026, 10, 2, 9)),
    logAt(at(2026, 10, 7, 21)),
    logAt(at(2026, 10, 8, 9, 3)),
    logAt(at(2026, 10, 8, 12, 10)),
    logAt(at(2026, 10, 8, 15, 24)),
    logAt(at(2026, 9, 1, 10)),
  ];

  test('seven-day series is oldest-first and ends today', () => {
    const series = dailySeries(logs, today, 7);
    assert.deepEqual(
      series.map((d) => [d.key, d.count]),
      [
        ['2026-10-02', 2],
        ['2026-10-03', 0],
        ['2026-10-04', 0],
        ['2026-10-05', 0],
        ['2026-10-06', 0],
        ['2026-10-07', 1],
        ['2026-10-08', 3],
      ],
    );
  });

  test('weekly totals are rolling 7-day buckets ending today', () => {
    const weeks = weeklySeries(logs, today, 2);
    assert.deepEqual(weeks.map((w) => w.count), [0, 6]);
  });

  test('groups are newest day first with newest entries first', () => {
    const groups = groupLogsByDay(logs);
    assert.deepEqual(groups.map((g) => g.key), ['2026-10-08', '2026-10-07', '2026-10-02', '2026-09-01']);
    assert.deepEqual(
      groups[0].logs.map((l) => new Date(l.timestamp).getHours()),
      [15, 12, 9],
    );
  });
});

describe('logging and undo', () => {
  test('rapid logging creates one unique record per tap', () => {
    const now = new Date();
    let logs: PuffLog[] = [];
    for (let i = 0; i < 500; i += 1) logs = [...logs, createLog(now)];
    assert.equal(logs.length, 500);
    assert.equal(new Set(logs.map((l) => l.id)).size, 500);
    assert.equal(countOnDay(logs, now), 500);
  });

  test('undo removes exactly the most recently recorded log, even if the clock moved back', () => {
    const first = logAt(at(2026, 10, 8, 15), 'first');
    const second = logAt(at(2026, 10, 8, 14), 'second-after-clock-change');
    const logs = [first, second];
    const latest = latestRecordedLog(logs);
    assert.equal(latest?.id, 'second-after-clock-change');
    const after = logs.slice(0, -1);
    assert.deepEqual(after.map((l) => l.id), ['first']);
    assert.equal(latestRecordedLog([]), null);
  });

  test('deleting by id leaves the rest intact', () => {
    const logs = [logAt(at(2026, 10, 8), 'a'), logAt(at(2026, 10, 8), 'b'), logAt(at(2026, 10, 8), 'c')];
    assert.deepEqual(removeLogById(logs, 'b').map((l) => l.id), ['a', 'c']);
  });
});

describe('restoring persisted data', () => {
  test('sanitizeLogs keeps valid entries and drops corrupt or duplicate ones', () => {
    const raw = [
      { id: 'a', timestamp: '2026-10-08T06:00:00.000Z' },
      { id: 'a', timestamp: '2026-10-08T06:00:00.000Z' },
      { id: 'b', timestamp: 'not a date' },
      { id: 3, timestamp: '2026-10-08T06:00:00.000Z' },
      null,
      'junk',
      { id: 'c', timestamp: '2026-10-08T07:00:00.000Z', extra: true },
    ];
    assert.deepEqual(sanitizeLogs(raw).map((l) => l.id), ['a', 'c']);
    assert.deepEqual(sanitizeLogs({ not: 'an array' }), []);
  });

  test('sanitizeSettings fills defaults and rejects out-of-range values', () => {
    assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
    assert.deepEqual(sanitizeSettings({ mode: 'expressive' }), DEFAULT_SETTINGS);
    const restored = sanitizeSettings({ mode: 'dramatic', soundEnabled: true, reminderHour: 99, reminderMinute: 30 });
    assert.equal(restored.mode, 'dramatic');
    assert.equal(restored.soundEnabled, true);
    assert.equal(restored.reminderHour, DEFAULT_SETTINGS.reminderHour);
    assert.equal(restored.reminderMinute, 30);
    assert.equal(sanitizeSettings({ mode: 'chaotic' }).mode, DEFAULT_SETTINGS.mode);
  });

  test('a save/restore round trip reproduces the same history', () => {
    const logs = [createLog(at(2026, 10, 7, 22)), createLog(at(2026, 10, 8, 9))];
    const restored = sanitizeLogs(JSON.parse(JSON.stringify(logs)));
    assert.deepEqual(restored, logs);
  });
});

describe('write queue', () => {
  test('never writes concurrently and always persists the newest snapshot last', async () => {
    const writes: number[][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const queue = createWriteQueue<number[]>(
      async (value) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        writes.push(value);
        inFlight -= 1;
      },
      () => assert.fail('unexpected error'),
    );
    let state: number[] = [];
    for (let i = 1; i <= 50; i += 1) {
      state = [...state, i];
      queue.save(state);
    }
    await queue.flush();
    assert.equal(maxInFlight, 1);
    assert.deepEqual(writes[writes.length - 1], state);
    assert.ok(writes.length <= 2, `coalesced into ${writes.length} writes`);
  });

  test('reports failures and recovers on the next save', async () => {
    let fail = true;
    const errors: unknown[] = [];
    let successes = 0;
    const queue = createWriteQueue<string>(
      async () => {
        if (fail) throw new Error('disk full');
      },
      (error) => errors.push(error),
      () => (successes += 1),
    );
    queue.save('a');
    await queue.flush();
    fail = false;
    queue.save('b');
    await queue.flush();
    assert.equal(errors.length, 1);
    assert.equal(successes, 1);
  });
});

describe('data deletion', () => {
  const allKeys = [
    STORAGE_KEYS.logs,
    STORAGE_KEYS.settings,
    corruptBackupKey(STORAGE_KEYS.logs, 1),
    corruptBackupKey(STORAGE_KEYS.logs, 2),
    corruptBackupKey(STORAGE_KEYS.settings, 3),
    '@other-library/cache',
  ];

  test('clearing history finds every set-aside copy of the puff logs and nothing else', () => {
    assert.deepEqual(corruptBackupKeysFor(allKeys, [STORAGE_KEYS.logs]), [
      '@puphii/puff-logs-v1-corrupt-1',
      '@puphii/puff-logs-v1-corrupt-2',
    ]);
  });

  test('a full reset also finds set-aside settings, but never live keys or other libraries', () => {
    const doomed = corruptBackupKeysFor(allKeys, [STORAGE_KEYS.logs, STORAGE_KEYS.settings]);
    assert.equal(doomed.length, 3);
    assert.ok(!doomed.includes(STORAGE_KEYS.logs));
    assert.ok(!doomed.includes(STORAGE_KEYS.settings));
    assert.ok(!doomed.includes('@other-library/cache'));
  });
});
