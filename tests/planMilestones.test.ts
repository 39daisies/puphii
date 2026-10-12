import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { addMilestones, endPlan, paceFor, pausePlan, restartPlan, resumePlan, revisePlan, startPlan } from '../src/plan/actions';
import { createPlanEventBus, detectPlanEvents, PlanEvent, planSnapshot } from '../src/plan/events';
import { newMilestones, reachedMilestones } from '../src/plan/milestones';
import { defaultPlan, PlanRecord } from '../src/plan/model';
import { history, logsOn, NOW, planWith, segment } from './plan/fixtures';

const ids = (plan: PlanRecord, logs: Parameters<typeof reachedMilestones>[1], today: string) =>
  Object.fromEntries(reachedMilestones(plan, logs, today).map((m) => [m.id, m.reachedOn]));

describe('milestones', () => {
  // Week 0 runs Oct 1–7 with a target of 20 (baseline 20, steady, settle 10).
  const plan = planWith([segment({ startedOn: '2026-10-01' })]);

  test('days with no activity earn nothing, however many there are', () => {
    assert.deepEqual(reachedMilestones(plan, [], '2026-12-31'), []);
  });

  test('days within target are counted in total, never reset by a day above target or a gap', () => {
    const small = planWith([segment({ startedOn: '2026-10-01', baselinePerDay: 10, startTarget: 10, settleAt: 5 })]);
    const logs = history({ '2026-10-01': 8, '2026-10-02': 12, '2026-10-03': 9, '2026-10-05': 10 });
    assert.deepEqual(ids(small, logs, '2026-10-06'), { firstDayWithinTarget: '2026-10-01', daysWithinTarget3: '2026-10-05' });
  });

  test('today is never judged, and paused days count for nothing', () => {
    assert.deepEqual(ids(plan, logsOn('2026-10-01', 5), '2026-10-01'), {});
    const paused = { ...plan, pauses: [{ from: '2026-10-02', to: '2026-10-04' }] };
    const logs = history({ '2026-10-01': 15, '2026-10-02': 15, '2026-10-03': 15 });
    assert.deepEqual(ids(paused, logs, '2026-10-05'), { firstDayWithinTarget: '2026-10-01' });
  });

  test('the puff-free milestone needs an explicit confirmation; no logs alone never earns it', () => {
    const quit = planWith([segment({ goal: 'quit', settleAt: 0, startedOn: '2026-10-01' })]);
    assert.deepEqual(ids(quit, [], '2026-10-10'), {}, 'nine days without logs prove nothing');
    const confirmed = { ...quit, confirmedZeroDays: ['2026-10-04'] };
    assert.deepEqual(ids(confirmed, [], '2026-10-10'), { firstDayWithinTarget: '2026-10-04', firstConfirmedPuffFreeDay: '2026-10-04' });
    assert.deepEqual(ids(confirmed, logsOn('2026-10-04', 1), '2026-10-10'), { firstDayWithinTarget: '2026-10-04' }, 'a log overrides the confirmation');
    assert.deepEqual(ids(confirmed, [], '2026-10-04'), {}, 'not before the day is over');
  });

  test('the settle level counts only on a tracked day', () => {
    const late = planWith([segment({ startedOn: '2026-10-01', settleAt: 10 })]);
    assert.equal(ids(late, [], '2026-10-10').settleLevelReached, undefined);
    assert.equal(ids(late, logsOn('2026-10-03', 9), '2026-10-10').settleLevelReached, '2026-10-03');
    assert.equal(ids(late, [], '2026-10-10').settleLevelReached, undefined);
    assert.equal(ids({ ...late, confirmedZeroDays: ['2026-10-02'] }, [], '2026-10-10').settleLevelReached, '2026-10-02');
  });

  test('a plan week counts only with at least 4 tracked days', () => {
    const three = history({ '2026-10-01': 15, '2026-10-02': 15, '2026-10-03': 15 });
    assert.equal(ids(plan, three, '2026-10-08').firstPlanWeek, undefined);
    const four = history({ '2026-10-01': 15, '2026-10-02': 15, '2026-10-03': 15, '2026-10-06': 15 });
    assert.equal(ids(plan, four, '2026-10-08').firstPlanWeek, '2026-10-07');
    assert.equal(ids(plan, four, '2026-10-07').firstPlanWeek, undefined, 'the week is not over yet');
  });

  test('weekly averages use tracked days only, never treating gaps as zero', () => {
    // 4 tracked days of 15 and 3 untracked: an average of 15 (25% below 20), not 8.6.
    const logs = history({ '2026-10-01': 15, '2026-10-02': 15, '2026-10-03': 15, '2026-10-04': 15 });
    const reached = ids(plan, logs, '2026-10-08');
    assert.equal(reached.weekBelowBaseline10, '2026-10-07');
    assert.equal(reached.weekBelowBaseline25, '2026-10-07');
    assert.equal(reached.weekBelowBaseline50, undefined);
  });

  test('a week cut short by a revision does not count', () => {
    let revised = planWith([segment({ startedOn: '2026-10-01' })]);
    const result = revisePlan(revised, { pace: paceFor('gentle') }, '2026-10-05', NOW);
    assert.ok(result.ok);
    revised = result.plan;
    const logs = history({ '2026-10-01': 5, '2026-10-02': 5, '2026-10-03': 5, '2026-10-04': 5 });
    assert.equal(ids(revised, logs, '2026-10-08').firstPlanWeek, undefined);
  });

  test('recorded milestones are kept even if the logs that earned them are later deleted', () => {
    const logs = logsOn('2026-10-01', 15);
    const recorded = addMilestones(plan, newMilestones(plan, logs, '2026-10-02'), NOW);
    assert.deepEqual(recorded.milestones.map((m) => m.id), ['firstDayWithinTarget']);
    assert.deepEqual(newMilestones(recorded, [], '2026-10-02'), []);
    assert.equal(recorded.milestones.length, 1);
  });
});

describe('plan events', () => {
  const started = (() => {
    const result = startPlan(defaultPlan(), { goal: 'reduce', baseline: { perDay: 20, source: 'estimate' }, pace: paceFor('steady'), settleAt: 10 }, '2026-10-01', NOW);
    assert.ok(result.ok);
    return result.plan;
  })();
  const apply = (result: ReturnType<typeof pausePlan>) => {
    assert.ok(result.ok);
    return result.plan;
  };
  const between = (before: PlanRecord, after: PlanRecord, today = '2026-10-10', logs = logsOn('2026-10-10', 3)) =>
    detectPlanEvents(planSnapshot(before, logs, today), planSnapshot(after, logs, today));

  test('plan changes produce one event each', () => {
    assert.deepEqual(between(defaultPlan(), started), [{ type: 'planStarted', goal: 'reduce', target: 18 }]);
    const paused = apply(pausePlan(started, '2026-10-10', NOW));
    assert.deepEqual(between(started, paused), [{ type: 'planPaused' }]);
    assert.deepEqual(between(paused, apply(resumePlan(paused, '2026-10-12', NOW)), '2026-10-12', []), [{ type: 'planResumed' }]);
    assert.deepEqual(between(started, apply(revisePlan(started, { settleAt: 12 }, '2026-10-10', NOW))), [{ type: 'planRevised', target: 18 }]);
    assert.deepEqual(between(started, apply(restartPlan(started, {}, '2026-10-10', NOW))), [{ type: 'planRestarted', target: 20 }]);
    assert.deepEqual(between(started, apply(endPlan(started, '2026-10-10', NOW))), [{ type: 'planEnded' }]);
    assert.deepEqual(between(started, started), [], 'no change, no event');
  });

  test('going above target is reported once, when it happens', () => {
    const at = (count: number) => planSnapshot(started, logsOn('2026-10-10', count), '2026-10-10');
    assert.deepEqual(detectPlanEvents(at(18), at(19)), [{ type: 'dailyTargetCrossed', target: 18 }]);
    assert.deepEqual(detectPlanEvents(at(19), at(20)), [], 'not again for each further puff');
    assert.deepEqual(detectPlanEvents(at(10), at(11)), []);
  });

  test('a finished day within target is reported when the day changes; an untracked day is not', () => {
    const logs = logsOn('2026-10-10', 5);
    assert.deepEqual(detectPlanEvents(planSnapshot(started, logs, '2026-10-10'), planSnapshot(started, logs, '2026-10-11')), [
      { type: 'dayCompletedWithinTarget', day: '2026-10-10' },
    ]);
    assert.deepEqual(detectPlanEvents(planSnapshot(started, [], '2026-10-10'), planSnapshot(started, [], '2026-10-11')), []);
    const over = logsOn('2026-10-10', 25);
    assert.deepEqual(detectPlanEvents(planSnapshot(started, over, '2026-10-10'), planSnapshot(started, over, '2026-10-11')), []);
  });

  test('new milestones are reported', () => {
    const withMilestone = addMilestones(started, [{ id: 'firstDayWithinTarget', reachedOn: '2026-10-01', seenAt: null }], NOW);
    assert.deepEqual(between(started, withMilestone), [{ type: 'milestoneEarned', id: 'firstDayWithinTarget' }]);
  });

  test('events carry only a goal, target, day or milestone id; never a puff count', () => {
    const allowed = new Set(['type', 'goal', 'target', 'day', 'id']);
    const events: PlanEvent[] = [
      ...between(defaultPlan(), started),
      ...detectPlanEvents(planSnapshot(started, logsOn('2026-10-10', 18), '2026-10-10'), planSnapshot(started, logsOn('2026-10-10', 19), '2026-10-10')),
    ];
    for (const event of events) for (const key of Object.keys(event)) assert.ok(allowed.has(key), key);
  });

  test('the event channel is optional: no listeners is fine, and a failing listener changes nothing', () => {
    const bus = createPlanEventBus();
    assert.doesNotThrow(() => bus.emit([{ type: 'planPaused' }]));
    const heard: string[] = [];
    bus.subscribe(() => {
      throw new Error('listener failure');
    });
    const unsubscribe = bus.subscribe((event) => heard.push(event.type));
    assert.doesNotThrow(() => bus.emit([{ type: 'planPaused' }, { type: 'planResumed' }]));
    assert.deepEqual(heard, ['planPaused', 'planResumed']);
    unsubscribe();
    bus.emit([{ type: 'planEnded' }]);
    assert.deepEqual(heard, ['planPaused', 'planResumed']);
    assert.equal(bus.size, 1);
  });
});
