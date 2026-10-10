import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  comparisonText,
  dayPartOf,
  earliestOffset,
  formatAverage,
  periodDateLabel,
  periodRange,
  periodSeries,
  relativePeriodName,
  summarizePeriod,
  timeOfDayBreakdown,
} from '../src/data/insights';
import { localDayKey } from '../src/data/puffLogic';
import { PuffLog } from '../src/data/types';

const at = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min);
let seq = 0;
const logAt = (date: Date): PuffLog => ({ id: `log-${(seq += 1)}`, timestamp: date.toISOString() });
const logsOn = (date: Date, count: number) => Array.from({ length: count }, () => logAt(date));

// 2026-10-07 is a Wednesday; its Sunday-to-Saturday week is Oct 4–10.
const WEDNESDAY = at(2026, 10, 7, 15);

describe('period boundaries', () => {
  test('weeks run Sunday to Saturday on the local calendar', () => {
    const week = periodRange('week', WEDNESDAY);
    assert.equal(localDayKey(week.start), '2026-10-04');
    assert.equal(localDayKey(week.end), '2026-10-11');
    assert.equal(week.days, 7);
    assert.equal(week.elapsedDays, 4);

    const sunday = periodRange('week', at(2026, 10, 4, 0, 1));
    assert.equal(localDayKey(sunday.start), '2026-10-04');
    assert.equal(sunday.elapsedDays, 1);

    const previous = periodRange('week', WEDNESDAY, -1);
    assert.equal(localDayKey(previous.start), '2026-09-27');
    assert.equal(previous.elapsedDays, 7);
  });

  test('a week can span the new year', () => {
    const week = periodRange('week', at(2027, 1, 1));
    assert.equal(localDayKey(week.start), '2026-12-27');
    assert.equal(localDayKey(week.end), '2027-01-03');
  });

  test('a week containing a daylight-saving change still has seven days', () => {
    // US clocks change on 2026-03-08 and EU clocks on 2026-03-29; both fall on Sundays.
    for (const day of [at(2026, 3, 10), at(2026, 3, 31), at(2026, 11, 3)]) {
      const week = periodRange('week', day, -1);
      assert.equal(week.days, 7);
      const keys = periodSeries([], week).map((point) => point.key);
      assert.equal(new Set(keys).size, 7);
    }
  });

  test('months follow calendar length, including leap February and the year change', () => {
    const feb = periodRange('month', at(2028, 3, 15), -1);
    assert.equal(localDayKey(feb.start), '2028-02-01');
    assert.equal(feb.days, 29);
    assert.equal(feb.elapsedDays, 29);

    const december = periodRange('month', at(2027, 1, 10), -1);
    assert.equal(localDayKey(december.start), '2026-12-01');
    assert.equal(december.days, 31);

    const current = periodRange('month', WEDNESDAY);
    assert.equal(current.days, 31);
    assert.equal(current.elapsedDays, 7);
  });

  test('years cover January to December', () => {
    const year = periodRange('year', at(2026, 10, 10));
    assert.equal(localDayKey(year.start), '2026-01-01');
    assert.equal(localDayKey(year.end), '2027-01-01');
    assert.equal(year.days, 365);
    assert.equal(year.elapsedDays, 283);
    assert.equal(periodRange('year', at(2029, 6, 1), -1).days, 366);
  });

  test('the earliest reachable offset is the period containing the first log', () => {
    const today = at(2026, 10, 10);
    const logs = [logAt(at(2026, 5, 1)), logAt(at(2025, 12, 30, 8))];
    assert.equal(earliestOffset(logs, 'week', today), -40);
    assert.equal(earliestOffset(logs, 'month', today), -10);
    assert.equal(earliestOffset(logs, 'year', today), -1);
    assert.equal(earliestOffset([], 'month', today), 0);
  });
});

describe('chart series', () => {
  test('week series keeps zero days and marks future days as empty', () => {
    const logs = logsOn(at(2026, 10, 5, 9), 2);
    const series = periodSeries(logs, periodRange('week', WEDNESDAY));
    assert.deepEqual(
      series.map((point) => point.count),
      [0, 2, 0, 0, null, null, null],
    );
  });

  test('month series has one point per calendar day', () => {
    const series = periodSeries(logsOn(at(2028, 2, 29, 23, 59), 3), periodRange('month', at(2028, 3, 1), -1));
    assert.equal(series.length, 29);
    assert.equal(series[28].count, 3);
    assert.equal(series[0].count, 0);
  });

  test('year series totals each month and excludes other years', () => {
    const logs = [
      logAt(at(2027, 12, 31, 23, 59)),
      logAt(at(2028, 1, 31, 23, 59)),
      logAt(at(2028, 2, 29, 0, 0)),
      ...logsOn(at(2028, 3, 15, 8), 2),
    ];
    const series = periodSeries(logs, periodRange('year', at(2028, 3, 15, 20)));
    assert.equal(series.length, 12);
    assert.deepEqual(series.slice(0, 3).map((point) => point.count), [1, 1, 2]);
    assert.ok(series.slice(3).every((point) => point.count === null));
  });
});

describe('period summary', () => {
  test('total, average per elapsed calendar day, and days with logs', () => {
    const logs = [
      logAt(at(2026, 10, 3, 23, 59)), // Saturday of the previous week
      ...logsOn(at(2026, 10, 4, 0, 0), 3),
      ...logsOn(at(2026, 10, 6, 18), 2),
    ];
    const summary = summarizePeriod(logs, periodRange('week', WEDNESDAY));
    assert.equal(summary.total, 5);
    assert.equal(summary.average, 5 / 4);
    assert.equal(summary.daysWithLogs, 2);
    assert.equal(formatAverage(summary.average), '1.3');
  });

  test('a past period averages over all of its days', () => {
    const logs = logsOn(at(2026, 9, 15), 15);
    const summary = summarizePeriod(logs, periodRange('month', WEDNESDAY, -1));
    assert.equal(summary.total, 15);
    assert.equal(summary.average, 0.5);
  });

  test('empty and malformed data never produce NaN or Infinity', () => {
    const malformed = [{ id: 'bad', timestamp: 'not a date' }, { id: 'empty', timestamp: '' }] as PuffLog[];
    for (const logs of [[], malformed]) {
      for (const period of ['week', 'month', 'year'] as const) {
        const summary = summarizePeriod(logs, periodRange(period, WEDNESDAY));
        assert.equal(summary.total, 0);
        assert.equal(summary.average, 0);
        assert.equal(summary.daysWithLogs, 0);
        assert.equal(summary.comparison.kind, 'insufficient');
        assert.equal(comparisonText(summary), 'Not enough data to compare yet');
        assert.equal(formatAverage(summary.average), '0.0');
      }
    }
    assert.equal(formatAverage(NaN), '0.0');
    assert.equal(formatAverage(Infinity), '0.0');
    assert.equal(formatAverage(11 / 283), '<0.1');
    assert.equal(formatAverage(0.05), '0.1');
  });
});

describe('period comparison', () => {
  test('a current period is compared with the same number of days in the previous one', () => {
    const logs = [
      ...logsOn(at(2026, 9, 27), 4), // Sunday last week, inside the 4-day window
      ...logsOn(at(2026, 10, 1), 6), // Thursday last week, outside the window
      ...logsOn(at(2026, 10, 5), 1),
    ];
    const summary = summarizePeriod(logs, periodRange('week', WEDNESDAY));
    assert.deepEqual(summary.comparison, { kind: 'change', current: 1, previous: 4, difference: -3, percent: -75, toDate: true });
    assert.equal(comparisonText(summary), '3 fewer than this point last week (−75%)');
  });

  test('a past period is compared in full with the period before it', () => {
    const logs = [...logsOn(at(2028, 1, 1), 10), ...logsOn(at(2028, 2, 29), 12)];
    const summary = summarizePeriod(logs, periodRange('month', at(2028, 3, 15), -1));
    assert.equal(summary.comparison.kind, 'change');
    if (summary.comparison.kind !== 'change') return;
    assert.equal(summary.comparison.toDate, false);
    assert.equal(summary.comparison.percent, 20);
    assert.equal(comparisonText(summary), '2 more than the month before (+20%)');
  });

  test('a zero previous period gives a difference without a percentage', () => {
    const logs = [logAt(at(2026, 9, 1)), ...logsOn(at(2026, 10, 5), 3)];
    const summary = summarizePeriod(logs, periodRange('week', WEDNESDAY));
    assert.equal(summary.comparison.kind, 'change');
    if (summary.comparison.kind !== 'change') return;
    assert.equal(summary.comparison.previous, 0);
    assert.equal(summary.comparison.percent, null);
    assert.equal(comparisonText(summary), '3 more than this point last week');
  });

  test('equal periods, including two empty ones, read as the same', () => {
    const logs = [logAt(at(2026, 9, 1))];
    const summary = summarizePeriod(logs, periodRange('week', WEDNESDAY));
    assert.equal(comparisonText(summary), 'Same as this point last week');
  });

  test('logging that started during the previous period is not enough to compare', () => {
    const logs = [...logsOn(at(2026, 9, 29), 5), ...logsOn(at(2026, 10, 5), 1)];
    const summary = summarizePeriod(logs, periodRange('week', WEDNESDAY));
    assert.equal(summary.comparison.kind, 'insufficient');
  });

  test('comparison covers the year boundary', () => {
    const logs = [...logsOn(at(2026, 12, 1), 8), ...logsOn(at(2027, 1, 2), 2)];
    const summary = summarizePeriod(logs, periodRange('month', at(2027, 1, 10)));
    assert.equal(summary.comparison.kind, 'change');
    if (summary.comparison.kind !== 'change') return;
    assert.equal(summary.comparison.previous, 8);
    assert.equal(summary.comparison.current, 2);
  });
});

describe('time of day', () => {
  test('bucket edges', () => {
    const cases: [number, number, string][] = [
      [0, 0, 'night'],
      [4, 59, 'night'],
      [5, 0, 'morning'],
      [11, 59, 'morning'],
      [12, 0, 'afternoon'],
      [16, 59, 'afternoon'],
      [17, 0, 'evening'],
      [20, 59, 'evening'],
      [21, 0, 'night'],
      [23, 59, 'night'],
    ];
    for (const [hour, minute, part] of cases) assert.equal(dayPartOf(at(2026, 10, 5, hour, minute)), part, `${hour}:${minute}`);
  });

  test('counts only logs inside the period and percentages add up to 100', () => {
    const logs = [
      logAt(at(2026, 10, 3, 23, 30)), // previous week
      logAt(at(2026, 10, 4, 0, 10)),
      logAt(at(2026, 10, 5, 8)),
      logAt(at(2026, 10, 6, 13)),
      { id: 'bad', timestamp: 'nope' },
    ];
    const { total, parts } = timeOfDayBreakdown(logs, periodRange('week', WEDNESDAY));
    assert.equal(total, 3);
    assert.deepEqual(parts.map((p) => p.count), [1, 1, 0, 1]);
    assert.equal(parts.reduce((sum, p) => sum + p.percent, 0), 100);
    assert.deepEqual(parts.map((p) => p.percent), [34, 33, 0, 33]);
  });

  test('empty data has no invented shares', () => {
    const { total, parts } = timeOfDayBreakdown([], periodRange('year', WEDNESDAY));
    assert.equal(total, 0);
    assert.ok(parts.every((p) => p.count === 0 && p.percent === 0));
  });
});

describe('labels', () => {
  test('relative names and calendar labels', () => {
    assert.equal(relativePeriodName(periodRange('week', WEDNESDAY)), 'This week');
    assert.equal(relativePeriodName(periodRange('month', WEDNESDAY, -1)), 'Last month');
    assert.equal(relativePeriodName(periodRange('year', WEDNESDAY, -2)), null);
    assert.equal(periodDateLabel(periodRange('year', WEDNESDAY, -1), WEDNESDAY), '2025');
    assert.ok(periodDateLabel(periodRange('week', at(2026, 1, 2)), at(2026, 1, 2)).endsWith(', 2026'));
    assert.ok(!periodDateLabel(periodRange('week', WEDNESDAY), WEDNESDAY).includes('2026'));
  });
});
