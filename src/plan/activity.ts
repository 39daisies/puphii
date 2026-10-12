import { countsByDay } from '../data/puffLogic';
import { PuffLog } from '../data/types';
import { DayKey } from './days';

/**
 * What is known about a day. `tracked` means there is evidence for the day's total: at least
 * one log, or the person confirmed it had none. A day with neither is untracked: its total is
 * unknown, and it is never treated as puff-free.
 */
export type DayActivity = { day: DayKey; count: number; confirmedZero: boolean; tracked: boolean };

export type ActivityIndex = (day: DayKey) => DayActivity;

export function activityIndex(logs: readonly PuffLog[], confirmedZeroDays: readonly DayKey[]): ActivityIndex {
  const counts = countsByDay(logs);
  const confirmed = new Set(confirmedZeroDays);
  return (day) => {
    const count = counts.get(day) ?? 0;
    // A log on a confirmed day wins: the confirmation no longer describes that day.
    const confirmedZero = count === 0 && confirmed.has(day);
    return { day, count, confirmedZero, tracked: count > 0 || confirmedZero };
  };
}
