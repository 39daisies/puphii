import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isPreserved } from '../src/data/preserve';
import {
  addMilestones,
  clearPlanHistory,
  endPlan,
  markMilestonesSeen,
  paceFor,
  pausePlan,
  PlanResult,
  PlanSettings,
  restartPlan,
  resumePlan,
  revisePlan,
  setConfirmedZeroDay,
  startPlan,
} from '../src/plan/actions';
import { DEFAULT_PLAN, defaultPlan, PlanRecord, sanitizePlan } from '../src/plan/model';
import { activeSegment, targetForDay } from '../src/plan/schedule';
import { frozen, logsOn, NOW, planWith, segment } from './plan/fixtures';

const ok = (result: PlanResult): PlanRecord => {
  assert.ok(result.ok, result.ok ? '' : result.error);
  return result.plan;
};
const reduce = (overrides: Partial<PlanSettings> = {}): PlanSettings => ({
  goal: 'reduce',
  baseline: { perDay: 20, source: 'history' },
  pace: paceFor('steady'),
  settleAt: 10,
  ...overrides,
});

describe('stored plan record', () => {
  test('anything unusable becomes the default: tracking only', () => {
    for (const raw of [null, undefined, 'plan', 42, [], { goal: 'reduce' }]) {
      const plan = sanitizePlan(raw);
      assert.equal(plan.goal, 'track', JSON.stringify(raw));
      assert.deepEqual(plan.segments, []);
    }
    assert.deepEqual(sanitizePlan(null), DEFAULT_PLAN);
  });

  test('a valid plan survives a save and reload unchanged, including fields from other versions', () => {
    let plan = ok(startPlan(defaultPlan(), reduce(), '2026-10-01', NOW));
    plan = ok(pausePlan(plan, '2026-10-05', NOW));
    plan = ok(resumePlan(plan, '2026-10-08', NOW));
    plan = ok(revisePlan(plan, { pace: paceFor('custom', 7) }, '2026-10-15', NOW));
    plan = addMilestones(plan, [{ id: 'firstDayWithinTarget', reachedOn: '2026-10-01', seenAt: null }], NOW);
    plan = ok(setConfirmedZeroDay(plan, [], '2026-10-03', true, '2026-10-20', NOW));
    const stored = JSON.parse(
      JSON.stringify({
        ...plan,
        futureField: { voice: true },
        homeInvite: { dismissedAt: NOW.toISOString() },
        segments: plan.segments.map((s) => ({ ...s, note: 'x' })),
      }),
    );
    const restored = sanitizePlan(stored);
    assert.ok(isPreserved(stored, restored), 'nothing is dropped or changed');
    assert.deepEqual(sanitizePlan(JSON.parse(JSON.stringify(restored))), restored);
  });

  test('invalid entries are dropped rather than guessed at', () => {
    const good = segment({ startedOn: '2026-10-01', endedOn: '2026-10-08' });
    const restored = sanitizePlan({
      goal: 'reduce',
      segments: [
        good,
        segment({ startedOn: '2026-10-05', endedOn: null }), // overlaps the previous segment
        segment({ startedOn: '2026-02-30' }),
        segment({ pace: { preset: 'steady', percent: 12 } }), // preset and percent disagree
        segment({ pace: { preset: 'custom', percent: 0 } }),
        segment({ goal: 'quit', settleAt: 3 }),
        segment({ settleAt: 25 }), // settles above where it starts
        segment({ baselinePerDay: 0.5 }),
        segment({ baselinePerDay: 12.34 }),
      ],
      pauses: [{ from: '2026-10-03', to: '2026-10-03' }, { from: 'soon', to: null }],
      confirmedZeroDays: ['2026-10-02', '2026-10-02', 'yesterday'],
      milestones: [{ id: 'daysWithinTarget3', reachedOn: '2026-10-04' }, { id: 'daysWithinTarget3', reachedOn: '2026-10-05' }, { id: 'unknown', reachedOn: '2026-10-05' }],
    });
    assert.deepEqual(restored.segments, [good]);
    assert.equal(restored.goal, 'track', 'no open segment, so there is no active plan');
    assert.deepEqual(restored.pauses, []);
    assert.deepEqual(restored.confirmedZeroDays, ['2026-10-02']);
    assert.deepEqual(restored.milestones, [{ id: 'daysWithinTarget3', reachedOn: '2026-10-04', seenAt: null }]);
  });

  test('the goal always follows the open segment', () => {
    assert.equal(sanitizePlan({ goal: 'track', segments: [segment({ goal: 'quit', settleAt: 0 })] }).goal, 'quit');
  });
});

describe('starting a plan', () => {
  test('starts today from the baseline, rounded up to a whole target', () => {
    const plan = ok(startPlan(defaultPlan(), reduce({ baseline: { perDay: 13.4, source: 'history' }, settleAt: 7 }), '2026-10-12', NOW));
    assert.equal(plan.goal, 'reduce');
    assert.deepEqual(activeSegment(plan), {
      goal: 'reduce', startedOn: '2026-10-12', endedOn: null, baselinePerDay: 13.4, baselineSource: 'history',
      startTarget: 14, pace: { preset: 'steady', percent: 10 }, settleAt: 7, reason: 'start',
    });
    assert.equal(plan.updatedAt, NOW.toISOString());
  });

  test('quitting always settles at zero', () => {
    const plan = ok(startPlan(defaultPlan(), reduce({ goal: 'quit', settleAt: 5 }), '2026-10-12', NOW));
    assert.equal(activeSegment(plan)!.settleAt, 0);
  });

  test('invalid settings are refused with a reason', () => {
    const start = (settings: PlanSettings) => startPlan(defaultPlan(), settings, '2026-10-12', NOW);
    assert.deepEqual(start(reduce({ baseline: { perDay: 0, source: 'estimate' } })), { ok: false, error: 'invalidBaseline' });
    assert.deepEqual(start(reduce({ pace: paceFor('custom', 0) })), { ok: false, error: 'invalidPace' });
    assert.deepEqual(start(reduce({ pace: paceFor('custom', 51) })), { ok: false, error: 'invalidPace' });
    assert.deepEqual(start(reduce({ pace: { preset: 'gentle', percent: 9 } })), { ok: false, error: 'invalidPace' });
    assert.deepEqual(start(reduce({ settleAt: 20 })), { ok: false, error: 'invalidSettleLevel' });
    assert.deepEqual(start(reduce({ settleAt: -1 })), { ok: false, error: 'invalidSettleLevel' });
    assert.ok(start(reduce({ pace: paceFor('custom', 50) })).ok);
    const active = ok(start(reduce()));
    assert.deepEqual(startPlan(active, reduce(), '2026-10-13', NOW), { ok: false, error: 'planAlreadyActive' });
  });
});

describe('changing a plan keeps its history', () => {
  const started = ok(startPlan(defaultPlan(), reduce(), '2026-10-01', NOW));

  test('a new pace continues from today’s target, with weekly drops still a share of the original baseline', () => {
    const before = targetForDay(started, '2026-10-14');
    const plan = ok(revisePlan(frozen(started), { pace: paceFor('gentle') }, '2026-10-15', NOW));
    assert.equal(plan.segments.length, 2);
    assert.equal(plan.segments[0].endedOn, '2026-10-15');
    assert.deepEqual([activeSegment(plan)!.startTarget, activeSegment(plan)!.baselinePerDay, activeSegment(plan)!.reason], [16, 20, 'revise']);
    assert.equal(targetForDay(plan, '2026-10-14'), before, 'past days keep their targets');
    assert.equal(targetForDay(plan, '2026-10-15'), 16, 'no jump on the day of the change');
    assert.equal(targetForDay(plan, '2026-10-22'), 15, 'gentle: 5% of 20 = 1 a week');
  });

  test('revising on the day a segment started replaces it instead of leaving an empty one', () => {
    const plan = ok(revisePlan(started, { settleAt: 12 }, '2026-10-01', NOW));
    assert.equal(plan.segments.length, 1);
    assert.deepEqual([plan.segments[0].settleAt, plan.segments[0].reason, plan.segments[0].startTarget], [12, 'start', 20]);
  });

  test('a target or baseline can be revised explicitly', () => {
    const lower = ok(revisePlan(started, { target: 15 }, '2026-10-05', NOW));
    assert.equal(targetForDay(lower, '2026-10-05'), 15);
    assert.deepEqual(revisePlan(started, { target: 9 }, '2026-10-05', NOW), { ok: false, error: 'invalidSettleLevel' });
    const rebased = ok(revisePlan(started, { baseline: { perDay: 30, source: 'estimate' } }, '2026-10-05', NOW));
    assert.equal(activeSegment(rebased)!.baselinePerDay, 30);
    assert.equal(targetForDay(rebased, '2026-10-12'), 17, 'continues from 20, now dropping 3 a week');
  });

  test('switching to quitting settles at zero', () => {
    const plan = ok(revisePlan(started, { goal: 'quit' }, '2026-10-05', NOW));
    assert.deepEqual([plan.goal, activeSegment(plan)!.settleAt], ['quit', 0]);
  });

  test('restarting begins again from the baseline and ends any pause', () => {
    const paused = ok(pausePlan(started, '2026-10-10', NOW));
    const plan = ok(restartPlan(paused, {}, '2026-10-20', NOW));
    assert.deepEqual([plan.segments.length, activeSegment(plan)!.startTarget, activeSegment(plan)!.reason], [2, 20, 'restart']);
    assert.deepEqual(plan.pauses, [{ from: '2026-10-10', to: '2026-10-20' }]);
    assert.equal(targetForDay(plan, '2026-10-20'), 20);
  });

  test('pausing and resuming', () => {
    const paused = ok(pausePlan(started, '2026-10-05', NOW));
    assert.deepEqual(paused.pauses, [{ from: '2026-10-05', to: null }]);
    assert.equal(ok(pausePlan(paused, '2026-10-06', NOW)), paused, 'pausing twice changes nothing');
    assert.deepEqual(ok(resumePlan(paused, '2026-10-09', NOW)).pauses, [{ from: '2026-10-05', to: '2026-10-09' }]);
    assert.deepEqual(ok(resumePlan(paused, '2026-10-05', NOW)).pauses, [], 'a pause that covered no day is dropped');
    assert.deepEqual(pausePlan(defaultPlan(), '2026-10-05', NOW), { ok: false, error: 'noActivePlan' });
  });

  test('ending returns to tracking only and keeps past segments and milestones', () => {
    const withMilestone = addMilestones(started, [{ id: 'firstDayWithinTarget', reachedOn: '2026-10-01', seenAt: null }], NOW);
    const plan = ok(endPlan(withMilestone, '2026-10-20', NOW));
    assert.deepEqual([plan.goal, plan.segments.length, plan.segments[0].endedOn, plan.milestones.length], ['track', 1, '2026-10-20', 1]);
    assert.equal(activeSegment(plan), null);
    assert.deepEqual(ok(endPlan(started, '2026-10-01', NOW)).segments, [], 'a plan ended on its first day leaves no empty segment');
    const again = ok(startPlan(plan, reduce({ goal: 'quit' }), '2026-10-20', NOW));
    assert.equal(again.segments.length, 2);
    assert.deepEqual(sanitizePlan(JSON.parse(JSON.stringify(again))).segments, again.segments, 'no overlap when restarting the same day');
  });

  test('actions never mutate the plan they are given', () => {
    const input = frozen(ok(pausePlan(started, '2026-10-05', NOW)));
    assert.doesNotThrow(() => {
      resumePlan(input, '2026-10-09', NOW);
      revisePlan(input, { settleAt: 12 }, '2026-10-09', NOW);
      restartPlan(input, {}, '2026-10-09', NOW);
      endPlan(input, '2026-10-09', NOW);
      markMilestonesSeen(input, NOW);
      clearPlanHistory(input, NOW);
    });
  });
});

describe('confirmed puff-free days and other records', () => {
  const plan = planWith([segment()]);

  test('only today or earlier, and only for a day without logs', () => {
    assert.deepEqual(setConfirmedZeroDay(plan, [], '2026-10-21', true, '2026-10-20', NOW), { ok: false, error: 'futureDay' });
    assert.deepEqual(setConfirmedZeroDay(plan, logsOn('2026-10-19', 1), '2026-10-19', true, '2026-10-20', NOW), { ok: false, error: 'dayHasLogs' });
    let next = ok(setConfirmedZeroDay(plan, [], '2026-10-20', true, '2026-10-20', NOW));
    next = ok(setConfirmedZeroDay(next, [], '2026-10-18', true, '2026-10-20', NOW));
    next = ok(setConfirmedZeroDay(next, [], '2026-10-18', true, '2026-10-20', NOW));
    assert.deepEqual(next.confirmedZeroDays, ['2026-10-18', '2026-10-20']);
    assert.deepEqual(ok(setConfirmedZeroDay(next, [], '2026-10-18', false, '2026-10-20', NOW)).confirmedZeroDays, ['2026-10-20']);
  });

  test('milestones are never duplicated or re-dated', () => {
    const first = addMilestones(plan, [{ id: 'daysWithinTarget3', reachedOn: '2026-10-04', seenAt: null }], NOW);
    const again = addMilestones(first, [{ id: 'daysWithinTarget3', reachedOn: '2026-10-09', seenAt: null }], NOW);
    assert.equal(again, first);
    const seen = markMilestonesSeen(first, NOW);
    assert.equal(seen.milestones[0].seenAt, NOW.toISOString());
    assert.equal(markMilestonesSeen(seen, NOW), seen);
  });

  test('clearing puff history removes milestones and confirmations but keeps the plan', () => {
    const busy = { ...addMilestones(plan, [{ id: 'firstDayWithinTarget', reachedOn: '2026-10-01', seenAt: null }], NOW), confirmedZeroDays: ['2026-10-02'] };
    const cleared = clearPlanHistory(busy, NOW);
    assert.deepEqual([cleared.milestones, cleared.confirmedZeroDays], [[], []]);
    assert.deepEqual(cleared.segments, busy.segments);
    assert.equal(cleared.goal, 'reduce');
  });
});
