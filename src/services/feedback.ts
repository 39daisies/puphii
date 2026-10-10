import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { ReactionMode } from '../data/types';

let player: AudioPlayer | null = null;
let audioModeSet = false;

function getPlayer(): AudioPlayer | null {
  try {
    if (!audioModeSet) {
      audioModeSet = true;
      // Respect the silent switch and never interrupt the user's own audio.
      void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
    }
    if (!player) {
      player = createAudioPlayer(require('../../assets/sounds/bubble-bloop.wav'));
      player.volume = 0.6;
    }
    return player;
  } catch {
    return null;
  }
}

export function playPuffSound() {
  const sound = getPlayer();
  if (!sound) return;
  // Sound is an optional nicety; failure must never affect logging.
  const play = () => {
    try {
      sound.play();
    } catch {
      // ignore
    }
  };
  try {
    // A finished player ignores play() until the rewind has landed.
    sound.seekTo(0).then(play, play);
  } catch {
    play();
  }
}

const IMPACT_BY_MODE: Record<ReactionMode, Haptics.ImpactFeedbackStyle> = {
  minimal: Haptics.ImpactFeedbackStyle.Light,
  expressive: Haptics.ImpactFeedbackStyle.Medium,
  dramatic: Haptics.ImpactFeedbackStyle.Heavy,
};

export function puffHaptic(mode: ReactionMode) {
  if (Platform.OS === 'web') return;
  Haptics.impactAsync(IMPACT_BY_MODE[mode]).catch(() => undefined);
}

export function selectionHaptic() {
  if (Platform.OS === 'web') return;
  Haptics.selectionAsync().catch(() => undefined);
}
