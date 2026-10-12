import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * An Animated value that runs 0 → 1 over `duration` ms, then wraps, while `running` is true.
 * Stopping leaves it where it was (or wherever `settle` moves it), and running again continues
 * from there. Every loop is stopped when the component unmounts.
 */
export function useLoopClock(duration: number, running: boolean, settle?: (t: number) => number): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  const settleRef = useRef(settle);
  settleRef.current = settle;

  useEffect(() => {
    let active = true;
    let animation: Animated.CompositeAnimation | null = null;
    const run = (from: number) => {
      animation = Animated.timing(value, {
        toValue: 1,
        duration: Math.max(16, (1 - from) * duration),
        easing: Easing.linear,
        useNativeDriver: true,
        // An endless loop must not hold InteractionManager open.
        isInteraction: false,
      });
      animation.start(({ finished }) => {
        if (!active || !finished) return;
        value.setValue(0);
        run(0);
      });
    };
    value.stopAnimation((current) => {
      if (!active) return;
      if (running) {
        run(current >= 1 ? 0 : current);
        return;
      }
      const target = settleRef.current?.(current);
      if (target !== undefined && target !== current) value.setValue(target);
    });
    return () => {
      active = false;
      animation?.stop();
    };
  }, [duration, running, value]);

  return value;
}
