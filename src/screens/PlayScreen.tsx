import React from 'react';
import { RoundSession } from '../game/roundSession';
import { BubbleBreakScreen, useBubbleBreakSession } from './BubbleBreakScreen';

/** Games under the Play tab. A new game adds its key here and a session to `PlaySessions`. */
export type PlayGame = 'bubbleBreak';

/** Each game's in-progress state, held above the tab so switching tabs pauses rather than resets. */
export type PlaySessions = Record<PlayGame, RoundSession>;

export function usePlaySessions(): PlaySessions {
  return { bubbleBreak: useBubbleBreakSession() };
}

/** The Play tab. With one game it opens straight into Bubble Break; free for everyone. */
export function PlayScreen({ sessions }: { sessions: PlaySessions }) {
  return <BubbleBreakScreen session={sessions.bubbleBreak} />;
}
