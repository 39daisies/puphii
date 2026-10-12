/**
 * Timing and layout for the Home reef scene. Plain numbers only (no React Native), so the
 * choreography can be unit-tested: every animated property is a keyframe table driven by a
 * looping 0 → 1 clock, which lets the whole scene pause and resume exactly where it was.
 */

export type Keyframes = { inputRange: number[]; outputRange: number[] };

export const SWIM_CYCLE_MS = 14_000;
export const FISH_CYCLE_MS = 26_000;
export const BUBBLE_CYCLE_MS = 8_000;

/**
 * Sprite swaps happen inside this sliver of the swim cycle (under 6 ms), at the narrowest point
 * of a turn, so the side-on and front-facing sprites are never visible together.
 */
export const SWAP_WINDOW = 0.0004;
/** Narrowest horizontal scale during a turn: thin enough to hide the swap, never exactly zero. */
export const TURN_EDGE = 0.06;

/** Positions in the swim cycle. Puphii's side-on sprite faces left, so a positive scaleX faces left. */
export const SWIM_MOMENTS = {
  /** Turning around at the left end of the lane to face right. */
  turnRightEnd: 0.05,
  swimRightEnd: 0.4,
  /** Turning toward the viewer. */
  frontSwap: 0.43,
  frontFull: 0.46,
  frontHoldEnd: 0.6,
  /** Turning away again, now facing left. */
  profileSwap: 0.63,
  profileFull: 0.66,
} as const;

/** Clock position used whenever motion is off: Puphii facing the viewer, mid-lane. */
export const SWIM_REST = 0.53;

const M = SWIM_MOMENTS;
const half = SWAP_WINDOW / 2;

function smoothstep(t: number) {
  return t * t * (3 - 2 * t);
}

/** Keyframes through the given points, eased between each pair so Puphii glides rather than jerks. */
function eased(points: [number, number][], steps = 6): Keyframes {
  const inputRange = [points[0][0]];
  const outputRange = [points[0][1]];
  for (let i = 1; i < points.length; i += 1) {
    const [t0, v0] = points[i - 1];
    const [t1, v1] = points[i];
    for (let s = 1; s <= steps; s += 1) {
      const f = s / steps;
      inputRange.push(t0 + (t1 - t0) * f);
      outputRange.push(v0 + (v1 - v0) * smoothstep(f));
    }
  }
  return { inputRange, outputRange };
}

function linear(points: [number, number][]): Keyframes {
  return { inputRange: points.map((p) => p[0]), outputRange: points.map((p) => p[1]) };
}

/** `cycles` full sine waves across the clock, as keyframes. */
export function sineKeys(cycles: number, amplitude = 1, pointsPerCycle = 8): Keyframes {
  const count = Math.max(4, Math.round(cycles * pointsPerCycle));
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    inputRange.push(t);
    outputRange.push(Number((Math.sin(t * cycles * Math.PI * 2) * amplitude).toFixed(4)));
  }
  return { inputRange, outputRange };
}

/** Maps the clock to `(t + phase) mod 1`, so several things can share one clock out of step. */
export function wrapKeys(phase: number): Keyframes {
  const p = ((phase % 1) + 1) % 1;
  if (p === 0) return { inputRange: [0, 1], outputRange: [0, 1] };
  const split = 1 - p;
  return { inputRange: [0, split, split + 0.0001, 1], outputRange: [p, 1, 0, p] };
}

/**
 * One swim cycle: turn at the left end, swim right while drifting up, turn to smile at the viewer,
 * turn away, swim back left. `x` and `y` are fractions of the available travel (-1 … 1).
 */
export const SWIM_KEYS = {
  x: eased([
    [0, -1],
    [M.turnRightEnd, -0.96],
    [M.swimRightEnd, 1],
    [M.frontFull, 0.9],
    [M.frontHoldEnd, 0.7],
    [M.profileFull, 0.6],
    [1, -1],
  ]),
  y: eased([
    [0, 0.35],
    [M.swimRightEnd, -0.55],
    [M.frontFull, -0.3],
    [M.frontHoldEnd, -0.15],
    [M.profileFull, -0.05],
    [1, 0.35],
  ]),
  /** Small up-and-down float layered on top of the path. */
  bob: sineKeys(4),
  profileScaleX: linear([
    [0, 1],
    [M.turnRightEnd / 2 - half, TURN_EDGE],
    [M.turnRightEnd / 2 + half, -TURN_EDGE],
    [M.turnRightEnd, -1],
    [M.swimRightEnd, -1],
    [M.frontSwap - half, -TURN_EDGE],
    [M.frontSwap + half, -TURN_EDGE],
    [M.profileSwap - half, TURN_EDGE],
    [M.profileSwap + half, TURN_EDGE],
    [M.profileFull, 1],
    [1, 1],
  ]),
  profileOpacity: linear([
    [0, 1],
    [M.frontSwap - half, 1],
    [M.frontSwap + half, 0],
    [M.profileSwap - half, 0],
    [M.profileSwap + half, 1],
    [1, 1],
  ]),
  frontScaleX: linear([
    [0, TURN_EDGE],
    [M.frontSwap - half, TURN_EDGE],
    [M.frontSwap + half, TURN_EDGE],
    [M.frontFull, 1],
    [M.frontHoldEnd, 1],
    [M.profileSwap - half, TURN_EDGE],
    [M.profileSwap + half, TURN_EDGE],
    [1, TURN_EDGE],
  ]),
} satisfies Record<string, Keyframes>;

export const FRONT_OPACITY: Keyframes = {
  inputRange: SWIM_KEYS.profileOpacity.inputRange,
  outputRange: SWIM_KEYS.profileOpacity.outputRange.map((v) => 1 - v),
};

/** Where a stopped swim clock should rest: never mid-turn, where the sprite is squeezed thin. */
export function settleSwim(t: number, still: boolean): number {
  if (still) return SWIM_REST;
  if (t < M.turnRightEnd) return M.turnRightEnd;
  if (t > M.swimRightEnd && t < M.frontFull) return M.frontFull;
  if (t > M.frontHoldEnd && t < M.profileFull) return M.profileFull;
  return t;
}

/** Linear interpolation of a keyframe table, clamped, matching Animated's `extrapolate: 'clamp'`. */
export function sample(keys: Keyframes, t: number): number {
  const { inputRange: xs, outputRange: ys } = keys;
  if (t <= xs[0]) return ys[0];
  for (let i = 1; i < xs.length; i += 1) {
    if (t === xs[i]) return ys[i];
    if (t < xs[i]) return ys[i - 1] + ((ys[i] - ys[i - 1]) * (t - xs[i - 1])) / (xs[i] - xs[i - 1]);
  }
  return ys[ys.length - 1];
}

export type FishSpec = { phase: number; y: number; size: number; direction: 1 | -1; tint: 0 | 1 };
export type BubbleSpec = { phase: number; x: number; size: number };

/** A few small fish crossing at different depths. They pass behind the count and Puphii. */
export const REEF_FISH: readonly FishSpec[] = [
  { phase: 0.08, y: 0.66, size: 18, direction: -1, tint: 0 },
  { phase: 0.52, y: 0.8, size: 13, direction: -1, tint: 1 },
  { phase: 0.3, y: 0.3, size: 14, direction: 1, tint: 0 },
];

export const REEF_BUBBLES: readonly BubbleSpec[] = [
  { phase: 0, x: 0.58, size: 7 },
  { phase: 0.36, x: 0.9, size: 10 },
  { phase: 0.63, x: 0.95, size: 6 },
  { phase: 0.82, x: 0.06, size: 8 },
];

/** Mascot.tsx draws the fish in a frame this much larger than `size`, to leave room for reaction effects. */
export const MASCOT_FRAME_W = 1.25;
export const MASCOT_FRAME_H = 1.05;
/** Approximate advance width of one Fraunces Black digit, as a fraction of font size. */
export const DIGIT_WIDTH = 0.66;
/** Room for "Today's count" at the default text size; larger text wraps inside the plate. */
const LABEL_WIDTH = 104;
export const SCENE_INSET = 12;
export const PLATE_PADDING = 14;
const LANE_GAP = 8;
const LANE_END = 4;
const MIN_SWIM = 16;
export const BOB_AMPLITUDE = 5;
const MAX_RISE = 40;

export type ReefLayout = {
  sceneMinHeight: number;
  plateWidth: number;
  countSize: number;
  mascotSize: number;
  laneLeft: number;
  laneWidth: number;
  /** Horizontal travel each side of the lane's centre. */
  swimRange: number;
};

/**
 * The count sits on an opaque plate at the scene's top left; Puphii swims in the lane to its
 * right, so movement never passes over the digits. `sceneWidth` is the inner width of the card.
 */
export function reefLayout({ sceneWidth, screenHeight, digits }: { sceneWidth: number; screenHeight: number; digits: number }): ReefLayout {
  const tall = screenHeight >= 800;
  const compact = screenHeight < 700;
  const shownDigits = Math.max(2, digits);
  const maxPlate = sceneWidth * 0.48;
  const countSize = Math.floor(Math.min(tall ? 96 : compact ? 76 : 88, (maxPlate - PLATE_PADDING * 2) / (shownDigits * DIGIT_WIDTH)));
  const plateWidth = Math.ceil(Math.max(LABEL_WIDTH, shownDigits * DIGIT_WIDTH * countSize) + PLATE_PADDING * 2);
  const laneLeft = SCENE_INSET + plateWidth + LANE_GAP;
  const laneWidth = Math.max(0, sceneWidth - laneLeft - LANE_END);
  const maxMascot = tall ? 112 : compact ? 96 : 104;
  const mascotSize = Math.floor(Math.min(maxMascot, Math.max(60, (laneWidth - MIN_SWIM * 2) / MASCOT_FRAME_W)));
  const swimRange = Math.max(0, (laneWidth - mascotSize * MASCOT_FRAME_W) / 2);
  return { sceneMinHeight: tall ? 232 : compact ? 188 : 208, plateWidth, countSize, mascotSize, laneLeft, laneWidth, swimRange };
}

/** Vertical travel each side of centre, leaving room for the bob so Puphii is never clipped. */
export function verticalRange(sceneHeight: number, mascotSize: number): number {
  const slack = (sceneHeight - mascotSize * MASCOT_FRAME_H) / 2 - BOB_AMPLITUDE - 4;
  return Math.max(0, Math.min(MAX_RISE, slack));
}
