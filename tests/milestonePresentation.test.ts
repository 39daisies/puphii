import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { addMilestones, markMilestonesSeen, paceFor, revisePlan } from '../src/plan/actions';
import { MILESTONE_COPY, MILESTONE_NOTICE_DISMISS, MILESTONE_NOTICE_HINT, MILESTONE_NOTICE_LABEL, milestoneNotice, spokenSentences } from '../src/plan/copy';
import { MILESTONE_IDS, MilestoneId, PlanRecord } from '../src/plan/model';
import { reachedMilestones } from '../src/plan/milestones';
import { earnedMilestones, unseenMilestones } from '../src/plan/view';
import { history, NOW, planWith, segment } from './plan/fixtures';
import { app, at, MemoryStore, REDUCE, restart } from './plan/storeHarness';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');
const unseenIds = (plan: PlanRecord) => unseenMilestones(plan).map((milestone) => milestone.id);
const ids = (plan: PlanRecord) => plan.milestones.map((milestone) => milestone.id);

/** A phone on Oct 1 with a reduction plan (target 20, settle 10) and a day within target logged. */
async function phoneWithFirstMilestone() {
  const store = new MemoryStore();
  const phone = app(store, { now: at('2026-10-01') });
  await phone.launch();
  phone.actions.start(REDUCE);
  phone.log('2026-10-01', 12);
  phone.clock.now = at('2026-10-02');
  phone.actions.refresh();
  return { store, phone, plan: () => phone.controller.current() };
}

describe('milestones: earned only when genuinely earned', () => {
  const quit = planWith([segment({ goal: 'quit', settleAt: 0, startedOn: '2026-10-01' })]);

  test('a month of missing logs earns nothing, not even the puff-free milestone', () => {
    assert.deepEqual(reachedMilestones(quit, [], '2026-11-01'), []);
    const reduce = planWith([segment({ startedOn: '2026-10-01' })]);
    assert.deepEqual(reachedMilestones(reduce, [], '2026-11-01'), []);
  });

  test('days within target add up across gaps, above-target days, a pause and a revision', () => {
    let plan = planWith([segment({ startedOn: '2026-10-01', baselinePerDay: 10, startTarget: 10, settleAt: 5 })], {
      pauses: [{ from: '2026-10-06', to: '2026-10-08' }],
    });
    const revised = revisePlan(plan, { pace: paceFor('gentle') }, '2026-10-10', NOW);
    assert.ok(revised.ok);
    plan = revised.plan;
    const logs = history({
      '2026-10-01': 9,
      '2026-10-02': 30,
      '2026-10-04': 8,
      '2026-10-06': 2, // paused: counts for nothing
      '2026-10-07': 2, // paused
      '2026-10-09': 6,
      '2026-10-11': 6,
      '2026-10-13': 40,
      '2026-10-14': 6,
      '2026-10-16': 6,
      '2026-10-17': 6,
    });
    const reached = Object.fromEntries(reachedMilestones(plan, logs, '2026-10-18').map((m) => [m.id, m.reachedOn]));
    assert.equal(reached.firstDayWithinTarget, '2026-10-01');
    assert.equal(reached.daysWithinTarget3, '2026-10-09', 'Oct 1, 4 and 9: not in a row, and the paused days did not count');
    assert.equal(reached.daysWithinTarget7, '2026-10-17');
  });

  test('a milestone stays earned, with its date, after days above target', async () => {
    const { phone, plan } = await phoneWithFirstMilestone();
    const first = plan().milestones[0];
    phone.log('2026-10-02', 40);
    phone.clock.now = at('2026-10-03');
    phone.actions.refresh();
    phone.log('2026-10-03', 40);
    phone.clock.now = at('2026-10-04');
    phone.actions.refresh();
    assert.deepEqual(plan().milestones[0], first);
  });
});

describe('milestones: presented once', () => {
  test('a newly earned milestone is new until acknowledged, then never new again', async () => {
    const { phone, plan } = await phoneWithFirstMilestone();
    assert.deepEqual(unseenIds(plan()), ['firstDayWithinTarget']);
    phone.actions.refresh();
    assert.deepEqual(unseenIds(plan()), ['firstDayWithinTarget'], 'refreshing does not hide it unread');
    assert.ok(phone.actions.markMilestonesSeen(['firstDayWithinTarget']).ok);
    assert.deepEqual(unseenIds(plan()), []);
    const seenAt = plan().milestones[0].seenAt;
    assert.ok(seenAt);
    phone.actions.markMilestonesSeen(['firstDayWithinTarget']);
    phone.actions.markMilestonesSeen();
    assert.equal(plan().milestones[0].seenAt, seenAt, 'the first acknowledgement is kept');
    assert.deepEqual(earnedMilestones(plan()).map((m) => m.id), ['firstDayWithinTarget'], 'still listed in Your Plan');
  });

  test('acknowledging what Home shows leaves a milestone earned since then still new', () => {
    const plan = planWith([segment()], {
      milestones: [
        { id: 'firstDayWithinTarget', reachedOn: '2026-10-01', seenAt: null },
        { id: 'settleLevelReached', reachedOn: '2026-10-02', seenAt: null },
      ],
    });
    const acknowledged = markMilestonesSeen(plan, NOW, ['firstDayWithinTarget']);
    assert.deepEqual(unseenIds(acknowledged), ['settleLevelReached']);
    assert.equal(markMilestonesSeen(acknowledged, NOW, ['firstDayWithinTarget']), acknowledged, 'nothing to change, same record');
  });

  test('acknowledged in Your Plan, Home no longer shows it, and the reverse', async () => {
    const yourPlanFirst = await phoneWithFirstMilestone();
    yourPlanFirst.phone.actions.markMilestonesSeen(unseenIds(yourPlanFirst.plan()));
    assert.deepEqual(unseenIds(yourPlanFirst.plan()), [], "Home's notice is gone");

    const homeFirst = await phoneWithFirstMilestone();
    homeFirst.phone.actions.markMilestonesSeen(unseenIds(homeFirst.plan()));
    const plan = homeFirst.plan();
    assert.deepEqual(plan.milestones.filter((m) => m.seenAt === null), [], 'Your Plan has nothing new to badge');
    assert.deepEqual(earnedMilestones(plan).map((m) => m.id), ['firstDayWithinTarget'], 'but still lists it');
  });

  test('a later milestone is new on its own; earlier ones stay acknowledged', async () => {
    const { phone, plan } = await phoneWithFirstMilestone();
    phone.actions.markMilestonesSeen(unseenIds(plan()));
    phone.log('2026-10-02', 9);
    phone.clock.now = at('2026-10-03');
    phone.actions.refresh();
    assert.deepEqual(unseenIds(plan()), ['settleLevelReached']);
  });
});

describe('milestones: in step across restarts and plan changes', () => {
  test('a new milestone is still new after a restart; once acknowledged, it stays acknowledged', async () => {
    const { store, phone } = await phoneWithFirstMilestone();
    await phone.flush();
    const first = await restart(store, '2026-10-02');
    assert.deepEqual(unseenIds(first.result.plan), ['firstDayWithinTarget']);
    first.next.actions.markMilestonesSeen(['firstDayWithinTarget']);
    await first.next.flush();
    const second = await restart(store, '2026-10-05');
    second.next.actions.refresh();
    assert.deepEqual(unseenIds(second.next.controller.current()), []);
    assert.deepEqual(ids(second.next.controller.current()), ['firstDayWithinTarget']);
  });

  test('revising, pausing, resuming, restarting and ending keep milestones and whether they were seen', async () => {
    const { phone, plan } = await phoneWithFirstMilestone();
    phone.log('2026-10-02', 9);
    phone.clock.now = at('2026-10-03');
    phone.actions.refresh();
    phone.actions.markMilestonesSeen(['firstDayWithinTarget']);
    const before = plan().milestones;
    for (const change of [
      () => phone.actions.revise({ settleAt: 8 }),
      () => phone.actions.pause(),
      () => phone.actions.resume(),
      () => phone.actions.restart(),
      () => phone.actions.end(),
    ]) {
      assert.ok(change().ok);
      assert.deepEqual(plan().milestones, before);
    }
    assert.deepEqual(unseenIds(plan()), ['settleLevelReached']);
  });

  test('a new local day records what the finished day earned, once', async () => {
    const { phone, plan } = await phoneWithFirstMilestone();
    const after = plan();
    phone.actions.refresh();
    assert.equal(plan(), after, 'the same day again changes nothing');
  });

  test('Clear puff history and Reset everything remove the notice along with the milestones', async () => {
    const cleared = await phoneWithFirstMilestone();
    await cleared.phone.clearLogs();
    assert.deepEqual([ids(cleared.plan()), unseenIds(cleared.plan())], [[], []]);
    cleared.phone.clock.now = at('2026-10-04');
    cleared.phone.actions.refresh();
    assert.deepEqual(ids(cleared.plan()), [], 'the deleted days cannot earn it back');

    const reset = await phoneWithFirstMilestone();
    await reset.phone.resetAll();
    assert.deepEqual([ids(reset.plan()), unseenIds(reset.plan())], [[], []]);
  });

  test('after Clear puff history, new logs can earn a milestone again, and it is presented as new', async () => {
    const { phone, plan } = await phoneWithFirstMilestone();
    phone.actions.markMilestonesSeen();
    await phone.clearLogs();
    phone.log('2026-10-02', 5);
    phone.clock.now = at('2026-10-03');
    phone.actions.refresh();
    assert.deepEqual(unseenIds(plan()), ['firstDayWithinTarget', 'settleLevelReached']);
  });
});

describe('milestone notice: wording', () => {
  test('one milestone: its title and what it means; several: their titles and where to find them', () => {
    assert.deepEqual(milestoneNotice(['daysWithinTarget3']), {
      label: 'New milestone',
      title: '3 days within target',
      detail: 'Counted in total, not in a row.',
      spoken: 'New milestone: 3 days within target. Counted in total, not in a row.',
    });
    const two = milestoneNotice(['firstDayWithinTarget', 'settleLevelReached']);
    assert.equal(two.label, '2 new milestones');
    assert.equal(two.title, 'First day within target · Reached your settle level');
    assert.equal(two.spoken, '2 new milestones: First day within target, Reached your settle level.');
  });

  test('calm and factual: no fanfare, streaks, guilt or health claims', () => {
    const lines = [
      MILESTONE_NOTICE_LABEL,
      MILESTONE_NOTICE_DISMISS,
      MILESTONE_NOTICE_HINT,
      ...MILESTONE_IDS.flatMap((id) => Object.values(milestoneNotice([id]))),
      ...Object.values(milestoneNotice([...MILESTONE_IDS])),
      ...Object.values(MILESTONE_COPY).flatMap((copy) => [copy.title, copy.detail]),
    ];
    for (const line of lines) {
      const text = line.replace('not in a row', '');
      assert.ok(!/!|amazing|incredible|congrat|streak|in a row|don't break|lost|failed|should|health|lungs|cure|for good/i.test(text), line);
    }
  });
});

describe('milestone notice: Home, Your Plan and accessibility', () => {
  const notice = read('src', 'screens', 'plan', 'MilestoneNotice.tsx');
  const home = read('src', 'screens', 'HomeScreen.tsx');
  const page = read('src', 'screens', 'PlanScreen.tsx');

  test('Home shows the notice for unacknowledged milestones, below logging, and dismissing acknowledges exactly those', () => {
    assert.match(home, /unseenMilestones\(plan\)\.map\(\(milestone\) => milestone\.id\)/);
    assert.match(home, /planActions\.markMilestonesSeen\(newMilestoneIds\)/);
    assert.match(home, /<MilestoneNotice ids=\{newMilestoneIds\} onOpen=\{onOpenPlan\} onDismiss=\{acknowledgeMilestones\} \/>/);
    const logButton = home.indexOf("'+ Puff'");
    const shown = home.indexOf('<MilestoneNotice');
    assert.ok(logButton > 0 && shown > home.indexOf('label="Undo"') && shown < home.indexOf("planView?.kind === 'plan' ? ("), 'never above the Log button');
  });

  test('Your Plan acknowledges what it badges, keeps the badge for the visit, and lists every milestone', () => {
    assert.match(page, /planActions\.markMilestonesSeen\(unseen\);/);
    assert.match(page, /newMilestones=\{newMilestones\}/);
    assert.match(read('src', 'screens', 'plan', 'PlanSetup.tsx'), /<MilestonesCard plan=\{plan\} newIds=\{newMilestones\} \/>/);
    const dashboard = read('src', 'screens', 'plan', 'PlanDashboard.tsx');
    assert.match(dashboard, /const milestones = earnedMilestones\(plan\);/);
    assert.match(dashboard, /accessibilityLabel=\{spokenSentences\(\[isNew \? NEW_MILESTONE_BADGE : null, milestone\.title, milestone\.detail, reached\]\)\}/);
  });

  test('spoken labels have one full stop between parts, never two', () => {
    assert.equal(
      spokenSentences(['New', 'First day within target', 'A finished day at or under its target.', 'Reached Oct 11, 2026']),
      'New. First day within target. A finished day at or under its target. Reached Oct 11, 2026',
    );
    assert.equal(spokenSentences([null, 'Just track', 'Log puffs and see your patterns, with no daily target.', undefined]), 'Just track. Log puffs and see your patterns, with no daily target');
    assert.match(read('src', 'screens', 'plan', 'controls.tsx'), /accessibilityLabel=\{spokenSentences\(\[title, description, detail\]\)\}/);
    assert.ok(!/\.filter\(Boolean\)\.join\('\. '\)/.test(read('src', 'screens', 'plan', 'controls.tsx') + read('src', 'screens', 'plan', 'PlanDashboard.tsx')));
  });

  test('no motion, sound or haptics at all, so Reduce Motion has nothing to remove', () => {
    const code = notice.replace(/\/\*\*[\s\S]*?\*\//g, '');
    assert.ok(!/Animated|spring|LayoutAnimation|Haptic|playPuffSound|Sound|<Mascot\b/.test(code), 'the animated mascot is not used; a still face is');
    assert.ok(!/confetti|scale/i.test(code));
  });

  test('screen readers hear it once per milestone, and both actions are labelled 44 pt targets', () => {
    assert.match(notice, /const announced = new Set<MilestoneId>\(\);/);
    assert.match(notice, /AccessibilityInfo\.announceForAccessibility\(notice\.spoken\);/);
    assert.match(notice, /accessibilityRole="button"\s*accessibilityLabel=\{notice\.spoken\}\s*accessibilityHint=\{MILESTONE_NOTICE_HINT\}/);
    assert.match(notice, /<IconButton icon="close" accessibilityLabel=\{MILESTONE_NOTICE_DISMISS\} onPress=\{onDismiss\} size=\{20\} \/>/);
    assert.match(notice, /minHeight: 44/);
  });

  test("uses Puphii's own mascot artwork, hidden from screen readers as decoration", () => {
    assert.match(notice, /<Image source=\{FACES\.happy\} style=\{styles\.mascot\} resizeMode="contain" accessible=\{false\} \/>/);
  });

  test('basic planning stays free: no Pro code in the notice', () => {
    assert.ok(!/\/subscription\/|useEntitlement|ProGate|Paywall/.test(notice));
  });
});

describe('milestones: stored records', () => {
  test('a milestone is recorded once, whatever is added later', () => {
    const plan = planWith([segment()]);
    const once = addMilestones(plan, [{ id: 'firstDayWithinTarget', reachedOn: '2026-10-01', seenAt: null }], NOW);
    const twice = addMilestones(once, [{ id: 'firstDayWithinTarget', reachedOn: '2026-10-05', seenAt: null }], NOW);
    assert.equal(twice, once);
    const id: MilestoneId = 'firstDayWithinTarget';
    assert.equal(twice.milestones.filter((m) => m.id === id).length, 1);
  });
});
