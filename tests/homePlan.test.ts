import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { createPlanController } from '../src/data/planController';
import { PuffLog } from '../src/data/types';
import { AppSession, firstAppSession, nextAppSession, SESSION_BREAK_MS } from '../src/data/appSession';
import { endPlan } from '../src/plan/actions';
import {
  HOME_INVITE_DISMISS,
  HOME_INVITE_LABEL,
  HOME_INVITE_TEXT,
  HOME_NEW_GOAL_DISMISS,
  HOME_NEW_GOAL_LABEL,
  HOME_NEW_GOAL_TEXT,
  HOME_TARGET_TITLE,
  homeTargetLine,
  todayNote,
  weekSummaryLine,
} from '../src/plan/copy';
import { DayKey } from '../src/plan/days';
import { defaultPlan, PlanRecord, sanitizePlan } from '../src/plan/model';
import { homePlanView } from '../src/plan/view';
import { planBars } from '../src/screens/plan/planBars';
import { history, NOW, planWith, segment } from './plan/fixtures';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

/** Thursday 1 October 2026 start; "today" is Wednesday the 7th, in the week starting Sunday the 4th. */
const TODAY = '2026-10-07';
const WEEK_LOGS = history({ '2026-10-04': 15, '2026-10-06': 25, '2026-10-07': 9 });

describe('Home: what the plan adds', () => {
  test('tracking-only people are invited to set a daily goal, even if an older version saved it as hidden', () => {
    assert.deepEqual(homePlanView(defaultPlan(), [], TODAY), { kind: 'invite', ended: false });
    const hiddenBefore = sanitizePlan({ ...defaultPlan(), homeInvite: { dismissedAt: '2026-10-02T10:00:00.000Z' } });
    assert.deepEqual(homePlanView(hiddenBefore, WEEK_LOGS, TODAY), { kind: 'invite', ended: false });
    assert.equal(HOME_INVITE_LABEL, 'Set a daily goal');
    assert.ok(!/free|trial|price|Pro\b/i.test(HOME_INVITE_TEXT), 'the invitation makes no offer');
  });

  test('after a plan ends, Home invites a new goal', () => {
    const ended = planWith([segment({ endedOn: '2026-10-05' })]);
    assert.deepEqual(homePlanView(ended, WEEK_LOGS, TODAY), { kind: 'invite', ended: true });
    assert.equal(HOME_NEW_GOAL_LABEL, 'Set a new goal');
    for (const line of [HOME_NEW_GOAL_TEXT, HOME_NEW_GOAL_DISMISS, HOME_INVITE_DISMISS]) {
      assert.ok(!/free|trial|price|Pro\b|remaining|left|streak|fail|!/i.test(line), line);
    }
    const sameDay = endPlan(planWith([segment({ startedOn: TODAY })]), TODAY, NOW);
    assert.ok(sameDay.ok);
    assert.deepEqual(
      homePlanView(sameDay.plan, WEEK_LOGS, TODAY),
      { kind: 'invite', ended: false },
      'a plan ended on its first day leaves no record, so it is a first goal again',
    );
  });

  test("an active plan shows today's target in neutral words", () => {
    const view = homePlanView(planWith([segment()]), WEEK_LOGS, TODAY);
    assert.equal(view.kind, 'plan');
    if (view.kind !== 'plan') return;
    assert.equal(view.paused, false);
    assert.equal(view.week, 1);
    assert.equal(homeTargetLine(view.progress), '9 logged · Daily target 20');
    assert.equal(todayNote(view.progress), "Within today's target.");
    assert.equal(HOME_TARGET_TITLE, "Today's target");
    for (const line of [homeTargetLine(view.progress), todayNote(view.progress)]) {
      assert.ok(!/remaining|left|streak|fail|only \d/i.test(line ?? ''), String(line));
    }
  });

  test('the week chart gets targets, and a finished day with no activity is an empty slot, not zero', () => {
    const view = homePlanView(planWith([segment()]), WEEK_LOGS, TODAY);
    if (view.kind !== 'plan') return assert.fail('expected a plan');
    const bars = planBars(view.days, TODAY);
    assert.deepEqual(
      bars.map((bar) => bar.key),
      ['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'],
      'the same Sunday-to-Saturday week as the rest of Home',
    );
    assert.deepEqual(bars.map((bar) => bar.target), [20, 20, 20, 20, 18, 18, 18], "the plan's second week starts on Thursday");
    const monday = bars[1];
    assert.equal(monday.untracked, true);
    assert.equal(monday.value, 0);
    assert.equal(monday.spokenValue, 'no activity recorded');
    assert.equal(bars[0].spokenValue, '15 puffs logged, within target');
    assert.equal(bars[2].spokenValue, '25 puffs logged, above target');
    assert.equal(bars[3].highlight, true);
    assert.deepEqual(bars.slice(4).map((bar) => bar.future), [true, true, true]);
  });

  test('the week summary counts tracked days and names untracked ones separately', () => {
    const view = homePlanView(planWith([segment()]), WEEK_LOGS, TODAY);
    if (view.kind !== 'plan') return assert.fail('expected a plan');
    assert.equal(view.summary.trackedDays, 2);
    assert.equal(view.summary.untrackedDays, 1);
    assert.equal(weekSummaryLine(view.summary), '1 of 2 days tracked within target · 1 with no activity recorded');
  });

  test('days before the plan started this week keep their plain bars', () => {
    const view = homePlanView(planWith([segment({ startedOn: '2026-10-06' })]), WEEK_LOGS, TODAY);
    if (view.kind !== 'plan') return assert.fail('expected a plan');
    const bars = planBars(view.days, TODAY);
    assert.deepEqual(bars.slice(0, 2).map((bar) => [bar.target, bar.untracked]), [
      [null, false],
      [null, false],
    ]);
  });

  test('a paused plan shows the count and the pause, without a target', () => {
    const paused = planWith([segment()], { pauses: [{ from: '2026-10-06', to: null }] });
    const view = homePlanView(paused, WEEK_LOGS, TODAY);
    if (view.kind !== 'plan') return assert.fail('expected a plan');
    assert.equal(view.paused, true);
    assert.equal(homeTargetLine(view.progress), '9 logged · Plan paused');
    assert.equal(todayNote(view.progress), 'Your plan is paused. Logging works as usual.');
    const bars = planBars(view.days, TODAY);
    assert.equal(bars[3].target, null, 'no target on a paused day');
  });
});

describe('Home: hiding the goal suggestion for this session', () => {
  const MINUTE = 60 * 1000;
  const after = (session: AppSession, ...steps: [state: string, at: number][]) =>
    steps.reduce((current, [state, at]) => nextAppSession(current, state, at), session);

  test('every launch is a new session, so a hidden suggestion comes back next time', () => {
    assert.deepEqual(firstAppSession(), { id: 1, backgroundSince: null });
    assert.notEqual(firstAppSession(), firstAppSession(), 'nothing is shared between launches');
  });

  test('short trips away keep the session, so the suggestion is not shown again', () => {
    const start = firstAppSession();
    const back = after(start, ['inactive', 0], ['background', 1 * MINUTE], ['inactive', 20 * MINUTE], ['active', 29 * MINUTE]);
    assert.equal(back.id, start.id);
    assert.equal(after(start, ['inactive', 0], ['active', 60 * MINUTE]), start, 'Control Center or a call is not leaving the app');
    assert.equal(after(start, ['active', 0]), start);
  });

  test('coming back after a long time away starts a new session', () => {
    const start = firstAppSession();
    assert.equal(after(start, ['background', 0], ['active', SESSION_BREAK_MS]).id, start.id + 1);
    assert.equal(
      after(start, ['background', 0], ['background', 10 * MINUTE], ['active', SESSION_BREAK_MS]).id,
      start.id + 1,
      'measured from when the app first went away',
    );
    assert.equal(SESSION_BREAK_MS, 30 * MINUTE);
  });

  test('hiding applies to the session it happened in', () => {
    let session = firstAppSession();
    const hiddenIn = session.id;
    session = after(session, ['background', 0], ['active', 5 * MINUTE]);
    assert.equal(hiddenIn === session.id, true, 'still hidden after a quick switch');
    session = after(session, ['background', 10 * MINUTE], ['active', 10 * MINUTE + SESSION_BREAK_MS]);
    assert.equal(hiddenIn === session.id, false, 'shown again in a later session');
  });
});

describe('Home: refreshing the plan', () => {
  test('a new day settles milestones once the store is asked to refresh', () => {
    const logs: PuffLog[] = history({ '2026-10-01': 12 });
    let plan: PlanRecord = planWith([segment()]);
    const clock = { day: '2026-10-01' as DayKey };
    const controller = createPlanController({
      logs: () => logs,
      save: () => undefined,
      publish: (next) => (plan = next),
      now: () => {
        const [y, m, d] = clock.day.split('-').map(Number);
        return new Date(y, m - 1, d, 9);
      },
      deliver: (task) => task(),
    });
    controller.load(plan);
    assert.equal(plan.milestones.length, 0, 'today is not finished yet');
    clock.day = '2026-10-02';
    controller.actions.refresh();
    assert.deepEqual(
      plan.milestones.map((milestone) => milestone.id),
      ['firstDayWithinTarget'],
    );
    const before = plan;
    controller.actions.refresh();
    assert.equal(plan, before, 'refreshing again changes nothing');
  });
});

describe('Home: wiring', () => {
  const home = read('src', 'screens', 'HomeScreen.tsx');
  const app = read('App.tsx');
  const settings = read('src', 'screens', 'SettingsScreen.tsx');

  test('the plan is refreshed when the local date changes or the app comes back', () => {
    assert.match(home, /useEffect\(\(\) => \{\s*if \(appActive\) planActions\.refresh\(\);\s*\}, \[todayKey, appActive, planActions\]\);/);
    assert.match(home, /const today = useToday\(\);/);
  });

  test("Today's target, the chart's targets and the invitation each appear only in their state", () => {
    assert.match(home, /homePlanView\(plan, logs, todayKey\)/);
    assert.match(home, /\{planView\?\.kind === 'plan' && targetCard \? \(\s*<Card/);
    assert.match(home, /\{planView\?\.kind === 'invite' && !inviteHidden \? \(/);
    assert.match(home, /<BarChart data=\{chartBars\} height=\{compact \? 44 : 56\} accessibilityTitle=\{WEEK_CHART_SPOKEN_TITLE\} \/>/);
    assert.match(home, /<BarChart data=\{chartBars\} height=\{compact \? 44 : 56\} \/>/, 'without a plan the chart is unchanged');
    assert.match(home, /: week\.bars,/);
    assert.match(home, /\{weekSummaryLine\(planView\.summary\)\}/);
    assert.match(home, /\{chartBars\.some\(\(bar\) => bar\.target != null \|\| bar\.untracked\) \? <ChartLegend \/> : null\}/, 'no legend for marks the chart does not show');
  });

  test('a paused plan offers Resume on Home', () => {
    assert.match(home, /\{planView\.paused \? TODAY_TITLE : HOME_TARGET_TITLE\}/);
    assert.match(home, /label=\{MANAGE_ACTIONS\.resume\.label\}/);
    assert.match(home, /if \(planActions\.resume\(\)\.ok\) AccessibilityInfo\.announceForAccessibility\(RESUMED_NOTICE\);/);
  });

  test("Today's target card cannot be hidden, whether the plan is active or paused", () => {
    const start = home.indexOf("{planView?.kind === 'plan' && targetCard ? (");
    const card = home.slice(start, home.indexOf('</Card>', start));
    assert.ok(start > 0 && card.includes('HOME_TARGET_TITLE'), 'found the target card');
    assert.ok(!/IconButton|icon="close"|inviteHidden|Hide|Dismiss/.test(card), 'no X or hiding on the target card');
    assert.match(card, /\{planView\.paused \? \(\s*<SecondaryButton/, 'a paused plan keeps its card, with Resume');
  });

  test('the suggestion opens Your Plan, names a new goal after a plan ends, and hides for this session only', () => {
    assert.match(home, /\{planView\?\.kind === 'invite' && !inviteHidden \? \(/);
    assert.match(home, /accessibilityLabel=\{invite\.label\}\s*accessibilityHint=\{invite\.text\}\s*onPress=\{onOpenPlan\}/);
    assert.match(home, /<IconButton icon="close" accessibilityLabel=\{invite\.dismiss\} onPress=\{onHideInvite\} size=\{20\} \/>/);
    assert.match(
      home,
      /planView\?\.kind === 'invite' && planView\.ended\s*\? \{ label: HOME_NEW_GOAL_LABEL, text: HOME_NEW_GOAL_TEXT, dismiss: HOME_NEW_GOAL_DISMISS \}\s*: \{ label: HOME_INVITE_LABEL, text: HOME_INVITE_TEXT, dismiss: HOME_INVITE_DISMISS \}/,
    );
    assert.match(app, /const session = useAppSession\(\);/);
    assert.match(app, /const hideInvite = useCallback\(\(\) => setInviteHiddenIn\(session\), \[session\]\);/);
    assert.match(app, /inviteHidden=\{inviteHiddenIn === session\}\s*onHideInvite=\{hideInvite\}/);
    assert.ok(!/dismissHomeInvite|homeInvite/.test(home + app), 'hiding is never saved');
    assert.ok(!/AsyncStorage|storage/i.test(read('src', 'hooks', 'useAppSession.ts') + read('src', 'data', 'appSession.ts')));
  });

  test('Home opens Your Plan on the You tab; other ways in start on its main list', () => {
    assert.match(home, /accessibilityRole="link"\s*accessibilityLabel=\{YOUR_PLAN_ROW\}\s*accessibilityHint=\{OPEN_PLAN_HINT\}\s*onPress=\{onOpenPlan\}/);
    assert.match(app, /onOpenPlan=\{openPlan\}/);
    assert.match(app, /setYouPage\('plan'\);\s*setTab\('you'\);/);
    assert.match(app, /if \(tab !== 'you'\) setYouPage\('main'\);/);
    assert.match(app, /<YouStartPage\.Provider value=\{youPage\}>/);
    assert.match(settings, /const startPage = useContext\(YouStartPage\);\s*const \[page, setPage\] = useState<Page>\(lockedToData \? 'data' : startPage\);/);
  });

  test('basic planning on Home stays free', () => {
    assert.ok(!/\/subscription\/|useEntitlement|ProGate|Paywall/.test(home));
    assert.ok(!/remaining|streak/i.test(home));
  });
});
