import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  AppState,
  GestureResponderEvent,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { AppText } from '../components/AppText';
import { BubbleArt } from '../components/BubbleArt';
import { IconButton, PrimaryButton, SecondaryButton } from '../components/Buttons';
import { Card } from '../components/Card';
import { usePuphii } from '../data/PuphiiStore';
import {
  Bubble,
  bubbleLayout,
  createRound,
  createRoundController,
  FieldSize,
  FrameScheduler,
  placeBubble,
  POP_EFFECT_MS,
  PopEffect,
  RoundController,
  RoundState,
  secondsLeft,
} from '../game/bubbleBreak';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { Mascot, MascotHandle } from '../mascot/Mascot';
import { colors, MAX_CONTENT_WIDTH, radii, spacing } from '../theme';
import { pluralize } from '../utils/format';

const FRAME_SCHEDULER: FrameScheduler = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle as number),
};

/** Keeps the mascot's pop reaction occasional rather than constant. */
const CHEER_GAP_MS = 1500;
const END_CHEER_MS = 1300;
/** Must match `styles.field.borderWidth`: touches are measured from the outer edge, bubbles from the inner one. */
const FIELD_BORDER = 1.5;

type Size = FieldSize;

export function BubbleBreakScreen({ onExit }: { onExit: () => void }) {
  const { gameStats, recordGameRound } = usePuphii();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const compact = useWindowDimensions().height < 700;
  const panelStyle = [styles.panel, compact && styles.panelCompact];
  const panelMascot = compact ? 64 : 88;
  const [round, setRound] = useState<RoundState>(createRound);
  const [field, setField] = useState<Size>({ width: 0, height: 0 });
  const controllerRef = useRef<RoundController | null>(null);
  const mascotRef = useRef<MascotHandle>(null);
  const lastCheerAt = useRef(0);
  const recordRef = useRef(recordGameRound);
  recordRef.current = recordGameRound;

  // Created in an effect so the cleanup that disposes it always pairs with this instance.
  useEffect(() => {
    const controller = createRoundController({
      scheduler: FRAME_SCHEDULER,
      onChange: setRound,
      onEnd: (score) => {
        recordRef.current(score);
        AccessibilityInfo.announceForAccessibility(`Round over. You popped ${pluralize(score, 'bubble')}.`);
      },
    });
    controllerRef.current = controller;
    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') controllerRef.current?.pause();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (round.status === 'ended') mascotRef.current?.cheer(END_CHEER_MS);
  }, [round.status]);

  const start = useCallback(() => {
    lastCheerAt.current = 0;
    controllerRef.current?.start();
  }, []);

  const cheerSometimes = useCallback(() => {
    const now = Date.now();
    if (now - lastCheerAt.current >= CHEER_GAP_MS) {
      lastCheerAt.current = now;
      mascotRef.current?.cheer();
    }
  }, []);

  const onPop = useCallback(
    (id: number) => {
      if (controllerRef.current?.pop(id)) cheerSometimes();
    },
    [cheerSometimes],
  );

  const fieldRef = useRef(field);
  fieldRef.current = field;

  // Every new finger is a tap, measured against the round's own geometry so the touch
  // target is exactly the bubble that was drawn. Positions must be read during the event.
  const onFieldTouch = useCallback(
    (event: GestureResponderEvent) => {
      const size = fieldRef.current;
      if (!size.width || !size.height) return;
      const { nativeEvent } = event;
      const touches = nativeEvent.changedTouches?.length ? nativeEvent.changedTouches : [nativeEvent];
      for (const touch of touches) {
        const point = { x: touch.locationX - FIELD_BORDER, y: touch.locationY - FIELD_BORDER };
        if (controllerRef.current?.tapAt(point, size)) cheerSometimes();
      }
    },
    [cheerSometimes],
  );

  const onFieldLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setField({ width: Math.max(0, width - FIELD_BORDER * 2), height: Math.max(0, height - FIELD_BORDER * 2) });
  }, []);

  const inRound = round.status === 'playing' || round.status === 'paused';

  return (
    <View style={styles.root}>
      <View style={[styles.content, { paddingTop: insets.top + spacing.xs }]}>
        {inRound ? (
          <>
            <View style={styles.hud}>
              <IconButton icon="close" accessibilityLabel="Leave Bubble Break" onPress={onExit} />
              <Stat label="Time left" value={`0:${String(secondsLeft(round)).padStart(2, '0')}`} spoken={`${secondsLeft(round)} seconds left`} />
              <Stat label="Popped" value={String(round.score)} spoken={`${pluralize(round.score, 'bubble')} popped`} />
              <Mascot ref={mascotRef} size={40} />
            </View>

            <View
              style={styles.field}
              onLayout={onFieldLayout}
              onStartShouldSetResponder={() => round.status === 'playing'}
              onResponderStart={onFieldTouch}
            >
              <FieldBackground {...field} />
              {field.width > 0 &&
                round.bubbles.map((bubble) => (
                  <FieldBubble key={bubble.id} bubble={bubble} elapsed={round.elapsed} field={field} onPop={onPop} />
                ))}
              {field.width > 0 &&
                round.pops.map((pop) => <PopRing key={pop.id} pop={pop} elapsed={round.elapsed} field={field} grow={!reduceMotion} />)}
              {round.status === 'paused' ? (
                <View style={styles.pausedScrim}>
                  <Card style={styles.pausedCard}>
                    <AppText variant="headline" align="center">
                      Paused
                    </AppText>
                    <AppText variant="bodySmall" align="center">
                      Your round is on hold.
                    </AppText>
                    <PrimaryButton label="Resume" onPress={() => controllerRef.current?.resume()} style={styles.wide} />
                  </Card>
                </View>
              ) : null}
            </View>
          </>
        ) : (
          <>
            <View style={styles.topBar}>
              <IconButton icon="close" accessibilityLabel="Leave Bubble Break" onPress={onExit} />
            </View>
            <ScrollView contentContainerStyle={[styles.centered, compact && styles.centeredCompact]} showsVerticalScrollIndicator={false}>
              {round.status === 'ended' ? (
                <Card style={panelStyle}>
                  <Mascot ref={mascotRef} size={panelMascot} />
                  <AppText variant="screenTitle" align="center" accessibilityRole="header">
                    Nice pause.
                  </AppText>
                  <View accessible accessibilityLabel={`${pluralize(round.score, 'bubble')} popped`} style={styles.finalScore}>
                    <AppText variant="statValue" align="center" style={compact ? styles.scoreValueCompact : styles.scoreValue}>
                      {round.score}
                    </AppText>
                    <AppText variant="caption" align="center">
                      {round.score === 1 ? 'bubble popped' : 'bubbles popped'}
                    </AppText>
                  </View>
                  <AppText variant="body" align="center">
                    You took 30 seconds for yourself.
                  </AppText>
                  {gameStats.bestScore > 0 ? (
                    <AppText variant="caption" align="center">
                      Best round so far: {gameStats.bestScore}
                    </AppText>
                  ) : null}
                  <View style={styles.actions}>
                    <PrimaryButton label="Play again" onPress={start} />
                    <SecondaryButton label="Back to Home" icon="home" onPress={onExit} />
                  </View>
                </Card>
              ) : (
                <Card style={panelStyle}>
                  <Mascot ref={mascotRef} size={panelMascot} />
                  <AppText variant="screenTitle" align="center" accessibilityRole="header">
                    Bubble Break
                  </AppText>
                  <AppText variant="body" align="center">
                    Take a little pause. Tap the bubbles as they float up.
                  </AppText>
                  <View style={styles.actions}>
                    <PrimaryButton label="Start" accessibilityHint="Starts a 30-second round" onPress={start} />
                  </View>
                  {gameStats.bestScore > 0 ? (
                    <AppText variant="caption" align="center">
                      Best round so far: {gameStats.bestScore}
                    </AppText>
                  ) : null}
                </Card>
              )}
            </ScrollView>
          </>
        )}
      </View>
    </View>
  );
}

function Stat({ label, value, spoken }: { label: string; value: string; spoken: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={spoken}>
      <AppText variant="caption">{label}</AppText>
      <AppText variant="statValue" style={styles.statValue}>
        {value}
      </AppText>
    </View>
  );
}

const FieldBackground = React.memo(function FieldBackground({ width, height }: Size) {
  if (!width || !height) return null;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
      <Defs>
        <LinearGradient id="bubbleField" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={colors.skyBlue} />
          <Stop offset="1" stopColor={colors.oceanBlue} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill="url(#bubbleField)" />
    </Svg>
  );
});

function FieldBubble({ bubble, elapsed, field, onPop }: { bubble: Bubble; elapsed: number; field: Size; onPop: (id: number) => void }) {
  const { size, left, top } = bubbleLayout(bubble, elapsed, field);
  return (
    // Touches pass through to the play area, which hit-tests the round circle. The press
    // handler remains for screen readers and keyboards.
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Bubble"
      onPress={() => onPop(bubble.id)}
      style={[styles.bubble, { width: size, height: size, left, top }]}
    >
      <BubbleArt size={size} tint={bubble.tint} />
    </Pressable>
  );
}

function PopRing({ pop, elapsed, field, grow }: { pop: PopEffect; elapsed: number; field: Size; grow: boolean }) {
  const age = Math.min(1, Math.max(0, (elapsed - pop.at) / POP_EFFECT_MS));
  const { size, left, top } = placeBubble(pop.size, pop.x, pop.progress, field);
  return (
    <View
      pointerEvents="none"
      style={[
        styles.ring,
        {
          width: size,
          height: size,
          left,
          top,
          borderRadius: size / 2,
          opacity: 1 - age,
          transform: [{ scale: grow ? 1 + age * 0.35 : 1 }],
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.skyBlue },
  content: {
    flex: 1,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.md,
  },
  topBar: { flexDirection: 'row', marginLeft: -spacing.sm },
  centered: { flexGrow: 1, justifyContent: 'center', paddingVertical: spacing.lg },
  centeredCompact: { paddingVertical: spacing.xs },
  panel: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xxl, borderRadius: radii.xl },
  panelCompact: { gap: spacing.sm, paddingVertical: spacing.lg },
  actions: { alignSelf: 'stretch', gap: spacing.md, marginTop: spacing.xs },
  finalScore: { alignItems: 'center' },
  scoreValue: { fontSize: 48, lineHeight: 54 },
  scoreValueCompact: { fontSize: 40, lineHeight: 46 },
  hud: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginLeft: -spacing.sm },
  stat: {
    flex: 1,
    minWidth: 0,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.white,
  },
  statValue: { fontSize: 24, lineHeight: 28 },
  field: {
    flex: 1,
    marginTop: spacing.md,
    borderRadius: radii.xl,
    borderWidth: 1.5,
    borderColor: colors.white,
    overflow: 'hidden',
    backgroundColor: colors.skyBlue,
  },
  bubble: { position: 'absolute', pointerEvents: 'none' },
  ring: { position: 'absolute', borderWidth: 2.5, borderColor: colors.white },
  pausedScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    backgroundColor: 'rgba(232, 246, 255, 0.72)',
  },
  pausedCard: { alignSelf: 'stretch', alignItems: 'center', gap: spacing.sm },
  wide: { alignSelf: 'stretch', marginTop: spacing.xs },
});
