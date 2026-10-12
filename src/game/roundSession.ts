import { createRoundController, RoundState } from './bubbleBreak';

type SessionOptions = Omit<Parameters<typeof createRoundController>[0], 'onChange'>;

/**
 * Keeps a round alive while its screen is away, so leaving the Play tab pauses the round
 * rather than losing it. One screen is attached at a time; detaching pauses a round in play,
 * which also stops its frame loop.
 */
export function createRoundSession(options: SessionOptions) {
  let listener: ((state: RoundState) => void) | null = null;
  const controller = createRoundController({ ...options, onChange: (state) => listener?.(state) });

  return {
    controller,
    /** Shows the round on a screen. Returns a function that detaches it and pauses the round. */
    attach(onChange: (state: RoundState) => void): () => void {
      listener = onChange;
      onChange(controller.getState());
      return () => {
        if (listener === onChange) listener = null;
        controller.pause();
      };
    },
  };
}

export type RoundSession = ReturnType<typeof createRoundSession>;

/**
 * Whether a game has the person's attention: the Play tab is open, or a round is running.
 * Optional features that could make sound (such as future voice) stay quiet while this is true.
 */
export const gameActive = (sessions: Readonly<Record<string, RoundSession>>, playTabOpen: boolean): boolean =>
  playTabOpen || Object.values(sessions).some((session) => session.controller.getState().status === 'playing');
