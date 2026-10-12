export type Scheduler = {
  set: (callback: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

const defaultScheduler: Scheduler = {
  set: (callback, ms) => setTimeout(callback, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Holds at most one pending "back to idle" callback. Restarting replaces the pending one, so rapid
 * logs and undos never stack reactions or let an old timer cut a newer reaction short.
 */
export function createReactionTimer(scheduler: Scheduler = defaultScheduler) {
  let handle: unknown = null;
  const cancel = () => {
    if (handle !== null) scheduler.clear(handle);
    handle = null;
  };
  return {
    restart(duration: number, onEnd: () => void) {
      cancel();
      const own = scheduler.set(() => {
        if (handle !== own) return;
        handle = null;
        onEnd();
      }, duration);
      handle = own;
    },
    cancel,
    get pending() {
      return handle !== null;
    },
  };
}

export type ReactionTimer = ReturnType<typeof createReactionTimer>;
