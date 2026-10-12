/**
 * Personalized reduction plans: the stored record and its validation. Targets, progress and
 * milestones are always derived from this record plus the puff logs; nothing per-day is stored
 * except days the person explicitly confirmed as puff-free.
 */

import { isRecord, withUnknownFields } from '../data/preserve';
import { DayKey, isDayKey } from './days';

export type PlanGoal = 'track' | 'reduce' | 'quit';
export const PLAN_GOALS: readonly PlanGoal[] = ['track', 'reduce', 'quit'];

export type PacePreset = 'gentle' | 'steady' | 'faster' | 'custom';
const PACE_PRESET_IDS: readonly PacePreset[] = ['gentle', 'steady', 'faster', 'custom'];

/**
 * Example paces: the weekly drop in the daily target, as a percentage of the original baseline.
 * Planning examples the person can change at any time, not clinical recommendations.
 */
export const PACE_PRESETS: Record<Exclude<PacePreset, 'custom'>, number> = { gentle: 5, steady: 10, faster: 20 };
export const CUSTOM_PACE_LIMITS = { min: 1, max: 50 } as const;
/** Puffs per day. Baselines keep one decimal; targets are whole puffs. */
export const BASELINE_LIMITS = { min: 1, max: 1000 } as const;

export type Pace = { preset: PacePreset; percent: number };

export type SegmentReason = 'start' | 'revise' | 'restart';
const SEGMENT_REASONS: readonly SegmentReason[] = ['start', 'revise', 'restart'];

export type BaselineSource = 'history' | 'estimate';

/**
 * One stretch of a plan with fixed settings. Revising or restarting closes the current segment
 * and opens a new one, so days in the past keep the targets they had.
 */
export type PlanSegment = {
  goal: 'reduce' | 'quit';
  startedOn: DayKey;
  /** Exclusive: the first day this segment no longer applies. Null while current. */
  endedOn: DayKey | null;
  /** The original baseline. Every weekly drop is a percentage of this, never of a later target. */
  baselinePerDay: number;
  baselineSource: BaselineSource;
  /** Target on the segment's first day. */
  startTarget: number;
  pace: Pace;
  /** The target never goes below this. Always 0 when working toward quitting. */
  settleAt: number;
  reason: SegmentReason;
};

/** `to` is exclusive: the day the plan resumed. Null while paused. */
export type PlanPause = { from: DayKey; to: DayKey | null };

export type MilestoneId =
  | 'firstDayWithinTarget'
  | 'daysWithinTarget3'
  | 'daysWithinTarget7'
  | 'daysWithinTarget14'
  | 'daysWithinTarget30'
  | 'firstPlanWeek'
  | 'weekBelowBaseline10'
  | 'weekBelowBaseline25'
  | 'weekBelowBaseline50'
  | 'settleLevelReached'
  | 'firstConfirmedPuffFreeDay';

export const MILESTONE_IDS: readonly MilestoneId[] = [
  'firstDayWithinTarget',
  'daysWithinTarget3',
  'daysWithinTarget7',
  'daysWithinTarget14',
  'daysWithinTarget30',
  'firstPlanWeek',
  'weekBelowBaseline10',
  'weekBelowBaseline25',
  'weekBelowBaseline50',
  'settleLevelReached',
  'firstConfirmedPuffFreeDay',
];

export type MilestoneRecord = { id: MilestoneId; reachedOn: DayKey; seenAt: string | null };

export type PlanRecord = {
  version: 1;
  goal: PlanGoal;
  segments: PlanSegment[];
  pauses: PlanPause[];
  /**
   * Days the person explicitly confirmed as having no puffs. A day without logs is otherwise
   * "untracked", never assumed puff-free. Any log on a confirmed day overrides the confirmation.
   */
  confirmedZeroDays: DayKey[];
  milestones: MilestoneRecord[];
  updatedAt: string | null;
};

export const DEFAULT_PLAN: PlanRecord = {
  version: 1,
  goal: 'track',
  segments: [],
  pauses: [],
  confirmedZeroDays: [],
  milestones: [],
  updatedAt: null,
};

export const defaultPlan = (): PlanRecord => ({
  ...DEFAULT_PLAN,
  segments: [],
  pauses: [],
  confirmedZeroDays: [],
  milestones: [],
});

const isInstant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(new Date(value).getTime());
const isWhole = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const isAmount = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

export const isValidPacePercent = (percent: unknown): percent is number =>
  isWhole(percent, CUSTOM_PACE_LIMITS.min, CUSTOM_PACE_LIMITS.max);

export const isValidBaseline = (perDay: unknown): perDay is number =>
  isAmount(perDay, BASELINE_LIMITS.min, BASELINE_LIMITS.max) && Math.abs(Math.round(perDay * 10) - perDay * 10) < 1e-9;

function sanitizePace(raw: unknown): Pace | null {
  if (!isRecord(raw) || !(PACE_PRESET_IDS as readonly unknown[]).includes(raw.preset) || !isValidPacePercent(raw.percent)) return null;
  const preset = raw.preset as PacePreset;
  if (preset !== 'custom' && PACE_PRESETS[preset] !== raw.percent) return null;
  return withUnknownFields(raw, { preset, percent: raw.percent });
}

function sanitizeSegment(raw: unknown): PlanSegment | null {
  if (!isRecord(raw)) return null;
  const goal = raw.goal;
  if (goal !== 'reduce' && goal !== 'quit') return null;
  if (!isDayKey(raw.startedOn) || (raw.endedOn !== null && (!isDayKey(raw.endedOn) || raw.endedOn < raw.startedOn))) return null;
  if (!isValidBaseline(raw.baselinePerDay) || (raw.baselineSource !== 'history' && raw.baselineSource !== 'estimate')) return null;
  if (!isWhole(raw.startTarget, 0, BASELINE_LIMITS.max)) return null;
  const pace = sanitizePace(raw.pace);
  if (!pace) return null;
  if (!isWhole(raw.settleAt, 0, BASELINE_LIMITS.max) || raw.settleAt > raw.startTarget || (goal === 'quit' && raw.settleAt !== 0)) return null;
  if (!(SEGMENT_REASONS as readonly unknown[]).includes(raw.reason)) return null;
  return withUnknownFields(raw, {
    goal: goal as PlanSegment['goal'],
    startedOn: raw.startedOn,
    endedOn: raw.endedOn as DayKey | null,
    baselinePerDay: raw.baselinePerDay,
    baselineSource: raw.baselineSource as BaselineSource,
    startTarget: raw.startTarget,
    pace,
    settleAt: raw.settleAt,
    reason: raw.reason as SegmentReason,
  });
}

function sanitizePause(raw: unknown): PlanPause | null {
  if (!isRecord(raw) || !isDayKey(raw.from)) return null;
  if (raw.to !== null && (!isDayKey(raw.to) || raw.to <= raw.from)) return null;
  return withUnknownFields(raw, { from: raw.from, to: raw.to as DayKey | null });
}

function sanitizeMilestone(raw: unknown): MilestoneRecord | null {
  if (!isRecord(raw) || !(MILESTONE_IDS as readonly unknown[]).includes(raw.id) || !isDayKey(raw.reachedOn)) return null;
  return withUnknownFields(raw, { id: raw.id as MilestoneId, reachedOn: raw.reachedOn, seenAt: isInstant(raw.seenAt) ? raw.seenAt : null });
}

const keep = <T>(items: unknown, sanitize: (item: unknown) => T | null): T[] =>
  Array.isArray(items) ? items.map(sanitize).filter((item): item is T => item !== null) : [];

/**
 * Restores a stored plan. Invalid entries are dropped (the caller sets the original aside);
 * fields from other app versions are kept. Segments and pauses must not overlap, and only the
 * last of each may be open: anything that breaks that is dropped rather than guessed at.
 */
export function sanitizePlan(raw: unknown): PlanRecord {
  if (!isRecord(raw)) return defaultPlan();

  const segments: PlanSegment[] = [];
  for (const segment of keep(raw.segments, sanitizeSegment)) {
    const previous = segments[segments.length - 1];
    if (previous && (previous.endedOn === null || segment.startedOn < previous.endedOn)) continue;
    segments.push(segment);
  }
  const pauses: PlanPause[] = [];
  for (const pause of keep(raw.pauses, sanitizePause)) {
    const previous = pauses[pauses.length - 1];
    if (previous && (previous.to === null || pause.from < previous.to)) continue;
    pauses.push(pause);
  }
  const confirmedZeroDays = Array.isArray(raw.confirmedZeroDays)
    ? raw.confirmedZeroDays.filter((day, index, all): day is DayKey => isDayKey(day) && all.indexOf(day) === index)
    : [];
  const milestones = keep(raw.milestones, sanitizeMilestone).filter(
    (milestone, index, all) => all.findIndex((other) => other.id === milestone.id) === index,
  );

  const open = segments.length > 0 && segments[segments.length - 1].endedOn === null;
  // The goal follows the segments: an open segment is the active plan, and without one there is none.
  const goal: PlanGoal = open ? segments[segments.length - 1].goal : 'track';

  return withUnknownFields(raw, {
    version: 1 as const,
    goal,
    segments,
    pauses,
    confirmedZeroDays,
    milestones,
    updatedAt: isInstant(raw.updatedAt) ? raw.updatedAt : null,
  });
}
