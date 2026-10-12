import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { FrameScheduler } from '../src/game/bubbleBreak';
import { createRoundSession, gameActive } from '../src/game/roundSession';
import { createPlanController } from '../src/data/planController';
import { createPlanEventBus, PLAN_EVENT_TYPES, PlanEvent } from '../src/plan/events';
import { defaultPlan } from '../src/plan/model';
import { DEFAULT_VOICE_CONTEXT, VOICE_RESPONSE, voiceMayRespond } from '../src/plan/voicePolicy';
import { app, at, MemoryStore, REDUCE, restart } from './plan/storeHarness';
import { seeded } from './sim/playerSim';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

async function launched(day = '2026-10-01') {
  const store = new MemoryStore();
  const phone = app(store, { now: at(day) });
  await phone.launch();
  return { store, phone };
}

describe('plan events: the catalogue', () => {
  test('one event type for each plan moment a future feature may respond to', () => {
    assert.deepEqual([...PLAN_EVENT_TYPES], [
      'planStarted',
      'planRevised',
      'planRestarted',
      'planPaused',
      'planResumed',
      'planEnded',
      'dailyTargetCrossed',
      'dayCompletedWithinTarget',
      'milestoneEarned',
    ]);
  });

  test('a full plan lifecycle reports each moment once, in order', async () => {
    const { phone } = await launched();
    assert.ok(phone.actions.start(REDUCE).ok);
    phone.log('2026-10-01', 12);
    phone.actions.refresh();
    phone.clock.now = at('2026-10-02');
    phone.actions.refresh();
    phone.log('2026-10-02', 21);
    phone.log('2026-10-02', 1);
    assert.ok(phone.actions.pause().ok);
    assert.ok(phone.actions.resume().ok);
    assert.ok(phone.actions.revise({ settleAt: 12 }).ok);
    assert.ok(phone.actions.restart().ok);
    assert.ok(phone.actions.end().ok);
    assert.deepEqual(phone.events, [
      { type: 'planStarted', goal: 'reduce', target: 20 },
      { type: 'dayCompletedWithinTarget', day: '2026-10-01' },
      { type: 'milestoneEarned', id: 'firstDayWithinTarget' },
      { type: 'dailyTargetCrossed', target: 20 },
      { type: 'planPaused' },
      { type: 'planResumed' },
      { type: 'planRevised', target: 20 },
      { type: 'planRestarted', target: 20 },
      { type: 'planEnded' },
    ]);
  });

  test('events carry the minimum: no puff counts, timestamps, notes or baselines', async () => {
    const { phone } = await launched();
    phone.actions.start(REDUCE);
    phone.log('2026-10-01', 25);
    phone.clock.now = at('2026-10-02');
    phone.actions.refresh();
    const allowed: Record<PlanEvent['type'], string[]> = {
      planStarted: ['type', 'goal', 'target'],
      planRevised: ['type', 'target'],
      planRestarted: ['type', 'target'],
      planPaused: ['type'],
      planResumed: ['type'],
      planEnded: ['type'],
      dailyTargetCrossed: ['type', 'target'],
      dayCompletedWithinTarget: ['type', 'day'],
      milestoneEarned: ['type', 'id'],
    };
    assert.ok(phone.events.length >= 2);
    for (const event of phone.events) assert.deepEqual(Object.keys(event).sort(), [...allowed[event.type]].sort(), event.type);
  });
});

describe('plan events: no duplicates', () => {
  test('a milestone is reported once, however often the plan refreshes or the app restarts', async () => {
    const { store, phone } = await launched();
    phone.actions.start(REDUCE);
    phone.log('2026-10-01', 12);
    phone.clock.now = at('2026-10-02');
    for (let i = 0; i < 5; i += 1) phone.actions.refresh();
    phone.log('2026-10-02', 1);
    phone.actions.markMilestonesSeen();
    await phone.flush();
    const earned = (events: PlanEvent[]) => events.filter((event) => event.type === 'milestoneEarned');
    assert.equal(earned(phone.events).length, 1);

    const sameDay = await restart(store, '2026-10-02');
    sameDay.next.actions.refresh();
    assert.deepEqual(earned(sameDay.next.events), [], 'a recorded milestone is never reported again after a restart');
    await sameDay.next.flush();

    const nextWeek = await restart(store, '2026-10-09');
    nextWeek.next.actions.refresh();
    assert.ok(!earned(nextWeek.next.events).some((event) => event.type === 'milestoneEarned' && event.id === 'firstDayWithinTarget'));
  });

  test('a finished day is reported once, and never for an untracked, paused or above-target day', async () => {
    const { phone } = await launched();
    phone.actions.start(REDUCE);
    phone.log('2026-10-01', 12);
    phone.clock.now = at('2026-10-02');
    phone.actions.refresh();
    phone.actions.refresh();
    // Oct 2: nothing logged (untracked). Oct 3: above target. Oct 4: paused.
    phone.clock.now = at('2026-10-03');
    phone.actions.refresh();
    phone.log('2026-10-03', 25);
    phone.clock.now = at('2026-10-04');
    phone.actions.refresh();
    phone.actions.pause();
    phone.log('2026-10-04', 2);
    phone.clock.now = at('2026-10-05');
    phone.actions.refresh();
    const days = phone.events.filter((event) => event.type === 'dayCompletedWithinTarget');
    assert.deepEqual(days, [{ type: 'dayCompletedWithinTarget', day: '2026-10-01' }]);
  });

  test('crossing the target is reported once per crossing, and never for a revision or a paused plan', async () => {
    const { phone } = await launched();
    phone.actions.start(REDUCE);
    phone.log('2026-10-01', 15);
    phone.actions.revise({ target: 10 });
    phone.log('2026-10-01', 1);
    const crossed = () => phone.events.filter((event) => event.type === 'dailyTargetCrossed');
    assert.deepEqual(crossed(), [], 'a lower target from a revision is not a crossing, and further puffs stay quiet');
    phone.actions.pause();
    phone.log('2026-10-01', 30);
    assert.deepEqual(crossed(), []);
  });

  test('Clear puff history and Reset everything report nothing', async () => {
    const { phone } = await launched();
    phone.actions.start(REDUCE);
    phone.log('2026-10-01', 12);
    phone.clock.now = at('2026-10-02');
    phone.actions.refresh();
    const before = phone.events.length;
    await phone.clearLogs();
    assert.equal(phone.events.length, before, 'clearing history is not a plan moment');
    await phone.resetAll();
    assert.equal(phone.events.length, before, 'resetting is not "plan ended"');
  });
});

describe('plan events: listeners are isolated', () => {
  test('a listener that throws, rejects or tries to change an event affects nothing else', async () => {
    const bus = createPlanEventBus();
    const heard: PlanEvent[] = [];
    bus.subscribe(() => {
      throw new Error('broken');
    });
    bus.subscribe((async () => {
      throw new Error('broken later');
    }) as unknown as (event: PlanEvent) => void);
    bus.subscribe((event) => {
      (event as { target: number }).target = 0;
    });
    bus.subscribe((event) => heard.push(event));
    assert.doesNotThrow(() => bus.emit([{ type: 'dailyTargetCrossed', target: 12 }]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(heard, [{ type: 'dailyTargetCrossed', target: 12 }], 'the next listener gets the event unchanged');
  });

  test('events never interrupt logging: listeners run on a later task, after the change and its save', async () => {
    const order: string[] = [];
    const logs: { id: string; timestamp: string }[] = [];
    const controller = createPlanController({
      logs: () => logs,
      save: () => order.push('saved'),
      publish: () => order.push('published'),
      now: () => at('2026-10-01'),
    });
    controller.load(defaultPlan());
    controller.subscribe(() => {
      order.push('listener');
      throw new Error('a broken optional feature');
    });
    controller.actions.start(REDUCE);
    for (let i = 0; i < 21; i += 1) logs.push({ id: `l${i}`, timestamp: at('2026-10-01', 12).toISOString() });
    assert.doesNotThrow(() => controller.logsChanged());
    order.push('logging returned');
    assert.ok(!order.includes('listener'));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(order.slice(-3), ['logging returned', 'listener', 'listener']);
  });

  test('nothing in the app listens to plan events yet', () => {
    const files = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? files(join(dir, entry.name)) : /\.tsx?$/.test(entry.name) ? [join(dir, entry.name)] : [],
      );
    const users = [...files('src'), 'App.tsx'].filter((file) => /subscribePlanEvents\(/.test(read(file)));
    assert.deepEqual(users, []);
  });
});

describe('Voice Pep Rally hooks (no voice yet)', () => {
  test('every event has a voice rule, and going over target is never voiced', () => {
    assert.deepEqual(Object.keys(VOICE_RESPONSE).sort(), [...PLAN_EVENT_TYPES].sort());
    assert.equal(VOICE_RESPONSE.dailyTargetCrossed, 'none');
    assert.equal(VOICE_RESPONSE.milestoneEarned, 'encouraging');
    assert.equal(VOICE_RESPONSE.dayCompletedWithinTarget, 'encouraging');
    const optedIn = { optedIn: true, appActive: true, gameActive: false };
    assert.equal(voiceMayRespond({ type: 'dailyTargetCrossed', target: 10 }, optedIn), false);
  });

  test('voice is opt-in, foreground only and never during a game', () => {
    const milestone: PlanEvent = { type: 'milestoneEarned', id: 'firstDayWithinTarget' };
    assert.equal(DEFAULT_VOICE_CONTEXT.optedIn, false);
    assert.equal(voiceMayRespond(milestone, DEFAULT_VOICE_CONTEXT), false, 'off unless chosen');
    assert.equal(voiceMayRespond(milestone, { optedIn: true, appActive: true, gameActive: false }), true);
    assert.equal(voiceMayRespond(milestone, { optedIn: true, appActive: false, gameActive: false }), false);
    assert.equal(voiceMayRespond(milestone, { optedIn: true, appActive: true, gameActive: true }), false);
  });

  test('a game is active while the Play tab is open or a round is running', () => {
    let now = 0;
    const scheduler: FrameScheduler = { now: () => now, request: () => 1, cancel: () => undefined };
    const bubbleBreak = createRoundSession({ scheduler, random: seeded(3), onEnd: () => undefined });
    assert.equal(gameActive({ bubbleBreak }, false), false);
    assert.equal(gameActive({ bubbleBreak }, true), true);
    bubbleBreak.controller.start();
    assert.equal(gameActive({ bubbleBreak }, false), true, 'a running round, wherever the person is');
    now += 500;
    bubbleBreak.controller.pause();
    assert.equal(gameActive({ bubbleBreak }, false), false, 'a round left paused on another tab does not hold voice back');
  });

  test('no audio, speech or recording code exists for plan events', () => {
    for (const file of ['events.ts', 'voicePolicy.ts']) {
      const text = read('src', 'plan', file);
      assert.ok(!/expo-av|expo-audio|expo-speech|Audio|Sound|playAsync|Recording/.test(text.replace(/\/\*\*[\s\S]*?\*\//g, '')), file);
    }
    const pkg = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
    assert.ok(!Object.keys(pkg.dependencies).some((name) => /expo-speech|expo-av|voice/i.test(name)), 'no voice dependency was added');
  });
});
