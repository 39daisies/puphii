import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../components/AppText';
import { SecondaryButton } from '../components/Buttons';
import { FACES } from '../mascot/faces';
import { colors, spacing } from '../theme';
import { ONBOARDING_DEMO_CONTINUE, ONBOARDING_DEMO_HINT, ONBOARDING_DEMO_SKIP, ONBOARDING_DEMO_TITLE } from './copy';

type Props = {
  onDone: () => void;
};

const FRAMES = [
  { face: FACES.curious, caption: 'Puphii notices a puff…' },
  { face: FACES.puffSurprised, caption: 'Tap + Puff — one moment logged.' },
  { face: FACES.skipProud, caption: 'Or + Skip when you choose not to.' },
  { face: FACES.happy, caption: 'Your plan and insights stay on this device.' },
] as const;

const FRAME_MS = 2500;
const TOTAL_MS = FRAME_MS * FRAMES.length; // ~10s

/**
 * Skippable illustrative sequence. Never writes puff/skip logs. Respects reduce-motion by
 * showing a static last frame with Continue.
 */
export function OnboardingDemo({ onDone }: Props) {
  const [index, setIndex] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(false);
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduceMotion(!!enabled);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setIndex(FRAMES.length - 1);
      return;
    }
    const id = setInterval(() => {
      setIndex((current) => {
        const next = current + 1;
        if (next >= FRAMES.length) {
          clearInterval(id);
          return current;
        }
        opacity.setValue(0.35);
        Animated.timing(opacity, { toValue: 1, duration: 280, useNativeDriver: true }).start();
        return next;
      });
    }, FRAME_MS);
    const end = setTimeout(onDone, TOTAL_MS + 400);
    return () => {
      clearInterval(id);
      clearTimeout(end);
    };
  }, [reduceMotion, onDone, opacity]);

  const frame = FRAMES[index];

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <AppText variant="headline">{ONBOARDING_DEMO_TITLE}</AppText>
      <AppText variant="bodySmall" style={styles.hint}>
        {ONBOARDING_DEMO_HINT}
      </AppText>
      <Animated.View style={[styles.stage, { opacity }]}>
        <Image source={frame.face} style={styles.mascot} resizeMode="contain" accessible={false} />
        <AppText variant="body" style={styles.caption}>
          {frame.caption}
        </AppText>
      </Animated.View>
      <View style={styles.actions}>
        <Pressable onPress={onDone} accessibilityRole="button" accessibilityLabel={ONBOARDING_DEMO_SKIP} style={styles.skip}>
          <AppText variant="bodySmall" color={colors.coralInk}>
            {ONBOARDING_DEMO_SKIP}
          </AppText>
        </Pressable>
        {reduceMotion || index >= FRAMES.length - 1 ? (
          <SecondaryButton label={ONBOARDING_DEMO_CONTINUE} onPress={onDone} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md, flex: 1 },
  hint: { color: colors.textMuted },
  stage: { alignItems: 'center', justifyContent: 'center', flex: 1, gap: spacing.md, paddingVertical: spacing.lg },
  mascot: { width: 160, height: 160 },
  caption: { textAlign: 'center', paddingHorizontal: spacing.md },
  actions: { gap: spacing.sm, alignItems: 'center', paddingBottom: spacing.md },
  skip: { padding: spacing.sm },
});
