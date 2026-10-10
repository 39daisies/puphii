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
} satisfies Record<string, ImageSourcePropType>;

export type FaceName = keyof typeof FACES;

export type ReactionSpec = {
  faces: FaceName[];
  /** How long the reaction face stays before returning to idle (ms). */
  duration: number;
};

export const REACTIONS: Record<ReactionMode, ReactionSpec> = {
  minimal: { faces: ['curious', 'winking'], duration: 550 },
  expressive: { faces: ['coughing', 'annoyed', 'exasperated'], duration: 850 },
  dramatic: { faces: ['furiousSteam', 'dizzy'], duration: 1000 },
};

export const MODE_COPY: Record<ReactionMode, { title: string; subtitle: string; thumbnail: FaceName }> = {
  minimal: { title: 'Minimal', subtitle: 'A subtle reaction.', thumbnail: 'happy' },
  expressive: { title: 'Expressive', subtitle: 'A clear reaction.', thumbnail: 'coughing' },
  dramatic: { title: 'Dramatic', subtitle: 'A big, manga-style reaction.', thumbnail: 'dizzy' },
};
