import { KeyValueStore, loadFrom, removeSetAsideCopies } from '../../src/data/persistence';
import { createPlanController } from '../../src/data/planController';
import { RESET_KEYS, resetValues } from '../../src/data/reset';
import { defaultSavings } from '../../src/data/savings';
import { STORAGE_KEYS } from '../../src/data/storageKeys';
import { PuffLog } from '../../src/data/types';
import { createWriteQueue } from '../../src/data/writeQueue';
import { paceFor, PlanSettings } from '../../src/plan/actions';
import { DayKey } from '../../src/plan/days';
import { PlanEvent } from '../../src/plan/events';
import { PlanRecord } from '../../src/plan/model';
import { logsOn } from './fixtures';

/** Device storage in memory. Writes can be slowed down to expose ordering problems. */
export class MemoryStore implements KeyValueStore {
  readonly data = new Map<string, string>();
  writeDelay: (key: string) => number = () => 0;
  failReads = false;
  writes: string[] = [];

  constructor(initial: Record<string, unknown> = {}) {
    for (const [key, value] of Object.entries(initial)) this.data.set(key, typeof value === 'string' ? value : JSON.stringify(value));
  }
  async getItem(key: string) {
    if (this.failReads) throw new Error('storage unavailable');
    return this.data.get(key) ?? null;
  }
  async setItem(key: string, value: string) {
    const delay = this.writeDelay(key);
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    this.writes.push(key);
    this.data.set(key, value);
  }
  async multiSet(pairs: ReadonlyArray<readonly [string, string]>) {
    for (const [key, value] of pairs) await this.setItem(key, value);
  }
  async getAllKeys() {
    if (this.failReads) throw new Error('storage unavailable');
    return [...this.data.keys()];
  }
  async multiRemove(keys: readonly string[]) {
    for (const key of keys) this.data.delete(key);
  }
  json(key: string) {
    const raw = this.data.get(key);
    return raw == null ? undefined : JSON.parse(raw);
  }
  keysStartingWith(prefix: string) {
    return [...this.data.keys()].filter((key) => key.startsWith(prefix));
  }
}

/** Evening of a local calendar day. */
export const at = (day: DayKey, hour = 21) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0);
};

export const REDUCE: PlanSettings = { goal: 'reduce', baseline: { perDay: 20, source: 'estimate' }, pace: paceFor('steady'), settleAt: 10 };

/** Data an existing install already has, before plans existed. */
export const EXISTING = {
  [STORAGE_KEYS.logs]: logsOn('2026-09-30', 18),
  [STORAGE_KEYS.settings]: { mode: 'dramatic', soundEnabled: true, hapticsEnabled: false, remindersEnabled: true, reminderHour: 21, reminderMinute: 30 },
  [STORAGE_KEYS.savings]: { ...defaultSavings('JPY'), goalName: 'Trip to Okinawa', goalAmount: 80000 },
  [STORAGE_KEYS.game]: { roundsCompleted: 12, bestScore: 41 },
  [STORAGE_KEYS.appState]: { version: 1, firstLaunchAt: '2026-09-01T00:00:00.000Z', firstLaunchSource: 'existingInstall', onboardingCompletedAt: null, experiments: {} },
  [STORAGE_KEYS.schema]: { version: 2, updatedAt: '2026-09-01T00:00:00.000Z' },
};

/**
 * The app as PuphiiStore wires it: the loader, one newest-wins write queue per key, and the plan
 * controller reading the latest logs. Launching again on the same storage is an app restart.
 */
export function app(store: MemoryStore, clock = { now: at('2026-10-01') }) {
  let logs: PuffLog[] = [];
  let canSave = false;
  let published: PlanRecord | null = null;
  const errors: unknown[] = [];
  const events: PlanEvent[] = [];
  const queue = <T,>(key: string) =>
    createWriteQueue<T>((value) => (canSave ? store.setItem(key, JSON.stringify(value)) : Promise.resolve()), (error) => errors.push(error));
  const queues = { logs: queue<PuffLog[]>(STORAGE_KEYS.logs), plan: queue<PlanRecord>(STORAGE_KEYS.plan), other: queue<unknown>('unused') };
  const controller = createPlanController({
    logs: () => logs,
    save: (plan) => queues.plan.save(plan),
    publish: (plan) => (published = plan),
    now: () => clock.now,
    deliver: (task) => task(),
  });
  controller.subscribe((event) => events.push(event));

  const commitLogs = (next: PuffLog[]) => {
    logs = next;
    queues.logs.save(next);
    controller.logsChanged();
  };

  return {
    clock,
    controller,
    actions: controller.actions,
    events,
    errors,
    get logs() {
      return logs;
    },
    get published() {
      return published;
    },
    async launch() {
      const result = await loadFrom(store, { currency: 'USD', now: clock.now });
      logs = result.logs;
      canSave = result.canSave;
      controller.load(result.plan);
      return result;
    },
    log(day: DayKey, count: number) {
      commitLogs([...logs, ...logsOn(day, count)]);
    },
    undo() {
      commitLogs(logs.slice(0, -1));
    },
    clearLogs() {
      commitLogs([]);
      controller.clearHistory();
      return removeSetAsideCopies(store, [STORAGE_KEYS.logs]);
    },
    async resetAll() {
      const reset = resetValues('USD');
      commitLogs(reset.logs);
      await Promise.all(
        ([STORAGE_KEYS.settings, STORAGE_KEYS.savings, STORAGE_KEYS.game] as const).map((key, index) =>
          store.setItem(key, JSON.stringify([reset.settings, reset.savings, reset.gameStats][index])),
        ),
      );
      controller.reset();
      await this.flush();
      await removeSetAsideCopies(store, RESET_KEYS);
    },
    flush: () => Promise.all([queues.logs.flush(), queues.plan.flush()]),
  };
}

export async function restart(store: MemoryStore, day: DayKey) {
  const next = app(store, { now: at(day) });
  const result = await next.launch();
  return { next, result };
}
