import { DayKey, daysBetween } from './days';
import { PlanPause, PlanRecord, PlanSegment } from './model';

/** The current plan segment, or null when only tracking. */
export function activeSegment(plan: PlanRecord): PlanSegment | null {
  const last = plan.segments[plan.segments.length - 1];
  return plan.goal !== 'track' && last && last.endedOn === null ? last : null;
}

/** The segment whose settings applied on `day`, if any. */
export function segmentForDay(plan: PlanRecord, day: DayKey): PlanSegment | null {
  for (let index = plan.segments.length - 1; index >= 0; index -= 1) {
    const segment = plan.segments[index];
    if (segment.startedOn <= day && (segment.endedOn === null || day < segment.endedOn)) return segment;
  }
  return null;
}

export const openPause = (plan: PlanRecord): PlanPause | null => {
  const last = plan.pauses[plan.pauses.length - 1];
  return last && last.to === null ? last : null;
};

export const isPausedOn = (pauses: readonly PlanPause[], day: DayKey): boolean =>
  pauses.some((pause) => pause.from <= day && (pause.to === null || day < pause.to));

/** Paused days in [from, to). */
export function pausedDaysBetween(pauses: readonly PlanPause[], from: DayKey, to: DayKey): number {
  let total = 0;
  for (const pause of pauses) {
    const start = pause.from > from ? pause.from : from;
    const end = pause.to === null || pause.to > to ? to : pause.to;
    if (end > start) total += daysBetween(start, end);
  }
  return total;
}

/** Days the segment was active before `day`, so pausing freezes the schedule instead of skipping ahead. */
export function activeDaysBefore(segment: PlanSegment, pauses: readonly PlanPause[], day: DayKey): number {
  if (day <= segment.startedOn) return 0;
  return daysBetween(segment.startedOn, day) - pausedDaysBetween(pauses, segment.startedOn, day);
}

/**
 * Week of the plan `day` falls in, counted from 0 (the number of full active weeks before it).
 * The target changes once per active week. Show it to people with `weekNumber`.
 */
export const planWeek = (segment: PlanSegment, pauses: readonly PlanPause[], day: DayKey): number =>
  Math.floor(activeDaysBefore(segment, pauses, day) / 7);

/** The week number people see: plan week 0 is "Week 1". */
export const weekNumber = (week: number): number => week + 1;

/** Puffs the daily target drops by each week: a share of the original baseline. */
export const weeklyStep = (segment: Pick<PlanSegment, 'baselinePerDay' | 'pace'>): number =>
  (segment.baselinePerDay * segment.pace.percent) / 100;

/**
 * Target for a given plan week: the start target less one step per week, rounded up to a whole
 * puff and never below the settle level. Rounding up keeps each change gentle.
 */
export function targetForWeek(segment: Pick<PlanSegment, 'baselinePerDay' | 'pace' | 'startTarget' | 'settleAt'>, week: number): number {
  const exact = Number((segment.startTarget - weeklyStep(segment) * Math.max(0, week)).toFixed(6));
  return Math.max(segment.settleAt, Math.ceil(exact), 0);
}

/** What the target was (or would be) on `day` under `segment`, ignoring whether that day was paused. */
export const scheduledTarget = (segment: PlanSegment, pauses: readonly PlanPause[], day: DayKey): number =>
  targetForWeek(segment, planWeek(segment, pauses, day));

/** The daily target on `day`. Null outside a plan and on paused days. */
export function targetForDay(plan: PlanRecord, day: DayKey): number | null {
  const segment = segmentForDay(plan, day);
  if (!segment || isPausedOn(plan.pauses, day)) return null;
  return scheduledTarget(segment, plan.pauses, day);
}

/** Targets for plan weeks 0…`weeks` - 1 (Week 1 onwards), for previews. */
export const projectTargets = (segment: Pick<PlanSegment, 'baselinePerDay' | 'pace' | 'startTarget' | 'settleAt'>, weeks: number): number[] =>
  Array.from({ length: weeks }, (_, week) => targetForWeek(segment, week));

/**
 * First plan week (from 0) whose target is the settle level, if the pace ever gets there. This
 * is also the number of full weeks before that happens: 10 means "after 10 weeks", in Week 11.
 */
export function weekReachingSettle(segment: Pick<PlanSegment, 'baselinePerDay' | 'pace' | 'startTarget' | 'settleAt'>): number | null {
  const step = weeklyStep(segment);
  if (step <= 0) return segment.startTarget <= segment.settleAt ? 0 : null;
  // Smallest week with ceil(start - step·week) <= settle, i.e. start - step·week <= settle.
  const week = Math.max(0, Math.ceil(Number(((segment.startTarget - segment.settleAt) / step).toFixed(6))));
  return targetForWeek(segment, week) <= segment.settleAt ? week : week + 1;
}
