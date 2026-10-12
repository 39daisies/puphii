/**
 * Plan events for optional features such as Voice Pep Rallies. Detected by comparing two
 * snapshots, entirely on the device. Events carry only what a short, supportive response needs:
 * a goal, a target, a day or a milestone, never a puff count. Nothing listens by default, a
 * listener can't affect logging or the plan, and a failing listener is ignored. Events never
 * play anything themselves; see `voicePolicy` for what a future voice feature may respond to.
 */

import { PuffLog } from '../data/types';
import { activityIndex } from './activity';
import { addDays, DayKey } from './days';
import { MilestoneId, PlanGoal, PlanRecord, PlanSegment } from './model';
import { planDay } from './progress';
import { activeSegment, openPause, scheduledTarget } from './schedule';

export type PlanEvent =
  | { type: 'planStarted'; goal: 'reduce' | 'quit'; target: number }
  | { type: 'planRevised'; target: number }
  | { type: 'planRestarted'; target: number }
  | { type: 'planPaused' }
  | { type: 'planResumed' }
  | { type: 'planEnded' }
  /** Today's count went above today's target. Reported once per crossing; never a cue for criticism. */
  | { type: 'dailyTargetCrossed'; target: number }
  /** A finished, tracked day ended at or under its target. Reported when the app sees the day change. */
  | { type: 'dayCompletedWithinTarget'; day: DayKey }
  /** Reported once, when the milestone is first recorded. */
  | { type: 'milestoneEarned'; id: MilestoneId };

export type PlanEventType = PlanEvent['type'];

export const PLAN_EVENT_TYPES: readonly PlanEventType[] = [
  'planStarted',
  'planRevised',
  'planRestarted',
  'planPaused',
  'planResumed',
  'planEnded',
  'dailyTargetCrossed',
  'dayCompletedWithinTarget',
  'milestoneEarned',
];

export type PlanSnapshot = {
  today: DayKey;
  goal: PlanGoal;
  segment: PlanSegment | null;
  paused: boolean;
  todayCount: number;
  /** Null without an active, unpaused plan. */
  target: number | null;
  /** Status of the day before `today`, used when the day changes. */
  previousDay: { day: DayKey; withinTarget: boolean };
  milestoneIds: readonly MilestoneId[];
};

export function planSnapshot(plan: PlanRecord, logs: readonly PuffLog[], today: DayKey): PlanSnapshot {
  const activity = activityIndex(logs, plan.confirmedZeroDays);
  const segment = activeSegment(plan);
  const paused = !!openPause(plan);
  const yesterday = addDays(today, -1);
  return {
    today,
    goal: plan.goal,
    segment,
    paused,
    todayCount: activity(today).count,
    target: segment && !paused ? scheduledTarget(segment, plan.pauses, today) : null,
    previousDay: { day: yesterday, withinTarget: planDay(plan, activity, yesterday, today).status === 'withinTarget' },
    milestoneIds: plan.milestones.map((milestone) => milestone.id),
  };
}

const sameSegment = (a: PlanSegment | null, b: PlanSegment | null) => JSON.stringify(a) === JSON.stringify(b);

export function detectPlanEvents(before: PlanSnapshot, after: PlanSnapshot): PlanEvent[] {
  const events: PlanEvent[] = [];
  const target = after.target ?? 0;

  if (!before.segment && after.segment) events.push({ type: 'planStarted', goal: after.segment.goal, target });
  else if (before.segment && !after.segment) events.push({ type: 'planEnded' });
  else if (before.segment && after.segment && !sameSegment(before.segment, after.segment)) {
    // A same-day replacement keeps the segment's original reason, so compare what changed.
    const restarted = after.segment.reason === 'restart' && (before.segment.reason !== 'restart' || after.segment.startedOn !== before.segment.startedOn);
    events.push(restarted ? { type: 'planRestarted', target } : { type: 'planRevised', target });
  }

  if (after.segment && before.segment) {
    if (!before.paused && after.paused) events.push({ type: 'planPaused' });
    if (before.paused && !after.paused) events.push({ type: 'planResumed' });
  }

  if (after.today === before.today) {
    // Only a new log crosses the target; a revision that moves the target below today's count does not.
    if (after.target !== null && before.target === after.target && before.todayCount <= after.target && after.todayCount > after.target) {
      events.push({ type: 'dailyTargetCrossed', target: after.target });
    }
  } else if (after.today > before.today && after.previousDay.day === before.today && after.previousDay.withinTarget) {
    events.push({ type: 'dayCompletedWithinTarget', day: before.today });
  }

  for (const id of after.milestoneIds) if (!before.milestoneIds.includes(id)) events.push({ type: 'milestoneEarned', id });
  return events;
}

export type PlanEventListener = (event: PlanEvent) => void;

/** A minimal in-memory event channel. Emitting with no listeners does nothing. */
export function createPlanEventBus() {
  const listeners = new Set<PlanEventListener>();
  return {
    subscribe(listener: PlanEventListener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(events: readonly PlanEvent[]): void {
      for (const event of events) {
        // Frozen, so one listener can't change what the next one receives.
        Object.freeze(event);
        for (const listener of [...listeners]) {
          try {
            const result: unknown = listener(event);
            if (result && typeof (result as Promise<unknown>).catch === 'function') (result as Promise<unknown>).catch(() => undefined);
          } catch {
            // An optional listener must never break logging or the plan.
          }
        }
      }
    },
    get size() {
      return listeners.size;
    },
  };
}
