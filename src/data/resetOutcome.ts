/**
 * What "Reset everything" achieved, and what the Data page says about it. Success is reported
 * only when the Pep Rally reset confirmed that every file and detail it covers is gone: without
 * a media store nothing can be confirmed, so the reset stays pending and is never called done.
 */

import type { PepResetResult } from './pepRallyController';

/**
 * `done`: everything confirmed reset. `partial`: files were deleted but named ones are left
 * over, and the pending reset is finished at the next launch. `notFinished`: it couldn't be
 * started, saved or checked, so recordings may remain.
 */
export type ResetOutcome = 'done' | 'partial' | 'notFinished';

export const RESETTING_LABEL = 'Resetting…';
export const RESET_TRY_AGAIN_LABEL = 'Try again';

export const RESET_OUTCOME_MESSAGE: Record<ResetOutcome, string> = {
  done: 'Puphii has been reset.',
  partial: "Puphii has been reset, but some recordings couldn't be deleted yet. Puphii will try again the next time it opens.",
  notFinished: "Puphii couldn't finish resetting. Your recordings may still be on this device.",
};

/** No result, including a reset that never ran or threw, is never treated as success. */
export function resetOutcomeOf(result: PepResetResult | null | undefined): ResetOutcome {
  if (!result) return 'notFinished';
  if (result.ok === true && result.reason === null && result.failed.length === 0 && result.remaining.length === 0) return 'done';
  return result.reason === 'filesRemain' ? 'partial' : 'notFinished';
}

export type ResetRunner = {
  /** True from the moment a reset starts until its outcome is known. */
  readonly running: boolean;
  /**
   * Starts the reset and, whatever it achieves, attempts to cancel the daily reminder. A problem
   * cancelling the reminder never changes the outcome. Resolves null, doing nothing, while a
   * reset is already running.
   */
  run(reset: () => Promise<ResetOutcome>, cancelReminder: () => Promise<unknown>): Promise<ResetOutcome | null>;
};

export function createResetRunner(): ResetRunner {
  let running = false;
  return {
    get running() {
      return running;
    },
    async run(reset, cancelReminder) {
      if (running) return null;
      running = true;
      try {
        let pending: Promise<ResetOutcome>;
        try {
          pending = reset();
        } catch {
          pending = Promise.resolve<ResetOutcome>('notFinished');
        }
        try {
          cancelReminder().catch(() => undefined);
        } catch {
          // The outcome reported is the reset's alone.
        }
        return await pending.catch((): ResetOutcome => 'notFinished');
      } finally {
        running = false;
      }
    },
  };
}
