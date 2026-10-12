import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { CORRUPT_DATA_MESSAGE } from '../src/data/persistence';
import { createPlanController } from '../src/data/planController';
import { RESET_KEYS } from '../src/data/reset';
import { STORAGE_KEYS, USER_DATA_KEYS } from '../src/data/storageKeys';
import { paceFor } from '../src/plan/actions';
import { DayKey } from '../src/plan/days';
import { PlanEvent } from '../src/plan/events';
import { defaultPlan, PlanRecord } from '../src/plan/model';
import { todayProgress } from '../src/plan/progress';
import { targetForDay } from '../src/plan/schedule';
import { segment } from './plan/fixtures';
import { app, at, EXISTING, MemoryStore, REDUCE, restart } from './plan/storeHarness';

describe('plan storage: first launch', () => {
  test('a fresh install starts in Track Only and writes no plan', async () => {
    const store = new MemoryStore();
    const phone = app(store);
    const result = await phone.launch();
    await phone.flush();
    assert.deepEqual(result.plan, defaultPlan());
    assert.equal(phone.controller.current().goal, 'track');
    assert.equal(store.data.has(STORAGE_KEYS.plan), false);
    assert.equal(result.error, null);
  });

  test('an install from before plans keeps every record and starts in Track Only', async () => {
    const store = new MemoryStore(EXISTING);
    const before = new Map(store.data);
    const phone = app(store);
    const result = await phone.launch();
    await phone.flush();
    assert.equal(result.plan.goal, 'track');
    assert.deepEqual(new Map(store.data), before, 'nothing was written or set aside');
    assert.equal(result.logs.length, 18);
  });

  test('nothing changes the plan before saved data has loaded', async () => {
    const store = new MemoryStore();
    const phone = app(store);
    assert.deepEqual(phone.actions.start(REDUCE), { ok: false, error: 'notReady' });
    assert.deepEqual(phone.actions.markMilestonesSeen(), { ok: false, error: 'notReady' });
    phone.controller.clearHistory();
    phone.controller.reset();
    await phone.flush();
    assert.equal(store.data.has(STORAGE_KEYS.plan), false);
  });
});

describe('plan storage: saving and restoring', () => {
  test('a started plan is saved and restored exactly after a restart', async () => {
    const store = new MemoryStore(EXISTING);
    const phone = app(store);
    await phone.launch();
    const started = phone.actions.start(REDUCE);
    assert.ok(started.ok);
    assert.equal(phone.published, started.plan, 'the UI sees the new plan at once');
    await phone.flush();
    assert.deepEqual(store.json(STORAGE_KEYS.plan), started.plan);

    const { next, result } = await restart(store, '2026-10-09');
    assert.deepEqual(result.plan, started.plan);
    assert.equal(result.error, null);
    assert.equal(store.keysStartingWith(`${STORAGE_KEYS.plan}-`).length, 0, 'a saved plan reloads without corrections');
    assert.equal(targetForDay(next.controller.current(), '2026-10-09'), 18);
    next.log('2026-10-09', 9);
    assert.deepEqual(todayProgress(next.controller.current(), next.logs, '2026-10-09'), {
      kind: 'active',
      count: 9,
      target: 18,
      state: 'withinTarget',
      above: 0,
      atSettleLevel: false,
      goal: 'reduce',
    });
  });

  test('revising, pausing, resuming, restarting and ending each survive a restart', async () => {
    const store = new MemoryStore();
    let phone = app(store);
    await phone.launch();
    assert.ok(phone.actions.start(REDUCE).ok);
    await phone.flush();

    const steps: [DayKey, (a: typeof phone.actions) => { ok: boolean }, (plan: PlanRecord) => void][] = [
      ['2026-10-15', (a) => a.revise({ pace: paceFor('gentle') }), (p) => assert.deepEqual(p.segments.map((s) => [s.startedOn, s.endedOn, s.startTarget]), [['2026-10-01', '2026-10-15', 20], ['2026-10-15', null, 16]])],
      ['2026-10-20', (a) => a.pause(), (p) => assert.deepEqual(p.pauses, [{ from: '2026-10-20', to: null }])],
      ['2026-10-23', (a) => a.resume(), (p) => assert.deepEqual(p.pauses, [{ from: '2026-10-20', to: '2026-10-23' }])],
      ['2026-10-30', (a) => a.restart(), (p) => assert.deepEqual([p.segments.length, p.segments[2].startTarget, p.segments[2].reason], [3, 20, 'restart'])],
      ['2026-11-05', (a) => a.end(), (p) => assert.deepEqual([p.goal, p.segments.length, p.segments[2].endedOn], ['track', 3, '2026-11-05'])],
    ];
    for (const [day, change, check] of steps) {
      ({ next: phone } = await restart(store, day));
      assert.equal(change(phone.actions).ok, true, day);
      await phone.flush();
      const { result } = await restart(store, day);
      check(result.plan);
      assert.deepEqual(result.plan, phone.controller.current(), `${day}: what was saved is what reloads`);
    }
    const { result } = await restart(store, '2026-11-06');
    assert.equal(targetForDay(result.plan, '2026-10-14'), 18, 'past days keep the targets they had');
    assert.equal(targetForDay(result.plan, '2026-11-06'), null, 'no target after the plan ended');
  });

  test('confirming a puff-free day is saved, and refused for days with logs or in the future', async () => {
    const store = new MemoryStore();
    const phone = app(store, { now: at('2026-10-05') });
    await phone.launch();
    phone.actions.start(REDUCE);
    phone.log('2026-10-04', 3);
    assert.deepEqual(phone.actions.confirmPuffFreeDay('2026-10-04', true), { ok: false, error: 'dayHasLogs' });
    assert.deepEqual(phone.actions.confirmPuffFreeDay('2026-10-06', true), { ok: false, error: 'futureDay' });
    assert.equal(phone.actions.confirmPuffFreeDay('2026-10-05', true).ok, true);
    await phone.flush();
    let { result } = await restart(store, '2026-10-05');
    assert.deepEqual(result.plan.confirmedZeroDays, ['2026-10-05']);

    const { next } = await restart(store, '2026-10-05');
    assert.equal(next.actions.confirmPuffFreeDay('2026-10-05', false).ok, true);
    await next.flush();
    ({ result } = await restart(store, '2026-10-05'));
    assert.deepEqual(result.plan.confirmedZeroDays, []);
  });

  test('milestones are recorded once a day is finished, and kept after a restart', async () => {
    const store = new MemoryStore();
    const phone = app(store);
    await phone.launch();
    phone.actions.start(REDUCE);
    phone.log('2026-10-01', 12);
    assert.deepEqual(phone.controller.current().milestones, [], 'today is never judged');
    await phone.flush();

    const { next } = await restart(store, '2026-10-02');
    assert.deepEqual(next.controller.current().milestones, [{ id: 'firstDayWithinTarget', reachedOn: '2026-10-01', seenAt: null }]);
    await next.flush();
    assert.deepEqual(store.json(STORAGE_KEYS.plan).milestones, next.controller.current().milestones);
    assert.equal(next.actions.markMilestonesSeen().ok, true);
    await next.flush();
    const { result } = await restart(store, '2026-10-03');
    assert.equal(result.plan.milestones[0].seenAt, at('2026-10-02').toISOString());
  });
});

describe('plan storage: damaged data', () => {
  test('unreadable plan data is set aside, Track Only is used, and nothing else is affected', async () => {
    const store = new MemoryStore({ ...EXISTING, [STORAGE_KEYS.plan]: '{"version":1,"goal":"red' });
    const phone = app(store);
    const result = await phone.launch();
    await phone.flush();
    assert.equal(result.error, CORRUPT_DATA_MESSAGE);
    assert.deepEqual(result.plan, defaultPlan());
    assert.equal(result.logs.length, 18);
    assert.deepEqual(result.settings, EXISTING[STORAGE_KEYS.settings]);
    assert.deepEqual(result.gameStats, EXISTING[STORAGE_KEYS.game]);
    const [copy] = store.keysStartingWith(`${STORAGE_KEYS.plan}-corrupt-`);
    assert.equal(store.data.get(copy), '{"version":1,"goal":"red');
    assert.equal(store.data.get(STORAGE_KEYS.plan), '{"version":1,"goal":"red', 'not overwritten just by opening the app');
    for (const key of [STORAGE_KEYS.logs, STORAGE_KEYS.settings, STORAGE_KEYS.savings, STORAGE_KEYS.game]) {
      assert.equal(store.keysStartingWith(`${key}-`).length, 0, `${key} untouched`);
    }

    assert.ok(phone.actions.start(REDUCE).ok);
    await phone.flush();
    const { result: reloaded } = await restart(store, '2026-10-02');
    assert.equal(reloaded.error, null);
    assert.equal(reloaded.plan.goal, 'reduce');
    assert.equal(store.keysStartingWith(`${STORAGE_KEYS.plan}-corrupt-`).length, 1, 'the backup is kept');
  });

  test('invalid parts of a plan are dropped with a backup; valid parts and unknown fields are kept', async () => {
    const stored = {
      version: 1,
      goal: 'reduce',
      segments: [segment({ startedOn: '2026-10-01' }), { goal: 'reduce', startedOn: 'someday' }],
      pauses: [{ from: '2026-10-03', to: '2026-10-02' }],
      confirmedZeroDays: ['2026-10-02', 'not-a-day'],
      milestones: [{ id: 'unknownMilestone', reachedOn: '2026-10-02' }],
      homeInvite: { dismissedAt: '2026-10-01T11:00:00.000Z' },
      updatedAt: '2026-10-01T12:00:00.000Z',
      voiceRallies: { enabled: false },
    };
    const store = new MemoryStore({ ...EXISTING, [STORAGE_KEYS.plan]: stored });
    const phone = app(store, { now: at('2026-10-02') });
    const result = await phone.launch();
    assert.equal(result.error, null);
    assert.equal(result.plan.goal, 'reduce');
    assert.equal(result.plan.segments.length, 1);
    assert.deepEqual([result.plan.pauses, result.plan.confirmedZeroDays, result.plan.milestones], [[], ['2026-10-02'], []]);
    assert.deepEqual((result.plan as unknown as { voiceRallies: unknown }).voiceRallies, { enabled: false });
    const [copy] = store.keysStartingWith(`${STORAGE_KEYS.plan}-invalid-`);
    assert.deepEqual(store.json(copy), stored);

    phone.actions.pause();
    await phone.flush();
    assert.deepEqual(store.json(STORAGE_KEYS.plan).voiceRallies, { enabled: false }, 'fields from other versions survive saving');
    assert.deepEqual(store.json(STORAGE_KEYS.plan).homeInvite, stored.homeInvite, 'so does the Home invite flag older versions saved');
  });

  test('a plan of the wrong type falls back to Track Only', async () => {
    for (const raw of ['"reduce"', '42', '[]', 'null']) {
      const store = new MemoryStore({ [STORAGE_KEYS.plan]: raw });
      const result = await app(store).launch();
      assert.deepEqual(result.plan, defaultPlan(), raw);
    }
  });

  test('if storage cannot be read, plan changes are kept in memory but never written', async () => {
    const store = new MemoryStore(EXISTING);
    store.failReads = true;
    const phone = app(store);
    const result = await phone.launch();
    assert.equal(result.canSave, false);
    store.failReads = false;
    assert.ok(phone.actions.start(REDUCE).ok);
    await phone.flush();
    assert.equal(store.data.has(STORAGE_KEYS.plan), false);
  });
});

describe('plan storage: clearing and resetting', () => {
  async function busyPhone() {
    const store = new MemoryStore({ ...EXISTING, [`${STORAGE_KEYS.plan}-corrupt-1`]: '{', [`${STORAGE_KEYS.logs}-corrupt-2`]: '[' });
    const phone = app(store, { now: at('2026-10-01') });
    await phone.launch();
    phone.actions.start(REDUCE);
    phone.log('2026-10-01', 12);
    phone.clock.now = at('2026-10-03');
    phone.actions.confirmPuffFreeDay('2026-10-02', true);
    assert.deepEqual(phone.controller.current().milestones.map((m) => m.id), ['firstDayWithinTarget', 'settleLevelReached', 'firstConfirmedPuffFreeDay']);
    await phone.flush();
    return { store, phone };
  }

  test('Clear puff history keeps the plan settings but clears milestones and confirmed puff-free days', async () => {
    const { store, phone } = await busyPhone();
    const before = phone.controller.current();
    await phone.clearLogs();
    await phone.flush();
    const { result } = await restart(store, '2026-10-03');
    assert.deepEqual(result.logs, []);
    assert.deepEqual(result.plan.segments, before.segments);
    assert.equal(result.plan.goal, 'reduce');
    assert.deepEqual([result.plan.milestones, result.plan.confirmedZeroDays], [[], []]);
    assert.deepEqual(result.settings, EXISTING[STORAGE_KEYS.settings]);
    assert.deepEqual(result.gameStats, EXISTING[STORAGE_KEYS.game]);
    assert.equal(store.keysStartingWith(`${STORAGE_KEYS.logs}-corrupt-`).length, 0);
  });

  test('Clear puff history writes no plan for someone who never used one', async () => {
    const store = new MemoryStore(EXISTING);
    const phone = app(store);
    await phone.launch();
    await phone.clearLogs();
    await phone.flush();
    assert.equal(store.data.has(STORAGE_KEYS.plan), false);
  });

  test('Reset everything returns the plan to Track Only and deletes its backups, keeping lifecycle state', async () => {
    const { store, phone } = await busyPhone();
    await phone.resetAll();
    assert.deepEqual(store.json(STORAGE_KEYS.plan), defaultPlan());
    assert.equal(store.keysStartingWith(`${STORAGE_KEYS.plan}-`).length, 0);
    assert.deepEqual(store.json(STORAGE_KEYS.appState), EXISTING[STORAGE_KEYS.appState]);
    const { result } = await restart(store, '2026-10-04');
    assert.deepEqual(result.plan, defaultPlan());
    assert.deepEqual(result.logs, []);
    assert.ok(RESET_KEYS.includes(STORAGE_KEYS.plan));
    assert.ok(USER_DATA_KEYS.includes(STORAGE_KEYS.plan));
  });
});

describe('plan storage: ordering and isolation', () => {
  test('rapid plan changes all apply, in order, and the newest one is what is stored', async () => {
    const store = new MemoryStore();
    let delay = 30;
    store.writeDelay = () => (delay = Math.max(1, delay - 7));
    const phone = app(store, { now: at('2026-10-05') });
    await phone.launch();
    const results = [
      phone.actions.start(REDUCE),
      phone.actions.pause(),
      phone.actions.resume(),
      phone.actions.revise({ settleAt: 12 }),
      phone.actions.revise({ pace: paceFor('custom', 7) }),
      phone.actions.confirmPuffFreeDay('2026-10-05', true),
      phone.actions.pause(),
    ];
    assert.ok(results.every((result) => result.ok));
    const latest = phone.controller.current();
    assert.deepEqual(latest.segments.map((s) => [s.startedOn, s.pace.percent, s.settleAt, s.reason]), [['2026-10-05', 7, 12, 'start']]);
    assert.deepEqual(latest.pauses, [{ from: '2026-10-05', to: null }]);
    assert.deepEqual(latest.confirmedZeroDays, ['2026-10-05']);
    await phone.flush();
    assert.deepEqual(store.json(STORAGE_KEYS.plan), latest);
    assert.ok(store.writes.filter((key) => key === STORAGE_KEYS.plan).length < results.length, 'superseded snapshots are skipped, not written late');
    const { result } = await restart(store, '2026-10-05');
    assert.deepEqual(result.plan, latest);
  });

  test('logging puffs and changing the plan at the same time never overwrite each other', async () => {
    const store = new MemoryStore();
    store.writeDelay = (key) => (key === STORAGE_KEYS.logs ? 15 : 2);
    const phone = app(store, { now: at('2026-10-05') });
    await phone.launch();
    phone.log('2026-10-05', 1);
    phone.actions.start(REDUCE);
    phone.log('2026-10-05', 1);
    phone.actions.pause();
    phone.log('2026-10-05', 1);
    phone.undo();
    await phone.flush();
    const { result } = await restart(store, '2026-10-05');
    assert.equal(result.logs.length, 2);
    assert.equal(result.plan.goal, 'reduce');
    assert.deepEqual(result.plan.pauses, [{ from: '2026-10-05', to: null }]);
  });

  test('plan changes never write to logs, settings, savings, Bubble Break or lifecycle records', async () => {
    const store = new MemoryStore(EXISTING);
    const phone = app(store, { now: at('2026-10-05') });
    await phone.launch();
    const before = new Map(store.data);
    phone.actions.start(REDUCE);
    phone.actions.revise({ pace: paceFor('faster') });
    phone.actions.pause();
    phone.actions.end();
    await phone.flush();
    assert.deepEqual(new Set(store.writes), new Set([STORAGE_KEYS.plan]));
    for (const [key, value] of before) assert.equal(store.data.get(key), value, key);
  });

  test('failing listeners never affect the plan, saving or other listeners', async () => {
    const store = new MemoryStore();
    const phone = app(store, { now: at('2026-10-05') });
    phone.controller.subscribe(() => {
      throw new Error('a broken optional feature');
    });
    await phone.launch();
    assert.ok(phone.actions.start(REDUCE).ok);
    phone.log('2026-10-05', 21);
    assert.ok(phone.actions.pause().ok);
    await phone.flush();
    assert.deepEqual(phone.events, [
      { type: 'planStarted', goal: 'reduce', target: 20 },
      { type: 'dailyTargetCrossed', target: 20 },
      { type: 'planPaused' },
    ]);
    assert.deepEqual(store.json(STORAGE_KEYS.plan), phone.controller.current());
    assert.deepEqual(phone.errors, []);
  });

  test('events are delivered after the change returns, and only to current listeners', async () => {
    const delivered: PlanEvent[] = [];
    let plan: PlanRecord | null = null;
    const controller = createPlanController({ logs: () => [], save: () => undefined, publish: (next) => (plan = next), now: () => at('2026-10-05') });
    assert.doesNotThrow(() => controller.load(defaultPlan()));
    const unsubscribe = controller.subscribe((event) => delivered.push(event));
    const result = controller.actions.start(REDUCE);
    assert.ok(result.ok);
    assert.equal(plan, result.plan);
    assert.deepEqual(delivered, [], 'a listener never runs inside the change');
    await Promise.resolve();
    assert.deepEqual(delivered, [], 'nor in the same task, so it never delays the render that follows');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(delivered, [{ type: 'planStarted', goal: 'reduce', target: 20 }]);
    unsubscribe();
    controller.actions.pause();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(delivered.length, 1);
    assert.doesNotThrow(() => controller.actions.resume(), 'no listeners is fine');
  });
});

describe('store wiring', () => {
  const store = readFileSync(join(__dirname, '..', '..', 'src', 'data', 'PuphiiStore.tsx'), 'utf8');
  const body = (name: string) => {
    const header = `const ${name} = useCallback(`;
    const start = store.indexOf(header);
    assert.ok(start >= 0, name);
    const end = store.indexOf('useCallback(', start + header.length);
    return store.slice(start, end < 0 ? undefined : end);
  };

  test('the store saves the plan through its own queue and loads it before becoming ready', () => {
    assert.match(store, /plan: queue<PlanRecord>\(STORAGE_KEYS\.plan\)/);
    assert.match(store, /createPlanController\(\{ logs: \(\) => logsRef\.current, save: \(next\) => queues\.plan\.save\(next\), publish: setPlan \}\)/);
    const load = store.indexOf('planController.load(result.plan)');
    assert.ok(load > store.indexOf('logsRef.current = result.logs') && load > store.indexOf('canSaveRef.current = result.canSave'));
    assert.ok(load < store.indexOf('readyRef.current = true'));
  });

  test('every log change, Clear history and Reset everything reach the plan', () => {
    assert.match(body('commitLogs'), /queues\.logs\.save\(next\);\s+planController\.logsChanged\(\);/);
    assert.match(body('clearLogs'), /commitLogs\(\[\]\);\s+planController\.clearHistory\(\);\s+purgeBackups\(\[STORAGE_KEYS\.logs\]\)/);
    assert.match(body('resetAll'), /planController\.reset\(\);\s+purgeBackups\(\[\.\.\.RESET_KEYS\]\)/);
  });

  test('plan state and actions are exposed, and nothing about plans involves subscriptions', () => {
    assert.match(store, /plan,\s+planActions: planController\.actions,\s+subscribePlanEvents: planController\.subscribe,/);
    const controller = readFileSync(join(__dirname, '..', '..', 'src', 'data', 'planController.ts'), 'utf8');
    for (const text of [store, controller]) assert.ok(!/subscription|entitlement|ProGate|paywall/i.test(text.replace(/subscribe\w*/gi, '')));
  });
});
