/**
 * A simulated Bubble Break player, for tuning. It is a rough model of a person, not a
 * stand-in for one: it never gets tired, distracted or hidden by its own finger, and
 * the timing figures are textbook approximations, so treat its results as relative
 * comparisons between configurations rather than as a measure of fun.
 */
import {
  advance,
  Bubble,
  bubbleLayout,
  bubblePosition,
  DEFAULT_TUNING,
  FieldSize,
  GameTuning,
  isOnScreen,
  Point,
  Random,
  resolveTap,
  RoundState,
  stageAt,
  StageName,
  startRound,
} from '../../src/game/bubbleBreak';

/** Deterministic random numbers (mulberry32). */
export function seeded(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PlayerProfile = {
  name: string;
  /** How long a bubble has to be visible before the player goes for it. */
  noticeMs: number;
  /** Time to pick the next target after a tap. */
  decideMs: number;
  /** Fitts' law movement time in ms: a + b · log2(distance / width + 1). */
  fittsA: number;
  fittsB: number;
  /** The aim is fixed this long before the finger lands; the player extrapolates the bubble's motion over it. */
  lockMs: number;
  /** Random aim error (standard deviation, points). */
  aimNoise: number;
};

/**
 * Four players. "Expert" pops essentially every bubble in the original version. "Fast"
 * is calibrated to the report that every bubble could still be popped in the first
 * rework (`ROUND_ONE`): roughly four to five taps a second.
 */
export const PLAYERS: readonly PlayerProfile[] = [
  { name: 'relaxed', noticeMs: 260, decideMs: 260, fittsA: 90, fittsB: 150, lockMs: 140, aimNoise: 7 },
  { name: 'typical', noticeMs: 200, decideMs: 180, fittsA: 70, fittsB: 120, lockMs: 130, aimNoise: 5.5 },
  { name: 'expert', noticeMs: 150, decideMs: 110, fittsA: 50, fittsB: 95, lockMs: 120, aimNoise: 4.5 },
  { name: 'fast', noticeMs: 110, decideMs: 50, fittsA: 30, fittsB: 65, lockMs: 100, aimNoise: 4 },
];

export const FIELDS: Readonly<Record<'phone390' | 'phone320', FieldSize>> = {
  phone390: { width: 347, height: 690 },
  phone320: { width: 277, height: 414 },
};

export type StageResult = { spawned: number; popped: number; escaped: number };
export type RoundResult = {
  score: number;
  taps: number;
  missedTaps: number;
  stages: Record<StageName, StageResult>;
};

const emptyStages = (): Record<StageName, StageResult> => ({
  'warm-up': { spawned: 0, popped: 0, escaped: 0 },
  build: { spawned: 0, popped: 0, escaped: 0 },
  challenge: { spawned: 0, popped: 0, escaped: 0 },
  finish: { spawned: 0, popped: 0, escaped: 0 },
});

function gaussian(random: Random): number {
  const u = Math.max(1e-9, random());
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * random());
}

const center = (bubble: Bubble, at: number, field: FieldSize, tuning: GameTuning) => {
  const { cx, cy, size } = bubbleLayout(bubble, at, field, tuning);
  return { x: cx, y: cy, size };
};

export function simulateRound({
  tuning = DEFAULT_TUNING,
  seed,
  player,
  field = FIELDS.phone390,
  stepMs = 8,
}: {
  tuning?: GameTuning;
  seed: number;
  player: PlayerProfile;
  field?: FieldSize;
  stepMs?: number;
}): RoundResult {
  const gameRandom = seeded(seed);
  const hand = seeded(seed * 7919 + 17);
  const stages = emptyStages();
  const live = new Map<number, Bubble>();
  let state: RoundState = startRound(tuning);
  let finger: Point = { x: field.width / 2, y: field.height * 0.75 };
  let readyAt = 400;
  let plan: { at: number; point: Point } | null = null;
  let taps = 0;
  let missedTaps = 0;

  while (state.status === 'playing') {
    const seen = state;
    state = advance(state, stepMs, gameRandom, tuning);
    if (state.status !== 'playing') break;
    const t = state.elapsed;

    for (const bubble of state.bubbles) {
      if (!live.has(bubble.id)) {
        live.set(bubble.id, bubble);
        stages[stageAt(bubble.bornAt, tuning).name].spawned += 1;
      }
    }
    for (const [id, bubble] of live) {
      if (t - bubble.bornAt >= bubble.travelMs) {
        stages[stageAt(bubble.bornAt, tuning).name].escaped += 1;
        live.delete(id);
      }
    }

    if (plan && t >= plan.at) {
      taps += 1;
      const result = resolveTap(seen, state, { point: plan.point, field }, tuning);
      if (result.popped) {
        state = result.state;
        live.delete(result.popped.id);
        stages[stageAt(result.popped.bornAt, tuning).name].popped += 1;
      } else {
        missedTaps += 1;
      }
      finger = plan.point;
      plan = null;
      readyAt = t + player.decideMs;
    }

    if (!plan && t >= readyAt) {
      let choice: { bubble: Bubble; at: number } | null = null;
      for (const bubble of state.bubbles) {
        if (t - bubble.bornAt < player.noticeMs || !isOnScreen(bubble, t)) continue;
        const here = center(bubble, t, field, tuning);
        const distance = Math.hypot(here.x - finger.x, here.y - finger.y);
        const at = t + player.fittsA + player.fittsB * Math.log2(distance / here.size + 1);
        if (!isOnScreen(bubble, at)) continue;
        const remaining = bubble.bornAt + bubble.travelMs - t;
        const best = choice ? choice.bubble.bornAt + choice.bubble.travelMs - t : Infinity;
        if (remaining < best) choice = { bubble, at };
      }
      if (choice) {
        const { bubble, at } = choice;
        const lockAt = Math.max(t, at - player.lockMs);
        const seenNow = center(bubble, lockAt, field, tuning);
        const before = Math.max(bubble.bornAt + 1, lockAt - 60);
        const seenBefore = center(bubble, before, field, tuning);
        const span = Math.max(1, lockAt - before);
        const lead = at - lockAt;
        plan = {
          at,
          point: {
            x: seenNow.x + ((seenNow.x - seenBefore.x) / span) * lead + gaussian(hand) * player.aimNoise,
            y: seenNow.y + ((seenNow.y - seenBefore.y) / span) * lead + gaussian(hand) * player.aimNoise,
          },
        };
      } else {
        readyAt = t + 40;
      }
    }
  }

  return { score: state.score, taps, missedTaps, stages };
}

export type Summary = {
  rounds: number;
  score: number;
  spawned: number;
  popRate: number;
  escapeRate: number;
  tapAccuracy: number;
  stages: Record<StageName, { spawned: number; popRate: number; escapeRate: number }>;
};

export function summarize(results: readonly RoundResult[]): Summary {
  const total = emptyStages();
  let score = 0;
  let taps = 0;
  let missed = 0;
  for (const result of results) {
    score += result.score;
    taps += result.taps;
    missed += result.missedTaps;
    for (const name of Object.keys(total) as StageName[]) {
      total[name].spawned += result.stages[name].spawned;
      total[name].popped += result.stages[name].popped;
      total[name].escaped += result.stages[name].escaped;
    }
  }
  const all = Object.values(total).reduce(
    (sum, stage) => ({ spawned: sum.spawned + stage.spawned, popped: sum.popped + stage.popped, escaped: sum.escaped + stage.escaped }),
    { spawned: 0, popped: 0, escaped: 0 },
  );
  const stages = {} as Summary['stages'];
  for (const name of Object.keys(total) as StageName[]) {
    const stage = total[name];
    stages[name] = {
      spawned: stage.spawned / results.length,
      popRate: stage.spawned ? stage.popped / stage.spawned : 0,
      escapeRate: stage.spawned ? stage.escaped / stage.spawned : 0,
    };
  }
  return {
    rounds: results.length,
    score: score / results.length,
    spawned: all.spawned / results.length,
    popRate: all.popped / all.spawned,
    escapeRate: all.escaped / all.spawned,
    tapAccuracy: taps ? (taps - missed) / taps : 0,
    stages,
  };
}

export function simulate(options: {
  tuning?: GameTuning;
  player: PlayerProfile;
  rounds: number;
  field?: FieldSize;
  firstSeed?: number;
}): Summary {
  const results: RoundResult[] = [];
  for (let i = 0; i < options.rounds; i += 1) {
    results.push(simulateRound({ ...options, seed: (options.firstSeed ?? 1) + i }));
  }
  return summarize(results);
}

/** Bubbles from one round, recorded as they spawn, for movement analysis. */
export function spawnedBubbles(tuning: GameTuning, seed: number): Bubble[] {
  const random = seeded(seed);
  let state = startRound(tuning);
  const seen = new Map<number, Bubble>();
  while (state.status === 'playing') {
    state = advance(state, 16, random, tuning);
    for (const bubble of state.bubbles) if (!seen.has(bubble.id)) seen.set(bubble.id, bubble);
  }
  return [...seen.values()];
}

export type MovementStats = {
  /** Average on-screen time (ms) and the spread between slow and fast bubbles. */
  travelMs: number;
  travelP10: number;
  travelP90: number;
  /** Share of bubbles that reverse sideways direction at least once. */
  reversals: number;
  /** How far (points) a 250 ms straight-line guess of a bubble's position is off, on average. */
  predictionError: number;
  /** Average |correlation| of sideways velocity between bubbles on screen together (0 = independent). */
  sync: number;
  /** Spread of rising speeds among bubbles on screen at the same moment (coefficient of variation). */
  speedSpread: number;
  /** Average bubbles on screen. */
  onScreen: number;
};

/** Sideways swing (fraction of the free width, about 17 pt on a 390 pt phone) that counts as a change of direction. */
const REVERSAL_SWING = 0.06;

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

function correlation(a: number[], b: number[]): number {
  const n = a.length;
  const ma = a.reduce((s, v) => s + v, 0) / n;
  const mb = b.reduce((s, v) => s + v, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i += 1) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va > 1e-12 && vb > 1e-12 ? cov / Math.sqrt(va * vb) : 0;
}

export function movementStats(tuning: GameTuning, seeds: number, field: FieldSize = FIELDS.phone390): Record<StageName, MovementStats> {
  const byStage = new Map<StageName, Bubble[]>();
  const counts = new Map<StageName, number[]>();
  for (let seed = 1; seed <= seeds; seed += 1) {
    const bubbles = spawnedBubbles(tuning, seed);
    for (const bubble of bubbles) {
      const name = stageAt(bubble.bornAt, tuning).name;
      byStage.set(name, [...(byStage.get(name) ?? []), bubble]);
    }
    for (let t = 50; t < 30_000; t += 100) {
      const name = stageAt(t, tuning).name;
      const n = bubbles.filter((bubble) => isOnScreen(bubble, t)).length;
      counts.set(name, [...(counts.get(name) ?? []), n]);
    }
  }

  const result = {} as Record<StageName, MovementStats>;
  for (const stage of tuning.stages) {
    const bubbles = byStage.get(stage.name) ?? [];
    const travel = bubbles.map((bubble) => bubble.travelMs).sort((a, b) => a - b);

    let reversing = 0;
    let errorSum = 0;
    let errorCount = 0;
    for (const bubble of bubbles) {
      // A reversal only counts once the bubble has swung back by a visible amount.
      let direction = 0;
      let extreme = bubblePosition(bubble, bubble.bornAt).x;
      let flips = 0;
      for (let i = 1; i <= 80; i += 1) {
        const x = bubblePosition(bubble, bubble.bornAt + (bubble.travelMs * i) / 80).x;
        if (direction === 0) {
          if (Math.abs(x - extreme) >= REVERSAL_SWING) direction = Math.sign(x - extreme);
          else continue;
          extreme = x;
        } else if ((x - extreme) * direction > 0) {
          extreme = x;
        } else if (Math.abs(x - extreme) >= REVERSAL_SWING) {
          flips += 1;
          direction = -direction;
          extreme = x;
        }
      }
      if (flips > 0) reversing += 1;
      for (let f = 0.2; f <= 0.6; f += 0.1) {
        const t = bubble.bornAt + bubble.travelMs * f;
        if (t + 250 >= bubble.bornAt + bubble.travelMs) continue;
        const a = bubbleLayout(bubble, t - 60, field, tuning);
        const b = bubbleLayout(bubble, t, field, tuning);
        const actual = bubbleLayout(bubble, t + 250, field, tuning);
        const k = 250 / 60;
        errorSum += Math.hypot(b.cx + (b.cx - a.cx) * k - actual.cx, b.cy + (b.cy - a.cy) * k - actual.cy);
        errorCount += 1;
      }
    }

    let syncSum = 0;
    let syncCount = 0;
    for (let i = 0; i < bubbles.length && syncCount < 400; i += 1) {
      for (let j = i + 1; j < bubbles.length && j < i + 4; j += 1) {
        const a = bubbles[i];
        const b = bubbles[j];
        const from = Math.max(a.bornAt, b.bornAt);
        const to = Math.min(a.bornAt + a.travelMs, b.bornAt + b.travelMs);
        if (to - from < 600) continue;
        const va: number[] = [];
        const vb: number[] = [];
        for (let t = from + 20; t < to - 20; t += (to - from) / 24) {
          va.push(bubblePosition(a, t + 20).x - bubblePosition(a, t).x);
          vb.push(bubblePosition(b, t + 20).x - bubblePosition(b, t).x);
        }
        syncSum += Math.abs(correlation(va, vb));
        syncCount += 1;
      }
    }

    let spreadSum = 0;
    let spreadCount = 0;
    for (let seed = 1; seed <= Math.min(seeds, 10); seed += 1) {
      const round = spawnedBubbles(tuning, seed);
      for (let t = stage.startsAt + 200; t < Math.min(30_000, stage.startsAt + 10_000); t += 250) {
        if (stageAt(t, tuning) !== stage) break;
        const speeds = round
          .filter((bubble) => isOnScreen(bubble, t) && isOnScreen(bubble, t + 40))
          .map((bubble) => bubbleLayout(bubble, t, field, tuning).cy - bubbleLayout(bubble, t + 40, field, tuning).cy);
        if (speeds.length < 3) continue;
        const mean = speeds.reduce((s, v) => s + v, 0) / speeds.length;
        const sd = Math.sqrt(speeds.reduce((s, v) => s + (v - mean) ** 2, 0) / speeds.length);
        spreadSum += sd / mean;
        spreadCount += 1;
      }
    }

    const onScreen = counts.get(stage.name) ?? [0];
    result[stage.name] = {
      travelMs: travel.reduce((s, v) => s + v, 0) / Math.max(1, travel.length),
      travelP10: quantile(travel, 0.1),
      travelP90: quantile(travel, 0.9),
      reversals: bubbles.length ? reversing / bubbles.length : 0,
      predictionError: errorCount ? errorSum / errorCount : 0,
      sync: syncCount ? syncSum / syncCount : 0,
      speedSpread: spreadCount ? spreadSum / spreadCount : 0,
      onScreen: onScreen.reduce((s, v) => s + v, 0) / onScreen.length,
    };
  }
  return result;
}
