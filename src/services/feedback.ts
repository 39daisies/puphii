import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';
import { AudioPlayer, createAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { ReactionMode } from '../data/types';

let puffPlayer: AudioPlayer | null = null;
let skipPlayer: AudioPlayer | null = null;
let audioModeSet = false;

function ensureAudioMode() {
  if (audioModeSet) return;
  audioModeSet = true;
  // Respect the silent switch and never interrupt the user's own audio.
  void setAudioModeAsync({ playsInSilentMode: false, interruptionMode: 'mixWithOthers' }).catch(() => undefined);
}

function loadPlayer(asset: number, volume: number): AudioPlayer | null {
  try {
    ensureAudioMode();
    const next = createAudioPlayer(asset);
    next.volume = volume;
    return next;
  } catch {
    return null;
  }
}

function getPuffPlayer(): AudioPlayer | null {
  if (!puffPlayer) puffPlayer = loadPlayer(require('../../assets/sounds/bubble-bloop.wav'), 0.6);
  return puffPlayer;
}

function getSkipPlayer(): AudioPlayer | null {
  if (!skipPlayer) skipPlayer = loadPlayer(require('../../assets/sounds/skip-chime.wav'), 0.5);
  return skipPlayer;
}

/** Restart from the start without awaiting — logging must never wait on audio. */
function playRestart(player: AudioPlayer | null) {
  if (!player) return;
  const play = () => {
    try {
      player.play();
    } catch {
      // ignore
    }
  };
  try {
    // A finished player ignores play() until the rewind has landed. Rapid taps seek to 0
    // so the chime restarts instead of layering overlapping copies.
    player.seekTo(0).then(play, play);
  } catch {
    play();
  }
}

export function playPuffSound() {
  playRestart(getPuffPlayer());
}

/** Short cheerful two-note Skip confirmation. Same session rules as the puff sound. */
export function playSkipSound() {
  playRestart(getSkipPlayer());
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
