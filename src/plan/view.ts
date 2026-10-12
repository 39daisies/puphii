/**
 * What the plan screens show, worked out from the plan and the logs. Pure, so every number and
 * label on screen can be tested without rendering.
 */

import { PuffLog } from '../data/types';
import { baselineFromHistory } from './baseline';
import { MILESTONE_COPY, PLAN_STATUS_LABEL } from './copy';
import { addDays, DayKey, dayIndex, daysBetween } from './days';
import { BaselineSource, MILESTONE_IDS, MilestoneId, Pace, PlanRecord, PlanSegment } from './model';
import { PlanDay, planDays, summarizeDays, TodayProgress, todayProgress, WeekSummary } from './progress';
import { activeDaysBefore, activeSegment, openPause, pausedDaysBetween, targetForWeek, weekNumber, weekReachingSettle } from './schedule';

type Schedule = Pick<PlanSegment, 'baselinePerDay' | 'pace' | 'startTarget' | 'settleAt'>;

/** Suggested settle level for a new reduction plan: half the starting target, rounded down. */
export const defaultSettleAt = (startTarget: number): number => Math.max(0, Math.floor(startTarget / 2));

/** A reduction plan settles below where it starts. */
export const settleLimits = (startTarget: number) => ({ min: 0, max: Math.max(0, startTarget - 1) });

export type PreviewRow = { week: number; target: number; settles: boolean };
export type SetupPreview = { startTarget: number; settleAt: number; settleWeek: number | null; rows: PreviewRow[] };

/** The first four plan weeks, then the week the target settles (if later). Weeks count from 0. */
export function setupPreview(input: { goal: 'reduce' | 'quit'; baselinePerDay: number; pace: Pace; settleAt: number }): SetupPreview {
  const startTarget = Math.ceil(input.baselinePerDay);
  const limits = settleLimits(startTarget);
  const settleAt = input.goal === 'quit' ? 0 : Math.min(limits.max, Math.max(limits.min, input.settleAt));
  const schedule: Schedule = { baselinePerDay: input.baselinePerDay, pace: input.pace, startTarget, settleAt };
  const settleWeek = weekReachingSettle(schedule);
  const weeks = [0, 1, 2, 3].filter((week) => settleWeek === null || week < settleWeek);
  if (settleWeek !== null) weeks.push(settleWeek);
  return { startTarget, settleAt, settleWeek, rows: weeks.map((week) => ({ week, target: targetForWeek(schedule, week), settles: week === settleWeek })) };
}

export type TargetChange = { day: DayKey; target: number };

/**
 * The next days the target drops under `schedule`, for a segment that has been active for
 * `activeBefore` days before `from`. Assumes no pause ahead; stops once the target settles.
 */
export function upcomingChanges(schedule: Schedule, activeBefore: number, from: DayKey, count: number): TargetChange[] {
  const week = Math.floor(activeBefore / 7);
  const firstBoundary = addDays(from, 7 - (activeBefore % 7));
  const changes: TargetChange[] = [];
  let previous = targetForWeek(schedule, week);
  for (let next = week + 1; changes.length < count && previous > schedule.settleAt && next <= week + 1100; next += 1) {
    const target = targetForWeek(schedule, next);
    if (target < previous) changes.push({ day: addDays(firstBoundary, 7 * (next - week - 1)), target });
    previous = target;
  }
  return changes;
}

/** Upcoming target changes for the active plan. None while paused or once settled. */
export function nextTargetChanges(plan: PlanRecord, today: DayKey, count = 1): TargetChange[] {
  const segment = activeSegment(plan);
  if (!segment || openPause(plan)) return [];
  return upcomingChanges(segment, activeDaysBefore(segment, plan.pauses, today), today, count);
}

/** What a revision starting today would do: today's target, then the next drops. */
export const revisionPreview = (schedule: Schedule, today: DayKey, count = 3) => ({
  today: schedule.startTarget,
  changes: upcomingChanges(schedule, 0, today, count),
});

/** First day of the current plan: when it was started or last restarted. Revisions continue it. */
export function planStartDay(plan: PlanRecord): DayKey | null {
  if (!activeSegment(plan)) return null;
  const segments = plan.segments;
  let index = segments.length - 1;
  while (index > 0 && segments[index].reason === 'revise' && segments[index - 1].endedOn === segments[index].startedOn) index -= 1;
  return segments[index].startedOn;
}

/** The plan week people see ("Week 3"), counted from the plan's start with paused days left out. */
export function displayPlanWeek(plan: PlanRecord, today: DayKey): number | null {
  const start = planStartDay(plan);
  if (!start) return null;
  const active = today <= start ? 0 : daysBetween(start, today) - pausedDaysBetween(plan.pauses, start, today);
  return weekNumber(Math.floor(Math.max(0, active) / 7));
}

export type PlanStatus = keyof typeof PLAN_STATUS_LABEL;

export function planStatus(plan: PlanRecord): PlanStatus {
  const segment = activeSegment(plan);
  if (!segment) return 'track';
  return openPause(plan) ? 'paused' : segment.goal;
}

/** The day the most recent plan ended, when there is no active plan. */
export function lastPlanEnded(plan: PlanRecord): DayKey | null {
  if (activeSegment(plan)) return null;
  return plan.segments[plan.segments.length - 1]?.endedOn ?? null;
}

/** First day of the calendar week containing `today`: Sunday, as in Insights. */
export const chartWeekStart = (today: DayKey): DayKey => addDays(today, -((dayIndex(today) + 4) % 7));

/** The seven days of the week starting `firstDay`, each with its count, target and status. */
export const weekChartDays = (plan: PlanRecord, logs: readonly PuffLog[], firstDay: DayKey, today: DayKey): PlanDay[] =>
  planDays(plan, logs, firstDay, 7, today);

/**
 * What Home adds for the plan: today against its target and this week's targets while a plan is
 * active or paused; otherwise an invitation to set a goal, or a new one after a plan has ended.
 */
export type HomePlanView =
  | { kind: 'invite'; ended: boolean }
  | {
      kind: 'plan';
      progress: Exclude<TodayProgress, { kind: 'noPlan' }>;
      paused: boolean;
      week: number;
      days: PlanDay[];
      summary: WeekSummary;
    };

export function homePlanView(plan: PlanRecord, logs: readonly PuffLog[], today: DayKey): HomePlanView {
  const progress = todayProgress(plan, logs, today);
  if (progress.kind === 'noPlan') return { kind: 'invite', ended: lastPlanEnded(plan) !== null };
  const days = weekChartDays(plan, logs, chartWeekStart(today), today);
  return {
    kind: 'plan',
    progress,
    paused: progress.kind === 'paused',
    week: displayPlanWeek(plan, today) ?? 1,
    days,
    summary: summarizeDays(days),
  };
}

export type MilestoneView = { id: MilestoneId; title: string; detail: string; reachedOn: DayKey; seen: boolean };

/** Earned milestones, oldest first. Unearned ones aren't listed, so nothing reads as a shortfall. */
export function earnedMilestones(plan: PlanRecord): MilestoneView[] {
  return [...plan.milestones]
    .sort((a, b) => a.reachedOn.localeCompare(b.reachedOn) || MILESTONE_IDS.indexOf(a.id) - MILESTONE_IDS.indexOf(b.id))
    .map((milestone) => ({ id: milestone.id, ...MILESTONE_COPY[milestone.id], reachedOn: milestone.reachedOn, seen: milestone.seenAt !== null }));
}

/** Earned but not yet acknowledged on any screen: what Home's notice presents, once. */
export const unseenMilestones = (plan: PlanRecord): MilestoneView[] => earnedMilestones(plan).filter((milestone) => !milestone.seen);

export type BaselineProvenance = {
  source: BaselineSource;
  perDay: number;
  /** The day the starting level was set, so a calculated one covers the two weeks before it. */
  since: DayKey;
  /** Calculated levels only: whether the logs still on this device give the same number. */
  checkable: boolean;
};

/**
 * Where the active plan's starting level came from. A level calculated from history is checked
 * against the logs still on the device, so it is never presented as verifiable after the logs it
 * came from were cleared or changed.
 */
export function baselineProvenance(plan: PlanRecord, logs: readonly PuffLog[]): BaselineProvenance | null {
  const current = activeSegment(plan);
  if (!current) return null;
  const segments = plan.segments;
  let index = segments.length - 1;
  while (
    index > 0 &&
    segments[index].reason !== 'start' &&
    segments[index - 1].endedOn === segments[index].startedOn &&
    segments[index - 1].baselinePerDay === current.baselinePerDay &&
    segments[index - 1].baselineSource === current.baselineSource
  ) {
    index -= 1;
  }
  const since = segments[index].startedOn;
  if (current.baselineSource === 'estimate') return { source: 'estimate', perDay: current.baselinePerDay, since, checkable: false };
  const recalculated = baselineFromHistory(logs, plan.confirmedZeroDays, since);
  return {
    source: 'history',
    perDay: current.baselinePerDay,
    since,
    checkable: recalculated.status === 'ok' && recalculated.perDay === current.baselinePerDay,
  };
}
