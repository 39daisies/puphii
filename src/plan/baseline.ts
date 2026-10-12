import { PuffLog } from '../data/types';
import { activityIndex } from './activity';
import { addDays, DayKey } from './days';
import { BASELINE_LIMITS } from './model';

/** Complete days before today that a history baseline looks at. */
export const BASELINE_WINDOW_DAYS = 14;
/** Tracked days needed in that window before the logs are used as a baseline. */
export const MIN_TRACKED_DAYS = 3;

export type HistoryBaseline =
  | {
      status: 'ok';
      /** Average over tracked days, one decimal. */
      perDay: number;
      trackedDays: number;
      loggedDays: number;
      confirmedZeroDays: number;
      untrackedDays: number;
    }
  /** Every tracked day was a confirmed zero: there is nothing to reduce from. */
  | { status: 'zero'; trackedDays: number }
  | { status: 'notEnoughData'; trackedDays: number; needed: number };

/**
 * Average puffs per day over the tracked days of the last two weeks, today excluded because it
 * isn't over. Untracked days are left out entirely rather than counted as zero, so gaps in
 * logging don't make the baseline look lower than it is.
 */
export function baselineFromHistory(logs: readonly PuffLog[], confirmedZeroDays: readonly DayKey[], today: DayKey): HistoryBaseline {
  const activity = activityIndex(logs, confirmedZeroDays);
  let total = 0;
  let loggedDays = 0;
  let zeroDays = 0;
  for (let back = 1; back <= BASELINE_WINDOW_DAYS; back += 1) {
    const day = activity(addDays(today, -back));
    total += day.count;
    if (day.count > 0) loggedDays += 1;
    else if (day.confirmedZero) zeroDays += 1;
  }
  const trackedDays = loggedDays + zeroDays;
  if (trackedDays < MIN_TRACKED_DAYS) return { status: 'notEnoughData', trackedDays, needed: MIN_TRACKED_DAYS };
  if (total === 0) return { status: 'zero', trackedDays };
  const perDay = Math.min(BASELINE_LIMITS.max, Math.max(BASELINE_LIMITS.min, Math.round((total / trackedDays) * 10) / 10));
  return { status: 'ok', perDay, trackedDays, loggedDays, confirmedZeroDays: zeroDays, untrackedDays: BASELINE_WINDOW_DAYS - trackedDays };
}

/** A typed-in estimate as a baseline (one decimal), or null when it can't be used. */
export function baselineFromEstimate(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const rounded = Math.round(value * 10) / 10;
  return rounded >= BASELINE_LIMITS.min && rounded <= BASELINE_LIMITS.max ? rounded : null;
}
