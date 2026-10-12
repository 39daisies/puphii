import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/** False while the app is in the background or covered by the app switcher. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setActive(state === 'active'));
    return () => subscription.remove();
  }, []);
  return active;
}
