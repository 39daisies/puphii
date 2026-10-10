import { withUnknownFields } from './preserve';
import { DEFAULT_SETTINGS, PuffLog, REACTION_MODES, ReactionMode, Settings } from './types';

const pad = (value: number) => String(value).padStart(2, '0');

/** `YYYY-MM-DD` in the device's local calendar. */
export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function dayKeyOfLog(log: PuffLog): string {
  return localDayKey(new Date(log.timestamp));
}

/**
 * Shifts by whole local calendar days. Anchored at local noon so DST transitions
 * (23h/25h days) can never push the result onto a neighbouring date.
 */
export function addLocalDays(date: Date, days: number): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
  result.setDate(result.getDate() + days);
  return result;
}

export function msUntilNextLocalMidnight(now: Date): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0);
  return Math.max(0, next.getTime() - now.getTime());
}

export function countsByDay(logs: readonly PuffLog[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const log of logs) {
    const key = dayKeyOfLog(log);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export function countOnDay(logs: readonly PuffLog[], date: Date): number {
  const key = localDayKey(date);
  let total = 0;
  for (const log of logs) if (dayKeyOfLog(log) === key) total += 1;
  return total;
}

export type DayPoint = { key: string; date: Date; count: number };

/** Oldest-first series of `days` local days ending with `today`. */
export function dailySeries(logs: readonly PuffLog[], today: Date, days: number): DayPoint[] {
  const counts = countsByDay(logs);
  return Array.from({ length: days }, (_, index) => {
    const date = addLocalDays(today, index - (days - 1));
    const key = localDayKey(date);
    return { key, date, count: counts.get(key) ?? 0 };
  });
}

export type WeekPoint = { key: string; start: Date; count: number };

/** Oldest-first rolling 7-day buckets; the last bucket ends with `today`. */
export function weeklySeries(logs: readonly PuffLog[], today: Date, weeks: number): WeekPoint[] {
  const days = dailySeries(logs, today, weeks * 7);
  return Array.from({ length: weeks }, (_, index) => {
    const slice = days.slice(index * 7, index * 7 + 7);
    return { key: slice[0].key, start: slice[0].date, count: slice.reduce((sum, day) => sum + day.count, 0) };
  });
}

export type DayGroup = { key: string; date: Date; logs: PuffLog[] };

/** Newest day first; logs inside a day newest first. */
export function groupLogsByDay(logs: readonly PuffLog[]): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  for (const log of logs) {
    const date = new Date(log.timestamp);
    const key = localDayKey(date);
    let group = groups.get(key);
    if (!group) {
      group = { key, date: addLocalDays(date, 0), logs: [] };
      groups.set(key, group);
    }
    group.logs.push(log);
  }
  const sorted = [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  for (const group of sorted) group.logs.sort(compareNewestFirst);
  return sorted;
}

function compareNewestFirst(a: PuffLog, b: PuffLog): number {
  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
}

/**
 * The most recently *recorded* log is the last array element: logs are only ever
 * appended, so insertion order survives clock adjustments that timestamps don't.
 */
export function latestRecordedLog(logs: readonly PuffLog[]): PuffLog | null {
  return logs.length ? logs[logs.length - 1] : null;
}

export function removeLogById(logs: readonly PuffLog[], id: string): PuffLog[] {
  return logs.filter((log) => log.id !== id);
}

let idCounter = 0;
export function createLog(now: Date = new Date()): PuffLog {
  idCounter = (idCounter + 1) % 1_000_000;
  const id = `${now.getTime().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { id, timestamp: now.toISOString() };
}

export function sanitizeLogs(raw: unknown): PuffLog[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: PuffLog[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const { id, timestamp } = item as Record<string, unknown>;
    if (typeof id !== 'string' || typeof timestamp !== 'string') continue;
    if (Number.isNaN(new Date(timestamp).getTime()) || seen.has(id)) continue;
    seen.add(id);
    result.push(withUnknownFields(item, { id, timestamp }));
  }
  return result;
}

const isMode = (value: unknown): value is ReactionMode =>
  typeof value === 'string' && (REACTION_MODES as readonly string[]).includes(value);

const isIntInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

export function sanitizeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const value = raw as Record<string, unknown>;
  return withUnknownFields(raw, {
    mode: isMode(value.mode) ? value.mode : DEFAULT_SETTINGS.mode,
    soundEnabled: typeof value.soundEnabled === 'boolean' ? value.soundEnabled : DEFAULT_SETTINGS.soundEnabled,
    hapticsEnabled: typeof value.hapticsEnabled === 'boolean' ? value.hapticsEnabled : DEFAULT_SETTINGS.hapticsEnabled,
    remindersEnabled:
      typeof value.remindersEnabled === 'boolean' ? value.remindersEnabled : DEFAULT_SETTINGS.remindersEnabled,
    reminderHour: isIntInRange(value.reminderHour, 0, 23) ? value.reminderHour : DEFAULT_SETTINGS.reminderHour,
    reminderMinute: isIntInRange(value.reminderMinute, 0, 59) ? value.reminderMinute : DEFAULT_SETTINGS.reminderMinute,
  });
}
