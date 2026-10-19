import {
  Comparison,
  InsightsPeriod,
  PeriodRange,
  PeriodSummary,
  ChartPoint,
  periodRange,
  periodSeries,
  summarizePeriod,
  earliestOffset,
} from './insights';
import { countOnDay, countsByDay, dailySeries, localDayKey, weeklySeries } from './puffLogic';
import { TimedEvent } from './types';

export type DayTotals = { puffs: number; skips: number };

/** Today's separate tallies. Never mixes the two event types. */
export function todayTotals(puffs: readonly TimedEvent[], skips: readonly TimedEvent[], today: Date): DayTotals {
  return { puffs: countOnDay(puffs, today), skips: countOnDay(skips, today) };
}

export function cumulativeCount(events: readonly TimedEvent[]): number {
  return events.length;
}

export function dayCounts(events: readonly TimedEvent[]) {
  return countsByDay(events);
}

export function periodEventSeries(events: readonly TimedEvent[], range: PeriodRange): ChartPoint[] {
  return periodSeries(events, range);
}

export function summarizeEvents(events: readonly TimedEvent[], range: PeriodRange): PeriodSummary {
  return summarizePeriod(events, range);
}

export function earliestEventOffset(events: readonly TimedEvent[], period: InsightsPeriod, today: Date): number {
  return earliestOffset(events, period, today);
}

export function rollingDaily(events: readonly TimedEvent[], today: Date, days: number) {
  return dailySeries(events, today, days);
}

export function rollingWeekly(events: readonly TimedEvent[], today: Date, weeks: number) {
  return weeklySeries(events, today, weeks);
}

export type DualPeriodSummary = {
  range: PeriodRange;
  puffs: PeriodSummary;
  skips: PeriodSummary;
};

/** Side-by-side period totals for Insights. Labels must stay distinct in the UI. */
export function dualPeriodSummary(
  puffs: readonly TimedEvent[],
  skips: readonly TimedEvent[],
  period: InsightsPeriod,
  today: Date,
  offset = 0,
): DualPeriodSummary {
  const range = periodRange(period, today, offset);
  return { range, puffs: summarizePeriod(puffs, range), skips: summarizePeriod(skips, range) };
}

export type PreviousComparison = Comparison;

export function previousPeriodComparison(events: readonly TimedEvent[], range: PeriodRange): Comparison {
  return summarizePeriod(events, range).comparison;
}

/** Count of events whose local day is `dayKey`. */
export function countOnDayKey(events: readonly TimedEvent[], dayKey: string): number {
  let total = 0;
  for (const event of events) if (localDayKey(new Date(event.timestamp)) === dayKey) total += 1;
  return total;
}
