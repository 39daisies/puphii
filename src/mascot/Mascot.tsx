import React, { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import Svg, { Path, Polygon } from 'react-native-svg';
import { AppText } from '../components/AppText';
import { Icon } from '../components/Icon';
import { ReactionMode } from '../data/types';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { colors } from '../theme';
import { FaceName, FACES, REACTIONS } from './faces';

export type MascotHandle = {
  react: (mode: ReactionMode) => void;
  relieve: () => void;
  /** A brief happy face with small rising bubbles, then back to idle. */
  cheer: (duration?: number) => void;
};

type Props = {
  size: number;
  ref?: React.Ref<MascotHandle>;
};

type Effect = { mode: ReactionMode | 'relief'; id: number } | null;

const FACE_NAMES = Object.keys(FACES) as FaceName[];
const RELIEF_DURATION = 700;
const CHEER_DURATION = 600;

export function Mascot({ size, ref }: Props) {
  const reduceMotion = useReducedMotion();
  const [face, setFace] = useState<FaceName>('idle');
  const [effect, setEffect] = useState<Effect>(null);

  const scale = useRef(new Animated.Value(1)).current;
  const shake = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const fx = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const step = useRef(0);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  // Every call restarts from rest: a new tap interrupts the old reaction instead of queueing.
  const restart = (nextFace: FaceName, nextEffect: Effect, duration: number, motion: Animated.CompositeAnimation | null) => {
    if (timer.current) clearTimeout(timer.current);
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
    timer.current = setTimeout(() => {
      setFace('idle');
      setEffect(null);
      timer.current = null;
    }, duration);
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
      const motion = Animated.sequence([
        Animated.timing(scale, { toValue: 1.08, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.spring(scale, { toValue: 1, friction: 5, tension: 160, useNativeDriver: true }),
      ]);
      restart('happy', { mode: 'minimal', id: Date.now() }, duration, motion);
    },
  }));

  const translateX = shake.interpolate({ inputRange: [-1, 1], outputRange: [-size * 0.05, size * 0.05] });
  const rotate = tilt.interpolate({ inputRange: [-1, 1], outputRange: ['-7deg', '7deg'] });
  const fxOpacity = fx.interpolate({ inputRange: [0, 0.12, 0.75, 1], outputRange: [0, 1, 1, 0] });
  const fxScale = fx.interpolate({ inputRange: [0, 0.18, 1], outputRange: [0.4, 1.08, 1] });
  const rise = fx.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.22] });

  const mode = effect?.mode;

  return (
    <View style={{ width: size * 1.25, height: size * 1.05, alignItems: 'center', justifyContent: 'center' }}>
      {mode === 'dramatic' && (
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: fxOpacity, transform: [{ scale: fxScale }] }]} pointerEvents="none">
          <SpeedLines size={size * 1.25} />
        </Animated.View>
      )}

      <Animated.View
        accessible
        accessibilityRole="image"
        accessibilityLabel={`Puphii the pufferfish${face === 'idle' ? '' : ', reacting'}`}
        style={{ width: size, height: size, transform: [{ translateX }, { rotate }, { scale }] }}
      >
        {FACE_NAMES.map((name) => (
          <Image
            key={name}
            source={FACES[name]}
            resizeMode="contain"
            fadeDuration={0}
            style={[StyleSheet.absoluteFill, { width: size, height: size, opacity: name === face ? 1 : 0 }]}
          />
        ))}
      </Animated.View>

      {mode === 'minimal' && (
        <Animated.View
          pointerEvents="none"
          style={[styles.fxAnchor, { top: size * 0.3, right: size * 0.16, opacity: fxOpacity, transform: [{ translateY: rise }] }]}
        >
          <View style={[styles.miniBubble, { width: 14, height: 14 }]} />
          <View style={[styles.miniBubble, { width: 9, height: 9, marginLeft: 12, marginTop: 4 }]} />
        </Animated.View>
      )}

      {mode === 'expressive' && (
        <Animated.View
          pointerEvents="none"
          style={[styles.fxAnchor, { top: size * 0.04, right: size * 0.12, opacity: fxOpacity, transform: [{ scale: fxScale }] }]}
        >
          <ShockMarks size={size * 0.26} />
        </Animated.View>
      )}

      {mode === 'dramatic' && (
        <Animated.View
          pointerEvents="none"
          style={[styles.fxAnchor, { top: -size * 0.02, right: size * 0.02, opacity: fxOpacity, transform: [{ scale: fxScale }, { rotate: '-8deg' }] }]}
        >
          <Burst size={size * 0.36} />
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

function ShockMarks({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 40 40">
      <Path d="M10 30 L5 16" stroke={colors.coralDeep} strokeWidth={4.5} strokeLinecap="round" />
      <Path d="M20 26 L22 8" stroke={colors.coralDeep} strokeWidth={4.5} strokeLinecap="round" />
      <Path d="M29 30 L36 18" stroke={colors.coralDeep} strokeWidth={4.5} strokeLinecap="round" />
    </Svg>
  );
}

function SpeedLines({ size }: { size: number }) {
  const c = size / 2;
  const lines = Array.from({ length: 22 }, (_, i) => {
    const angle = (i / 22) * Math.PI * 2;
    const inner = c * (0.66 + (i % 3) * 0.05);
    const outer = c * 0.98;
    return {
      d: `M${c + Math.cos(angle) * inner} ${c + Math.sin(angle) * inner} L${c + Math.cos(angle) * outer} ${c + Math.sin(angle) * outer}`,
      color: i % 2 ? colors.coralPink : colors.peach,
      width: i % 3 === 0 ? 4 : 2.5,
    };
  });
  return (
    <Svg width={size} height={size}>
      {lines.map((line, i) => (
        <Path key={i} d={line.d} stroke={line.color} strokeWidth={line.width} strokeLinecap="round" />
      ))}
    </Svg>
  );
}

function Burst({ size }: { size: number }) {
  const c = 50;
  const points = Array.from({ length: 24 }, (_, i) => {
    const angle = (i / 24) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? 48 : 36;
    return `${c + Math.cos(angle) * r},${c + Math.sin(angle) * r}`;
  }).join(' ');
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox="0 0 100 100" style={StyleSheet.absoluteFill}>
        <Polygon points={points} fill={colors.coralDeep} stroke={colors.warmCream} strokeWidth={4} strokeLinejoin="round" />
      </Svg>
      <AppText variant="headline" color={colors.white} style={{ fontSize: size * 0.34, lineHeight: size * 0.4 }} accessible={false}>
        !!
      </AppText>
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
