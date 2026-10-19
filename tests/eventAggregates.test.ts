import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  cumulativeCount,
  dualPeriodSummary,
  previousPeriodComparison,
  todayTotals,
} from '../src/data/eventAggregates';
import { periodRange } from '../src/data/insights';
import { localDayKey } from '../src/data/puffLogic';
import { TimedEvent } from '../src/data/types';

const at = (y: number, m: number, d: number, h = 12, min = 0): Date => new Date(y, m - 1, d, h, min);
const eventAt = (date: Date, _id?: string): TimedEvent => ({ timestamp: date.toISOString() });

describe('today totals', () => {
  test('counts puffs and skips separately for the local day', () => {
    const today = at(2026, 10, 16, 18);
    const puffs = [eventAt(at(2026, 10, 16, 9), 'p1'), eventAt(at(2026, 10, 16, 14), 'p2'), eventAt(at(2026, 10, 15, 22), 'p0')];
    const skips = [eventAt(at(2026, 10, 16, 10), 's1'), eventAt(at(2026, 10, 15, 11), 's0')];
    assert.deepEqual(todayTotals(puffs, skips, today), { puffs: 2, skips: 1 });
  });

  test('local midnight boundary: late evening and early morning are different days', () => {
    const late = at(2026, 10, 16, 23, 50);
    const early = at(2026, 10, 17, 0, 10);
    const puffs = [eventAt(late, 'a'), eventAt(early, 'b')];
    assert.equal(todayTotals(puffs, [], late).puffs, 1);
    assert.equal(todayTotals(puffs, [], early).puffs, 1);
    assert.notEqual(localDayKey(late), localDayKey(early));
  });
});

describe('period aggregations', () => {
  // Wednesday Oct 7, 2026 — week starts Sunday Oct 4.
  const wed = at(2026, 10, 7, 15);
  const puffs = [
    ...Array.from({ length: 3 }, (_, i) => eventAt(at(2026, 10, 5, 10 + i), `p-${i}`)),
    ...Array.from({ length: 2 }, (_, i) => eventAt(at(2026, 10, 7, 9 + i), `p2-${i}`)),
  ];
  const skips = [
    eventAt(at(2026, 10, 6, 12), 's1'),
    eventAt(at(2026, 10, 7, 12), 's2'),
    eventAt(at(2026, 10, 7, 15), 's3'),
  ];

  test('weekly dual summary keeps puffs and skips independent', () => {
    const dual = dualPeriodSummary(puffs, skips, 'week', wed);
    assert.equal(dual.puffs.total, 5);
    assert.equal(dual.skips.total, 3);
    assert.equal(dual.range.days, 7);
    assert.equal(localDayKey(dual.range.start), '2026-10-04');
  });

  test('monthly and yearly totals use the same periodRange conventions', () => {
    const month = dualPeriodSummary(puffs, skips, 'month', wed);
    const year = dualPeriodSummary(puffs, skips, 'year', wed);
    assert.equal(month.puffs.total, 5);
    assert.equal(month.skips.total, 3);
    assert.equal(year.puffs.total, 5);
    assert.equal(year.skips.total, 3);
    assert.equal(month.range.period, 'month');
    assert.equal(year.range.period, 'year');
  });

  test('previous-period comparison is derived from stored events, not a separate counter', () => {
    const range = periodRange('week', wed);
    const comparison = previousPeriodComparison(puffs, range);
    assert.ok(comparison.kind === 'insufficient' || comparison.kind === 'change');
  });

  test('cumulative skips are the length of persisted history', () => {
    assert.equal(cumulativeCount(skips), 3);
    assert.equal(cumulativeCount([]), 0);
  });
});
