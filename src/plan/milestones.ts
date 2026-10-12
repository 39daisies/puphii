import { PuffLog } from '../data/types';
import { activityIndex } from './activity';
import { addDays, DayKey } from './days';
import { MilestoneId, MilestoneRecord, PlanRecord } from './model';
import { planDay } from './progress';
import { planWeek, segmentForDay } from './schedule';

export const DAYS_WITHIN_TARGET_STEPS: readonly [number, MilestoneId][] = [
  [1, 'firstDayWithinTarget'],
  [3, 'daysWithinTarget3'],
  [7, 'daysWithinTarget7'],
  [14, 'daysWithinTarget14'],
  [30, 'daysWithinTarget30'],
];

export const WEEK_BELOW_BASELINE_STEPS: readonly [number, MilestoneId][] = [
  [10, 'weekBelowBaseline10'],
  [25, 'weekBelowBaseline25'],
  [50, 'weekBelowBaseline50'],
];

/** A plan week only counts toward weekly milestones with at least this many tracked days. */
export const MIN_TRACKED_DAYS_PER_WEEK = 4;

/**
 * Every milestone the history supports, each dated to the finished day it was first reached.
 * Rules, all judged on finished, unpaused plan days only:
 * - Days within target are counted in total, not in a row, so nothing resets. A day counts only
 *   when tracked: logs at or under the target, or a confirmed puff-free day. Untracked days count
 *   for nothing either way.
 * - A plan week (7 active days of one segment) counts once at least 4 of its days were tracked;
 *   its average is over tracked days only, compared with the segment's original baseline.
 * - The puff-free milestone needs an explicit confirmation; no logs alone is never enough.
 */
export function reachedMilestones(plan: PlanRecord, logs: readonly PuffLog[], today: DayKey): MilestoneRecord[] {
  const first = plan.segments[0];
  if (!first) return [];
  const activity = activityIndex(logs, plan.confirmedZeroDays);
  const reached = new Map<MilestoneId, DayKey>();
  const reach = (id: MilestoneId, day: DayKey) => {
    if (!reached.has(id)) reached.set(id, day);
  };
  const weeks = new Map<string, { activeDays: number; trackedDays: number; total: number }>();
  let withinTarget = 0;

  for (let day = first.startedOn; day < today; day = addDays(day, 1)) {
    const entry = planDay(plan, activity, day, today);
    if (entry.status !== 'withinTarget' && entry.status !== 'aboveTarget' && entry.status !== 'untracked') continue;
    const segment = segmentForDay(plan, day)!;
    const tracked = entry.status !== 'untracked';

    if (entry.status === 'withinTarget') {
      withinTarget += 1;
      for (const [count, id] of DAYS_WITHIN_TARGET_STEPS) if (withinTarget === count) reach(id, day);
    }
    if (tracked && segment.goal === 'reduce' && entry.count <= segment.settleAt) reach('settleLevelReached', day);
    if (entry.confirmedZero) reach('firstConfirmedPuffFreeDay', day);

    const key = `${plan.segments.indexOf(segment)}:${planWeek(segment, plan.pauses, day)}`;
    const week = weeks.get(key) ?? { activeDays: 0, trackedDays: 0, total: 0 };
    week.activeDays += 1;
    if (tracked) {
      week.trackedDays += 1;
      week.total += entry.count;
    }
    weeks.set(key, week);
    if (week.activeDays === 7 && week.trackedDays >= MIN_TRACKED_DAYS_PER_WEEK) {
      reach('firstPlanWeek', day);
      const average = week.total / week.trackedDays;
      for (const [percent, id] of WEEK_BELOW_BASELINE_STEPS) {
        if (average <= segment.baselinePerDay * (1 - percent / 100) + 1e-9) reach(id, day);
      }
    }
  }
  return [...reached].map(([id, reachedOn]) => ({ id, reachedOn, seenAt: null }));
}

/** Milestones reached but not yet recorded in the plan. Recorded ones are never revisited. */
export const newMilestones = (plan: PlanRecord, logs: readonly PuffLog[], today: DayKey): MilestoneRecord[] =>
  reachedMilestones(plan, logs, today).filter((milestone) => !plan.milestones.some((existing) => existing.id === milestone.id));
