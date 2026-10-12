import { PuffLog } from '../data/types';
import { activityIndex, ActivityIndex } from './activity';
import { addDays, DayKey } from './days';
import { PlanRecord } from './model';
import { activeSegment, isPausedOn, openPause, scheduledTarget, segmentForDay } from './schedule';

/**
 * How a day relates to its target. Only finished days are judged; an untracked finished day
 * (no logs, no confirmation) is neither within nor above target: its total is unknown.
 */
export type DayStatus = 'outsidePlan' | 'paused' | 'future' | 'today' | 'untracked' | 'withinTarget' | 'aboveTarget';

export type PlanDay = {
  day: DayKey;
  count: number;
  /** Null outside a plan and on paused days. */
  target: number | null;
  status: DayStatus;
  confirmedZero: boolean;
};

export function planDay(plan: PlanRecord, activity: ActivityIndex, day: DayKey, today: DayKey): PlanDay {
  const { count, confirmedZero, tracked } = activity(day);
  const segment = segmentForDay(plan, day);
  const base = { day, count, confirmedZero };
  if (day > today) return { ...base, target: segment && !isPausedOn(plan.pauses, day) ? scheduledTarget(segment, plan.pauses, day) : null, status: 'future' };
  if (!segment) return { ...base, target: null, status: 'outsidePlan' };
  if (isPausedOn(plan.pauses, day)) return { ...base, target: null, status: 'paused' };
  const target = scheduledTarget(segment, plan.pauses, day);
  if (day === today) return { ...base, target, status: 'today' };
  if (!tracked) return { ...base, target, status: 'untracked' };
  return { ...base, target, status: count <= target ? 'withinTarget' : 'aboveTarget' };
}

export function planDays(plan: PlanRecord, logs: readonly PuffLog[], from: DayKey, days: number, today: DayKey): PlanDay[] {
  const activity = activityIndex(logs, plan.confirmedZeroDays);
  return Array.from({ length: days }, (_, index) => planDay(plan, activity, addDays(from, index), today));
}

export type WeekSummary = {
  /** Finished plan days in the range, paused days excluded. */
  finishedDays: number;
  trackedDays: number;
  withinTargetDays: number;
  aboveTargetDays: number;
  untrackedDays: number;
  /** Average logged per tracked finished day; null with none. */
  averageLogged: number | null;
  /** Average target over the same days; null with none. */
  averageTarget: number | null;
};

export function summarizeDays(days: readonly PlanDay[]): WeekSummary {
  const finished = days.filter((d) => d.status === 'withinTarget' || d.status === 'aboveTarget' || d.status === 'untracked');
  const tracked = finished.filter((d) => d.status !== 'untracked');
  const average = (values: number[]) => (values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null);
  return {
    finishedDays: finished.length,
    trackedDays: tracked.length,
    withinTargetDays: tracked.filter((d) => d.status === 'withinTarget').length,
    aboveTargetDays: tracked.filter((d) => d.status === 'aboveTarget').length,
    untrackedDays: finished.length - tracked.length,
    averageLogged: average(tracked.map((d) => d.count)),
    averageTarget: average(tracked.map((d) => d.target!)),
  };
}

/**
 * Today, for Home. States describe what has been logged against the target and never suggest
 * logging more: `noLogsYet` is not "within target", and there is no "remaining" amount.
 */
export type TodayProgress =
  | { kind: 'noPlan' }
  | { kind: 'paused'; count: number }
  | {
      kind: 'active';
      count: number;
      target: number;
      state: 'noLogsYet' | 'confirmedZero' | 'withinTarget' | 'aboveTarget';
      /** Puffs logged above the target; 0 otherwise. */
      above: number;
      /** Today's target is the plan's settle level (0 when working toward quitting). */
      atSettleLevel: boolean;
      goal: 'reduce' | 'quit';
    };

export function todayProgress(plan: PlanRecord, logs: readonly PuffLog[], today: DayKey): TodayProgress {
  const segment = activeSegment(plan);
  if (!segment) return { kind: 'noPlan' };
  const activity = activityIndex(logs, plan.confirmedZeroDays)(today);
  if (openPause(plan) || isPausedOn(plan.pauses, today)) return { kind: 'paused', count: activity.count };
  const target = scheduledTarget(segment, plan.pauses, today);
  const state = activity.count > target ? 'aboveTarget' : activity.count > 0 ? 'withinTarget' : activity.confirmedZero ? 'confirmedZero' : 'noLogsYet';
  return {
    kind: 'active',
    count: activity.count,
    target,
    state,
    above: Math.max(0, activity.count - target),
    atSettleLevel: target === segment.settleAt,
    goal: segment.goal,
  };
}
