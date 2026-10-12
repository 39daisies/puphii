import React, { createContext, useContext } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { useEntitlement } from '../subscription/EntitlementProvider';
import { canUse, ProFeature } from '../subscription/proFeatures';
import { colors, fontFamilies, radii, spacing, TOUCH_TARGET } from '../theme';
import { AppText } from './AppText';
import { SecondaryButton } from './Buttons';
import { Card } from './Card';
import { Icon } from './Icon';

/** Opens the Puphii Pro paywall. Undefined where the paywall isn't offered. */
const ProEntryContext = createContext<(() => void) | undefined>(undefined);
export const ProEntryProvider = ProEntryContext.Provider;

export function useProFeature(feature: ProFeature | null): boolean {
  return canUse(useEntitlement().access.pro, feature);
}

type Props = {
  feature: ProFeature | null;
  children: React.ReactNode;
  /** Takes people back to the free view this card replaced. Omitted where nothing is blocked. */
  onNotNow?: () => void;
  style?: ViewStyle;
};

/** Shows `children` only with Puphii Pro access. Until it's confirmed, nothing protected renders. */
export function ProGate({ feature, children, onNotNow, style }: Props) {
  const { access, entitlement, refresh } = useEntitlement();
  const openPro = useContext(ProEntryContext);
  if (canUse(access.pro, feature)) return <>{children}</>;

  if (access.pro === 'checking') {
    const failed = entitlement.status === 'error';
    return (
      <Card style={[styles.card, style]}>
        <View accessible accessibilityLiveRegion="polite" style={styles.text}>
          <AppText variant="cardTitle" align="center">{failed ? "Couldn't check Puphii Pro right now" : 'Checking your Puphii Pro access'}</AppText>
          <AppText variant="bodySmall" align="center" color={colors.textPrimary}>
            Your logs are safe on this device. These insights appear once your subscription is confirmed.
          </AppText>
        </View>
        {failed ? <TextLink label="Try again" onPress={() => void refresh()} /> : null}
      </Card>
    );
  }

  return (
    <Card style={[styles.card, style]}>
      <View style={styles.badge}>
        <Icon name="heart" size={20} color={colors.white} strokeWidth={2.2} />
      </View>
      <View style={styles.text}>
        <AppText variant="cardTitle" align="center" accessibilityRole="header">
          Unlock deeper insights with Puphii Pro
        </AppText>
        <AppText variant="bodySmall" align="center" color={colors.textPrimary}>
          See your monthly and yearly trends, extended history, and detailed spending estimates.
        </AppText>
      </View>
      {openPro ? <SecondaryButton label="Explore Puphii Pro" onPress={openPro} style={styles.button} /> : null}
      {onNotNow ? <TextLink label="Not now" onPress={onNotNow} /> : null}
    </Card>
  );
}

function TextLink({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
    >
      <AppText variant="label" color={colors.deepOcean} style={styles.linkText}>
        {label}
      </AppText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: spacing.lg, alignItems: 'center', gap: spacing.md },
  badge: {
    width: 40,
    height: 40,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.coralDeep,
  },
  text: { gap: spacing.xs, alignSelf: 'stretch', alignItems: 'center' },
  button: { alignSelf: 'stretch' },
  link: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.md },
  linkText: { fontFamily: fontFamilies.semibold, textDecorationLine: 'underline' },
});
