import { formatMonthDay, formatMonthYear } from '../utils/format';
import { addLocalDays, countsByDay, localDayKey } from './puffLogic';
import { PuffLog } from './types';

export type InsightsPeriod = 'week' | 'month' | 'year';

export type PeriodRange = {
  period: InsightsPeriod;
  /** 0 = the period containing today, -1 = the one before, and so on. */
  offset: number;
  /** First local day of the period (local noon, like `addLocalDays`). */
  start: Date;
  /** First local day of the following period. */
  end: Date;
  /** Calendar days in the period. */
  days: number;
  /** Days from the start up to and including today; equals `days` for past periods. */
  elapsedDays: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const noon = (date: Date) => addLocalDays(date, 0);

/** Whole local days between two local-noon dates; rounding absorbs DST hours. */
const daysBetween = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / DAY_MS);

function periodStart(period: InsightsPeriod, today: Date, offset: number): Date {
  const day = noon(today);
  if (period === 'week') return addLocalDays(day, -day.getDay() + offset * 7);
  if (period === 'month') return new Date(day.getFullYear(), day.getMonth() + offset, 1, 12);
  return new Date(day.getFullYear() + offset, 0, 1, 12);
}

function nextPeriodStart(period: InsightsPeriod, start: Date): Date {
  if (period === 'week') return addLocalDays(start, 7);
  if (period === 'month') return new Date(start.getFullYear(), start.getMonth() + 1, 1, 12);
  return new Date(start.getFullYear() + 1, 0, 1, 12);
}

/** Weeks run Sunday to Saturday; months and years follow the local calendar. */
export function periodRange(period: InsightsPeriod, today: Date, offset = 0): PeriodRange {
  const start = periodStart(period, today, offset);
  const end = nextPeriodStart(period, start);
  const days = daysBetween(start, end);
  const elapsedDays = Math.min(days, Math.max(0, daysBetween(start, noon(today)) + 1));
  return { period, offset, start, end, days, elapsedDays };
}

export type ChartPoint = {
  key: string;
  /** First day the point covers. */
  date: Date;
  /** Logged puffs, or null if the point is entirely in the future. */
  count: number | null;
};

function sumDays(counts: Map<string, number>, from: Date, days: number): number {
  let total = 0;
  for (let i = 0; i < days; i += 1) total += counts.get(localDayKey(addLocalDays(from, i))) ?? 0;
  return total;
}

/** One point per day for weeks and months, one per calendar month for years. Zero days are kept. */
export function periodSeries(logs: readonly PuffLog[], range: PeriodRange): ChartPoint[] {
  const counts = countsByDay(logs);
  if (range.period !== 'year') {
    return Array.from({ length: range.days }, (_, i) => {
      const date = addLocalDays(range.start, i);
      return { key: localDayKey(date), date, count: i < range.elapsedDays ? counts.get(localDayKey(date)) ?? 0 : null };
    });
  }
  return Array.from({ length: 12 }, (_, month) => {
    const date = new Date(range.start.getFullYear(), month, 1, 12);
    const monthDays = daysBetween(date, new Date(date.getFullYear(), month + 1, 1, 12));
    const elapsedInMonth = Math.min(monthDays, range.elapsedDays - daysBetween(range.start, date));
    return {
      key: localDayKey(date).slice(0, 7),
      date,
      count: elapsedInMonth > 0 ? sumDays(counts, date, elapsedInMonth) : null,
    };
  });
}

export type Comparison =
  /** Logging started after the comparison window began, so missing days can't be read as zero. */
  | { kind: 'insufficient' }
  | {
      kind: 'change';
      current: number;
      previous: number;
      difference: number;
      /** Rounded percentage change; null when the previous total is zero. */
      percent: number | null;
      /** True when the current period is still in progress and only the same number of days is compared. */
      toDate: boolean;
    };

export type PeriodSummary = {
  range: PeriodRange;
  total: number;
  /** Logged puffs per elapsed calendar day. */
  average: number;
  daysWithLogs: number;
  comparison: Comparison;
};

function earliestLogDayKey(logs: readonly PuffLog[]): string | null {
  let earliest = Infinity;
  for (const log of logs) {
    const time = new Date(log.timestamp).getTime();
    if (Number.isFinite(time) && time < earliest) earliest = time;
  }
  return Number.isFinite(earliest) ? localDayKey(new Date(earliest)) : null;
}

export function summarizePeriod(logs: readonly PuffLog[], range: PeriodRange): PeriodSummary {
  const counts = countsByDay(logs);
  let total = 0;
  let daysWithLogs = 0;
  for (let i = 0; i < range.elapsedDays; i += 1) {
    const count = counts.get(localDayKey(addLocalDays(range.start, i))) ?? 0;
    total += count;
    if (count > 0) daysWithLogs += 1;
  }
  const average = range.elapsedDays > 0 ? total / range.elapsedDays : 0;

  const previous = periodRange(range.period, range.start, -1);
  const toDate = range.elapsedDays < range.days;
  const compareDays = toDate ? Math.min(range.elapsedDays, previous.days) : previous.days;
  const earliest = earliestLogDayKey(logs);

  let comparison: Comparison;
  if (!earliest || range.elapsedDays === 0 || earliest > localDayKey(previous.start)) {
    comparison = { kind: 'insufficient' };
  } else {
    const current = toDate ? sumDays(counts, range.start, compareDays) : total;
    const previousTotal = sumDays(counts, previous.start, compareDays);
    const difference = current - previousTotal;
    comparison = {
      kind: 'change',
      current,
      previous: previousTotal,
      difference,
      percent: previousTotal > 0 ? Math.round((difference / previousTotal) * 100) : null,
      toDate,
    };
  }

  return { range, total, average, daysWithLogs, comparison };
}

/** The earliest offset worth navigating to: the period that contains the first log. */
export function earliestOffset(logs: readonly PuffLog[], period: InsightsPeriod, today: Date): number {
  const earliest = earliestLogDayKey(logs);
  if (!earliest) return 0;
  const [y, m, d] = earliest.split('-').map(Number);
  const first = new Date(y, m - 1, d, 12);
  const now = noon(today);
  if (period === 'week') return -Math.round(daysBetween(periodStart('week', first, 0), periodStart('week', now, 0)) / 7);
  if (period === 'month') return -((now.getFullYear() - y) * 12 + (now.getMonth() - (m - 1)));
  return -(now.getFullYear() - y);
}

/** "This week", "Last month", or null for older periods. */
export function relativePeriodName(range: PeriodRange): string | null {
  if (range.offset === 0) return `This ${range.period}`;
  if (range.offset === -1) return `Last ${range.period}`;
  return null;
}

/** The calendar span, e.g. "Oct 4 – Oct 10", "October 2026", "2026". */
export function periodDateLabel(range: PeriodRange, today: Date): string {
  if (range.period === 'month') return formatMonthYear(range.start);
  if (range.period === 'year') return String(range.start.getFullYear());
  const last = addLocalDays(range.start, range.days - 1);
  const label = `${formatMonthDay(range.start)} – ${formatMonthDay(last)}`;
  return last.getFullYear() === today.getFullYear() && range.start.getFullYear() === today.getFullYear()
    ? label
    : `${label}, ${last.getFullYear()}`;
}

/** One decimal place; a small non-zero average reads "<0.1" rather than a misleading "0.0". */
export function formatAverage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0.0';
  if (value < 0.05) return '<0.1';
  return (Math.round(value * 10) / 10).toFixed(1);
}

/** Neutral one-line comparison, e.g. "12 fewer than this point last week (−20%)". */
export function comparisonText(summary: PeriodSummary): string {
  const { comparison, range } = summary;
  if (comparison.kind === 'insufficient') return 'Not enough data to compare yet';
  const reference = comparison.toDate ? `this point last ${range.period}` : `the ${range.period} before`;
  if (comparison.difference === 0) return `Same as ${reference}`;
  const amount = Math.abs(comparison.difference);
  const direction = comparison.difference < 0 ? 'fewer' : 'more';
  const percent =
    comparison.percent !== null && comparison.percent !== 0
      ? ` (${comparison.percent > 0 ? '+' : '−'}${Math.abs(comparison.percent)}%)`
      : '';
  return `${amount} ${direction} than ${reference}${percent}`;
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

export const DAY_PARTS: { part: DayPart; label: string; hours: string }[] = [
  { part: 'morning', label: 'Morning', hours: '5:00–11:59' },
  { part: 'afternoon', label: 'Afternoon', hours: '12:00–16:59' },
  { part: 'evening', label: 'Evening', hours: '17:00–20:59' },
  { part: 'night', label: 'Night', hours: '21:00–4:59' },
];

/** Minimum logged puffs in a period before time-of-day patterns are shown. */
export const MIN_LOGS_FOR_PATTERNS = 5;

export function dayPartOf(date: Date): DayPart {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

export type DayPartShare = { part: DayPart; count: number; percent: number };

/** Logs in the elapsed part of `range`, grouped by local time of day. Percentages sum to 100. */
export function timeOfDayBreakdown(logs: readonly PuffLog[], range: PeriodRange): { total: number; parts: DayPartShare[] } {
  const from = new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate()).getTime();
  const lastDay = addLocalDays(range.start, range.elapsedDays);
  const to = new Date(lastDay.getFullYear(), lastDay.getMonth(), lastDay.getDate()).getTime();
  const counts: Record<DayPart, number> = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  let total = 0;
  for (const log of logs) {
    const date = new Date(log.timestamp);
    const time = date.getTime();
    if (!Number.isFinite(time) || time < from || time >= to) continue;
    counts[dayPartOf(date)] += 1;
    total += 1;
  }

  // Largest-remainder rounding so the shown percentages always add up to 100.
  const exact = DAY_PARTS.map(({ part }) => (total ? (counts[part] / total) * 100 : 0));
  const percents = exact.map(Math.floor);
  let remaining = total ? 100 - percents.reduce((sum, value) => sum + value, 0) : 0;
  const byRemainder = exact.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (const { index } of byRemainder) {
    if (remaining <= 0) break;
    percents[index] += 1;
    remaining -= 1;
  }

  return { total, parts: DAY_PARTS.map(({ part }, index) => ({ part, count: counts[part], percent: percents[index] })) };
}
