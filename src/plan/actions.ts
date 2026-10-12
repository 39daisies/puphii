/**
 * Plan changes as pure functions: each takes the current record and returns a new one, or a
 * reason the change can't be made. None of them touch puff logs, and none delete past segments,
 * so revising, pausing or ending a plan never rewrites history.
 */

import { PuffLog } from '../data/types';
import { activityIndex } from './activity';
import { DayKey } from './days';
import {
  BaselineSource,
  isValidBaseline,
  isValidPacePercent,
  MilestoneId,
  MilestoneRecord,
  Pace,
  PACE_PRESETS,
  PlanRecord,
  PlanSegment,
  SegmentReason,
} from './model';
import { activeSegment, openPause, scheduledTarget } from './schedule';

export type PlanSettings = {
  goal: 'reduce' | 'quit';
  baseline: { perDay: number; source: BaselineSource };
  pace: Pace;
  /** Reduce only; quitting always settles at 0. */
  settleAt: number;
};

export type PlanError =
  | 'invalidBaseline'
  | 'invalidPace'
  | 'invalidSettleLevel'
  | 'invalidTarget'
  | 'planAlreadyActive'
  | 'noActivePlan'
  | 'futureDay'
  | 'dayHasLogs'
  /** Saved data hasn't finished loading, so a change now could overwrite it. */
  | 'notReady';

export type PlanResult = { ok: true; plan: PlanRecord } | { ok: false; error: PlanError };

const fail = (error: PlanError): PlanResult => ({ ok: false, error });
const done = (plan: PlanRecord, now: Date): PlanResult => ({ ok: true, plan: { ...plan, updatedAt: now.toISOString() } });

export const paceFor = (preset: Pace['preset'], customPercent?: number): Pace =>
  preset === 'custom' ? { preset, percent: customPercent ?? 0 } : { preset, percent: PACE_PRESETS[preset] };

function checkSettings(settings: PlanSettings, startTarget: number): PlanError | null {
  if (!isValidBaseline(settings.baseline.perDay)) return 'invalidBaseline';
  const pace = settings.pace;
  if (!isValidPacePercent(pace.percent) || (pace.preset !== 'custom' && PACE_PRESETS[pace.preset] !== pace.percent)) return 'invalidPace';
  if (!Number.isInteger(startTarget) || startTarget < 0) return 'invalidTarget';
  const settleAt = settings.goal === 'quit' ? 0 : settings.settleAt;
  if (!Number.isInteger(settleAt) || settleAt < 0) return 'invalidSettleLevel';
  // A reduction plan settles below where it starts; otherwise there is nothing to reduce.
  if (settings.goal === 'reduce' && settleAt >= startTarget) return 'invalidSettleLevel';
  return null;
}

const segmentFrom = (settings: PlanSettings, startedOn: DayKey, startTarget: number, reason: SegmentReason): PlanSegment => ({
  goal: settings.goal,
  startedOn,
  endedOn: null,
  baselinePerDay: settings.baseline.perDay,
  baselineSource: settings.baseline.source,
  startTarget,
  pace: { ...settings.pace },
  settleAt: settings.goal === 'quit' ? 0 : settings.settleAt,
  reason,
});

const settingsOf = (segment: PlanSegment): PlanSettings => ({
  goal: segment.goal,
  baseline: { perDay: segment.baselinePerDay, source: segment.baselineSource },
  pace: segment.pace,
  settleAt: segment.settleAt,
});

/**
 * Closes the current segment on `today` and appends `next`. A segment that started today never
 * applied to a finished day, so it is replaced instead of leaving an empty segment behind.
 */
function replaceCurrent(plan: PlanRecord, today: DayKey, next: PlanSegment | null): PlanSegment[] {
  const segments = [...plan.segments];
  const current = activeSegment(plan);
  if (current) {
    segments.pop();
    if (current.startedOn < today) segments.push({ ...current, endedOn: today });
    else if (next) next = { ...next, reason: current.reason === 'revise' ? next.reason : current.reason };
  }
  if (next) segments.push(next);
  return segments;
}

/** Ends an open pause on `today`. A pause that started today is dropped: it covered no day. */
function closePause(plan: PlanRecord, today: DayKey): PlanRecord['pauses'] {
  const pause = openPause(plan);
  if (!pause) return plan.pauses;
  const rest = plan.pauses.slice(0, -1);
  return pause.from < today ? [...rest, { ...pause, to: today }] : rest;
}

export function startPlan(plan: PlanRecord, settings: PlanSettings, today: DayKey, now: Date): PlanResult {
  if (activeSegment(plan)) return fail('planAlreadyActive');
  const startTarget = Math.ceil(settings.baseline.perDay);
  const error = checkSettings(settings, startTarget);
  if (error) return fail(error);
  return done({ ...plan, goal: settings.goal, segments: replaceCurrent(plan, today, segmentFrom(settings, today, startTarget, 'start')) }, now);
}

export type PlanRevision = Partial<Omit<PlanSettings, 'baseline'>> & {
  baseline?: PlanSettings['baseline'];
  /** A new daily target to continue from. Defaults to today's scheduled target, so nothing jumps. */
  target?: number;
};

/**
 * Changes pace, settle level, goal, baseline or target from today on. Weekly drops stay a share
 * of the (possibly revised) baseline; the schedule continues from today's target.
 */
export function revisePlan(plan: PlanRecord, revision: PlanRevision, today: DayKey, now: Date): PlanResult {
  const current = activeSegment(plan);
  if (!current) return fail('noActivePlan');
  const settings: PlanSettings = { ...settingsOf(current), ...revision, baseline: revision.baseline ?? settingsOf(current).baseline };
  const startTarget = revision.target ?? scheduledTarget(current, plan.pauses, today);
  const error = checkSettings(settings, startTarget);
  if (error) return fail(error);
  return done({ ...plan, goal: settings.goal, segments: replaceCurrent(plan, today, segmentFrom(settings, today, startTarget, 'revise')) }, now);
}

/** Starts the schedule again from the baseline (or a new one) today. Ends any pause. */
export function restartPlan(plan: PlanRecord, revision: Partial<PlanSettings>, today: DayKey, now: Date): PlanResult {
  const current = activeSegment(plan);
  if (!current) return fail('noActivePlan');
  const settings: PlanSettings = { ...settingsOf(current), ...revision };
  const startTarget = Math.ceil(settings.baseline.perDay);
  const error = checkSettings(settings, startTarget);
  if (error) return fail(error);
  const segments = replaceCurrent(plan, today, segmentFrom(settings, today, startTarget, 'restart'));
  return done({ ...plan, goal: settings.goal, segments, pauses: closePause(plan, today) }, now);
}

/** Pauses from today: no targets are shown and the schedule stops advancing until resumed. */
export function pausePlan(plan: PlanRecord, today: DayKey, now: Date): PlanResult {
  if (!activeSegment(plan)) return fail('noActivePlan');
  if (openPause(plan)) return { ok: true, plan };
  return done({ ...plan, pauses: [...plan.pauses, { from: today, to: null }] }, now);
}

export function resumePlan(plan: PlanRecord, today: DayKey, now: Date): PlanResult {
  if (!openPause(plan)) return { ok: true, plan };
  return done({ ...plan, pauses: closePause(plan, today) }, now);
}

/** Goes back to tracking only. Past segments, logs and milestones are kept. */
export function endPlan(plan: PlanRecord, today: DayKey, now: Date): PlanResult {
  if (!activeSegment(plan)) return fail('noActivePlan');
  return done({ ...plan, goal: 'track', segments: replaceCurrent(plan, today, null), pauses: closePause(plan, today) }, now);
}

/**
 * Records, or withdraws, the person's confirmation that `day` had no puffs. Only possible for
 * today or earlier, and only while the day has no logs: a log is always the better evidence.
 */
export function setConfirmedZeroDay(
  plan: PlanRecord,
  logs: readonly PuffLog[],
  day: DayKey,
  confirmed: boolean,
  today: DayKey,
  now: Date,
): PlanResult {
  if (day > today) return fail('futureDay');
  const has = plan.confirmedZeroDays.includes(day);
  if (!confirmed) return has ? done({ ...plan, confirmedZeroDays: plan.confirmedZeroDays.filter((d) => d !== day) }, now) : { ok: true, plan };
  if (activityIndex(logs, [])(day).count > 0) return fail('dayHasLogs');
  if (has) return { ok: true, plan };
  return done({ ...plan, confirmedZeroDays: [...plan.confirmedZeroDays, day].sort() }, now);
}

/** Adds newly reached milestones. Milestones already recorded are never removed or re-dated. */
export function addMilestones(plan: PlanRecord, reached: readonly MilestoneRecord[], now: Date): PlanRecord {
  const fresh = reached.filter((milestone) => !plan.milestones.some((existing) => existing.id === milestone.id));
  return fresh.length ? { ...plan, milestones: [...plan.milestones, ...fresh], updatedAt: now.toISOString() } : plan;
}

/**
 * Acknowledges milestones, so they are no longer presented as new anywhere. With `ids`, only
 * those (the ones actually shown); otherwise every unacknowledged one. The first time is kept.
 */
export function markMilestonesSeen(plan: PlanRecord, now: Date, ids?: readonly MilestoneId[]): PlanRecord {
  const acknowledging = (m: MilestoneRecord) => !m.seenAt && (!ids || ids.includes(m.id));
  if (!plan.milestones.some(acknowledging)) return plan;
  const seenAt = now.toISOString();
  return { ...plan, milestones: plan.milestones.map((m) => (acknowledging(m) ? { ...m, seenAt } : m)), updatedAt: seenAt };
}

/**
 * For "Clear puff history": removes what was derived from, or adds to, the deleted history
 * (milestones and confirmed puff-free days). The plan's settings stay.
 */
export const clearPlanHistory = (plan: PlanRecord, now: Date): PlanRecord =>
  plan.confirmedZeroDays.length || plan.milestones.length
    ? { ...plan, confirmedZeroDays: [], milestones: [], updatedAt: now.toISOString() }
    : plan;
