/** Configurations compared while tuning Bubble Break. Only DEFAULT_TUNING ships. */
import { DEFAULT_TUNING, GameTuning, KindTuning, StageTuning } from '../../src/game/bubbleBreak';

const LEGACY_SPEED = [1, 1.4, 1.9, 2.5];
const LEGACY_INTERVAL = [1, 0.8, 0.65, 0.5];

/** Straight up at a steady speed with a ±6 pt sway, as in the original version. */
const legacyKind: KindTuning = {
  travel: [4200 / 5100, 6000 / 5100],
  size: 1,
  weave: [0.022, 0.022],
  weaveCycles: [1.2, 1.2],
  wobble: [0, 0],
  drift: [0, 0],
  surge: [0, 0],
  ease: [0, 0],
};

const LEGACY_STAGES = [
  ['warm-up', 0],
  ['build', 5_000],
  ['challenge', 10_000],
  ['finish', 20_000],
] as const;

/** Version 2, the first with speed stages: one kind of bubble, steady rhythm, large targets. Too fast for players. */
export const LEGACY: GameTuning = {
  stages: LEGACY_STAGES.map(
    ([name, startsAt], i): StageTuning => ({
      name,
      startsAt,
      travelMs: 5100 / LEGACY_SPEED[i],
      spawnGapMs: [520 * LEGACY_INTERVAL[i], 860 * LEGACY_INTERVAL[i]],
      clusterChance: 0,
      clusterSize: [2, 2],
      clusterGapMs: [0, 0],
      lullChance: 0,
      lullGapMs: [0, 0],
      size: [58, 84],
      kinds: { drifter: 1, weaver: 0, darter: 0, floater: 0, shooter: 0 },
    }),
  ),
  kinds: { drifter: legacyKind, weaver: legacyKind, darter: legacyKind, floater: legacyKind, shooter: legacyKind },
  maxBubbles: 7,
  firstSpawnMs: 150,
  spawnSpacing: 0.25,
  minTravelMs: 0,
  maxDiameterRatio: 0.26,
  minDiameter: 52,
  // The old touch target was the bubble's square plus 4 pt, roughly the circle plus 10 pt.
  touchSlop: 10,
};

const ROUND_ONE_DARTER: KindTuning = {
  travel: [0.6, 0.85],
  size: 0.86,
  weave: [0.03, 0.12],
  weaveCycles: [0.5, 1.4],
  wobble: [0, 0.04],
  drift: [0.15, 0.55],
  surge: [0.1, 0.3],
  ease: [0.2, 0.45],
};

/** The first rework, with varied movement. Players found it, and every busier rework after it, too fast. */
export const ROUND_ONE: GameTuning = {
  stages: [
    { name: 'warm-up', startsAt: 0, travelMs: 4000, spawnGapMs: [520, 820], clusterChance: 0, clusterSize: [2, 2], clusterGapMs: [140, 220], lullChance: 0, lullGapMs: [0, 0], size: [64, 80], kinds: { drifter: 0.75, weaver: 0.1, darter: 0, floater: 0.15, shooter: 0 } },
    { name: 'build', startsAt: 5_000, travelMs: 2700, spawnGapMs: [400, 660], clusterChance: 0.15, clusterSize: [2, 2], clusterGapMs: [120, 200], lullChance: 0, lullGapMs: [0, 0], size: [58, 76], kinds: { drifter: 0.45, weaver: 0.3, darter: 0.12, floater: 0.13, shooter: 0 } },
    { name: 'challenge', startsAt: 10_000, travelMs: 1950, spawnGapMs: [300, 500], clusterChance: 0.25, clusterSize: [2, 3], clusterGapMs: [100, 180], lullChance: 0, lullGapMs: [0, 0], size: [52, 72], kinds: { drifter: 0.3, weaver: 0.33, darter: 0.25, floater: 0.12, shooter: 0 } },
    { name: 'finish', startsAt: 20_000, travelMs: 1750, spawnGapMs: [260, 440], clusterChance: 0.3, clusterSize: [2, 3], clusterGapMs: [90, 160], lullChance: 0, lullGapMs: [0, 0], size: [48, 68], kinds: { drifter: 0.25, weaver: 0.33, darter: 0.32, floater: 0.1, shooter: 0 } },
  ],
  kinds: {
    drifter: { travel: [0.8, 1.2], size: 1, weave: [0.02, 0.08], weaveCycles: [0.6, 1.6], wobble: [0, 0.04], drift: [0, 0.3], surge: [0.1, 0.35], ease: [-0.25, 0.25] },
    weaver: { travel: [0.85, 1.25], size: 1, weave: [0.12, 0.26], weaveCycles: [1.1, 2.4], wobble: [0, 0.04], drift: [0, 0.2], surge: [0.15, 0.4], ease: [-0.2, 0.2] },
    darter: ROUND_ONE_DARTER,
    floater: { travel: [1.25, 1.6], size: 1.08, weave: [0.05, 0.14], weaveCycles: [0.5, 1.2], wobble: [0, 0.04], drift: [0, 0.15], surge: [0.35, 0.55], ease: [-0.2, 0.1] },
    shooter: ROUND_ONE_DARTER,
  },
  maxBubbles: 9,
  firstSpawnMs: 150,
  spawnSpacing: 0.22,
  minTravelMs: 900,
  maxDiameterRatio: 0.24,
  minDiameter: 44,
  touchSlop: 8,
};

const ROUND_TWO_DARTER: KindTuning = { travel: [0.55, 0.8], size: 0.86, weave: [0.03, 0.12], weaveCycles: [0.5, 1.4], wobble: [0, 0.04], drift: [0.15, 0.55], surge: [0.1, 0.3], ease: [0.2, 0.45] };

/** The second rework, found too hard: big, fast volleys from 10 seconds on. */
export const ROUND_TWO: GameTuning = {
  stages: [
    { name: 'warm-up', startsAt: 0, travelMs: 3600, spawnGapMs: [380, 760], clusterChance: 0.1, clusterSize: [2, 2], clusterGapMs: [160, 240], lullChance: 0, lullGapMs: [0, 0], size: [62, 78], kinds: { drifter: 0.6, weaver: 0.2, darter: 0, floater: 0.2, shooter: 0 } },
    { name: 'build', startsAt: 5_000, travelMs: 2500, spawnGapMs: [260, 620], clusterChance: 0.2, clusterSize: [2, 3], clusterGapMs: [110, 190], lullChance: 0.08, lullGapMs: [700, 950], size: [56, 74], kinds: { drifter: 0.3, weaver: 0.3, darter: 0.15, floater: 0.1, shooter: 0.15 } },
    { name: 'challenge', startsAt: 10_000, travelMs: 1700, spawnGapMs: [150, 430], clusterChance: 0.35, clusterSize: [3, 4], clusterGapMs: [70, 130], lullChance: 0.08, lullGapMs: [500, 800], size: [50, 70], kinds: { drifter: 0.2, weaver: 0.3, darter: 0.2, floater: 0.1, shooter: 0.2 } },
    { name: 'finish', startsAt: 20_000, travelMs: 1450, spawnGapMs: [100, 340], clusterChance: 0.4, clusterSize: [3, 5], clusterGapMs: [55, 115], lullChance: 0.06, lullGapMs: [400, 650], size: [46, 66], kinds: { drifter: 0.15, weaver: 0.3, darter: 0.25, floater: 0.08, shooter: 0.22 } },
  ],
  kinds: {
    drifter: { travel: [0.7, 1.3], size: 1, weave: [0.02, 0.08], weaveCycles: [0.6, 1.6], wobble: [0, 0.04], drift: [0, 0.3], surge: [0.1, 0.35], ease: [-0.25, 0.25] },
    weaver: { travel: [0.75, 1.35], size: 1, weave: [0.12, 0.26], weaveCycles: [1.1, 2.4], wobble: [0, 0.04], drift: [0, 0.2], surge: [0.15, 0.4], ease: [-0.2, 0.2] },
    darter: ROUND_TWO_DARTER,
    floater: { travel: [1.2, 1.7], size: 1.08, weave: [0.05, 0.14], weaveCycles: [0.5, 1.2], wobble: [0, 0.04], drift: [0, 0.15], surge: [0.35, 0.55], ease: [-0.2, 0.1] },
    shooter: { travel: [0.55, 0.8], size: 0.9, weave: [0.02, 0.08], weaveCycles: [0.5, 1.2], wobble: [0, 0.03], drift: [0.1, 0.45], surge: [0.05, 0.15], ease: [-0.6, -0.4] },
  },
  maxBubbles: 16,
  firstSpawnMs: 150,
  spawnSpacing: 0.22,
  minTravelMs: 850,
  maxDiameterRatio: 0.24,
  minDiameter: 44,
  touchSlop: 8,
};

/** The third rework, still too hard: smaller volleys, but too many bubbles, too fast. */
export const ROUND_THREE: GameTuning = {
  ...ROUND_TWO,
  stages: [
    ROUND_TWO.stages[0],
    ROUND_TWO.stages[1],
    { ...ROUND_TWO.stages[2], travelMs: 1850, spawnGapMs: [180, 480], clusterChance: 0.3, clusterSize: [2, 4], clusterGapMs: [80, 150], lullChance: 0.1, lullGapMs: [550, 850] },
    { ...ROUND_TWO.stages[3], travelMs: 1600, spawnGapMs: [130, 400], clusterChance: 0.35, clusterSize: [3, 4], clusterGapMs: [65, 130], lullChance: 0.08, lullGapMs: [500, 750] },
  ],
  maxBubbles: 14,
};

/** The fourth rework, still frustrating although gentler than round one by these models. */
export const ROUND_FOUR: GameTuning = {
  stages: [
    ROUND_TWO.stages[0],
    { name: 'build', startsAt: 5_000, travelMs: 2800, spawnGapMs: [380, 680], clusterChance: 0.12, clusterSize: [2, 2], clusterGapMs: [140, 220], lullChance: 0.08, lullGapMs: [750, 1000], size: [58, 76], kinds: { drifter: 0.4, weaver: 0.3, darter: 0.1, floater: 0.12, shooter: 0.08 } },
    { name: 'challenge', startsAt: 10_000, travelMs: 2100, spawnGapMs: [260, 540], clusterChance: 0.2, clusterSize: [2, 3], clusterGapMs: [110, 180], lullChance: 0.12, lullGapMs: [650, 950], size: [54, 72], kinds: { drifter: 0.3, weaver: 0.3, darter: 0.15, floater: 0.12, shooter: 0.13 } },
    { name: 'finish', startsAt: 20_000, travelMs: 1850, spawnGapMs: [220, 480], clusterChance: 0.28, clusterSize: [2, 3], clusterGapMs: [90, 160], lullChance: 0.12, lullGapMs: [600, 900], size: [50, 70], kinds: { drifter: 0.25, weaver: 0.3, darter: 0.2, floater: 0.1, shooter: 0.15 } },
  ],
  kinds: {
    ...ROUND_TWO.kinds,
    darter: { ...ROUND_TWO_DARTER, travel: [0.65, 0.9] },
    shooter: { travel: [0.7, 0.95], size: 0.92, weave: [0.02, 0.08], weaveCycles: [0.5, 1.2], wobble: [0, 0.03], drift: [0.1, 0.4], surge: [0.05, 0.12], ease: [-0.5, -0.35] },
  },
  maxBubbles: 11,
  minTravelMs: 1100,
  firstSpawnMs: 150,
  spawnSpacing: 0.22,
  maxDiameterRatio: 0.24,
  minDiameter: 44,
  touchSlop: 8,
};

/** `rhythm` scales how often volleys and quiet spells happen; 0 fires at a steady pace. */
export function scaled(base: GameTuning, { travel = 1, gap = 1, rhythm = 1 }: { travel?: number; gap?: number; rhythm?: number }): GameTuning {
  return {
    ...base,
    stages: base.stages.map((stage) => ({
      ...stage,
      travelMs: stage.travelMs * travel,
      spawnGapMs: [stage.spawnGapMs[0] * gap, stage.spawnGapMs[1] * gap],
      clusterChance: Math.min(1, stage.clusterChance * rhythm),
      lullChance: Math.min(1, stage.lullChance * rhythm),
    })),
  };
}

export const CANDIDATES: readonly { name: string; note: string; tuning: GameTuning }[] = [
  { name: 'original', note: 'version 2, speed stages only; too fast for players', tuning: LEGACY },
  { name: 'round one', note: 'varied movement; too fast for players', tuning: ROUND_ONE },
  { name: 'round one, 1.5× bubbles', note: 'just firing more bubbles', tuning: scaled(ROUND_ONE, { gap: 0.67 }) },
  { name: 'round two', note: 'big uneven volleys, too hard', tuning: ROUND_TWO },
  { name: 'round three', note: 'smaller volleys, still too many and too fast', tuning: ROUND_THREE },
  { name: 'round four', note: 'gentler, still frustrating', tuning: ROUND_FOUR },
  { name: 'new, steady firing', note: 'new speeds and kinds, no volleys or quiet spells', tuning: scaled(DEFAULT_TUNING, { rhythm: 0 }) },
  { name: 'new (default)', note: 'shipped tuning', tuning: DEFAULT_TUNING },
  { name: 'new, 10% faster', note: 'harder variant', tuning: scaled(DEFAULT_TUNING, { travel: 0.9, gap: 0.9 }) },
  { name: 'new, 10% slower', note: 'easier variant', tuning: scaled(DEFAULT_TUNING, { travel: 1.1, gap: 1.1 }) },
];
