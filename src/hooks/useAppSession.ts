import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { firstAppSession, nextAppSession } from '../data/appSession';

/** Identifies the current app session: a new one starts at launch and after a long time away. */
export function useAppSession(): number {
  const [session, setSession] = useState(firstAppSession);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      const at = Date.now();
      setSession((current) => nextAppSession(current, state, at));
    });
    return () => subscription.remove();
  }, []);

  return session.id;
}
