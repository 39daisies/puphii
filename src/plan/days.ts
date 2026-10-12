import { localDayKey } from '../data/puffLogic';

/** A local calendar day, `YYYY-MM-DD`, as produced by `localDayKey`. */
export type DayKey = string;

const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function isDayKey(value: unknown): value is DayKey {
  if (typeof value !== 'string') return false;
  const match = DAY_KEY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Whole days since 1970-01-01 for a calendar day. Calendar arithmetic is done in UTC so a
 * 23- or 25-hour local day (DST) still counts as exactly one day.
 */
export function dayIndex(key: DayKey): number {
  const [year, month, day] = key.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);
}

export function dayFromIndex(index: number): DayKey {
  return new Date(index * MS_PER_DAY).toISOString().slice(0, 10);
}

export const addDays = (key: DayKey, days: number): DayKey => dayFromIndex(dayIndex(key) + days);

/** Calendar days from `from` to `to`; negative when `to` is earlier. */
export const daysBetween = (from: DayKey, to: DayKey): number => dayIndex(to) - dayIndex(from);

export const todayKey = (now: Date = new Date()): DayKey => localDayKey(now);
