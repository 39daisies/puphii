import React from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useEntitlement } from '../subscription/EntitlementProvider';
import { FACES } from '../mascot/faces';
import { colors, fontFamilies, spacing, TOUCH_TARGET } from '../theme';
import { AppText } from './AppText';
import { SecondaryButton } from './Buttons';
import { OceanBackground } from './OceanBackground';

/** Shown while subscription status is unknown or unverifiable — never unlocks, never claims expired. */
export function SubscriptionCheckingScreen() {
  const { entitlement, refresh } = useEntitlement();
  const failed = entitlement.status === 'error';

  return (
    <View style={styles.root}>
      <OceanBackground variant="calm" />
      <SafeAreaView style={styles.center} edges={['top', 'bottom']}>
        <Image source={FACES.curious} style={styles.mascot} resizeMode="contain" accessible={false} />
        <AppText variant="cardTitle" align="center" accessibilityRole="header">
          {failed ? "Couldn't verify your subscription" : 'Checking your subscription…'}
        </AppText>
        <AppText variant="bodySmall" align="center" color={colors.textPrimary} style={styles.copy}>
          {failed
            ? 'Your logs stay on this device. Check your connection and try again — this isn’t treated as an expired subscription.'
            : 'Hang tight while Puphii confirms your subscription with the store.'}
        </AppText>
        {failed ? (
          <SecondaryButton label="Try again" onPress={() => void refresh()} style={styles.retry} />
        ) : (
          <ActivityIndicator color={colors.deepOcean} style={styles.spinner} />
        )}
      </SafeAreaView>
    </View>
  );
}

/** Footer actions for the locked paywall (data + optional support). */
export function LockedAccountLinks({
  onOpenData,
  onOpenSupport,
}: {
  onOpenData: () => void;
  onOpenSupport?: () => void;
}) {
  return (
    <View style={styles.links}>
      <Pressable accessibilityRole="button" onPress={onOpenData} style={({ pressed }) => [styles.link, pressed && styles.dimmed]} hitSlop={8}>
        <AppText variant="label" color={colors.deepOcean} style={styles.underline}>
          Your data on this device
        </AppText>
      </Pressable>
      {onOpenSupport ? (
        <Pressable accessibilityRole="button" onPress={onOpenSupport} style={({ pressed }) => [styles.link, pressed && styles.dimmed]} hitSlop={8}>
          <AppText variant="label" color={colors.deepOcean} style={styles.underline}>
            Support
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.warmCream },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl, gap: spacing.md },
  mascot: { width: 120, height: 120 },
  copy: { maxWidth: 340 },
  retry: { alignSelf: 'stretch', marginTop: spacing.sm },
  spinner: { marginTop: spacing.md },
  links: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  link: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.md },
  underline: { fontFamily: fontFamilies.semibold, textDecorationLine: 'underline' },
  dimmed: { opacity: 0.6 },
});
