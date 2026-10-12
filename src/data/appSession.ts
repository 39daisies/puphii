/** Time in the background after which coming back counts as a new app session. */
export const SESSION_BREAK_MS = 30 * 60 * 1000;

/** Held in memory only, so every launch starts a new session. */
export type AppSession = { id: number; backgroundSince: number | null };

export const firstAppSession = (): AppSession => ({ id: 1, backgroundSince: null });

/**
 * Follows the app's state changes. Returning to the foreground after at least `SESSION_BREAK_MS`
 * in the background starts a new session; shorter trips, and "inactive" moments such as Control
 * Center or an incoming call, stay in the same one. Unchanged sessions are returned as they were.
 */
export function nextAppSession(session: AppSession, state: string, now: number): AppSession {
  if (state === 'background') return session.backgroundSince === null ? { ...session, backgroundSince: now } : session;
  if (state !== 'active' || session.backgroundSince === null) return session;
  return { id: now - session.backgroundSince >= SESSION_BREAK_MS ? session.id + 1 : session.id, backgroundSince: null };
}
