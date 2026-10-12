import { PuffLog } from '../../src/data/types';
import { DayKey } from '../../src/plan/days';
import { defaultPlan, PlanRecord, PlanSegment } from '../../src/plan/model';

export const NOW = new Date(2026, 9, 20, 21, 0);

let seq = 0;
/** `count` logs at local noon on `day`. */
export function logsOn(day: DayKey, count: number): PuffLog[] {
  const [y, m, d] = day.split('-').map(Number);
  const timestamp = new Date(y, m - 1, d, 12, 0).toISOString();
  return Array.from({ length: count }, () => ({ id: `plan-log-${(seq += 1)}`, timestamp }));
}

export const history = (counts: Record<DayKey, number>): PuffLog[] => Object.entries(counts).flatMap(([day, count]) => logsOn(day, count));

export const segment = (overrides: Partial<PlanSegment> = {}): PlanSegment => ({
  goal: 'reduce',
  startedOn: '2026-10-01',
  endedOn: null,
  baselinePerDay: 20,
  baselineSource: 'estimate',
  startTarget: 20,
  pace: { preset: 'steady', percent: 10 },
  settleAt: 10,
  reason: 'start',
  ...overrides,
});

export function planWith(segments: PlanSegment[], extra: Partial<PlanRecord> = {}): PlanRecord {
  const open = segments.length > 0 && segments[segments.length - 1].endedOn === null;
  return { ...defaultPlan(), goal: open ? segments[segments.length - 1].goal : 'track', segments, ...extra };
}

/** Deep-freezes a value so a test fails if an action mutates its input. */
export function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) frozen((value as Record<string, unknown>)[key]);
    Object.freeze(value);
  }
  return value;
}
