import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { HistoryBaseline } from '../src/plan/baseline';
import {
  averagesLine,
  baselineProvenanceNote,
  baselineSummary,
  clearHistoryMessage,
  fromTodayLine,
  homeTargetLine,
  newMilestoneLine,
  nextChangeLine,
  PACE_DISCLAIMER,
  PACE_LABELS,
  paceDescription,
  paceLabel,
  perDay,
  planWeekLine,
  previewRowLabel,
  previousPlanNote,
  reachedOnLine,
  settledLine,
  settleDetail,
  settleLine,
  spokenPlanDay,
  startingLevel,
  STATIC_PLAN_COPY,
  todayNote,
  upcomingChangeLine,
  weekSummaryLine,
} from '../src/plan/copy';
import { MILESTONE_IDS, PacePreset } from '../src/plan/model';
import { DayStatus, TodayProgress } from '../src/plan/progress';

const ROOT = join(__dirname, '..', '..');
const PLAN_DIR = join(ROOT, 'src', 'plan');

const active = (count: number, target: number, state: 'noLogsYet' | 'confirmedZero' | 'withinTarget' | 'aboveTarget', extra: Partial<TodayProgress> = {}): TodayProgress =>
  ({ kind: 'active', count, target, state, above: Math.max(0, count - target), atSettleLevel: false, goal: 'reduce', ...extra }) as TodayProgress;

const PROGRESS_SAMPLES: TodayProgress[] = [
  { kind: 'noPlan' },
  { kind: 'paused', count: 4 },
  active(0, 14, 'noLogsYet'),
  active(0, 14, 'confirmedZero'),
  active(9, 14, 'withinTarget'),
  active(14, 14, 'withinTarget'),
  active(15, 14, 'aboveTarget'),
  active(31, 14, 'aboveTarget'),
  active(3, 7, 'withinTarget', { atSettleLevel: true }),
  active(0, 0, 'noLogsYet', { atSettleLevel: true, goal: 'quit' }),
  active(2, 0, 'aboveTarget', { atSettleLevel: true, goal: 'quit' }),
];
const BASELINE_SAMPLES: HistoryBaseline[] = [
  { status: 'ok', perDay: 13.4, trackedDays: 9, loggedDays: 8, confirmedZeroDays: 1, untrackedDays: 5 },
  { status: 'ok', perDay: 12, trackedDays: 14, loggedDays: 14, confirmedZeroDays: 0, untrackedDays: 0 },
  { status: 'zero', trackedDays: 4 },
  { status: 'notEnoughData', trackedDays: 1, needed: 3 },
];

function everyLine(): string[] {
  return [
    ...STATIC_PLAN_COPY,
    ...PROGRESS_SAMPLES.flatMap((progress) => [homeTargetLine(progress), todayNote(progress)]).filter((line): line is string => !!line),
    ...BASELINE_SAMPLES.map(baselineSummary),
    paceDescription(20, 10),
    paceDescription(13.4, 5),
    settleLine(7, 5),
    settleLine(0, 1),
    settleLine(7, 0),
    settleLine(7, null),
    weekSummaryLine({ finishedDays: 5, trackedDays: 4, withinTargetDays: 3, aboveTargetDays: 1, untrackedDays: 1, averageLogged: 11, averageTarget: 13 }),
    weekSummaryLine({ finishedDays: 0, trackedDays: 0, withinTargetDays: 0, aboveTargetDays: 0, untrackedDays: 0, averageLogged: null, averageTarget: null }),
    ...MILESTONE_IDS.map(newMilestoneLine),
    planWeekLine(3, false),
    planWeekLine(3, true),
    nextChangeLine(12, 'Sunday, October 18, 2026'),
    settledLine('reduce'),
    settledLine('quit'),
    ...DAY_STATUSES.flatMap((status) => [0, 1, 9].flatMap((count) => [spokenPlanDay({ status, count, confirmedZero: false }), spokenPlanDay({ status, count, confirmedZero: true })])),
    averagesLine({ finishedDays: 5, trackedDays: 4, withinTargetDays: 3, aboveTargetDays: 1, untrackedDays: 1, averageLogged: 11.25, averageTarget: 13 })!,
    reachedOnLine('October 12, 2026'),
    baselineProvenanceNote('estimate', false, 'October 1, 2026'),
    baselineProvenanceNote('history', true, 'October 1, 2026'),
    baselineProvenanceNote('history', false, 'October 1, 2026'),
    ...(['gentle', 'steady', 'faster', 'custom'] as PacePreset[]).map((preset) => paceLabel(preset, 8)),
    settleDetail('reduce', 7),
    settleDetail('quit', 0),
    previewRowLabel(0, false),
    previewRowLabel(10, true),
    perDay(14),
    fromTodayLine(14),
    upcomingChangeLine('October 18, 2026', 12),
    previousPlanNote('October 1, 2026'),
    startingLevel(13.4),
    clearHistoryMessage(0),
    clearHistoryMessage(1),
    clearHistoryMessage(240),
  ];
}

const DAY_STATUSES: DayStatus[] = ['outsidePlan', 'paused', 'future', 'today', 'untracked', 'withinTarget', 'aboveTarget'];

describe('plan wording', () => {
  test('no shame, punishment, streaks or health and medical claims', () => {
    const banned = [
      /\bfail/i, /\bbad\b/i, /cheat/i, /\bslip/i, /relapse/i, /ruin/i, /streak/i, /shame/i, /guilt/i, /disappoint/i, /\bwrong\b/i,
      /\bshould\b/i, /\bmust\b/i, /health/i, /\bsafe/i, /\bcure/i, /detox/i, /guarantee/i, /nicotine/i, /addict/i, /clinical/i,
      /\brecommended\b/i, /\bbest\b/i, /\boptimal\b/i, /!/,
    ];
    for (const line of everyLine()) for (const pattern of banned) assert.ok(!pattern.test(line), `"${line}" matches ${pattern}`);
    const medical = everyLine().filter((line) => /medical/i.test(line));
    assert.deepEqual(medical, [PACE_DISCLAIMER], 'medicine is mentioned only to say this is not medical advice');
  });

  test('targets are never framed as an amount to reach', () => {
    const lines = PROGRESS_SAMPLES.flatMap((progress) => [homeTargetLine(progress), todayNote(progress)]).filter((line): line is string => !!line);
    for (const line of lines) {
      assert.ok(!/to go|\bleft\b|remaining|\bmore\b|\bstill\b|\breach|\buntil\b|almost|nearly|\bonly\b/i.test(line), line);
    }
  });

  test('Home shows what was logged next to the target', () => {
    assert.equal(homeTargetLine(active(9, 14, 'withinTarget')), '9 logged · Daily target 14');
    assert.equal(homeTargetLine(active(0, 14, 'noLogsYet')), '0 logged · Daily target 14');
    assert.equal(homeTargetLine(active(17, 14, 'aboveTarget')), '17 logged · Daily target 14');
    assert.equal(homeTargetLine({ kind: 'paused', count: 4 }), '4 logged · Plan paused');
    assert.equal(homeTargetLine({ kind: 'noPlan' }), null);
    assert.equal(todayNote(active(17, 14, 'aboveTarget')), "3 puffs above today's target. Logging every puff is what makes your plan useful.");
  });

  test('paces are adjustable examples, none presented as better than another', () => {
    assert.deepEqual(Object.values(PACE_LABELS), ['Gentle', 'Steady', 'Faster', 'Custom']);
    assert.match(PACE_DISCLAIMER, /examples, not medical advice/);
    assert.match(PACE_DISCLAIMER, /change yours at any time/);
    assert.equal(paceDescription(20, 10), 'Each week, the daily target drops by about 2 (10% of your starting level).');
    assert.equal(paceDescription(13.4, 5), 'Each week, the daily target drops by about 0.7 (5% of your starting level).');
    assert.equal(settleLine(7, 5), 'If you follow this pace, the daily target would reach 7 in Week 6.');
    assert.equal(paceLabel('custom', 8), 'Custom · 8% a week');
  });

  test('baseline wording explains that untracked days are left out', () => {
    assert.equal(
      baselineSummary(BASELINE_SAMPLES[0]),
      "About 13.4 a day, based on 9 days you tracked in the last two weeks. Days with no activity recorded aren't counted.",
    );
    assert.equal(baselineSummary(BASELINE_SAMPLES[1]), 'About 12 a day, based on 14 days you tracked in the last two weeks.');
  });
});

describe('plan logic stays self-contained', () => {
  const files = readdirSync(PLAN_DIR).filter((name) => name.endsWith('.ts'));

  test('no React Native, storage, subscription or network code', () => {
    assert.ok(files.length >= 9);
    for (const name of files) {
      const text = readFileSync(join(PLAN_DIR, name), 'utf8');
      assert.ok(!/from 'react|react-native|expo-|async-storage|\/subscription\/|fetch\(|XMLHttpRequest/.test(text), `${name} must stay pure`);
    }
  });

  test('deterministic: the current time is always passed in', () => {
    for (const name of files) {
      const text = readFileSync(join(PLAN_DIR, name), 'utf8');
      assert.ok(!/Math\.random|Date\.now\(\)/.test(text), name);
      const clockReads = text.match(/new Date\(\)/g) ?? [];
      assert.ok(clockReads.length === 0 || (name === 'days.ts' && clockReads.length === 1), `${name} reads the clock`);
    }
  });

  test('only puff logic and the data-preservation helpers are borrowed from the data layer', () => {
    for (const name of files) {
      const imports = readFileSync(join(PLAN_DIR, name), 'utf8').match(/from '\.\.\/data\/[^']+'/g) ?? [];
      for (const line of imports) assert.match(line, /\.\.\/data\/(puffLogic|preserve|types)'/, `${name}: ${line}`);
    }
  });
});
