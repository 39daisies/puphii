/**
 * Rules for a future Voice Pep Rally feature. Nothing here plays audio, and nothing in the app
 * calls it yet: it is the single place a voice feature must ask before responding to a plan event.
 */

import { PlanEvent, PlanEventType } from './events';

/**
 * How a voice line may respond to each event. `none` means never voiced, whatever the settings:
 * going over a target gets no voice response at all, so it can never sound like a judgment.
 */
export type VoiceResponse = 'encouraging' | 'informational' | 'none';

export const VOICE_RESPONSE: Readonly<Record<PlanEventType, VoiceResponse>> = {
  planStarted: 'encouraging',
  planRevised: 'informational',
  planRestarted: 'encouraging',
  planPaused: 'informational',
  planResumed: 'encouraging',
  planEnded: 'informational',
  dailyTargetCrossed: 'none',
  dayCompletedWithinTarget: 'encouraging',
  milestoneEarned: 'encouraging',
};

export type VoiceContext = {
  /** The person turned voice on. Off unless they choose it. */
  optedIn: boolean;
  /** The app is in the foreground. */
  appActive: boolean;
  /** The Play tab is open or a game round is running; voice never plays over a game. */
  gameActive: boolean;
};

export const DEFAULT_VOICE_CONTEXT: VoiceContext = { optedIn: false, appActive: true, gameActive: false };

export function voiceMayRespond(event: PlanEvent, context: VoiceContext): boolean {
  return context.optedIn && context.appActive && !context.gameActive && VOICE_RESPONSE[event.type] !== 'none';
}
