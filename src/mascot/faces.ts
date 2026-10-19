import { ImageSourcePropType } from 'react-native';
import { ReactionMode } from '../data/types';

/**
 * Only assets that passed the transparency audit (real alpha, transparent corners,
 * no checkerboard fringe, no stray fragments, no extra front fin) are registered.
 * Rejected: old `coughing.png` and RECHECKED 12 furious_shouting (checkerboard
 * fringe), RECHECKED 05/06 (no alpha), 04/13/14 (extra front fin).
 */
export const FACES = {
  idle: require('../../assets/puffy/idle.png'),
  happy: require('../../assets/puffy/happy.png'),
  curious: require('../../assets/puffy/curious.png'),
  winking: require('../../assets/puffy/winking.png'),
  annoyed: require('../../assets/puffy/annoyed.png'),
  exasperated: require('../../assets/puffy/exasperated.png'),
  coughing: require('../../assets/puffy/coughing_dramatic.png'),
  dizzy: require('../../assets/puffy/dizzy.png'),
  furiousSteam: require('../../assets/puffy/furious_steam.png'),
  recovering: require('../../assets/puffy/recovering.png'),
  /** Puff-log reactions only — never Skip cheer. */
  puffSurprised: require('../../assets/puffy/puff_surprised.png'),
  puffExhaling: require('../../assets/puffy/puff_exhaling.png'),
  puffStraining: require('../../assets/puffy/puff_straining.png'),
  puffDizzyBubbles: require('../../assets/puffy/puff_dizzyBubbles.png'),
  puffNervous: require('../../assets/puffy/puff_nervous.png'),
  puffDreamy: require('../../assets/puffy/puff_dreamy.png'),
  puffAngry: require('../../assets/puffy/puff_angry.png'),
  puffSleeping: require('../../assets/puffy/puff_sleeping.png'),
  puffSad: require('../../assets/puffy/puff_sad.png'),
  puffShouting: require('../../assets/puffy/puff_shouting.png'),
  puffCrying: require('../../assets/puffy/puff_crying.png'),
  puffScared: require('../../assets/puffy/puff_scared.png'),
  /** Skip cheer only — never puff reactions. */
  skipProud: require('../../assets/puffy/skip_proud.png'),
  skipWink: require('../../assets/puffy/skip_wink.png'),
  skipWiggle: require('../../assets/puffy/skip_wiggle.png'),
  skipGrateful: require('../../assets/puffy/skip_grateful.png'),
  skipVictory: require('../../assets/puffy/skip_victory.png'),
  skipRelief: require('../../assets/puffy/skip_relief.png'),
  skipStarry: require('../../assets/puffy/skip_starry.png'),
  skipDance: require('../../assets/puffy/skip_dance.png'),
  skipTears: require('../../assets/puffy/skip_tears.png'),
  skipChampion: require('../../assets/puffy/skip_champion.png'),
} satisfies Record<string, ImageSourcePropType>;

export type FaceName = keyof typeof FACES;

/** Cycles on each successful Skip. Smiling / positive only. */
export const SKIP_CHEER_FACES: readonly FaceName[] = [
  'skipProud',
  'skipWink',
  'skipWiggle',
  'skipGrateful',
  'skipVictory',
  'skipRelief',
  'skipStarry',
  'skipDance',
  'skipTears',
  'skipChampion',
];

/**
 * Happy idle sprites for the Home reef: side-on (facing left) and facing the viewer. Re-framed
 * from the reef page artwork onto the same 512 px canvas, body width and centre as `FACES`, so
 * switching to a reaction face doesn't make Puphii jump or change size.
 */
export const SWIM_SPRITES = {
  side: require('../../assets/puffy/swim_happy.png'),
  front: require('../../assets/puffy/front_happy.png'),
} satisfies Record<string, ImageSourcePropType>;

export type ReactionSpec = {
  faces: FaceName[];
  /** How long the reaction face stays before returning to idle (ms). */
  duration: number;
};

/**
 * Puff-log reactions only. Never include smiling / Skip cheer faces (`happy`, `recovering`,
 * `skip*`). Emotion-sheet faces only.
 */
export const REACTIONS: Record<ReactionMode, ReactionSpec> = {
  minimal: { faces: ['puffNervous', 'puffDreamy'], duration: 550 },
  expressive: {
    faces: ['puffSurprised', 'puffExhaling', 'puffStraining', 'puffDizzyBubbles', 'puffSad', 'puffSleeping'],
    duration: 850,
  },
  dramatic: {
    faces: ['puffAngry', 'puffShouting', 'puffScared', 'puffCrying', 'puffExhaling'],
    duration: 1000,
  },
};

export const MODE_COPY: Record<ReactionMode, { title: string; subtitle: string; thumbnail: FaceName }> = {
  minimal: { title: 'Minimal', subtitle: 'A subtle reaction.', thumbnail: 'puffNervous' },
  expressive: { title: 'Expressive', subtitle: 'A clear reaction.', thumbnail: 'puffExhaling' },
  dramatic: { title: 'Dramatic', subtitle: 'A big, manga-style reaction.', thumbnail: 'puffAngry' },
};
