import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  advance,
  Bubble,
  bubbleDiameter,
  bubbleLayout,
  bubblePosition,
  createRound,
  createRoundController,
  DEFAULT_TUNING,
  FieldSize,
  FrameScheduler,
  hitTest,
  isOnScreen,
  Motion,
  placeBubble,
  popBubble,
  resolveTap,
  RoundState,
  ROUND_MS,
  secondsLeft,
  stageAt,
  StageName,
  startRound,
  TAP_LATENCY_MS,
} from '../src/game/bubbleBreak';
import { DEFAULT_GAME_STATS, GameStats, recordRound, sanitizeGameStats } from '../src/game/gameStats';
import { STORAGE_KEYS } from '../src/data/storageKeys';
import { createWriteQueue } from '../src/data/writeQueue';
import { LEGACY, ROUND_ONE } from './sim/candidates';
import { FIELDS, movementStats, PLAYERS, seeded, simulate, spawnedBubbles } from './sim/playerSim';

const STAGES: StageName[] = ['warm-up', 'build', 'challenge', 'finish'];
const FIELD: FieldSize = { width: 300, height: 600 };

/** A manual frame clock: nothing runs until the test calls `frame`. */
function fakeScheduler() {
  let now = 0;
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  let cancelled = 0;
  const scheduler: FrameScheduler = {
    now: () => now,
    request: (callback) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle;
    },
    cancel: (handle) => {
      if (pending.delete(handle as number)) cancelled += 1;
    },
  };
  return {
    scheduler,
    pendingCount: () => pending.size,
    cancelledCount: () => cancelled,
    /** Moves the clock without delivering frames, like an app sitting in the background. */
    wait: (ms: number) => {
      now += ms;
    },
    frame: (ms = 16) => {
      now += ms;
      const callbacks = [...pending.values()];
      pending.clear();
      callbacks.forEach((callback) => callback());
    },
  };
}

function setup(seed = 7) {
  const clock = fakeScheduler();
  const ends: number[] = [];
  let changes = 0;
  const controller = createRoundController({
    scheduler: clock.scheduler,
    random: seeded(seed),
    onChange: () => {
      changes += 1;
    },
    onEnd: (score) => ends.push(score),
  });
  return { clock, controller, ends, changeCount: () => changes };
}

/** Plays forward until at least one bubble is on screen. */
function untilBubble(clock: ReturnType<typeof fakeScheduler>, controller: ReturnType<typeof setup>['controller']) {
  for (let i = 0; i < 200 && controller.getState().bubbles.length === 0; i += 1) clock.frame(16);
  const bubble = controller.getState().bubbles[0];
  assert.ok(bubble, 'expected a bubble to appear');
  return bubble;
}

const playedFor = (ms: number, random = seeded(3)): RoundState => {
  let state = startRound();
  for (let t = 0; t < ms; t += 16) state = advance(state, 16, random);
  return state;
};

const STRAIGHT: Motion = {
  x0: 0.5,
  drift: 0,
  weave: 0,
  weaveCycles: 1,
  weavePhase: 0,
  wobble: 0,
  wobbleCycles: 3,
  wobblePhase: 0,
  surge: 0,
  surgeCycles: 1,
  surgePhase: 0,
  ease: 0,
};

/** A bubble rising straight up at a steady speed, for exact geometry checks. */
function straightBubble({ x = 0.5, ...rest }: Partial<Bubble> & { x?: number } = {}): Bubble {
  return { id: 1, kind: 'drifter', size: 60, bornAt: 0, travelMs: 2000, tint: 0, motion: { ...STRAIGHT, x0: x }, ...rest };
}

const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
const roundsOfBubbles = (seeds: number) => Array.from({ length: seeds }, (_, i) => spawnedBubbles(DEFAULT_TUNING, i + 1));

describe('Bubble Break round rules', () => {
  test('a new round starts ready, then playing at 30 seconds with no score', () => {
    assert.equal(createRound().status, 'ready');
    const state = startRound();
    assert.equal(state.status, 'playing');
    assert.equal(state.score, 0);
    assert.equal(state.elapsed, 0);
    assert.equal(secondsLeft(state), 30);
  });

  test('popping scores exactly once per bubble and removes it immediately', () => {
    const state = playedFor(2000);
    const target = state.bubbles[0];
    assert.ok(target);

    const first = popBubble(state, target.id);
    assert.equal(first.popped, true);
    assert.equal(first.state.score, 1);
    assert.equal(first.state.bubbles.some((bubble) => bubble.id === target.id), false);
    assert.equal(first.state.pops.length, 1);

    const again = popBubble(first.state, target.id);
    assert.equal(again.popped, false);
    assert.equal(again.state, first.state);
    assert.equal(again.state.score, 1);

    assert.equal(popBubble(first.state, 99_999).popped, false);
  });

  test('bubbles that reach the top leave without any penalty', () => {
    const random = seeded(5);
    let state = startRound();
    while (state.bubbles.length === 0) state = advance(state, 16, random);
    const first = state.bubbles[0];
    while (state.elapsed < first.bornAt + first.travelMs) state = advance(state, 16, random);
    assert.equal(state.bubbles.some((bubble) => bubble.id === first.id), false);
    assert.equal(state.score, 0);
    assert.equal(state.status, 'playing');
  });

  test('every bubble leaves on time: none get stuck or stay forever', () => {
    for (const round of roundsOfBubbles(10)) {
      for (const bubble of round) {
        assert.ok(bubble.travelMs >= DEFAULT_TUNING.minTravelMs && bubble.travelMs <= 7000, `travel ${bubble.travelMs}`);
        assert.equal(bubblePosition(bubble, bubble.bornAt + bubble.travelMs).progress, 1);
        assert.equal(isOnScreen(bubble, bubble.bornAt + bubble.travelMs), false);
      }
    }
    // A round left to run with no taps clears every bubble that has reached the top.
    const random = seeded(9);
    let state = startRound();
    while (state.status === 'playing') {
      state = advance(state, 23, random);
      state.bubbles.forEach((bubble) => assert.ok(state.elapsed - bubble.bornAt < bubble.travelMs));
    }
  });

  test('a late frame counts in full, while broken or backwards steps count as nothing', () => {
    const random = seeded(1);
    const state = startRound();
    assert.equal(advance(state, 10_000, random).elapsed, 10_000);
    assert.equal(advance(state, 45_000, random).status, 'ended');
    assert.equal(advance(state, -500, random).elapsed, 0);
    assert.equal(advance(state, Number.NaN, random).elapsed, 0);
    assert.equal(advance(state, Number.POSITIVE_INFINITY, random).elapsed, 0);
  });

  test('after a late frame, only bubbles still in the play area remain', () => {
    const random = seeded(8);
    const before = playedFor(3000, random);
    const state = advance(before, 4000, random);
    assert.equal(state.elapsed, before.elapsed + 4000);
    assert.ok(state.nextId > before.nextId, 'bubbles due during the late frame were still released');
    assert.ok(state.bubbles.length > 0);
    state.bubbles.forEach((bubble) => assert.ok(state.elapsed - bubble.bornAt < bubble.travelMs));
  });

  test('bubbles that have left the play area, or not yet entered it, cannot be popped', () => {
    const gone = straightBubble({ id: 1, bornAt: 0 });
    const fresh = straightBubble({ id: 2, bornAt: 3000 });
    const live = straightBubble({ id: 3, bornAt: 2500 });
    const state: RoundState = { ...startRound(), elapsed: 3000, bubbles: [gone, fresh, live] };
    assert.equal(isOnScreen(gone, 3000), false);
    assert.equal(popBubble(state, gone.id).popped, false);
    assert.equal(popBubble(state, fresh.id).popped, false);
    const hit = popBubble(state, live.id);
    assert.equal(hit.popped, true);
    assert.equal(hit.state.score, 1);
  });

  test('time left counts down and never goes below zero', () => {
    const random = seeded(2);
    let state = startRound();
    let previous = secondsLeft(state);
    while (state.status === 'playing') {
      state = advance(state, 37, random);
      const left = secondsLeft(state);
      assert.ok(left <= previous && left >= 0);
      previous = left;
    }
    assert.equal(state.status, 'ended');
    assert.equal(state.elapsed, ROUND_MS);
    assert.equal(secondsLeft(state), 0);
    assert.equal(secondsLeft({ ...state, elapsed: ROUND_MS + 5000 }), 0);
  });

  test('nothing scores or moves after the round ends', () => {
    const random = seeded(4);
    let state = playedFor(ROUND_MS - 100, random);
    const leftover = state.bubbles[0];
    assert.ok(leftover);
    state = advance(state, 200, random);
    assert.equal(state.status, 'ended');
    assert.deepEqual(state.bubbles, []);

    assert.equal(popBubble(state, leftover.id).popped, false);
    assert.equal(resolveTap(state, state, { id: leftover.id }).popped, null);
    assert.equal(advance(state, 16, random), state);
  });

  test('a paused round neither scores nor advances', () => {
    const random = seeded(6);
    const paused: RoundState = { ...playedFor(2000, random), status: 'paused' };
    const target = paused.bubbles[0];
    assert.ok(target);
    assert.equal(popBubble(paused, target.id).popped, false);
    assert.equal(resolveTap(paused, paused, { id: target.id }).popped, null);
    assert.equal(advance(paused, 16, random), paused);
  });
});

describe('Bubble Break movement', () => {
  test('each bubble enters at the bottom, leaves at the top and always keeps rising', () => {
    for (const round of roundsOfBubbles(8)) {
      for (const bubble of round) {
        assert.equal(bubblePosition(bubble, bubble.bornAt).progress, 0);
        let previous = 0;
        for (let i = 1; i <= 200; i += 1) {
          const { x, progress } = bubblePosition(bubble, bubble.bornAt + (bubble.travelMs * i) / 200);
          assert.ok(x >= 0 && x <= 1, `x ${x} is outside the field`);
          // Never slower than a fifth of its average speed, never faster than 1.8×.
          const step = progress - previous;
          assert.ok(step >= 0.2 / 200 - 1e-9 && step <= 1.8 / 200 + 1e-9, `${bubble.kind} step ${step * 200}× average`);
          previous = progress;
        }
        assert.ok(Math.abs(previous - 1) < 1e-9);
      }
    }
  });

  test('positions depend only on round time, so any frame rate shows the same round', () => {
    const play = (steps: number[]) => {
      const random = seeded(17);
      let state = startRound();
      for (let i = 0; state.elapsed < 12_000; i += 1) state = advance(state, steps[i % steps.length], random);
      return state;
    };
    const at60 = play([16]); // 750 frames
    const at40 = play([25]); // 480 frames
    const uneven = play([7, 33, 16, 50, 4, 10]); // a stuttering device
    assert.equal(at60.elapsed, 12_000);
    assert.deepEqual(at40, at60);
    assert.deepEqual(uneven, at60);
    const layouts = (state: RoundState) => state.bubbles.map((bubble) => bubbleLayout(bubble, state.elapsed, FIELD));
    assert.deepEqual(layouts(uneven), layouts(at60));
  });

  test('each bubble rises at its own steady speed with only a gentle sway', () => {
    for (const round of roundsOfBubbles(5)) {
      for (const bubble of round) {
        assert.equal(bubble.kind, 'drifter');
        const stage = stageAt(bubble.bornAt);
        assert.ok(bubble.travelMs >= Math.round((stage.travelMs * 4200) / 5100) && bubble.travelMs <= Math.round((stage.travelMs * 6000) / 5100));
        const start = bubblePosition(bubble, bubble.bornAt).x;
        for (let i = 1; i <= 20; i += 1) {
          const { x } = bubblePosition(bubble, bubble.bornAt + (bubble.travelMs * i) / 20);
          assert.ok(Math.abs(x - start) <= 0.045, `${bubble.id} swayed ${Math.abs(x - start)}`);
        }
      }
      assert.equal(new Set(round.map((bubble) => bubble.motion.weavePhase)).size, round.length, 'every bubble sways out of step');
    }
  });

  test('movement is the steady rise of version 2', () => {
    const now = movementStats(DEFAULT_TUNING, 12);
    for (const stage of ['build', 'challenge', 'finish'] as const) {
      assert.equal(now[stage].reversals, 0, `${stage}: bubbles change direction`);
      assert.ok(now[stage].predictionError < 3, `${stage}: a 250 ms guess is off by ${now[stage].predictionError} pt`);
    }
  });

  test('new bubbles start apart from the bubbles still near the bottom', () => {
    let crowded = 0;
    let overlapping = 0;
    let total = 0;
    for (const round of roundsOfBubbles(10)) {
      for (const bubble of round) {
        const start = bubblePosition(bubble, bubble.bornAt).x;
        const gaps = round
          .filter((other) => other.id !== bubble.id && isOnScreen(other, bubble.bornAt) && bubblePosition(other, bubble.bornAt).progress < 0.2)
          .map((other) => Math.abs(bubblePosition(other, bubble.bornAt).x - start));
        total += 1;
        if (gaps.some((gap) => gap < DEFAULT_TUNING.spawnSpacing - 1e-9)) crowded += 1;
        // About half a bubble's width on a 390 pt phone.
        if (gaps.some((gap) => gap < 0.1)) overlapping += 1;
      }
    }
    assert.ok(crowded / total < 0.03, `${crowded} of ${total} bubbles started closer than the spacing`);
    assert.ok(overlapping / total < 0.005, `${overlapping} of ${total} bubbles started on top of another`);
  });

  test('bubbles bounce off the side walls instead of leaving the field', () => {
    const bubble = straightBubble({ x: 0.95, motion: { ...STRAIGHT, x0: 0.95, drift: 0.6 } });
    const xs = Array.from({ length: 21 }, (_, i) => bubblePosition(bubble, (bubble.travelMs * i) / 20).x);
    xs.forEach((x) => assert.ok(x >= 0 && x <= 1));
    assert.ok(Math.abs(xs[20] - 0.45) < 1e-9, 'drifting 0.6 from 0.95 bounces back to 0.45');
  });
});

describe('Bubble Break difficulty', () => {
  test('four stages over the 30-second round, each starting on its boundary', () => {
    assert.deepEqual(
      DEFAULT_TUNING.stages.map((stage) => [stage.name, stage.startsAt]),
      [
        ['warm-up', 0],
        ['build', 5_000],
        ['challenge', 10_000],
        ['finish', 20_000],
      ],
    );
    const at = (ms: number) => stageAt(ms).name;
    assert.equal(at(4_999), 'warm-up');
    assert.equal(at(5_000), 'build');
    assert.equal(at(9_999), 'build');
    assert.equal(at(10_000), 'challenge');
    assert.equal(at(19_999), 'challenge');
    assert.equal(at(20_000), 'finish');
    assert.equal(at(ROUND_MS), 'finish');
  });

  test('each stage is quicker and busier than the one before, one bubble at a time', () => {
    const stages = DEFAULT_TUNING.stages;
    assert.deepEqual(
      stages.map((stage) => Number((stages[0].travelMs / stage.travelMs).toFixed(2))),
      [1, 1.2, 1.4, 1.6],
    );
    assert.deepEqual(
      stages.map((stage) => Number((stage.spawnGapMs[0] / stages[0].spawnGapMs[0]).toFixed(2))),
      [1, 0.9, 0.8, 0.7],
    );
    stages.forEach((stage) => {
      assert.equal(stage.clusterChance, 0, `${stage.name} sends bubbles in groups`);
      assert.equal(stage.lullChance, 0);
      assert.equal(stage.kinds.drifter, 1, `${stage.name} uses other kinds of bubble`);
    });
  });

  // Players found version 2, and every faster rework, too fast and frustrating.
  test('version 2 bubbles and targets, but no stage as fast or as busy as version 2', () => {
    const { kinds, stages, ...rest } = DEFAULT_TUNING;
    const { kinds: oldKinds, stages: oldStages, ...old } = LEGACY;
    assert.deepEqual(rest, old);
    assert.deepEqual(kinds.drifter, oldKinds.drifter);
    stages.forEach((stage, i) => {
      assert.ok(stage.travelMs >= oldStages[i].travelMs, `${stage.name} rises faster than version 2`);
      assert.ok(stage.spawnGapMs[0] >= oldStages[i].spawnGapMs[0], `${stage.name} is busier than version 2`);
    });
    assert.ok(stages[3].travelMs > oldStages[2].travelMs, 'the end is as fast as version 2 at 10 seconds');
  });

  test('shooting bubbles, if a stage uses them, launch fast and slow down near the top', () => {
    const onlyShooters = {
      ...DEFAULT_TUNING,
      stages: DEFAULT_TUNING.stages.map((stage) => ({ ...stage, kinds: { drifter: 0, weaver: 0, darter: 0, floater: 0, shooter: 1 } })),
    };
    const shooters = Array.from({ length: 5 }, (_, i) => spawnedBubbles(onlyShooters, i + 1)).flat();
    assert.ok(shooters.length > 50);
    const speed = (bubble: Bubble, from: number, to: number) =>
      (bubblePosition(bubble, bubble.bornAt + bubble.travelMs * to).progress - bubblePosition(bubble, bubble.bornAt + bubble.travelMs * from).progress) / (to - from);
    for (const bubble of shooters) {
      assert.ok(speed(bubble, 0, 0.2) > 1.15, `launch at ${speed(bubble, 0, 0.2).toFixed(2)}× average`);
      assert.ok(speed(bubble, 0.8, 1) < 0.85, `arrival at ${speed(bubble, 0.8, 1).toFixed(2)}× average`);
    }
  });

  test('over real rounds, bubbles rise faster and appear more often as time goes on', () => {
    const rounds = roundsOfBubbles(20);
    const all = rounds.flat();
    const byStage = (name: StageName) => all.filter((bubble) => stageAt(bubble.bornAt).name === name);
    const travel = STAGES.map((name) => mean(byStage(name).map((bubble) => bubble.travelMs)));
    for (let i = 1; i < travel.length; i += 1) assert.ok(travel[i] < travel[i - 1], `mean travel ${travel.map(Math.round)}`);

    const perSecond = (name: StageName, seconds: number) => byStage(name).length / rounds.length / seconds;
    assert.ok(perSecond('finish', 10) > perSecond('warm-up', 5) * 1.25, 'the finish is busier than the opening');

    // The opening is gentle for everyone: no bubble crosses in under 3 seconds.
    byStage('warm-up').forEach((bubble) => assert.ok(bubble.travelMs >= 3000));
    // Even at the end, no bubble crosses in under 2.5 seconds.
    const finish = byStage('finish').map((bubble) => bubble.travelMs);
    assert.ok(Math.min(...finish) >= 2500);
  });

  test('bubbles stay large enough to tap on small phones', () => {
    for (const field of [FIELDS.phone320, FIELDS.phone390]) {
      for (const round of roundsOfBubbles(5)) {
        for (const bubble of round) {
          const size = bubbleDiameter(bubble.size, field.width);
          assert.ok(size >= 44, `${size} pt is below the 44 pt minimum`);
          assert.ok(size <= Math.ceil(field.width * DEFAULT_TUNING.maxDiameterRatio));
        }
      }
    }
  });

  test('a bubble cap keeps the field readable', () => {
    const random = seeded(23);
    let state = startRound();
    while (state.status === 'playing') {
      state = advance(state, 16, random);
      assert.ok(state.bubbles.length <= DEFAULT_TUNING.maxBubbles);
    }
  });
});

describe('Bubble Break touch targets', () => {
  // At half way up a 300 × 600 field, a 60 pt bubble at x 0.5 is centred on (150, 300).
  const bubble = straightBubble();
  const state: RoundState = { ...startRound(), elapsed: 1000, bubbles: [bubble] };
  const reach = 30 + DEFAULT_TUNING.touchSlop;

  test('the drawn bubble and the touch target share one geometry', () => {
    const layout = bubbleLayout(bubble, 1000, FIELD);
    assert.deepEqual(layout, { size: 60, left: 120, top: 270, cx: 150, cy: 300 });
    assert.deepEqual(layout, placeBubble(bubble.size, 0.5, 0.5, FIELD));
  });

  test('taps hit inside the circle plus a small finger allowance, and nowhere else', () => {
    assert.equal(hitTest(state.bubbles, 1000, FIELD, { x: 150, y: 300 })?.id, 1);
    assert.equal(hitTest(state.bubbles, 1000, FIELD, { x: 150 + reach - 0.5, y: 300 })?.id, 1);
    assert.equal(hitTest(state.bubbles, 1000, FIELD, { x: 150, y: 300 - reach - 1 }), null);
    // The corner of the bubble's square is outside the circle, so it no longer counts.
    assert.equal(hitTest(state.bubbles, 1000, FIELD, { x: 121, y: 271 }), null);
  });

  test('where bubbles overlap, the tap goes to the one it is closest to', () => {
    const near = straightBubble({ id: 2, x: (170 - 30) / 240 });
    const both = [bubble, near];
    assert.equal(hitTest(both, 1000, FIELD, { x: 165, y: 300 })?.id, 2);
    assert.equal(hitTest(both, 1000, FIELD, { x: 152, y: 300 })?.id, 1);
  });

  test('bubbles that have left, or not yet arrived, cannot be hit', () => {
    assert.equal(hitTest([bubble], 2000, FIELD, { x: 150, y: -30 }), null);
    assert.equal(hitTest([straightBubble({ bornAt: 1000 })], 1000, FIELD, { x: 150, y: 630 }), null);
  });

  test('a tap is judged against the frame the player saw, if that frame is recent', () => {
    const tap = { point: { x: 150, y: 330 }, field: FIELD }; // the lower edge of the bubble as drawn at 1000 ms
    const later = (ms: number): RoundState => ({ ...state, elapsed: 1000 + ms });

    // The bubble has risen 26 pt since that frame; the tap still counts.
    assert.equal(hitTest(later(80).bubbles, 1080, FIELD, tap.point), null);
    const fresh = resolveTap(state, later(80), tap);
    assert.equal(fresh.popped?.id, 1);
    assert.equal(fresh.state.score, 1);
    assert.equal(fresh.state.elapsed, 1080);

    // A frame older than the latency allowance is not trusted; the tap is judged now.
    assert.equal(resolveTap(state, later(TAP_LATENCY_MS + 50), tap).popped, null);
  });

  test('a bubble seen just before it left still scores, but only once', () => {
    const seen: RoundState = { ...state, elapsed: 1990 };
    const now: RoundState = { ...state, elapsed: 2040, bubbles: [] };
    const { cx, cy } = bubbleLayout(bubble, 1990, FIELD);
    const first = resolveTap(seen, now, { point: { x: cx, y: cy }, field: FIELD });
    assert.equal(first.popped?.id, 1);
    assert.equal(first.state.score, 1);
    // The next tap sees the round after this pop, so the same bubble can't score again.
    assert.equal(resolveTap(first.state, first.state, { point: { x: cx, y: cy }, field: FIELD }).popped, null);
    assert.equal(resolveTap(first.state, first.state, { id: 1 }).popped, null);
  });
});

describe('Bubble Break with simulated players', () => {
  // These are models with fixed reaction and aiming times, not people. They guard the
  // tuning against regressions; how the game feels still needs testing by hand.
  const result = (tuning = DEFAULT_TUNING) =>
    Object.fromEntries(PLAYERS.map((player) => [player.name, simulate({ tuning, player, rounds: 40 })]));

  // The "fast" model is tuned so that, like a real tester, it clears both earlier versions.
  test('the earlier versions could be cleared by a fast player', () => {
    for (const tuning of [LEGACY, ROUND_ONE]) {
      const fast = result(tuning).fast;
      assert.ok(fast.popRate >= 0.95, `fast player popped ${fast.popRate}`);
      assert.ok(fast.stages.finish.escapeRate < 0.05);
    }
  });

  test('calm throughout: the first 20 seconds are easy for everyone, and the end only a little busier', () => {
    const now = result();
    for (const player of PLAYERS) {
      const stages = now[player.name].stages;
      for (const name of ['warm-up', 'build', 'challenge'] as const) {
        assert.ok(stages[name].popRate >= 0.95, `${player.name} ${name} ${stages[name].popRate}`);
      }
      assert.ok(stages.finish.escapeRate <= 0.1, `${player.name}: ${stages.finish.escapeRate} of the last bubbles float away`);
    }
  });

  test('aimed taps still land: misses come from timing, not unfair hit areas', () => {
    const now = result();
    for (const player of PLAYERS) assert.ok(now[player.name].tapAccuracy >= 0.93, `${player.name} tap accuracy ${now[player.name].tapAccuracy}`);
  });
});

describe('Bubble Break round controller', () => {
  test('runs a full round on uneven frames, ends once, and stops asking for frames', () => {
    const { clock, controller, ends } = setup();
    controller.start();
    const steps = [16, 33, 7, 50, 16, 120];
    let i = 0;
    while (controller.getState().status === 'playing') {
      assert.equal(clock.pendingCount(), 1, 'exactly one frame should be pending');
      clock.frame(steps[i % steps.length]);
      i += 1;
      assert.ok(i < 10_000, 'round should finish');
    }
    const state = controller.getState();
    assert.equal(state.status, 'ended');
    assert.equal(state.elapsed, ROUND_MS);
    assert.equal(secondsLeft(state), 0);
    assert.deepEqual(ends, [state.score]);
    assert.equal(clock.pendingCount(), 0);
    assert.equal(controller.isLooping(), false);

    clock.frame(16);
    clock.frame(1000);
    assert.deepEqual(ends, [state.score], 'onEnd fires only once');
  });

  test('the round lasts 30 real seconds even when frames arrive late', () => {
    const { clock, controller, ends } = setup();
    controller.start();
    for (let i = 0; i < 29; i += 1) clock.frame(1000);
    assert.equal(controller.getState().status, 'playing');
    assert.equal(controller.getState().elapsed, 29_000);
    clock.frame(999);
    assert.equal(controller.getState().status, 'playing');
    clock.frame(1);
    assert.equal(controller.getState().status, 'ended');
    assert.equal(ends.length, 1);
    assert.equal(clock.pendingCount(), 0);
  });

  test('a single very late frame ends the round on time, once', () => {
    const { clock, controller, ends } = setup();
    controller.start();
    clock.frame(16);
    clock.frame(45_000);
    const state = controller.getState();
    assert.equal(state.status, 'ended');
    assert.equal(state.elapsed, ROUND_MS);
    assert.deepEqual(state.bubbles, []);
    assert.deepEqual(ends, [state.score]);
    assert.equal(clock.pendingCount(), 0);
  });

  test('60 and 30 frames per second play the same round', () => {
    const fast = setup(41);
    const slow = setup(41);
    fast.controller.start();
    slow.controller.start();
    // 16 and 33 ms frames line up every 528 ms.
    for (let sync = 1; sync <= 20; sync += 1) {
      for (let i = 0; i < 33; i += 1) fast.clock.frame(16);
      for (let i = 0; i < 16; i += 1) slow.clock.frame(33);
      assert.deepEqual(slow.controller.getState(), fast.controller.getState());
    }
  });

  test('tapping a bubble where it is drawn pops it; tapping empty space does nothing', () => {
    const { clock, controller } = setup();
    controller.start();
    const bubble = untilBubble(clock, controller);
    for (let i = 0; i < 10; i += 1) clock.frame(16);
    const state = controller.getState();
    assert.equal(state.bubbles.length, 1);
    const { cx, cy } = bubbleLayout(bubble, state.elapsed, FIELDS.phone390);

    clock.wait(30);
    assert.equal(controller.tapAt({ x: FIELDS.phone390.width - cx, y: 5 }, FIELDS.phone390), false);
    assert.equal(controller.getState().score, 0, 'a miss costs nothing');
    assert.equal(controller.tapAt({ x: cx, y: cy }, FIELDS.phone390), true);
    assert.equal(controller.getState().score, 1);
    assert.equal(controller.tapAt({ x: cx, y: cy }, FIELDS.phone390), false, 'a second tap on the same spot finds nothing');
    assert.equal(controller.getState().score, 1);
  });

  test('a tap is judged at the moment it happens, not at an old frame', () => {
    const { clock, controller, ends } = setup();
    controller.start();
    const bubble = untilBubble(clock, controller);

    // The bubble has floated away by the time of the tap, even though no frame has run since.
    clock.wait(bubble.travelMs + 100);
    assert.equal(controller.pop(bubble.id), false);
    assert.equal(controller.getState().score, 0);

    // After time is up, a tap ends the round instead of scoring.
    const live = untilBubble(clock, controller);
    clock.wait(ROUND_MS);
    assert.equal(controller.pop(live.id), false);
    assert.equal(controller.getState().status, 'ended');
    assert.equal(controller.getState().score, 0);
    assert.deepEqual(ends, [0]);
    assert.equal(clock.pendingCount(), 0);
  });

  test('time up to a pause counts, time while paused does not', () => {
    const { clock, controller } = setup();
    controller.start();
    clock.frame(500);
    clock.wait(300);
    controller.pause();
    assert.equal(controller.getState().elapsed, 800);
    clock.wait(20_000);
    controller.resume();
    clock.frame(200);
    assert.equal(controller.getState().elapsed, 1000);
    assert.equal(stageAt(controller.getState().elapsed).name, 'warm-up');
  });

  test('play again starts back at the gentle opening', () => {
    const { clock, controller } = setup();
    controller.start();
    for (let i = 0; i < 26; i += 1) clock.frame(1000);
    assert.equal(stageAt(controller.getState().elapsed).name, 'finish');
    controller.start();
    assert.equal(controller.getState().elapsed, 0);
    const bubble = untilBubble(clock, controller);
    assert.equal(stageAt(bubble.bornAt).name, 'warm-up');
    assert.ok(bubble.travelMs >= 2500, 'replay bubbles rise at warm-up speed');
  });

  test('rapid repeated taps on the same bubble score once', () => {
    const { clock, controller } = setup();
    controller.start();
    const bubble = untilBubble(clock, controller);
    const results = [controller.pop(bubble.id), controller.pop(bubble.id), controller.pop(bubble.id)];
    assert.deepEqual(results, [true, false, false]);
    assert.equal(controller.getState().score, 1);
  });

  test('taps after the round ends do not score', () => {
    const { clock, controller, ends } = setup();
    controller.start();
    let last: Bubble | null = null;
    while (controller.getState().status === 'playing') {
      const bubbles = controller.getState().bubbles;
      if (bubbles.length) last = bubbles[bubbles.length - 1];
      clock.frame(16);
    }
    const final = controller.getState().score;
    assert.ok(last);
    assert.equal(controller.pop(last.id), false);
    const { cx, cy } = bubbleLayout(last, ROUND_MS - 16, FIELDS.phone390);
    assert.equal(controller.tapAt({ x: cx, y: cy }, FIELDS.phone390), false);
    assert.equal(controller.getState().score, final);
    assert.deepEqual(ends, [final]);
  });

  test('starting twice, or replaying, never leaves duplicate frame loops', () => {
    const { clock, controller } = setup();
    controller.start();
    controller.start();
    controller.start();
    assert.equal(clock.pendingCount(), 1);
    clock.frame(16);
    assert.equal(clock.pendingCount(), 1);
  });

  test('play again resets the score and the timer', () => {
    const { clock, controller, ends } = setup();
    controller.start();
    controller.pop(untilBubble(clock, controller).id);
    while (controller.getState().status === 'playing') clock.frame(100);
    assert.equal(controller.getState().score, 1);

    controller.start();
    const replay = controller.getState();
    assert.equal(replay.status, 'playing');
    assert.equal(replay.score, 0);
    assert.equal(replay.elapsed, 0);
    assert.deepEqual(replay.bubbles, []);
    assert.equal(secondsLeft(replay), 30);
    assert.equal(clock.pendingCount(), 1);

    clock.frame(16);
    assert.equal(controller.getState().elapsed, 16, 'the replay timer starts from its own start time');
    while (controller.getState().status === 'playing') clock.frame(100);
    assert.deepEqual(ends, [1, 0]);
  });

  test('replaying in the middle of a round also starts from zero', () => {
    const { clock, controller } = setup();
    controller.start();
    controller.pop(untilBubble(clock, controller).id);
    for (let i = 0; i < 50; i += 1) clock.frame(16);
    controller.start();
    assert.equal(controller.getState().score, 0);
    assert.equal(controller.getState().elapsed, 0);
    assert.equal(clock.pendingCount(), 1);
  });

  test('pausing stops the loop and time spent away is not counted', () => {
    const { clock, controller } = setup();
    controller.start();
    const bubble = untilBubble(clock, controller);
    const before = controller.getState().elapsed;

    controller.pause();
    assert.equal(controller.getState().status, 'paused');
    assert.equal(clock.pendingCount(), 0);
    assert.equal(controller.pop(bubble.id), false);
    const { cx, cy } = bubbleLayout(bubble, before, FIELDS.phone390);
    assert.equal(controller.tapAt({ x: cx, y: cy }, FIELDS.phone390), false);

    clock.wait(60_000);
    clock.frame(16);
    assert.equal(controller.getState().status, 'paused');

    controller.resume();
    assert.equal(clock.pendingCount(), 1);
    clock.frame(16);
    const after = controller.getState();
    assert.equal(after.status, 'playing');
    assert.equal(after.elapsed, before + 16, 'only the frame after resuming counts');
    assert.equal(after.score, 0);

    controller.resume();
    assert.equal(clock.pendingCount(), 1, 'resuming twice does not add a loop');
  });

  test('leaving the game cancels the frame loop, and nothing restarts it', () => {
    const { clock, controller, ends, changeCount } = setup();
    controller.start();
    const bubble = untilBubble(clock, controller);
    assert.equal(clock.pendingCount(), 1);

    controller.dispose();
    assert.equal(clock.pendingCount(), 0);
    assert.equal(clock.cancelledCount(), 1);
    assert.equal(controller.isLooping(), false);

    const changes = changeCount();
    controller.start();
    controller.resume();
    assert.equal(controller.pop(bubble.id), false);
    assert.equal(controller.tapAt({ x: 100, y: 100 }, FIELDS.phone390), false);
    clock.frame(16);
    clock.frame(ROUND_MS);
    assert.equal(clock.pendingCount(), 0);
    assert.equal(changeCount(), changes);
    assert.deepEqual(ends, []);
  });

  test('leaving while paused is also clean', () => {
    const { clock, controller } = setup();
    controller.start();
    clock.frame(16);
    controller.pause();
    controller.dispose();
    controller.resume();
    assert.equal(clock.pendingCount(), 0);
  });
});

describe('Bubble Break on-device record', () => {
  test('a completed round adds one and keeps the best score', () => {
    let stats: GameStats = { ...DEFAULT_GAME_STATS };
    stats = recordRound(stats, 12);
    stats = recordRound(stats, 7);
    stats = recordRound(stats, 0);
    assert.deepEqual(stats, { roundsCompleted: 3, bestScore: 12 });
    assert.deepEqual(recordRound(stats, 20), { roundsCompleted: 4, bestScore: 20 });
  });

  test('odd scores cannot corrupt the record', () => {
    assert.deepEqual(recordRound(DEFAULT_GAME_STATS, -4), { roundsCompleted: 1, bestScore: 0 });
    assert.deepEqual(recordRound(DEFAULT_GAME_STATS, Number.NaN), { roundsCompleted: 1, bestScore: 0 });
    assert.deepEqual(recordRound(DEFAULT_GAME_STATS, 2.5), { roundsCompleted: 1, bestScore: 0 });
  });

  test('missing or invalid saved values fall back to zero', () => {
    assert.deepEqual(sanitizeGameStats(null), DEFAULT_GAME_STATS);
    assert.deepEqual(sanitizeGameStats('x'), DEFAULT_GAME_STATS);
    assert.deepEqual(sanitizeGameStats({ roundsCompleted: -1, bestScore: 'ten' }), DEFAULT_GAME_STATS);
    assert.deepEqual(sanitizeGameStats({ roundsCompleted: 3.5, bestScore: 1e12 }), { roundsCompleted: 0, bestScore: 1_000_000 });
    assert.deepEqual(sanitizeGameStats({ roundsCompleted: 4, bestScore: 18 }), { roundsCompleted: 4, bestScore: 18 });
  });

  test('completed rounds survive a restart: saved through the write queue, then read back', async () => {
    const disk = new Map<string, string>();
    const queue = createWriteQueue<GameStats>(
      async (value) => {
        disk.set(STORAGE_KEYS.game, JSON.stringify(value));
      },
      () => assert.fail('write failed'),
    );
    let stats: GameStats = { ...DEFAULT_GAME_STATS };
    for (const score of [9, 14, 11]) {
      stats = recordRound(stats, score);
      queue.save(stats);
    }
    await queue.flush();

    const restored = sanitizeGameStats(JSON.parse(disk.get(STORAGE_KEYS.game)!));
    assert.deepEqual(restored, { roundsCompleted: 3, bestScore: 14 });
    assert.deepEqual([...disk.keys()], [STORAGE_KEYS.game], 'only the game record is written');
  });

  test('the game record has its own storage key, separate from puff logs and savings', () => {
    assert.equal(STORAGE_KEYS.game, '@puphii/bubble-break-v1');
    const others = Object.entries(STORAGE_KEYS)
      .filter(([name]) => name !== 'game')
      .map(([, key]) => key);
    assert.equal(others.includes(STORAGE_KEYS.game), false);
  });
});
