import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { localDayKey, msUntilNextLocalMidnight } from '../data/puffLogic';

/**
 * Current local date that re-renders at local midnight and whenever the app
 * returns to the foreground (covers sleep, time-zone and manual clock changes).
 */
export function useToday(): Date {
  const [today, setToday] = useState(() => new Date());

  useEffect(() => {
    const refresh = () =>
      setToday((previous) => {
        const now = new Date();
        return localDayKey(now) === localDayKey(previous) ? previous : now;
      });

    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        refresh();
        schedule();
      }, msUntilNextLocalMidnight(new Date()) + 1000);
    };
    schedule();

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refresh();
        clearTimeout(timer);
        schedule();
      }
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, []);

  return today;
}
