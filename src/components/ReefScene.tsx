import React, { useMemo } from 'react';
import { Animated, Image, StyleSheet, View } from 'react-native';
import Svg, { Circle, Ellipse, Path } from 'react-native-svg';
import { useLoopClock } from '../hooks/useLoopClock';
import { SWIM_SPRITES } from '../mascot/faces';
import { Mascot, MascotHandle } from '../mascot/Mascot';
import {
  BOB_AMPLITUDE,
  BUBBLE_CYCLE_MS,
  BubbleSpec,
  FISH_CYCLE_MS,
  FishSpec,
  FRONT_OPACITY,
  Keyframes,
  MASCOT_FRAME_H,
  MASCOT_FRAME_W,
  REEF_BUBBLES,
  REEF_FISH,
  ReefLayout,
  settleSwim,
  sineKeys,
  SWIM_CYCLE_MS,
  SWIM_KEYS,
  verticalRange,
  wrapKeys,
} from '../mascot/reefMotion';
import { colors } from '../theme';

const OCEAN_REEF = require('../../assets/ocean/ocean-reef.jpg');

const clamp = (keys: Keyframes, scale = 1) => ({
  inputRange: keys.inputRange,
  outputRange: scale === 1 ? keys.outputRange : keys.outputRange.map((v) => v * scale),
  extrapolate: 'clamp' as const,
});

/**
 * The reef photo with a few small fish and bubbles drifting across it. Purely decorative: it
 * never takes touches and is hidden from screen readers. Nothing moves unless `running`.
 */
export const ReefBackdrop = React.memo(function ReefBackdrop({ width, height, running }: { width: number; height: number; running: boolean }) {
  const fishClock = useLoopClock(FISH_CYCLE_MS, running);
  const bubbleClock = useLoopClock(BUBBLE_CYCLE_MS, running);
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Image source={OCEAN_REEF} resizeMode="cover" fadeDuration={0} style={styles.photo} accessible={false} />
      {width > 0 && height > 0 ? (
        <>
          {REEF_FISH.map((spec, i) => (
            <Fish key={`fish-${i}`} clock={fishClock} spec={spec} width={width} height={height} />
          ))}
          {REEF_BUBBLES.map((spec, i) => (
            <Bubble key={`bubble-${i}`} clock={bubbleClock} spec={spec} width={width} height={height} />
          ))}
        </>
      ) : null}
    </View>
  );
});

function Fish({ clock, spec, width, height }: { clock: Animated.Value; spec: FishSpec; width: number; height: number }) {
  const length = spec.size * 1.5;
  const motion = useMemo(() => {
    const progress = clock.interpolate(clamp(wrapKeys(spec.phase)));
    return {
      opacity: progress.interpolate({ inputRange: [0, 0.04, 0.96, 1], outputRange: [0, 0.9, 0.9, 0] }),
      transform: [
        { translateX: progress.interpolate({ inputRange: [0, 1], outputRange: spec.direction > 0 ? [-length, width] : [width, -length] }) },
        { translateY: progress.interpolate(clamp(sineKeys(3), 2.5)) },
        { scaleX: spec.direction > 0 ? -1 : 1 },
      ],
    };
  }, [clock, spec, length, width]);
  return (
    <Animated.View style={[styles.anchor, { top: spec.y * height }, motion]}>
      <FishArt length={length} tint={spec.tint} />
    </Animated.View>
  );
}

/** A small reef fish facing left. */
function FishArt({ length, tint }: { length: number; tint: 0 | 1 }) {
  const body = tint === 0 ? colors.coralDeep : colors.coralPink;
  return (
    <Svg width={length} height={length * 0.6} viewBox="0 0 30 18" accessible={false}>
      <Path d="M20 9 L29 2.5 L27 9 L29 15.5 Z" fill={body} />
      <Ellipse cx={12} cy={9} rx={11} ry={6.6} fill={body} />
      <Path d="M13 3.2 Q15 9 13 14.8" stroke={colors.peach} strokeWidth={1.6} fill="none" strokeLinecap="round" />
      <Circle cx={6} cy={7.6} r={1.5} fill={colors.textPrimaryStrong} />
    </Svg>
  );
}

function Bubble({ clock, spec, width, height }: { clock: Animated.Value; spec: BubbleSpec; width: number; height: number }) {
  const motion = useMemo(() => {
    const progress = clock.interpolate(clamp(wrapKeys(spec.phase)));
    return {
      opacity: progress.interpolate({ inputRange: [0, 0.12, 0.8, 1], outputRange: [0, 0.85, 0.85, 0] }),
      transform: [
        { translateX: progress.interpolate(clamp(sineKeys(2), 3)) },
        { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [height, height * 0.1] }) },
      ],
    };
  }, [clock, spec, height]);
  return <Animated.View style={[styles.anchor, styles.bubble, { left: spec.x * width, width: spec.size, height: spec.size }, motion]} />;
}

type SwimmingProps = {
  ref?: React.Ref<MascotHandle>;
  layout: ReefLayout;
  sceneHeight: number;
  running: boolean;
  /** Motion is off (Reduce Motion): rest facing the viewer. */
  still: boolean;
};

/**
 * Puphii swimming back and forth in the lane beside the count, turning now and then to smile at
 * the viewer. Logging reactions swap in Mascot's reaction faces on top of the swim path.
 */
export function SwimmingPuphii({ ref, layout, sceneHeight, running, still }: SwimmingProps) {
  const clock = useLoopClock(SWIM_CYCLE_MS, running, (t) => settleSwim(t, still));
  const size = layout.mascotSize;
  const frameW = size * MASCOT_FRAME_W;
  const frameH = size * MASCOT_FRAME_H;
  const rise = verticalRange(sceneHeight, size);

  const translateX = useMemo(() => clock.interpolate(clamp(SWIM_KEYS.x, layout.swimRange)), [clock, layout.swimRange]);
  const translateY = useMemo(
    () => Animated.add(clock.interpolate(clamp(SWIM_KEYS.y, rise)), clock.interpolate(clamp(SWIM_KEYS.bob, BOB_AMPLITUDE))),
    [clock, rise],
  );
  const idle = useMemo(() => <SwimSprites clock={clock} size={size} />, [clock, size]);

  return (
    <Animated.View
      style={[
        styles.anchor,
        {
          left: layout.laneLeft + (layout.laneWidth - frameW) / 2,
          top: (sceneHeight - frameH) / 2,
          transform: [{ translateX }, { translateY }],
        },
      ]}
    >
      <Mascot ref={ref} size={size} idle={idle} />
    </Animated.View>
  );
}

const SwimSprites = React.memo(function SwimSprites({ clock, size }: { clock: Animated.Value; size: number }) {
  const motion = useMemo(
    () => ({
      side: { opacity: clock.interpolate(clamp(SWIM_KEYS.profileOpacity)), transform: [{ scaleX: clock.interpolate(clamp(SWIM_KEYS.profileScaleX)) }] },
      front: { opacity: clock.interpolate(clamp(FRONT_OPACITY)), transform: [{ scaleX: clock.interpolate(clamp(SWIM_KEYS.frontScaleX)) }] },
    }),
    [clock],
  );
  const sprite = { width: size, height: size };
  return (
    <>
      <Animated.Image
        source={SWIM_SPRITES.side}
        resizeMode="contain"
        fadeDuration={0}
        accessible={false}
        style={[styles.sprite, sprite, motion.side]}
      />
      <Animated.Image
        source={SWIM_SPRITES.front}
        resizeMode="contain"
        fadeDuration={0}
        accessible={false}
        style={[styles.sprite, sprite, motion.front]}
      />
    </>
  );
});

const styles = StyleSheet.create({
  photo: { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%' },
  anchor: { position: 'absolute', left: 0, top: 0 },
  sprite: { position: 'absolute', left: 0, top: 0 },
  bubble: {
    borderRadius: 99,
    borderWidth: 1.2,
    borderColor: colors.white,
    backgroundColor: 'rgba(255,255,255,0.35)',
  },
});
