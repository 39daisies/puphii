/**
 * Bubble Break round logic. Pure and clock-free: callers pass elapsed time in, so
 * the rules can be tested without React Native or real timers. Every bubble's path is
 * a function of round time, so it moves identically at any frame rate.
 */

export const ROUND_MS = 30_000;
export const POP_EFFECT_MS = 320;
export const BUBBLE_TINTS = 3;
/**
 * A tap is judged against the frame that was on screen when the finger landed,
 * provided that frame is this recent; otherwise it is judged at the moment of the tap.
 */
export const TAP_LATENCY_MS = 100;

export type Range = readonly [number, number];
export type BubbleKind = 'drifter' | 'weaver' | 'darter' | 'floater' | 'shooter';
export const BUBBLE_KINDS: readonly BubbleKind[] = ['drifter', 'weaver', 'darter', 'floater', 'shooter'];
export type StageName = 'warm-up' | 'build' | 'challenge' | 'finish';

/** How one kind of bubble moves. Each bubble draws its own values from these ranges. */
export type KindTuning = {
  /** Multiplies the stage travel time; below 1 is faster. */
  travel: Range;
  /** Multiplies the stage bubble size. */
  size: number;
  /** Side-to-side swing, as a fraction of the free width. */
  weave: Range;
  /** Swings per trip up the field. */
  weaveCycles: Range;
  /** A small second swing at a faster rate, so paths never repeat exactly. */
  wobble: Range;
  /** Net sideways travel over the trip, in either direction, as a fraction of the free width. */
  drift: Range;
  /** Rise-speed wobble: 0 is steady; 0.4 swings between 0.6× and 1.4× the average. */
  surge: Range;
  /** Above 0 the bubble speeds up as it rises; below 0 it starts fast and eases off. */
  ease: Range;
};

export type StageTuning = {
  name: StageName;
  /** Round time at which the stage begins. */
  startsAt: number;
  /** Bottom-to-top travel time of a typical bubble. */
  travelMs: number;
  /** Gap before the next bubble outside a cluster. */
  spawnGapMs: Range;
  /** Chance that a bubble starts a volley: several bubbles fired in quick succession. */
  clusterChance: number;
  /** Bubbles in a volley, including the first. */
  clusterSize: Range;
  clusterGapMs: Range;
  /** Chance of a short quiet spell instead of the usual gap, so the rhythm never settles. */
  lullChance: number;
  lullGapMs: Range;
  /** Nominal diameter in points before the kind's size factor. */
  size: Range;
  /** Relative chance of each kind of bubble. */
  kinds: Readonly<Record<BubbleKind, number>>;
};

export type GameTuning = {
  /** Ordered by `startsAt`; each stage applies until the next begins. */
  stages: readonly StageTuning[];
  kinds: Readonly<Record<BubbleKind, KindTuning>>;
  maxBubbles: number;
  firstSpawnMs: number;
  /** A new bubble starts at least this far (fraction of free width) from bubbles still low in the field. */
  spawnSpacing: number;
  /** No bubble crosses the field faster than this. */
  minTravelMs: number;
  /** Largest on-screen diameter as a fraction of the field width. */
  maxDiameterRatio: number;
  /** Smallest on-screen diameter, in points. */
  minDiameter: number;
  /** Distance outside a bubble's edge that still counts as a hit, for finger size. */
  touchSlop: number;
};

/**
 * Bubble Break tuning: version 2's steady bubbles with a gentler speed-up (1×, 1.2×, 1.4×
 * and 1.6×), because players found every faster variant frustrating. `npm run simulate`
 * compares alternatives; see tests/sim/tuneBubbleBreak.ts.
 */
export const DEFAULT_TUNING: GameTuning = {
  stages: [
    {
      name: 'warm-up',
      startsAt: 0,
      travelMs: 5100,
      spawnGapMs: [520, 860],
      clusterChance: 0,
      clusterSize: [2, 2],
      clusterGapMs: [0, 0],
      lullChance: 0,
      lullGapMs: [0, 0],
      size: [58, 84],
      kinds: { drifter: 1, weaver: 0, darter: 0, floater: 0, shooter: 0 },
    },
    {
      name: 'build',
      startsAt: 5_000,
      travelMs: 5100 / 1.2,
      spawnGapMs: [520 * 0.9, 860 * 0.9],
      clusterChance: 0,
      clusterSize: [2, 2],
      clusterGapMs: [0, 0],
      lullChance: 0,
      lullGapMs: [0, 0],
      size: [58, 84],
      kinds: { drifter: 1, weaver: 0, darter: 0, floater: 0, shooter: 0 },
    },
    {
      name: 'challenge',
      startsAt: 10_000,
      travelMs: 5100 / 1.4,
      spawnGapMs: [520 * 0.8, 860 * 0.8],
      clusterChance: 0,
      clusterSize: [2, 2],
      clusterGapMs: [0, 0],
      lullChance: 0,
      lullGapMs: [0, 0],
      size: [58, 84],
      kinds: { drifter: 1, weaver: 0, darter: 0, floater: 0, shooter: 0 },
    },
    {
      name: 'finish',
      startsAt: 20_000,
      travelMs: 5100 / 1.6,
      spawnGapMs: [520 * 0.7, 860 * 0.7],
      clusterChance: 0,
      clusterSize: [2, 2],
      clusterGapMs: [0, 0],
      lullChance: 0,
      lullGapMs: [0, 0],
      size: [58, 84],
      kinds: { drifter: 1, weaver: 0, darter: 0, floater: 0, shooter: 0 },
    },
  ],
  // Only drifters are used: straight up at a steady speed with a ±6 pt sway. The other
  // kinds are kept for tuning experiments (`npm run simulate`).
  kinds: {
    drifter: {
      travel: [4200 / 5100, 6000 / 5100],
      size: 1,
      weave: [0.022, 0.022],
      weaveCycles: [1.2, 1.2],
      wobble: [0, 0],
      drift: [0, 0],
      surge: [0, 0],
      ease: [0, 0],
    },
    weaver: {
      travel: [0.85, 1.25],
      size: 1,
      weave: [0.12, 0.26],
      weaveCycles: [1.1, 2.4],
      wobble: [0, 0.04],
      drift: [0, 0.2],
      surge: [0.15, 0.4],
      ease: [-0.2, 0.2],
    },
    darter: {
      travel: [0.6, 0.85],
      size: 0.86,
      weave: [0.03, 0.12],
      weaveCycles: [0.5, 1.4],
      wobble: [0, 0.04],
      drift: [0.15, 0.55],
      surge: [0.1, 0.3],
      ease: [0.2, 0.45],
    },
    floater: {
      travel: [1.25, 1.6],
      size: 1.08,
      weave: [0.05, 0.14],
      weaveCycles: [0.5, 1.2],
      wobble: [0, 0.04],
      drift: [0, 0.15],
      surge: [0.35, 0.55],
      ease: [-0.2, 0.1],
    },
    // Fired in fast and at an angle, then slowing near the top.
    shooter: {
      travel: [0.7, 0.95],
      size: 0.92,
      weave: [0.02, 0.08],
      weaveCycles: [0.5, 1.2],
      wobble: [0, 0.03],
      drift: [0.1, 0.35],
      surge: [0.03, 0.1],
      ease: [-0.42, -0.3],
    },
  },
  maxBubbles: 7,
  firstSpawnMs: 150,
  spawnSpacing: 0.25,
  minTravelMs: 0,
  maxDiameterRatio: 0.26,
  minDiameter: 52,
  // The version-2 touch target was the bubble's square plus 4 pt, roughly the circle plus 10 pt.
  touchSlop: 10,
};

export function stageAt(elapsed: number, tuning: GameTuning = DEFAULT_TUNING): StageTuning {
  let stage = tuning.stages[0];
  for (const candidate of tuning.stages) {
    if (elapsed >= candidate.startsAt) stage = candidate;
  }
  return stage;
}

/** One bubble's own path; values are drawn independently for every bubble. */
export type Motion = {
  /** Base horizontal position, as a fraction of the free width. */
  x0: number;
  drift: number;
  weave: number;
  weaveCycles: number;
  weavePhase: number;
  /** A small second swing at another rate, so paths never repeat exactly. */
  wobble: number;
  wobbleCycles: number;
  wobblePhase: number;
  surge: number;
  /** Whole number, so the bubble still leaves the field exactly at the end of its travel time. */
  surgeCycles: number;
  surgePhase: number;
  ease: number;
};

export type Bubble = {
  id: number;
  kind: BubbleKind;
  /** Nominal diameter in points; the screen may scale it to fit the field. */
  size: number;
  bornAt: number;
  /** Time to float from below the field to above it. */
  travelMs: number;
  tint: number;
  motion: Motion;
};

export type PopEffect = { id: number; x: number; size: number; progress: number; at: number };

export type RoundStatus = 'ready' | 'playing' | 'paused' | 'ended';

export type RoundState = {
  status: RoundStatus;
  /** Round time that has actually been played; pauses don't count. */
  elapsed: number;
  score: number;
  bubbles: Bubble[];
  pops: PopEffect[];
  nextSpawnAt: number;
  nextId: number;
  /** Bubbles still to come in the current cluster. */
  clusterLeft: number;
};

export type Random = () => number;
export type Point = { x: number; y: number };
export type FieldSize = { width: number; height: number };

const TAU = Math.PI * 2;
const between = (random: Random, [min, max]: Range) => min + random() * (max - min);
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const signed = (random: Random, range: Range) => (random() < 0.5 ? -1 : 1) * between(random, range);
const wholeBetween = (random: Random, [min, max]: Range) => min + Math.floor(random() * (max - min + 1));
/** Folds any position back into 0…1, so bubbles bounce off the side walls instead of sticking. */
const reflect = (value: number) => {
  const folded = ((value % 2) + 2) % 2;
  return folded > 1 ? 2 - folded : folded;
};

export function createRound(tuning: GameTuning = DEFAULT_TUNING): RoundState {
  return {
    status: 'ready',
    elapsed: 0,
    score: 0,
    bubbles: [],
    pops: [],
    nextSpawnAt: tuning.firstSpawnMs,
    nextId: 1,
    clusterLeft: 0,
  };
}

export function startRound(tuning: GameTuning = DEFAULT_TUNING): RoundState {
  return { ...createRound(tuning), status: 'playing' };
}

/** 0 at the start of a bubble's trip, 1 at the end. */
export function tripFraction(bubble: Pick<Bubble, 'bornAt' | 'travelMs'>, elapsed: number): number {
  return clamp((elapsed - bubble.bornAt) / bubble.travelMs, 0, 1);
}

/**
 * Where a bubble is: `x` across the free width (0…1) and `progress` up the field
 * (0 just below the bottom edge, 1 just above the top). Rise speed never drops below
 * a fifth of the average, so a bubble can't stall, and it always leaves on time.
 */
export function bubblePosition(bubble: Pick<Bubble, 'bornAt' | 'travelMs' | 'motion'>, elapsed: number) {
  const u = tripFraction(bubble, elapsed);
  const m = bubble.motion;
  const k = TAU * m.surgeCycles;
  const rise = (1 - m.ease) * u + m.ease * u * u + (m.surge / k) * (Math.sin(k * u + m.surgePhase) - Math.sin(m.surgePhase));
  const side =
    m.x0 +
    m.drift * u +
    m.weave * Math.sin(TAU * m.weaveCycles * u + m.weavePhase) +
    m.wobble * Math.sin(TAU * m.wobbleCycles * u + m.wobblePhase);
  return { x: reflect(side), progress: u >= 1 ? 1 : clamp(rise, 0, 1) };
}

/** Whether any part of the bubble is inside the play area. */
export function isOnScreen(bubble: Pick<Bubble, 'bornAt' | 'travelMs'>, elapsed: number): boolean {
  const age = elapsed - bubble.bornAt;
  return age > 0 && age < bubble.travelMs;
}

export function secondsLeft(state: RoundState): number {
  return Math.max(0, Math.ceil((ROUND_MS - state.elapsed) / 1000));
}

/** On-screen diameter: narrow fields shrink the largest bubbles, never below a comfortable target. */
export function bubbleDiameter(nominal: number, fieldWidth: number, tuning: GameTuning = DEFAULT_TUNING): number {
  return Math.round(Math.max(tuning.minDiameter, Math.min(nominal, fieldWidth * tuning.maxDiameterRatio)));
}

/** Screen box for a bubble at a given place; rendering and hit testing both use this. */
export function placeBubble(
  nominalSize: number,
  x: number,
  progress: number,
  field: FieldSize,
  tuning: GameTuning = DEFAULT_TUNING,
) {
  const size = bubbleDiameter(nominalSize, field.width, tuning);
  const left = x * Math.max(0, field.width - size);
  const top = field.height - progress * (field.height + size);
  return { size, left, top, cx: left + size / 2, cy: top + size / 2 };
}

export function bubbleLayout(bubble: Bubble, elapsed: number, field: FieldSize, tuning: GameTuning = DEFAULT_TUNING) {
  const { x, progress } = bubblePosition(bubble, elapsed);
  return placeBubble(bubble.size, x, progress, field, tuning);
}

/** The bubble under a point, if any. Overlaps go to the bubble whose centre is closest. */
export function hitTest(
  bubbles: readonly Bubble[],
  elapsed: number,
  field: FieldSize,
  point: Point,
  tuning: GameTuning = DEFAULT_TUNING,
): Bubble | null {
  let best: Bubble | null = null;
  let bestScore = Infinity;
  for (const bubble of bubbles) {
    if (!isOnScreen(bubble, elapsed)) continue;
    const { size, cx, cy } = bubbleLayout(bubble, elapsed, field, tuning);
    const reach = size / 2 + tuning.touchSlop;
    const distance = Math.hypot(point.x - cx, point.y - cy);
    if (distance <= reach && distance / reach < bestScore) {
      best = bubble;
      bestScore = distance / reach;
    }
  }
  return best;
}

function pickKind(weights: Readonly<Record<BubbleKind, number>>, random: Random): BubbleKind {
  const total = BUBBLE_KINDS.reduce((sum, kind) => sum + weights[kind], 0);
  let roll = random() * total;
  for (const kind of BUBBLE_KINDS) {
    roll -= weights[kind];
    if (roll < 0 && weights[kind] > 0) return kind;
  }
  return BUBBLE_KINDS.find((kind) => weights[kind] > 0) ?? 'drifter';
}

/** Bubbles below this fraction of their trip are still close enough to the entry point to overlap a new one. */
const ENTRY_ZONE = 0.2;

/** How long a bubble waits when the bottom of the field has no clear spot for it. */
const ENTRY_WAIT_MS = 50;

/**
 * A start spot clear of bubbles that are still near the bottom, so new bubbles never
 * stack, or null when the bottom is full.
 */
function pickStartX(neighbours: readonly Bubble[], at: number, random: Random, tuning: GameTuning): number | null {
  const low = neighbours
    .map((bubble) => bubblePosition(bubble, at))
    .filter((position) => position.progress < ENTRY_ZONE)
    .map((position) => position.x);
  // Candidates step by the golden ratio from a random start, which spreads them evenly
  // across the width, so a free gap is found whenever there is one.
  const shift = random();
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = (shift + attempt * 0.618034) % 1;
    const gap = low.reduce((nearest, x) => Math.min(nearest, Math.abs(candidate - x)), Infinity);
    if (gap >= tuning.spawnSpacing) return candidate;
  }
  return null;
}

function createBubble(id: number, at: number, startX: number, random: Random, tuning: GameTuning): Bubble {
  const stage = stageAt(at, tuning);
  const kind = pickKind(stage.kinds, random);
  const style = tuning.kinds[kind];
  const ease = between(random, style.ease);
  const motion: Motion = {
    x0: 0,
    drift: signed(random, style.drift),
    weave: between(random, style.weave),
    weaveCycles: between(random, style.weaveCycles),
    weavePhase: random() * TAU,
    wobble: between(random, style.wobble),
    wobbleCycles: between(random, [2.2, 3.8]),
    wobblePhase: random() * TAU,
    // Speed never falls below 0.2× the average: |ease| + surge stays at or under 0.8.
    surge: Math.min(between(random, style.surge), 0.8 - Math.abs(ease)),
    surgeCycles: wholeBetween(random, [1, 3]),
    surgePhase: random() * TAU,
    ease,
  };
  motion.x0 = startX - motion.weave * Math.sin(motion.weavePhase) - motion.wobble * Math.sin(motion.wobblePhase);
  return {
    id,
    kind,
    size: Math.round(between(random, stage.size) * style.size),
    bornAt: at,
    travelMs: Math.max(tuning.minTravelMs, Math.round(stage.travelMs * between(random, style.travel))),
    tint: Math.floor(random() * BUBBLE_TINTS) % BUBBLE_TINTS,
    motion,
  };
}

/**
 * Moves the round forward by the real time since the previous update. Positions follow
 * from the round clock, so a late frame shows the round where it should be instead of
 * slowing it down.
 */
export function advance(state: RoundState, dtMs: number, random: Random, tuning: GameTuning = DEFAULT_TUNING): RoundState {
  if (state.status !== 'playing') return state;
  const step = Number.isFinite(dtMs) && dtMs > 0 ? dtMs : 0;
  const elapsed = Math.min(ROUND_MS, state.elapsed + step);

  if (elapsed >= ROUND_MS) {
    return { ...state, status: 'ended', elapsed: ROUND_MS, bubbles: [], pops: [] };
  }

  let bubbles = state.bubbles;
  let { nextSpawnAt, nextId, clusterLeft } = state;
  while (nextSpawnAt <= elapsed) {
    const at = nextSpawnAt;
    const stage = stageAt(at, tuning);
    bubbles = bubbles.filter((bubble) => at - bubble.bornAt < bubble.travelMs);
    if (bubbles.length < tuning.maxBubbles) {
      const startX = pickStartX(bubbles, at, random, tuning);
      if (startX === null) {
        nextSpawnAt += ENTRY_WAIT_MS;
        continue;
      }
      bubbles = [...bubbles, createBubble(nextId, at, startX, random, tuning)];
      nextId += 1;
    }
    let gap: number;
    if (clusterLeft > 0) {
      clusterLeft -= 1;
      gap = between(random, stage.clusterGapMs);
    } else if (random() < stage.clusterChance) {
      clusterLeft = wholeBetween(random, stage.clusterSize) - 2;
      gap = between(random, stage.clusterGapMs);
    } else if (random() < stage.lullChance) {
      gap = between(random, stage.lullGapMs);
    } else {
      gap = between(random, stage.spawnGapMs);
    }
    nextSpawnAt += Math.max(1, Math.round(gap));
  }

  bubbles = bubbles.filter((bubble) => elapsed - bubble.bornAt < bubble.travelMs);
  const pops = state.pops.filter((pop) => elapsed - pop.at < POP_EFFECT_MS);
  return { ...state, elapsed, bubbles, pops, nextSpawnAt, nextId, clusterLeft };
}

/** Scores a bubble that was visible at `seenAt`, removing it if it is still in play. */
function scoreBubble(state: RoundState, bubble: Bubble, seenAt: number): RoundState {
  const { x, progress } = bubblePosition(bubble, seenAt);
  return {
    ...state,
    score: state.score + 1,
    bubbles: state.bubbles.filter((candidate) => candidate.id !== bubble.id),
    pops: [...state.pops, { id: bubble.id, x, size: bubble.size, progress, at: state.elapsed }],
  };
}

/** Pops one visible bubble by id. Popping it again, off screen or after the round changes nothing. */
export function popBubble(state: RoundState, id: number): { state: RoundState; popped: boolean } {
  if (state.status !== 'playing') return { state, popped: false };
  const bubble = state.bubbles.find((candidate) => candidate.id === id);
  if (!bubble || !isOnScreen(bubble, state.elapsed)) return { state, popped: false };
  return { state: scoreBubble(state, bubble, state.elapsed), popped: true };
}

/**
 * Resolves a tap. `seen` is the round as last drawn and `now` is the round brought up
 * to the moment of the tap. The tap is judged against what the player saw, as long as
 * that frame is recent. A bubble can only be in `seen` if it hasn't been popped yet,
 * so each bubble scores at most once.
 */
export function resolveTap(
  seen: RoundState,
  now: RoundState,
  target: { point: Point; field: FieldSize } | { id: number },
  tuning: GameTuning = DEFAULT_TUNING,
): { state: RoundState; popped: Bubble | null } {
  if (now.status !== 'playing') return { state: now, popped: null };
  const judged = now.elapsed - seen.elapsed <= TAP_LATENCY_MS && seen.status === 'playing' ? seen : now;
  const bubble =
    'id' in target
      ? judged.bubbles.find((candidate) => candidate.id === target.id && isOnScreen(candidate, judged.elapsed)) ?? null
      : hitTest(judged.bubbles, judged.elapsed, target.field, target.point, tuning);
  if (!bubble) return { state: now, popped: null };
  return { state: scoreBubble(now, bubble, judged.elapsed), popped: bubble };
}

export function pauseRound(state: RoundState): RoundState {
  return state.status === 'playing' ? { ...state, status: 'paused' } : state;
}

export function resumeRound(state: RoundState): RoundState {
  return state.status === 'paused' ? { ...state, status: 'playing' } : state;
}

export type FrameScheduler = {
  now: () => number;
  request: (callback: () => void) => unknown;
  cancel: (handle: unknown) => void;
};

export type RoundController = ReturnType<typeof createRoundController>;

/**
 * Runs a round on a frame scheduler. The round clock is real time minus paused time,
 * so slow or missing frames never stretch the round past 30 seconds. There is never
 * more than one pending frame, and nothing is scheduled once the round ends, pauses
 * or the controller is disposed.
 */
export function createRoundController({
  scheduler,
  random = Math.random,
  tuning = DEFAULT_TUNING,
  onChange,
  onEnd,
}: {
  scheduler: FrameScheduler;
  random?: Random;
  tuning?: GameTuning;
  onChange: (state: RoundState) => void;
  onEnd?: (score: number) => void;
}) {
  let state = createRound(tuning);
  let handle: unknown = null;
  /** Clock reading the round time was last brought up to date with. */
  let syncedAt = 0;
  let disposed = false;
  const current = () => state;

  const stopLoop = () => {
    if (handle !== null) scheduler.cancel(handle);
    handle = null;
  };

  const set = (next: RoundState) => {
    if (next === state) return;
    const wasPlaying = state.status === 'playing';
    state = next;
    onChange(state);
    if (wasPlaying && next.status === 'ended') {
      stopLoop();
      onEnd?.(next.score);
    }
  };

  /** Brings the round up to the current real time. */
  const sync = () => {
    if (state.status !== 'playing') return;
    const now = scheduler.now();
    const dt = now - syncedAt;
    syncedAt = now;
    set(advance(state, dt, random, tuning));
  };

  const frame = () => {
    handle = null;
    if (disposed || state.status !== 'playing') return;
    sync();
    if (current().status === 'playing') handle = scheduler.request(frame);
  };

  const startLoop = () => {
    if (disposed || handle !== null) return;
    syncedAt = scheduler.now();
    handle = scheduler.request(frame);
  };

  /** A tap is judged at the moment it happens, so a tap after time is up never scores. */
  const tap = (target: { point: Point; field: FieldSize } | { id: number }): Bubble | null => {
    if (disposed || state.status !== 'playing') return null;
    const seen = state;
    sync();
    const result = resolveTap(seen, current(), target, tuning);
    if (result.popped) set(result.state);
    return result.popped;
  };

  return {
    getState: () => state,
    isLooping: () => handle !== null,
    /** Starts a fresh round; also used for "Play again". */
    start() {
      if (disposed) return;
      stopLoop();
      set(startRound(tuning));
      startLoop();
    },
    /** Pops whichever bubble is under a point in the play area. */
    tapAt(point: Point, field: FieldSize): boolean {
      return tap({ point, field }) !== null;
    },
    /** Pops a bubble by id, for screen readers and keyboards. */
    pop(id: number): boolean {
      return tap({ id }) !== null;
    },
    pause() {
      if (disposed || state.status !== 'playing') return;
      sync();
      if (current().status !== 'playing') return;
      stopLoop();
      set(pauseRound(state));
    },
    resume() {
      if (disposed || state.status !== 'paused') return;
      set(resumeRound(state));
      startLoop();
    },
    dispose() {
      disposed = true;
      stopLoop();
    },
  };
}
