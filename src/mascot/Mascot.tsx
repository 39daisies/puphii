import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { Icon } from '../components/Icon';
import { ReactionMode } from '../data/types';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { colors } from '../theme';
import { FaceName, FACES, REACTIONS, SKIP_CHEER_FACES } from './faces';
import { createReactionTimer } from './reactionTimer';

export type MascotHandle = {
  react: (mode: ReactionMode) => void;
  relieve: () => void;
  /** A brief happy face from the Skip cheer pool, then back to idle. */
  cheer: (duration?: number) => void;
};

type Props = {
  size: number;
  ref?: React.Ref<MascotHandle>;
  /** Drawn instead of the idle face while Puphii isn't reacting, in the same size × size box. */
  idle?: React.ReactNode;
};

type Effect = { mode: ReactionMode | 'relief' | 'cheer'; id: number } | null;

const FACE_NAMES = Object.keys(FACES) as FaceName[];
const RELIEF_DURATION = 700;
const CHEER_DURATION = 600;

export function Mascot({ size, ref, idle }: Props) {
  const reduceMotion = useReducedMotion();
  const [face, setFace] = useState<FaceName>('idle');
  const [effect, setEffect] = useState<Effect>(null);

  const scale = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const fx = useRef(new Animated.Value(0)).current;
  const [timer] = useState(createReactionTimer);
  const step = useRef(0);
  const skipStep = useRef(0);

  useEffect(() => timer.cancel, [timer]);

  // Every call restarts from rest: a new tap interrupts the old reaction instead of queueing.
  const restart = (nextFace: FaceName, nextEffect: Effect, duration: number, motion: Animated.CompositeAnimation | null) => {
    for (const value of [scale, shake, tilt, fx]) value.stopAnimation();
    scale.setValue(1);
    shake.setValue(0);
    tilt.setValue(0);
    fx.setValue(0);
    setFace(nextFace);
    setEffect(nextEffect);
    if (!reduceMotion) {
      Animated.parallel([
        ...(motion ? [motion] : []),
        Animated.timing(fx, { toValue: 1, duration, easing: Easing.linear, useNativeDriver: true }),
      ]).start();
    }
    timer.restart(duration, () => {
      setFace('idle');
      setEffect(null);
    });
  };

  useImperativeHandle(ref, () => ({
    react(mode) {
      const spec = REACTIONS[mode];
      const nextFace = spec.faces[step.current % spec.faces.length];
      step.current += 1;
      const spring = (toValue: number, friction: number) =>
        Animated.spring(scale, { toValue, friction, tension: 180, useNativeDriver: true });
      const timing = (value: Animated.Value, toValue: number, duration: number) =>
        Animated.timing(value, { toValue, duration, easing: Easing.out(Easing.quad), useNativeDriver: true });

      let motion: Animated.CompositeAnimation;
      if (mode === 'minimal') {
        motion = Animated.sequence([timing(scale, 0.95, 90), spring(1, 5)]);
      } else if (mode === 'expressive') {
        motion = Animated.parallel([
          Animated.sequence([timing(scale, 1.1, 130), spring(1, 4)]),
          Animated.sequence([timing(tilt, 1, 110), timing(tilt, -0.7, 140), timing(tilt, 0, 140)]),
        ]);
      } else {
        motion = Animated.parallel([
          Animated.sequence([timing(scale, 1.2, 120), timing(scale, 0.94, 120), spring(1, 3)]),
          Animated.sequence([
            ...[1, -1, 0.8, -0.8, 0.5, -0.5].map((v) => timing(shake, v, 50)),
            timing(shake, 0, 60),
          ]),
        ]);
      }
      restart(nextFace, { mode, id: Date.now() }, spec.duration, motion);
    },
    relieve() {
      const motion = Animated.sequence([
        Animated.timing(scale, { toValue: 0.96, duration: 100, useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, useNativeDriver: true }),
      ]);
      restart('recovering', { mode: 'relief', id: Date.now() }, RELIEF_DURATION, motion);
    },
    cheer(duration = CHEER_DURATION) {
      const nextFace = SKIP_CHEER_FACES[skipStep.current % SKIP_CHEER_FACES.length];
      skipStep.current += 1;
      const motion = Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }),
      ]);
      restart(nextFace, { mode: 'cheer', id: Date.now() }, duration, motion);
    },
  }));

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-size * 0.05, size * 0.05] });
  const rotate = tilt.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] });
  const fxOpacity = fx.interpolate({ inputRange: [0, 0.12, 0.75, 1], outputRange: [0, 1, 1, 0] });
  const rise = fx.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.22] });

  const mode = effect?.mode;

  return (
    <View style={{ width: size * 1.25, height: size * 1.05, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Puphii the pufferfish${face === 'idle' ? '' : ', reacting'}`}
        style={{ width: size, height: size, transform: [{ translateX }, { rotate }, { scale }] }}
      >
        {FACE_NAMES.map((name) =>
          name === 'idle' && idle ? null : (
            <Image
              key={name}
              source={FACES[name]}
              resizeMode="contain"
              fadeDuration={0}
              style={[StyleSheet.absoluteFill, { width: size, height: size, opacity: name === face ? 1 : 0 }]}
            />
          ),
        )}
        {idle ? (
          <View style={[StyleSheet.absoluteFill, { opacity: face === 'idle' ? 1 : 0 }]} pointerEvents="none">
            {idle}
          </View>
        ) : null}
      </Animated.View>

      {/* Puff reactions are face-only. Skip cheer / Undo relief keep light positive FX. */}
      {mode === 'cheer' && (
        <Animated.View
          pointerEvents="none"
          style={[styles.fxAnchor, { top: size * 0.3, right: size * 0.16, opacity: fxOpacity, transform: [{ translateY: rise }] }]}
        >
          <View style={[styles.miniBubble, { width: 14, height: 14 }]} />
          <View style={[styles.miniBubble, { width: 9, height: 9, marginLeft: 12, marginTop: 4 }]} />
        </Animated.View>
      )}

      {mode === 'relief' && (
        <Animated.View
          pointerEvents="none"
          style={[styles.fxAnchor, { top: size * 0.1, right: size * 0.12, opacity: fxOpacity, transform: [{ translateY: rise }] }]}
        >
          <Icon name="heart" size={22} color={colors.coralDeep} fill={colors.peach} strokeWidth={1.6} />
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fxAnchor: { position: 'absolute', flexDirection: 'row' },
  miniBubble: {
    borderRadius: 99,
    borderWidth: 1.5,
    borderColor: colors.white,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
});
