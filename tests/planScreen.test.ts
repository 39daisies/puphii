import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { chartMax, spokenBar, targetOffset } from '../src/components/barChartModel';
import { createPlanController } from '../src/data/planController';
import { PuffLog } from '../src/data/types';
import { PlanSettings } from '../src/plan/actions';
import { baselineFromEstimate, baselineFromHistory } from '../src/plan/baseline';
import {
  BASELINE_SOURCE_LABEL,
  baselineProvenanceNote,
  clearHistoryMessage,
  GOAL_COPY,
  PLAN_STATUS_LABEL,
  planWeekLine,
  previewRowLabel,
  RESET_EVERYTHING_MESSAGE,
  settleLine,
  weekSummaryLine,
} from '../src/plan/copy';
import { addDays, DayKey } from '../src/plan/days';
import { defaultPlan, PACE_PRESETS, PlanRecord } from '../src/plan/model';
import { summarizeDays } from '../src/plan/progress';
import { targetForDay } from '../src/plan/schedule';
import {
  baselineProvenance,
  chartWeekStart,
  defaultSettleAt,
  displayPlanWeek,
  earnedMilestones,
  lastPlanEnded,
  nextTargetChanges,
  planStartDay,
  planStatus,
  revisionPreview,
  settleLimits,
  setupPreview,
  weekChartDays,
} from '../src/plan/view';
import { planBars } from '../src/screens/plan/planBars';
import { history, planWith, segment } from './plan/fixtures';

const ROOT = join(__dirname, '..', '..');
const source = (...parts: string[]) => readFileSync(join(ROOT, 'src', ...parts), 'utf8');
const PLAN_SCREEN_FILES = ['screens/PlanScreen.tsx', ...readdirSync(join(ROOT, 'src', 'screens', 'plan')).map((name) => `screens/plan/${name}`)];

const at = (day: DayKey, hour = 21) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d, hour);
};

/** A controller like the store's, with a clock the test moves. */
function harness(initialLogs: PuffLog[] = [], start = '2026-10-01') {
  let logs = initialLogs;
  let plan: PlanRecord = defaultPlan();
  const clock = { day: start };
  const controller = createPlanController({
    logs: () => logs,
    save: () => undefined,
    publish: (next) => (plan = next),
    now: () => at(clock.day),
    deliver: (task) => task(),
  });
  controller.load(defaultPlan());
  return {
    clock,
    actions: controller.actions,
    get plan() {
      return plan;
    },
    clearHistory: () => {
      logs = [];
      controller.clearHistory();
    },
  };
}

/** What the setup screen sends for a reduction plan from an estimate. */
const settingsFrom = (goal: 'reduce' | 'quit', perDay: number, preset: 'gentle' | 'steady' | 'faster', settleAt = defaultSettleAt(Math.ceil(perDay))): PlanSettings => ({
  goal,
  baseline: { perDay, source: 'estimate' },
  pace: { preset, percent: PACE_PRESETS[preset] },
  settleAt,
});

describe('setup: goals and starting point', () => {
  test('three goals, each explained without promises', () => {
    assert.deepEqual(
      Object.values(GOAL_COPY).map((goal) => goal.label),
      ['Just track', 'Cut down', 'Work toward quitting'],
    );
    for (const goal of Object.values(GOAL_COPY)) assert.ok(!/will help|improve|better|cure|guarantee/i.test(goal.description), goal.description);
  });

  test('a calculated starting level averages tracked days only; missing days are never zero', () => {
    const logs = history({ '2026-10-06': 10, '2026-10-07': 12, '2026-10-08': 8, '2026-10-09': 10, '2026-10-10': 10 });
    const result = baselineFromHistory(logs, [], '2026-10-20');
    assert.equal(result.status, 'ok');
    if (result.status !== 'ok') return;
    assert.equal(result.perDay, 10, '50 puffs over 5 tracked days, not over 14');
    assert.equal(result.untrackedDays, 9);
  });

  test('a manual estimate is accepted within limits and labelled as an estimate', () => {
    assert.equal(baselineFromEstimate(12), 12);
    assert.equal(baselineFromEstimate(0), null);
    assert.equal(baselineFromEstimate(1001), null);
    assert.equal(baselineFromEstimate(null), null);
    assert.equal(BASELINE_SOURCE_LABEL.history, 'Calculated from tracked activity');
    assert.equal(BASELINE_SOURCE_LABEL.estimate, 'Your estimate');
  });

  test('the suggested settle level is half the starting target, always below it', () => {
    assert.equal(defaultSettleAt(20), 10);
    assert.equal(defaultSettleAt(13), 6);
    assert.equal(defaultSettleAt(1), 0);
    assert.deepEqual(settleLimits(20), { min: 0, max: 19 });
    assert.deepEqual(settleLimits(0), { min: 0, max: 0 });
  });
});

describe('setup: pace preview', () => {
  test('Steady 10%: weekly drops from the original baseline, then the settle week', () => {
    const preview = setupPreview({ goal: 'reduce', baselinePerDay: 20, pace: { preset: 'steady', percent: 10 }, settleAt: 10 });
    assert.equal(preview.startTarget, 20);
    assert.equal(preview.settleWeek, 5);
    assert.deepEqual(preview.rows.map((row) => [previewRowLabel(row.week, row.settles), row.target]), [
      ['Week 1', 20],
      ['Week 2', 18],
      ['Week 3', 16],
      ['Week 4', 14],
      ['Week 6 onward', 10],
    ]);
    assert.equal(settleLine(preview.settleAt, preview.settleWeek), 'If you follow this pace, the daily target would reach 10 in Week 6.');
  });

  test('Gentle 5% toward quitting: whole-puff targets, settling at 0 in Week 21', () => {
    const preview = setupPreview({ goal: 'quit', baselinePerDay: 14, pace: { preset: 'gentle', percent: 5 }, settleAt: 9 });
    assert.equal(preview.settleAt, 0, 'quitting always settles at 0');
    assert.deepEqual(preview.rows.map((row) => row.target), [14, 14, 13, 12, 0]);
    assert.equal(previewRowLabel(preview.settleWeek!, true), 'Week 21 onward');
  });

  test('Faster 20% settles early, so the preview stops at the settle week', () => {
    const preview = setupPreview({ goal: 'reduce', baselinePerDay: 10, pace: { preset: 'faster', percent: 20 }, settleAt: 5 });
    assert.deepEqual(preview.rows.map((row) => [row.week, row.target, row.settles]), [
      [0, 10, false],
      [1, 8, false],
      [2, 6, false],
      [3, 5, true],
    ]);
  });

  test('Custom pace and a fractional baseline start from the rounded-up level', () => {
    const preview = setupPreview({ goal: 'reduce', baselinePerDay: 12.5, pace: { preset: 'custom', percent: 8 }, settleAt: 6 });
    assert.equal(preview.startTarget, 13);
    assert.deepEqual(preview.rows.map((row) => row.target), [13, 12, 11, 10, 6]);
    assert.equal(preview.settleWeek, 7);
  });

  test('an out-of-range settle level is clamped below the start', () => {
    assert.equal(setupPreview({ goal: 'reduce', baselinePerDay: 20, pace: { preset: 'steady', percent: 10 }, settleAt: 50 }).settleAt, 19);
  });
});

describe('plan lifecycle through the screen actions', () => {
  test('start, pause, resume, revise, restart and end, with consistent week numbers', () => {
    const app = harness();
    assert.equal(planStatus(app.plan), 'track');
    assert.ok(app.actions.start(settingsFrom('reduce', 20, 'steady', 10)).ok);
    assert.equal(planStatus(app.plan), 'reduce');
    assert.equal(displayPlanWeek(app.plan, '2026-10-01'), 1);
    assert.equal(planWeekLine(1, false), 'Week 1 of your plan');
    assert.deepEqual(nextTargetChanges(app.plan, '2026-10-01'), [{ day: '2026-10-08', target: 18 }]);
    assert.equal(displayPlanWeek(app.plan, '2026-10-08'), 2, 'the second preview week is the second dashboard week');

    app.clock.day = '2026-10-10';
    assert.ok(app.actions.pause().ok);
    assert.equal(planStatus(app.plan), 'paused');
    assert.equal(PLAN_STATUS_LABEL[planStatus(app.plan)], 'Paused');
    assert.deepEqual(nextTargetChanges(app.plan, '2026-10-10'), [], 'no dates promised while paused');

    app.clock.day = '2026-10-13';
    assert.ok(app.actions.resume().ok);
    assert.equal(displayPlanWeek(app.plan, '2026-10-13'), 2, 'paused days are left out of the week count');

    assert.ok(app.actions.revise({ pace: { preset: 'gentle', percent: 5 } }).ok);
    assert.equal(planStartDay(app.plan), '2026-10-01', 'a revision continues the plan');
    assert.equal(displayPlanWeek(app.plan, '2026-10-13'), 2);
    assert.equal(targetForDay(app.plan, '2026-10-13'), 18, 'nothing jumps on the day of the change');
    assert.deepEqual(nextTargetChanges(app.plan, '2026-10-13'), [{ day: '2026-10-20', target: 17 }]);

    assert.ok(app.actions.revise({ target: 15, settleAt: 8 }).ok);
    assert.equal(targetForDay(app.plan, '2026-10-13'), 15);

    app.clock.day = '2026-10-15';
    assert.ok(app.actions.restart().ok);
    assert.equal(planStartDay(app.plan), '2026-10-15');
    assert.equal(displayPlanWeek(app.plan, '2026-10-15'), 1);
    assert.equal(targetForDay(app.plan, '2026-10-15'), 20, 'restart goes back to the starting level');

    app.clock.day = '2026-10-17';
    assert.ok(app.actions.end().ok);
    assert.equal(planStatus(app.plan), 'track');
    assert.equal(lastPlanEnded(app.plan), '2026-10-17');
    assert.ok(app.actions.start(settingsFrom('quit', 12, 'faster')).ok, 'a new plan can start after ending one');
    assert.equal(planStatus(app.plan), 'quit');
    assert.equal(lastPlanEnded(app.plan), null);
  });

  test('a revision preview lists dated changes and stops once settled', () => {
    const schedule = { baselinePerDay: 20, pace: { preset: 'steady' as const, percent: 10 }, startTarget: 15, settleAt: 10 };
    assert.deepEqual(revisionPreview(schedule, '2026-10-13'), {
      today: 15,
      changes: [
        { day: '2026-10-20', target: 13 },
        { day: '2026-10-27', target: 11 },
        { day: '2026-11-03', target: 10 },
      ],
    });
    assert.deepEqual(revisionPreview({ ...schedule, startTarget: 10 }, '2026-10-13').changes, []);
  });

  test('editor validation matches the plan rules', () => {
    const app = harness();
    app.actions.start(settingsFrom('reduce', 20, 'steady', 10));
    const invalid = app.actions.revise({ target: 8, settleAt: 8 });
    assert.deepEqual(invalid, { ok: false, error: 'invalidSettleLevel' });
  });
});

describe('the week chart', () => {
  const plan = planWith([segment()]);
  const logs = history({ '2026-10-11': 25, '2026-10-12': 5, '2026-10-14': 3 });
  const today = '2026-10-14';
  const days = weekChartDays(plan, logs, chartWeekStart(today), today);
  const bars = planBars(days, today);

  test('weeks run Sunday to Saturday, like Insights', () => {
    assert.equal(chartWeekStart('2026-10-14'), '2026-10-11');
    assert.equal(chartWeekStart('2026-10-11'), '2026-10-11');
    assert.equal(chartWeekStart('2026-10-17'), '2026-10-11');
    assert.equal(bars.length, 7);
  });

  test('each day carries its target; untracked and future days are empty slots, never zeros', () => {
    assert.deepEqual(
      bars.map((bar) => [bar.key, bar.value, bar.target, !!bar.untracked, !!bar.future, !!bar.highlight]),
      [
        ['2026-10-11', 25, 18, false, false, false],
        ['2026-10-12', 5, 18, false, false, false],
        ['2026-10-13', 0, 18, true, false, false],
        ['2026-10-14', 3, 18, false, false, true],
        ['2026-10-15', 0, 16, false, true, false],
        ['2026-10-16', 0, 16, false, true, false],
        ['2026-10-17', 0, 16, false, true, false],
      ],
    );
  });

  test('every bar is described in words, so nothing depends on color', () => {
    const spoken = bars.map(spokenBar);
    assert.match(spoken[0], /25 puffs logged, above target, daily target 18$/);
    assert.match(spoken[1], /5 puffs logged, within target, daily target 18$/);
    assert.match(spoken[2], /no activity recorded, daily target 18$/);
    assert.match(spoken[3], /today so far, 3 puffs logged, daily target 18$/);
    assert.match(spoken[4], /not yet, daily target 16$/);
  });

  test('the summary counts untracked days separately from days within target', () => {
    assert.equal(weekSummaryLine(summarizeDays(days)), '1 of 2 days tracked within target · 1 with no activity recorded');
  });

  test('the scale includes targets but ignores empty slots, and charts without targets are unchanged', () => {
    assert.equal(chartMax(bars), 25);
    const legacy = [
      { key: 'a', value: 3, label: 'M', spokenLabel: 'Monday' },
      { key: 'b', value: 1, label: 'T', spokenLabel: 'Tuesday' },
      { key: 'c', value: 0, label: 'W', spokenLabel: 'Wednesday', future: true },
    ];
    assert.equal(chartMax(legacy), 3);
    assert.deepEqual(legacy.map(spokenBar), ['Monday: 3 logged puffs', 'Tuesday: 1 logged puff', 'Wednesday: not yet']);
    assert.equal(chartMax([]), 1);
    assert.equal(targetOffset(18, 25, 100), 72);
    assert.equal(targetOffset(0, 25, 100), 0);
    assert.equal(targetOffset(30, 25, 100), 100, 'markers never leave the plot');
  });
});

describe('milestones', () => {
  test('only earned milestones are listed, oldest first, with their seen state', () => {
    const plan = planWith([segment()], {
      milestones: [
        { id: 'daysWithinTarget3', reachedOn: '2026-10-06', seenAt: null },
        { id: 'firstDayWithinTarget', reachedOn: '2026-10-02', seenAt: '2026-10-02T21:00:00.000Z' },
        { id: 'firstPlanWeek', reachedOn: '2026-10-06', seenAt: null },
      ],
    });
    assert.deepEqual(
      earnedMilestones(plan).map((milestone) => [milestone.id, milestone.title, milestone.seen]),
      [
        ['firstDayWithinTarget', 'First day within target', true],
        ['daysWithinTarget3', '3 days within target', false],
        ['firstPlanWeek', 'First plan week', false],
      ],
    );
    assert.deepEqual(earnedMilestones(defaultPlan()), []);
  });
});

describe('starting level provenance', () => {
  const tracked = history({ '2026-09-24': 14, '2026-09-25': 16, '2026-09-26': 12, '2026-09-28': 14 });
  const calculated = baselineFromHistory(tracked, [], '2026-10-01');

  test('a calculated level is checkable while its logs are still on the device', () => {
    assert.equal(calculated.status, 'ok');
    if (calculated.status !== 'ok') return;
    const app = harness(tracked);
    app.actions.start({ goal: 'reduce', baseline: { perDay: calculated.perDay, source: 'history' }, pace: { preset: 'steady', percent: 10 }, settleAt: 7 });
    assert.deepEqual(baselineProvenance(app.plan, tracked), { source: 'history', perDay: 14, since: '2026-10-01', checkable: true });

    app.clock.day = '2026-10-09';
    app.actions.revise({ pace: { preset: 'gentle', percent: 5 } });
    assert.equal(baselineProvenance(app.plan, tracked)?.since, '2026-10-01', 'a revision keeps where the level came from');
  });

  test('after clearing puff history the plan keeps its level but never presents it as verifiable', () => {
    if (calculated.status !== 'ok') return;
    const app = harness(tracked);
    app.actions.start({ goal: 'reduce', baseline: { perDay: calculated.perDay, source: 'history' }, pace: { preset: 'steady', percent: 10 }, settleAt: 7 });
    app.clock.day = '2026-10-05';
    app.clearHistory();
    assert.equal(app.plan.segments.at(-1)?.baselinePerDay, 14, 'plan settings are kept');
    assert.equal(app.plan.segments.at(-1)?.baselineSource, 'history');
    const provenance = baselineProvenance(app.plan, []);
    assert.deepEqual(provenance, { source: 'history', perDay: 14, since: '2026-10-01', checkable: false });
    const note = baselineProvenanceNote('history', false, 'October 1, 2026');
    assert.match(note, /can't be rechecked from your current logs/);
    assert.match(note, /Your plan keeps using it/);
    assert.ok(!/verified|confirmed/i.test(note));
  });

  test('an estimate says it was entered, not calculated', () => {
    const app = harness();
    app.actions.start(settingsFrom('reduce', 18, 'steady', 9));
    assert.equal(baselineProvenance(app.plan, [])?.source, 'estimate');
    assert.equal(baselineProvenanceNote('estimate', false, 'October 1, 2026'), 'A number you entered, not calculated from your logs.');
    assert.equal(baselineProvenance(defaultPlan(), []), null);
  });
});

describe('Clear and Reset wording', () => {
  test('clearing history explains what goes, what stays and what it means for the plan', () => {
    const message = clearHistoryMessage(240);
    assert.match(message, /^All 240 logged puffs will be permanently deleted from this device\./);
    assert.match(message, /Your plan settings stay/);
    assert.match(message, /milestones and the days you confirmed as puff-free are cleared/);
    assert.match(message, /can no longer be checked against your logs/);
    assert.match(message, /Settings, skips, savings calculator details and Bubble Break scores stay as they are\./);
    assert.match(clearHistoryMessage(1), /^Your 1 logged puff will be/);
  });

  test('reset says the plan is deleted, Puphii returns to tracking only, and what is kept', () => {
    assert.match(RESET_EVERYTHING_MESSAGE, /your plan and its milestones/);
    assert.match(RESET_EVERYTHING_MESSAGE, /goes back to tracking only/);
    assert.match(RESET_EVERYTHING_MESSAGE, /keeps only the date it was first opened on this device and its data format version/);
  });

  test('the Data page uses this wording and its actions are unchanged', () => {
    const settings = source('screens', 'SettingsScreen.tsx');
    assert.match(settings, /message=\{clearHistoryMessage\(logs\.length\)\}/);
    assert.match(settings, /message=\{RESET_EVERYTHING_MESSAGE\}/);
    assert.match(settings, /clearLogs\(\);\s*setConfirm\(null\);/);
    assert.match(settings, /resetRunner\.run\(resetAll, cancelDailyReminder\)/);
    assert.match(settings, /Your puff logs, plan, settings/);
  });
});

describe('Your Plan screens', () => {
  const settings = source('screens', 'SettingsScreen.tsx');
  const screens = PLAN_SCREEN_FILES.map((file) => [file, source(file)] as const);
  const all = screens.map(([, text]) => text).join('\n');
  const page = source('screens', 'PlanScreen.tsx');
  const dashboard = source('screens', 'plan', 'PlanDashboard.tsx');
  const controls = source('screens', 'plan', 'controls.tsx');

  test('Your Plan sits first under You, whatever the plan state, and the Pro row is untouched', () => {
    assert.match(settings, /type Page = 'main' \| 'plan' \| 'reminders' \| 'data' \| 'about';/);
    assert.match(settings, /label=\{YOUR_PLAN_ROW\} detail=\{PLAN_STATUS_LABEL\[planStatus\(plan\)\]\} onPress=\{\(\) => onNavigate\('plan'\)\}/);
    assert.ok(settings.indexOf('title={PLAN_SECTION_TITLE}') > 0);
    assert.ok(settings.indexOf('title={PLAN_SECTION_TITLE}') < settings.indexOf('title="Reaction Mode"'));
    assert.match(settings, /page === 'plan' && !lockedToData \? <PlanPage onBack=\{back\} onScrollTop=\{scrollTop\} \/> : null/);
    assert.match(settings, /label="Subscription"/);
    assert.deepEqual(Object.values(PLAN_STATUS_LABEL), ['Tracking only', 'Cutting down', 'Toward quitting', 'Paused']);
  });

  test('free for everyone: no subscription, entitlement or paywall code', () => {
    for (const [file, text] of screens) {
      assert.ok(!/from '[^']*(subscription|ProGate|Paywall)[^']*'|useEntitlement|<ProGate|canUse\(|proGatingActive/.test(text), `${file} must not check Pro`);
    }
    for (const file of readdirSync(join(ROOT, 'src', 'subscription'))) {
      assert.ok(!/PlanRecord|planActions|\/plan\//.test(source('subscription', file)), `${file} must not gate the plan`);
    }
  });

  test('restart and end are confirmed in a non-destructive tone; pause and resume are immediate', () => {
    assert.equal((page.match(/<ConfirmDialog/g) ?? []).length, 2);
    assert.equal((page.match(/confirmTone="primary"/g) ?? []).length, 2);
    assert.match(page, /run\(planActions\.restart\(\), RESTARTED_NOTICE\)/);
    assert.match(page, /run\(planActions\.end\(\), ENDED_NOTICE\)/);
    assert.match(page, /action === 'pause'\) run\(planActions\.pause\(\), PAUSED_NOTICE\)/);
    assert.match(page, /action === 'resume'\) run\(planActions\.resume\(\), RESUMED_NOTICE\)/);
    assert.ok(!/confirmTone="primary"/.test(settings), 'Clear and Reset stay destructive');
  });

  test('the dashboard chart passes targets and its own spoken title, current week only', () => {
    assert.match(dashboard, /<BarChart data=\{planBars\(days, today\)\} accessibilityTitle=\{WEEK_CHART_SPOKEN_TITLE\} \/>/);
    assert.match(dashboard, /weekChartDays\(plan, logs, chartWeekStart\(today\), today\)/);
    assert.ok(!/offset/i.test(dashboard), 'past weeks stay in Insights, where Pro rules apply');
  });

  test('other charts are left as they were (Home adds targets only with a plan; see homePlan tests)', () => {
    for (const file of ['HistoryScreen.tsx', 'InsightsOverview.tsx']) {
      const text = source('screens', file);
      // Spoken chart titles are fine; plan-style untracked/target overlays stay off these screens.
      assert.ok(!/\buntracked\b|target:/.test(text), file);
    }
    assert.match(source('components', 'BarChart.tsx'), /accessibilityTitle = 'Logged puffs'/);
  });

  test('accessible controls: roles, labels, live values and 44-point targets', () => {
    assert.match(controls, /accessibilityRole="radio"/);
    assert.match(controls, /accessibilityRole="radiogroup"/);
    assert.match(controls, /aria-checked=\{selected\}/);
    assert.match(controls, /label=\{`Decrease \$\{label\.toLowerCase\(\)\}`\}/);
    assert.match(controls, /label=\{`Increase \$\{label\.toLowerCase\(\)\}`\}/);
    assert.match(controls, /accessibilityRole="button"\s*accessibilityLabel=\{label\}/);
    assert.match(controls, /accessibilityLiveRegion="polite" accessibilityLabel=\{`\$\{label\}: \$\{text\}`\}/);
    assert.match(controls, /width: TOUCH_TARGET,\s*height: TOUCH_TARGET/);
    assert.match(controls, /accessibilityHint=\{detail\}/);
    assert.match(dashboard, /accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden/, 'the legend repeats what the chart says');
    assert.match(dashboard, /accessibilityLabel=\{spokenSentences\(\[isNew \? NEW_MILESTONE_BADGE : null, milestone\.title/);
    for (const [file, text] of screens) assert.ok(!/fontSize:/.test(text), `${file} uses the shared type scale, so text scales`);
  });

  test('no motion added, and the original mascot artwork is reused', () => {
    assert.ok(!/Animated|LayoutAnimation|withTiming|useLoopClock/.test(all));
    assert.match(all, /FACES\.(curious|idle)/);
    assert.match(settings, /animated: !reducedMotion/);
  });

  test('Home and Bubble Break are not part of this screen', () => {
    assert.ok(!/HomeScreen|BubbleBreak|VoicePep|voice/i.test(all));
  });
});

describe('neutral wording on the plan screens', () => {
  test('no remaining-count, failure, streak or cure language in any screen string', () => {
    const files = PLAN_SCREEN_FILES.map((file) => source(file)).join('\n');
    const literals = files.match(/'[^'\n]{3,}'|"[^"\n]{3,}"|`[^`\n]{3,}`/g) ?? [];
    for (const literal of literals) {
      assert.ok(!/remaining|\bleft\b|fail|streak|ruin|cured|almost there|![^=]/i.test(literal), literal);
    }
  });

  test('the next target change is dated from the plan schedule', () => {
    const app = harness();
    app.actions.start(settingsFrom('reduce', 20, 'steady', 10));
    const [next] = nextTargetChanges(app.plan, '2026-10-05');
    assert.deepEqual(next, { day: addDays('2026-10-01', 7), target: 18 });
  });
});
