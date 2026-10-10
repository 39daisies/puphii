/**
 * Serialises writes: only one write is in flight and the newest snapshot always
 * wins, so rapid updates can't land out of order or be dropped.
 */
export function createWriteQueue<T>(
  write: (value: T) => Promise<void>,
  onError: (error: unknown) => void,
  onSuccess?: () => void,
) {
  let pending: { value: T } | null = null;
  let running: Promise<void> | null = null;

  async function drain() {
    while (pending) {
      const { value } = pending;
      pending = null;
      try {
        await write(value);
        if (!pending) onSuccess?.();
      } catch (error) {
        onError(error);
      }
    }
    running = null;
  }

  return {
    save(value: T) {
      pending = { value };
      if (!running) running = drain();
    },
    /** Resolves once every queued snapshot has been written (or failed). */
    flush(): Promise<void> {
      return running ?? Promise.resolve();
    },
  };
}
