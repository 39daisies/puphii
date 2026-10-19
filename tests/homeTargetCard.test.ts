import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { PuffLog } from '../src/data/types';
import { homeWeekLine, puffUnit, targetMarginLabel } from '../src/plan/copy';
import { defaultPlan, PlanRecord } from '../src/plan/model';
import { targetCardModel } from '../src/plan/targetCard';
import { HomePlanView, homePlanView } from '../src/plan/view';
import { history, planWith, segment } from './plan/fixtures';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

/** Thursday 1 October 2026 start; "today" is Wednesday the 7th, still in plan week 1. */
const TODAY = '2026-10-07';
const TEN_A_DAY = planWith([segment({ baselinePerDay: 10, startTarget: 10, settleAt: 5 })]);

type PlanView = Extract<HomePlanView, { kind: 'plan' }>;

function planView(plan: PlanRecord, logs: readonly PuffLog[]): PlanView {
  const view = homePlanView(plan, logs, TODAY);
  if (view.kind !== 'plan') throw new Error('expected a plan');
  return view;
}

const cardFor = (plan: PlanRecord, todayCount: number) => targetCardModel(planView(plan, history({ [TODAY]: todayCount })));

/** A real view with today's numbers replaced, for targets the schedule can't produce on this day. */
function withToday(count: number, target: number, goal: 'reduce' | 'quit' = 'reduce'): PlanView {
  const view = planView(TEN_A_DAY, []);
  if (view.progress.kind !== 'active') throw new Error('expected an active plan');
  const state = count > target ? 'aboveTarget' : count > 0 ? 'withinTarget' : 'noLogsYet';
  return { ...view, goal, progress: { ...view.progress, count, target, state, above: Math.max(0, count - target) } };
}

describe("Home's Today's target card", () => {
  test('shows the count against the target, a bar, the margin and the plan week', () => {
    const card = cardFor(TEN_A_DAY, 7);
    assert.deepEqual(card, {
      paused: false,
      count: 7,
      target: 10,
      fill: 0.7,
      tone: 'within',
      badge: '3 below target',
      weekLine: 'Week 1 of your reduction plan',
      spoken: '7 of 10 puffs logged today. 3 below target.',
    });
    assert.equal(`${card.count} / ${card.target} ${puffUnit(card.target!)}`, '7 / 10 puffs');
  });

  test('the bar and badge follow every puff logged or undone, with no stored state', () => {
    const logs = history({ [TODAY]: 7 });
    const steps: [PuffLog[], number, string][] = [
      [logs, 0.7, '3 below target'],
      [[...logs, ...history({ [TODAY]: 1 })], 0.8, '2 below target'],
      [logs.slice(0, -1), 0.6, '4 below target'],
      [history({ [TODAY]: 10 }), 1, 'At target'],
      [history({ [TODAY]: 12 }), 1, '2 above target'],
      [history({ [TODAY]: 11 }), 1, '1 above target'],
      [history({ [TODAY]: 10 }), 1, 'At target'],
      [[], 0, '10 below target'],
    ];
    for (const [today, fill, badge] of steps) {
      const card = targetCardModel(planView(TEN_A_DAY, today));
      assert.equal(card.count, today.length);
      assert.equal(card.fill, fill, badge);
      assert.equal(card.badge, badge);
    }
  });

  test('above the target, the bar stays full and switches tone; nothing is framed as an amount to use up', () => {
    const card = cardFor(TEN_A_DAY, 31);
    assert.equal(card.fill, 1);
    assert.equal(card.tone, 'above');
    assert.equal(card.badge, '21 above target');
    assert.equal(cardFor(TEN_A_DAY, 10).tone, 'within', 'meeting the target is not above it');
    for (const count of [0, 3, 10, 14]) {
      assert.ok(!/remaining|\bleft\b|to go|\bmore\b|\bonly\b/i.test(targetMarginLabel(count, 10)), targetMarginLabel(count, 10));
    }
  });

  test('a target of 0 never divides by zero: empty until something is logged, then full', () => {
    const none = targetCardModel(withToday(0, 0, 'quit'));
    assert.equal(none.fill, 0);
    assert.equal(none.badge, 'At target');
    assert.equal(none.tone, 'within');
    assert.equal(none.weekLine, 'Week 1 of your quit plan');
    assert.equal(none.spoken, '0 of 0 puffs logged today. At target.');
    const some = targetCardModel(withToday(2, 0, 'quit'));
    assert.equal(some.fill, 1);
    assert.equal(some.badge, '2 above target');
    assert.equal(some.tone, 'above');
  });

  test('a target of 1 reads in the singular', () => {
    const card = targetCardModel(withToday(0, 1));
    assert.equal(card.spoken, '0 of 1 puff logged today. 1 below target.');
    assert.equal(puffUnit(card.target!), 'puff');
  });

  test('broken numbers are shown as 0, never as NaN or a negative count', () => {
    for (const [count, target] of [
      [Number.NaN, 10],
      [-3, 10],
      [4, Number.NaN],
      [4, -1],
      [Number.POSITIVE_INFINITY, 10],
    ]) {
      const card = targetCardModel(withToday(count, target));
      assert.ok(Number.isFinite(card.count) && card.count >= 0, `count ${count}`);
      assert.ok(card.target !== null && Number.isFinite(card.target) && card.target >= 0, `target ${target}`);
      assert.ok(card.fill !== null && card.fill >= 0 && card.fill <= 1, `fill for ${count}/${target}`);
      assert.ok(!/NaN|Infinity|-\d/.test(card.badge + card.spoken), card.spoken);
    }
  });

  test('a paused plan shows the count and the pause, with no target and no bar', () => {
    const paused = planWith([segment()], { pauses: [{ from: '2026-10-06', to: null }] });
    const card = cardFor(paused, 1);
    assert.deepEqual(card, {
      paused: true,
      count: 1,
      target: null,
      fill: null,
      tone: 'paused',
      badge: 'Plan paused',
      weekLine: 'Week 1 · paused',
      spoken: '1 puff logged today. Plan paused.',
    });
  });

  test('the week line follows the goal and the plan week', () => {
    assert.equal(homeWeekLine(1, 'reduce', false), 'Week 1 of your reduction plan');
    assert.equal(homeWeekLine(4, 'quit', false), 'Week 4 of your quit plan');
    assert.equal(homeWeekLine(4, 'quit', true), 'Week 4 · paused');
    const quit = planWith([segment({ goal: 'quit', settleAt: 0 })]);
    assert.equal(planView(quit, []).goal, 'quit');
    assert.equal(cardFor(quit, 0).weekLine, 'Week 1 of your quit plan');
    const later = planView(planWith([segment({ startedOn: '2026-09-20' })]), []);
    assert.equal(targetCardModel(later).weekLine, 'Week 3 of your reduction plan');
  });

  test('without a plan there is no card: Home gets the invitation instead', () => {
    assert.deepEqual(homePlanView(defaultPlan(), history({ [TODAY]: 4 }), TODAY), { kind: 'invite', ended: false });
    const ended = planWith([segment({ endedOn: '2026-10-05' })]);
    assert.deepEqual(homePlanView(ended, [], TODAY), { kind: 'invite', ended: true });
  });

  test('plan calculations are untouched: the card reads the same progress Your Plan uses', () => {
    const view = planView(planWith([segment()]), history({ [TODAY]: 9 }));
    assert.equal(view.progress.kind, 'active');
    if (view.progress.kind !== 'active') return;
    const card = targetCardModel(view);
    assert.equal(card.count, view.progress.count);
    assert.equal(card.target, view.progress.target);
    assert.equal(card.target, 20);
    assert.equal(view.week, 1);
  });
});

describe("Home's Today's target card: wiring", () => {
  const home = read('src', 'screens', 'HomeScreen.tsx');
  const start = home.indexOf("{planView?.kind === 'plan' && targetCard ? (");
  const card = home.slice(start, home.indexOf('</Card>', start));
  const styleOf = (name: string) => home.match(new RegExp(`\\n  ${name}: \\{[^}]*\\}`))?.[0] ?? '';

  test('the card model is worked out from the plan view, which follows the logs', () => {
    assert.ok(start > 0, 'found the card');
    assert.match(home, /const planView = useMemo\(\(\) => \(ready \? homePlanView\(plan, logs, todayKey\) : null\), \[ready, plan, logs, todayKey\]\);/);
    assert.match(home, /const targetCard = useMemo\(\(\) => \(planView\?\.kind === 'plan' \? targetCardModel\(planView\) : null\), \[planView\]\);/);
  });

  test('shows the title, Your Plan, the count, the bar, the badge and the week line', () => {
    assert.match(card, /<AppText variant="overline" accessibilityRole="header" style=\{styles\.targetTitle\}>\s*\{planView\.paused \? TODAY_TITLE : HOME_TARGET_TITLE\}/);
    assert.match(styleOf('targetTitle'), /textTransform: 'uppercase'/);
    assert.match(card, /accessibilityRole="link"\s*accessibilityLabel=\{YOUR_PLAN_ROW\}\s*accessibilityHint=\{OPEN_PLAN_HINT\}\s*onPress=\{onOpenPlan\}/);
    assert.match(card, /hitSlop=\{\(TOUCH_TARGET - PLAN_LINK_HEIGHT\) \/ 2\}/, 'the smaller link keeps a 44 pt touch target');
    assert.match(card, /\{targetCard\.count\}/);
    assert.match(card, /\{` \/ \$\{targetCard\.target\}`\}/);
    assert.match(card, /\{targetCard\.badge\}/);
    assert.match(card, /\{targetCard\.weekLine\}/);
    assert.match(card, /accessible accessibilityLabel=\{targetCard\.spoken\}/);
  });

  test('the bar is drawn straight from the model on every render, and only when there is a target', () => {
    assert.match(card, /\{targetCard\.fill === null \? null : \(/);
    assert.match(card, /\{ width: `\$\{Math\.round\(targetCard\.fill \* 100\)\}%` as const \}/);
    assert.match(card, /targetCard\.tone === 'above' && styles\.targetFillAbove/);
    assert.ok(!/Animated|useState|useRef/.test(card), 'nothing holds an older value');
    assert.match(card, /accessibilityElementsHidden importantForAccessibility="no-hide-descendants"/, 'the spoken summary already says it');
  });

  test('compact: the week line shares the header with Your Plan, so the card is three rows', () => {
    const title = card.indexOf('HOME_TARGET_TITLE');
    const week = card.indexOf('{targetCard.weekLine}');
    const link = card.indexOf('accessibilityRole="link"');
    const count = card.indexOf('{targetCard.count}');
    const bar = card.indexOf('styles.targetTrack');
    assert.ok(title < week && week < link && link < count && count < bar, 'title and week, then count, then bar');
    assert.equal(card.match(/\{targetCard\.weekLine\}/g)?.length, 1, 'no second week line under the bar');
    assert.match(styleOf('targetCount'), /fontSize: 30, lineHeight: 34/);
    assert.match(styleOf('targetTrack'), /height: 8,/);
  });

  test('compact, in the existing palette and type', () => {
    assert.match(styleOf('targetCard'), /paddingVertical: spacing\.md, gap: spacing\.sm/);
    assert.ok(!/sectionTitle|bodySmall|homeTargetLine|todayNote/.test(card), 'the long summary and note are gone from Home');
    for (const name of ['targetBadge', 'targetBadgeAbove', 'targetTrack', 'targetFill', 'targetFillAbove']) {
      const style = styleOf(name);
      assert.ok(style, name);
      assert.ok(!/#[0-9a-f]{3,8}|rgb/i.test(style), `${name} uses theme colors only`);
    }
  });

  test('Resume stays on a paused card, and nothing can hide the card', () => {
    assert.match(card, /\{planView\.paused \? \(\s*<SecondaryButton\s*label=\{MANAGE_ACTIONS\.resume\.label\}/);
    assert.ok(!/IconButton|icon="close"|inviteHidden/.test(card));
  });
});
