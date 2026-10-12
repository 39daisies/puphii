import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { baselineFromEstimate, baselineFromHistory, MIN_TRACKED_DAYS } from '../src/plan/baseline';
import { planWeekLabel, settleLine } from '../src/plan/copy';
import { addDays, dayFromIndex, dayIndex, daysBetween, isDayKey } from '../src/plan/days';
import { planDays, summarizeDays, todayProgress } from '../src/plan/progress';
import {
  activeDaysBefore,
  planWeek,
  projectTargets,
  segmentForDay,
  targetForDay,
  targetForWeek,
  weekNumber,
  weekReachingSettle,
  weeklyStep,
} from '../src/plan/schedule';
import { history, logsOn, planWith, segment } from './plan/fixtures';

describe('calendar days', () => {
  test('day keys are validated as real calendar dates', () => {
    for (const key of ['2026-10-12', '2028-02-29', '2026-12-31']) assert.equal(isDayKey(key), true, key);
    for (const key of ['2026-02-30', '2026-13-01', '2026-1-01', '20261012', '', null, 20261012]) assert.equal(isDayKey(key), false, String(key));
  });

  test('arithmetic is in whole calendar days, unaffected by daylight-saving changes', () => {
    assert.equal(daysBetween('2026-03-07', '2026-03-09'), 2, 'US spring forward');
    assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2, 'EU fall back');
    assert.equal(addDays('2026-12-31', 1), '2027-01-01');
    assert.equal(addDays('2028-02-28', 1), '2028-02-29');
    assert.equal(addDays('2026-03-01', -1), '2026-02-28');
    assert.equal(daysBetween('2026-10-20', '2026-10-01'), -19);
    assert.equal(dayFromIndex(dayIndex('2026-10-12')), '2026-10-12');
  });
});

describe('daily targets', () => {
  test('each week drops by a fixed share of the original baseline, then settles', () => {
    const plan = segment({ baselinePerDay: 20, startTarget: 20, pace: { preset: 'steady', percent: 10 }, settleAt: 10 });
    assert.equal(weeklyStep(plan), 2);
    assert.deepEqual(projectTargets(plan, 8), [20, 18, 16, 14, 12, 10, 10, 10]);
  });

  test('fractional steps round up to whole puffs, without floating-point drift', () => {
    const plan = segment({ baselinePerDay: 14, startTarget: 14, pace: { preset: 'steady', percent: 10 }, settleAt: 7 });
    assert.deepEqual(projectTargets(plan, 7), [14, 13, 12, 10, 9, 7, 7], '12.6→13, 11.2→12, 9.8→10, 8.4→9, 7.0 stays 7');
    const gentle = segment({ baselinePerDay: 14, startTarget: 14, pace: { preset: 'gentle', percent: 5 }, settleAt: 0, goal: 'quit' });
    assert.equal(targetForWeek(gentle, 10), 7, '14 - 0.7 × 10 is exactly 7, not 8');
    assert.equal(targetForWeek(gentle, 20), 0);
    assert.equal(targetForWeek(gentle, 99), 0, 'never negative');
  });

  test('targets are whole, never increase, and never go below the settle level', () => {
    for (const baseline of [1, 2.5, 7, 13.4, 20, 41.7, 300]) {
      for (const percent of [1, 5, 10, 17, 20, 50]) {
        for (const settleAt of [0, 1, 5]) {
          const start = Math.ceil(baseline);
          if (settleAt >= start && settleAt !== 0) continue;
          const plan = segment({ baselinePerDay: baseline, startTarget: start, pace: { preset: 'custom', percent }, settleAt });
          const targets = projectTargets(plan, 120);
          targets.forEach((target, week) => {
            assert.ok(Number.isInteger(target) && target >= settleAt, `${baseline}/${percent}%/${settleAt} week ${week}: ${target}`);
            if (week) assert.ok(target <= targets[week - 1], `${baseline}/${percent}% rose in week ${week}`);
          });
          assert.equal(targets[0], start);
        }
      }
    }
  });

  test('the week the target first reaches the settle level', () => {
    assert.equal(weekReachingSettle(segment({ baselinePerDay: 20, startTarget: 20, settleAt: 10 })), 5);
    assert.equal(weekReachingSettle(segment({ baselinePerDay: 14, startTarget: 14, settleAt: 7 })), 5);
    assert.equal(weekReachingSettle(segment({ goal: 'quit', baselinePerDay: 20, startTarget: 20, settleAt: 0 })), 10);
    assert.equal(weekReachingSettle(segment({ baselinePerDay: 13.4, startTarget: 14, pace: { preset: 'gentle', percent: 5 }, settleAt: 7 })), 11);
  });

  test('week numbers people see start at Week 1: Gentle from 14 settles at 7 in Week 11, after 10 weeks', () => {
    const gentle = segment({ startedOn: '2026-10-01', baselinePerDay: 14, startTarget: 14, pace: { preset: 'gentle', percent: 5 }, settleAt: 7 });
    assert.deepEqual(projectTargets(gentle, 11), [14, 14, 13, 12, 12, 11, 10, 10, 9, 8, 7]);
    const settleWeek = weekReachingSettle(gentle)!;
    assert.equal(settleWeek, 10);
    assert.equal(weekNumber(settleWeek), 11);
    assert.equal(planWeekLabel(settleWeek), 'Week 11');
    assert.equal(planWeekLabel(planWeek(gentle, [], '2026-10-01')), 'Week 1', 'the starting week');
    assert.equal(settleLine(7, settleWeek), 'If you follow this pace, the daily target would reach 7 in Week 11.');

    const plan = planWith([gentle]);
    assert.equal(planWeekLabel(planWeek(gentle, [], '2026-12-09')), 'Week 10');
    assert.equal(targetForDay(plan, '2026-12-09'), 8, 'last day of Week 10: 14 − 0.7 × 9 = 7.7, shown as 8');
    assert.equal(planWeekLabel(planWeek(gentle, [], '2026-12-10')), 'Week 11');
    assert.equal(targetForDay(plan, '2026-12-10'), 7, 'first day of Week 11, 70 days after the start');
  });

  test('targets change once per active plan week, counted in calendar days', () => {
    const plan = planWith([segment({ startedOn: '2026-10-01' })]);
    assert.equal(targetForDay(plan, '2026-09-30'), null, 'no target before the plan');
    assert.equal(targetForDay(plan, '2026-10-01'), 20);
    assert.equal(targetForDay(plan, '2026-10-07'), 20);
    assert.equal(targetForDay(plan, '2026-10-08'), 18);
    assert.equal(targetForDay(plan, '2026-10-15'), 16);
  });

  test('pausing freezes the schedule: paused days have no target and do not advance it', () => {
    const plan = planWith([segment({ startedOn: '2026-10-01' })], { pauses: [{ from: '2026-10-05', to: '2026-10-12' }] });
    assert.equal(targetForDay(plan, '2026-10-05'), null);
    assert.equal(targetForDay(plan, '2026-10-11'), null);
    assert.equal(activeDaysBefore(plan.segments[0], plan.pauses, '2026-10-12'), 4);
    assert.equal(targetForDay(plan, '2026-10-12'), 20, 'resumes where it stopped: day 5 of week 1');
    assert.equal(planWeek(plan.segments[0], plan.pauses, '2026-10-15'), 1);
    assert.equal(targetForDay(plan, '2026-10-15'), 18);
    const open = planWith([segment({ startedOn: '2026-10-01' })], { pauses: [{ from: '2026-10-05', to: null }] });
    assert.equal(targetForDay(open, '2026-10-30'), null);
  });

  test('past days keep the target of the segment that applied then', () => {
    const plan = planWith([
      segment({ startedOn: '2026-10-01', endedOn: '2026-10-15' }),
      segment({ startedOn: '2026-10-15', startTarget: 16, pace: { preset: 'gentle', percent: 5 }, reason: 'revise' }),
    ]);
    assert.equal(segmentForDay(plan, '2026-10-14'), plan.segments[0]);
    assert.equal(targetForDay(plan, '2026-10-14'), 18);
    assert.equal(targetForDay(plan, '2026-10-15'), 16);
    assert.equal(targetForDay(plan, '2026-10-22'), 15, 'gentle: 5% of the original 20 = 1 a week');
    const ended = planWith([segment({ startedOn: '2026-10-01', endedOn: '2026-10-10' })]);
    assert.equal(targetForDay(ended, '2026-10-10'), null, 'no target after the plan ended');
  });
});

describe('baseline from history', () => {
  const today = '2026-10-20';

  test('averages tracked days in the last two weeks, leaving untracked days out', () => {
    const logs = history({ '2026-10-19': 12, '2026-10-17': 15, '2026-10-12': 10, '2026-10-06': 13 });
    const result = baselineFromHistory(logs, [], today);
    assert.deepEqual(result, { status: 'ok', perDay: 12.5, trackedDays: 4, loggedDays: 4, confirmedZeroDays: 0, untrackedDays: 10 });
  });

  test('confirmed puff-free days count as zero; days with no activity never do', () => {
    const logs = history({ '2026-10-19': 12, '2026-10-18': 12 });
    const result = baselineFromHistory(logs, ['2026-10-17', '2026-10-16'], today);
    assert.ok(result.status === 'ok');
    assert.equal(result.perDay, 6);
    assert.equal(result.confirmedZeroDays, 2);
    assert.deepEqual(baselineFromHistory(logs, [], today), { status: 'notEnoughData', trackedDays: 2, needed: MIN_TRACKED_DAYS });
  });

  test('a log on a confirmed day overrides the confirmation', () => {
    const logs = history({ '2026-10-19': 9, '2026-10-18': 9, '2026-10-17': 9 });
    const result = baselineFromHistory(logs, ['2026-10-17'], today);
    assert.ok(result.status === 'ok');
    assert.deepEqual([result.perDay, result.loggedDays, result.confirmedZeroDays], [9, 3, 0]);
  });

  test('today and days older than two weeks are ignored', () => {
    const logs = history({ '2026-10-20': 50, '2026-10-06': 4, '2026-10-05': 99, '2026-10-19': 4, '2026-10-18': 4 });
    const result = baselineFromHistory(logs, [], today);
    assert.ok(result.status === 'ok');
    assert.deepEqual([result.perDay, result.trackedDays], [4, 3]);
  });

  test('too few tracked days, or only confirmed zeros, give no baseline', () => {
    assert.equal(baselineFromHistory([], [], today).status, 'notEnoughData');
    assert.deepEqual(baselineFromHistory([], ['2026-10-19', '2026-10-18', '2026-10-17'], today), { status: 'zero', trackedDays: 3 });
  });

  test('typed estimates are rounded to one decimal and kept within limits', () => {
    assert.equal(baselineFromEstimate(12.34), 12.3);
    assert.equal(baselineFromEstimate(1000), 1000);
    for (const bad of [0.4, 0, -3, 1001, NaN, null]) assert.equal(baselineFromEstimate(bad), null, String(bad));
  });
});

describe('progress', () => {
  const plan = planWith([segment({ startedOn: '2026-10-01', baselinePerDay: 20, startTarget: 20, settleAt: 10 })]);
  const today = '2026-10-15'; // week 2: target 16

  test('today reports what was logged next to the target; no logs yet is not "within target"', () => {
    assert.deepEqual(todayProgress(plan, [], today), {
      kind: 'active', count: 0, target: 16, state: 'noLogsYet', above: 0, atSettleLevel: false, goal: 'reduce',
    });
    assert.equal((todayProgress(plan, logsOn(today, 9), today) as { state: string }).state, 'withinTarget');
    assert.equal((todayProgress(plan, logsOn(today, 16), today) as { state: string }).state, 'withinTarget');
    const above = todayProgress(plan, logsOn(today, 19), today);
    assert.ok(above.kind === 'active' && above.state === 'aboveTarget' && above.above === 3);
  });

  test('a confirmed puff-free day shows as such until a puff is logged', () => {
    const confirmed = { ...plan, confirmedZeroDays: [today] };
    assert.equal((todayProgress(confirmed, [], today) as { state: string }).state, 'confirmedZero');
    assert.equal((todayProgress(confirmed, logsOn(today, 1), today) as { state: string }).state, 'withinTarget');
  });

  test('no plan, paused and settle-level states', () => {
    assert.deepEqual(todayProgress(planWith([]), logsOn(today, 3), today), { kind: 'noPlan' });
    const paused = { ...plan, pauses: [{ from: '2026-10-14', to: null }] };
    assert.deepEqual(todayProgress(paused, logsOn(today, 3), today), { kind: 'paused', count: 3 });
    const late = todayProgress(plan, [], '2026-11-30');
    assert.ok(late.kind === 'active' && late.target === 10 && late.atSettleLevel);
    const quit = planWith([segment({ goal: 'quit', settleAt: 0, startedOn: '2026-01-01' })]);
    const zero = todayProgress(quit, [], '2026-10-15');
    assert.ok(zero.kind === 'active' && zero.target === 0 && zero.atSettleLevel && zero.goal === 'quit');
  });

  test('finished days are within, above or untracked; today, future, paused and pre-plan days are not judged', () => {
    const paused = { ...plan, pauses: [{ from: '2026-10-03', to: '2026-10-04' }] };
    const logs = history({ '2026-09-30': 30, '2026-10-01': 18, '2026-10-02': 25, '2026-10-03': 40, '2026-10-05': 20 });
    const days = planDays(paused, logs, '2026-09-30', 8, '2026-10-06');
    assert.deepEqual(
      days.map((d) => [d.day, d.status, d.target]),
      [
        ['2026-09-30', 'outsidePlan', null],
        ['2026-10-01', 'withinTarget', 20],
        ['2026-10-02', 'aboveTarget', 20],
        ['2026-10-03', 'paused', null],
        ['2026-10-04', 'untracked', 20],
        ['2026-10-05', 'withinTarget', 20],
        ['2026-10-06', 'today', 20],
        ['2026-10-07', 'future', 20],
      ],
    );
  });

  test('weekly summaries average tracked days only', () => {
    const logs = history({ '2026-10-01': 18, '2026-10-02': 22, '2026-10-04': 14 });
    const summary = summarizeDays(planDays(plan, logs, '2026-10-01', 7, '2026-10-06'));
    assert.deepEqual(summary, {
      finishedDays: 5, trackedDays: 3, withinTargetDays: 2, aboveTargetDays: 1, untrackedDays: 2, averageLogged: 18, averageTarget: 20,
    });
  });
});
