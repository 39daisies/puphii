import {
  addMilestones,
  clearPlanHistory,
  endPlan,
  markMilestonesSeen,
  PlanError,
  PlanResult,
  PlanRevision,
  PlanSettings,
  pausePlan,
  restartPlan,
  resumePlan,
  revisePlan,
  setConfirmedZeroDay,
  startPlan,
} from '../plan/actions';
import { DayKey, todayKey } from '../plan/days';
import { createPlanEventBus, detectPlanEvents, PlanEvent, PlanEventListener, PlanSnapshot, planSnapshot } from '../plan/events';
import { newMilestones } from '../plan/milestones';
import { defaultPlan, MilestoneId, PlanRecord } from '../plan/model';
import { PuffLog } from './types';

export type PlanActionResult = { ok: true; plan: PlanRecord } | { ok: false; error: PlanError };

export type PlanControllerOptions = {
  /** The latest logs, read at the moment of each change. */
  logs: () => readonly PuffLog[];
  /** Queues the plan for saving. Must keep only the newest value, like `createWriteQueue`. */
  save: (plan: PlanRecord) => void;
  /** Shows the new plan in the UI. */
  publish: (plan: PlanRecord) => void;
  now?: () => Date;
  /** Runs event delivery after the change that caused it, so listeners never hold up logging or its render. */
  deliver?: (task: () => void) => void;
};

export type PlanActions = {
  start(settings: PlanSettings): PlanActionResult;
  revise(revision: PlanRevision): PlanActionResult;
  restart(revision?: Partial<PlanSettings>): PlanActionResult;
  pause(): PlanActionResult;
  resume(): PlanActionResult;
  end(): PlanActionResult;
  confirmPuffFreeDay(day: DayKey, confirmed: boolean): PlanActionResult;
  /** Acknowledges the given milestones, or all of them, so no screen presents them as new again. */
  markMilestonesSeen(ids?: readonly MilestoneId[]): PlanActionResult;
  /** Records milestones and reports events after the day changes or the app returns to the foreground. */
  refresh(): void;
};

/**
 * Holds the plan between loading and saving. The plan here is the synchronous source of truth,
 * so rapid changes always build on the latest one, and every change is queued for saving in
 * order. Nothing can change the plan until saved data has loaded.
 */
export function createPlanController(options: PlanControllerOptions) {
  const now = options.now ?? (() => new Date());
  const deliver = options.deliver ?? ((task: () => void) => setTimeout(task, 0));
  const bus = createPlanEventBus();
  let plan = defaultPlan();
  let ready = false;
  let reported: PlanSnapshot | null = null;

  function commit(next: PlanRecord) {
    if (next === plan) return;
    plan = next;
    options.save(next);
    options.publish(next);
  }

  function emit(events: PlanEvent[]) {
    if (!events.length || !bus.size) return;
    deliver(() => bus.emit(events));
  }

  /** Records milestones the history now supports, then reports what changed since the last report. */
  function sync(at: Date) {
    const today = todayKey(at);
    const logs = options.logs();
    const fresh = newMilestones(plan, logs, today);
    if (fresh.length) commit(addMilestones(plan, fresh, at));
    const current = planSnapshot(plan, logs, today);
    const previous = reported;
    reported = current;
    if (previous) emit(detectPlanEvents(previous, current));
  }

  function run(change: (plan: PlanRecord, today: DayKey, at: Date) => PlanResult): PlanActionResult {
    if (!ready) return { ok: false, error: 'notReady' };
    const at = now();
    const result = change(plan, todayKey(at), at);
    if (!result.ok) return result;
    commit(result.plan);
    sync(at);
    return { ok: true, plan };
  }

  const actions: PlanActions = {
    start: (settings) => run((current, today, at) => startPlan(current, settings, today, at)),
    revise: (revision) => run((current, today, at) => revisePlan(current, revision, today, at)),
    restart: (revision = {}) => run((current, today, at) => restartPlan(current, revision, today, at)),
    pause: () => run(pausePlan),
    resume: () => run(resumePlan),
    end: () => run(endPlan),
    confirmPuffFreeDay: (day, confirmed) =>
      run((current, today, at) => setConfirmedZeroDay(current, options.logs(), day, confirmed, today, at)),
    markMilestonesSeen: (ids) => run((current, _today, at) => ({ ok: true, plan: markMilestonesSeen(current, at, ids) })),
    refresh: () => {
      if (ready) sync(now());
    },
  };

  return {
    actions,
    current: () => plan,
    isReady: () => ready,
    /** Takes the plan as loaded. Not saved again unless something changes it. */
    load(loaded: PlanRecord) {
      plan = loaded;
      ready = true;
      options.publish(loaded);
      const at = now();
      reported = planSnapshot(plan, options.logs(), todayKey(at));
      sync(at);
    },
    /** Call after logs change, so milestones and "above target" stay current. */
    logsChanged() {
      if (ready) sync(now());
    },
    /** "Clear puff history": keeps the plan's settings, drops milestones and confirmed puff-free days. */
    clearHistory() {
      if (!ready) return;
      const at = now();
      commit(clearPlanHistory(plan, at));
      sync(at);
    },
    /** "Reset everything": back to tracking only. Reported as no event; it isn't a plan decision. */
    reset() {
      if (!ready) return;
      const next = defaultPlan();
      plan = next;
      options.save(next);
      options.publish(next);
      reported = planSnapshot(plan, options.logs(), todayKey(now()));
    },
    /** Optional: nothing listens by default, and a failing listener never affects the plan or logging. */
    subscribe: (listener: PlanEventListener): (() => void) => bus.subscribe(listener),
  };
}

export type PlanController = ReturnType<typeof createPlanController>;
