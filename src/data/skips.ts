import { addLocalDays, createLog, dayKeyOfLog, latestRecordedLog, localDayKey, sanitizeLogs } from './puffLogic';
import { SkipLog } from './types';

/** Only ever called when the person taps + Skip; skips are never estimated or added automatically. */
export const createSkip = (now: Date = new Date()): SkipLog => {
  const log = createLog(now);
  return { id: log.id, timestamp: log.timestamp };
};

/** Drop product/unit fields that puff sanitization may preserve — skips are never consumption. */
export const sanitizeSkips = (raw: unknown): SkipLog[] =>
  sanitizeLogs(raw).map(({ id, timestamp }) => ({ id, timestamp }));

/** The skip Undo skip removes: the last one recorded, only if it was logged on `todayKey`. */
export function latestSkipToday(skips: readonly SkipLog[], todayKey: string): SkipLog | null {
  const latest = latestRecordedLog(skips);
  return latest && dayKeyOfLog(latest) === todayKey ? latest : null;
}

export type SkipDayGroup = { key: string; date: Date; skips: SkipLog[] };

/** Newest day first; skips inside a day newest first. Mirrors puff history grouping. */
export function groupSkipsByDay(skips: readonly SkipLog[]): SkipDayGroup[] {
  const groups = new Map<string, SkipDayGroup>();
  for (const skip of skips) {
    const date = new Date(skip.timestamp);
    const key = localDayKey(date);
    let group = groups.get(key);
    if (!group) {
      group = { key, date: addLocalDays(date, 0), skips: [] };
      groups.set(key, group);
    }
    group.skips.push(skip);
  }
  const sorted = [...groups.values()].sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0));
  for (const group of sorted) {
    group.skips.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }
  return sorted;
}
