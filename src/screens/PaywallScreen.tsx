import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { IconButton, PrimaryButton, SecondaryButton } from '../components/Buttons';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { OceanBackground } from '../components/OceanBackground';
import { Wordmark } from '../components/Wordmark';
import { FACES } from '../mascot/faces';
import { LEGAL_URLS, PRO_BENEFITS, REVENUECAT_ENTITLEMENT_ID } from '../subscription/config';
import { Entitlement, PlanId } from '../subscription/entitlement';
import { useEntitlement } from '../subscription/EntitlementProvider';
import {
  createPaywallController,
  describePlan,
  hasProAccess,
  PaywallNotice,
  PaywallState,
  paywallConfigIssues,
  PlanDisplay,
  storeAccountFor,
  storeNameFor,
} from '../subscription/paywall';
import { appProductIds, paywallSdk } from '../subscription/revenueCatSdk';
import { colors, fontFamilies, MAX_CONTENT_WIDTH, radii, spacing, TOUCH_TARGET } from '../theme';
import { formatLongDate } from '../utils/format';

const STORE_NAME = storeNameFor(Platform.OS);

/** Puphii Pro. Opened from the You screen; never shown on launch and never blocks the counter. */
export function PaywallScreen({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      {visible ? <PaywallContent onClose={onClose} /> : null}
    </Modal>
  );
}

function PaywallContent({ onClose }: { onClose: () => void }) {
  const { entitlement, refresh, restorePurchases } = useEntitlement();
  const controller = useMemo(
    () =>
      createPaywallController({
        sdk: paywallSdk,
        productIds: appProductIds,
        entitlementId: REVENUECAT_ENTITLEMENT_ID,
        entitlements: { refresh, restorePurchases },
        platform: Platform.OS,
      }),
    [refresh, restorePurchases],
  );
  const [state, setState] = useState<PaywallState>(controller.current());

  useEffect(() => {
    const unsubscribe = controller.subscribe(setState);
    void controller.load();
    return unsubscribe;
  }, [controller]);

  const plans: PlanDisplay[] = state.plans.map((verified) => describePlan(verified, state.trial[verified.plan] ?? 'unknown', Platform.OS));
  const selected = plans.find((plan) => plan.plan === state.selected) ?? null;
  const subscribed = hasProAccess(entitlement);
  const busy = state.busy !== null;
  const issues = __DEV__ ? paywallConfigIssues() : [];

  return (
    <View style={styles.root}>
      <OceanBackground variant="reef" />
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <IconButton icon="close" accessibilityLabel="Close Puphii Pro" onPress={onClose} />
        </View>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.column}>
            <View style={styles.hero}>
              <Image source={FACES.happy} style={styles.mascot} resizeMode="contain" accessible={false} />
              <View style={styles.brand} accessible accessibilityRole="header" accessibilityLabel="Puphii Pro">
                <Wordmark size={40} />
                <View style={styles.proPill}>
                  <AppText variant="overline" color={colors.white} style={styles.proText}>
                    PRO
                  </AppText>
                </View>
              </View>
              <AppText variant="body" align="center" style={styles.lede}>
                Notice your smoking or vaping habits, and make changes on your own terms.
              </AppText>
            </View>

            {PRO_BENEFITS?.length ? (
              <Card style={styles.benefits}>
                {PRO_BENEFITS.map((benefit) => (
                  <View key={benefit} style={styles.benefitRow}>
                    <View style={styles.benefitIcon}>
                      <Icon name="check" size={16} color={colors.white} strokeWidth={2.6} />
                    </View>
                    <AppText variant="bodyStrong" style={styles.flex}>
                      {benefit}
                    </AppText>
                  </View>
                ))}
              </Card>
            ) : null}

            {__DEV__ && issues.length ? <ConfigNotice issues={issues} /> : null}

            {subscribed ? <ActiveCard entitlement={entitlement} /> : null}

            {state.phase === 'loading' || state.phase === 'idle' ? (
              <View style={styles.loading} accessibilityLiveRegion="polite">
                <ActivityIndicator color={colors.deepOcean} />
                <AppText variant="bodySmall">Loading subscription options…</AppText>
              </View>
            ) : null}

            {state.phase === 'unavailable' && state.unavailable ? (
              <Card style={styles.unavailable}>
                <Image source={FACES.curious} style={styles.unavailableMascot} resizeMode="contain" accessible={false} />
                <AppText variant="bodyStrong" align="center">
                  {state.unavailable.message}
                </AppText>
                {__DEV__ && state.unavailable.detail ? (
                  <AppText variant="caption" align="center">
                    {state.unavailable.detail}
                  </AppText>
                ) : null}
                <SecondaryButton label="Try again" onPress={() => void controller.load()} disabled={busy} style={styles.retry} />
              </Card>
            ) : null}

            {state.phase === 'ready' && !subscribed ? (
              <>
                <View style={styles.plans} accessibilityRole="radiogroup" accessibilityLabel="Subscription plans">
                  {plans.map((plan) => (
                    <PlanCard
                      key={plan.plan}
                      plan={plan}
                      selected={plan.plan === state.selected}
                      disabled={busy}
                      onSelect={(id) => controller.select(id)}
                    />
                  ))}
                </View>
                {selected ? (
                  <AppText variant="caption" style={styles.disclosure}>
                    {selected.disclosure}
                  </AppText>
                ) : null}
              </>
            ) : null}

            {state.notice ? <Notice notice={state.notice} onDismiss={controller.dismissNotice} /> : null}

            {state.phase === 'ready' && !subscribed && selected ? (
              <View style={styles.cta}>
                <PrimaryButton
                  label={state.busy === 'purchasing' ? 'Processing…' : selected.cta}
                  accessibilityLabel={state.busy === 'purchasing' ? 'Processing purchase' : `${selected.cta}, ${selected.title}, ${selected.priceLine}`}
                  accessibilityHint={`Opens the ${STORE_NAME} purchase confirmation`}
                  disabled={busy}
                  onPress={() => void controller.purchase()}
                />
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy, busy: state.busy === 'restoring' }}
              disabled={busy}
              onPress={() => void controller.restore()}
              style={({ pressed }) => [styles.restore, (pressed || busy) && styles.dimmed]}
            >
              {state.busy === 'restoring' ? <ActivityIndicator color={colors.deepOcean} /> : null}
              <AppText variant="label">{state.busy === 'restoring' ? 'Restoring…' : 'Restore Purchases'}</AppText>
            </Pressable>

            <View style={styles.legal}>
              <LegalLink label="Terms of Use" url={LEGAL_URLS.termsOfUse} />
              <AppText variant="caption" accessible={false}>
                ·
              </AppText>
              <LegalLink label="Privacy Policy" url={LEGAL_URLS.privacyPolicy} />
            </View>

            <AppText variant="caption" align="center" style={styles.privacy}>
              Payment is handled by {STORE_NAME}. Puphii uses RevenueCat to confirm your subscription, so RevenueCat receives your purchase
              information, an anonymous ID and basic device details. Your puff logs stay on this device.
            </AppText>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function PlanCard({
  plan,
  selected,
  disabled,
  onSelect,
}: {
  plan: PlanDisplay;
  selected: boolean;
  disabled: boolean;
  onSelect: (plan: PlanId) => void;
}) {
  const label = [plan.title, plan.priceLine, plan.monthlyEquivalent, plan.trialBadge].filter(Boolean).join(', ');
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={label}
      disabled={disabled}
      onPress={() => onSelect(plan.plan)}
      style={({ pressed }) => [styles.plan, selected && styles.planSelected, pressed && styles.dimmed]}
    >
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <Icon name="check" size={16} color={colors.white} strokeWidth={2.6} /> : null}
      </View>
      <View style={styles.flex}>
        <View style={styles.planTitleRow}>
          <AppText variant="cardTitle" style={styles.planTitle}>
            {plan.title}
          </AppText>
          {plan.trialBadge ? (
            <View style={styles.badge}>
              <AppText variant="caption" color={colors.coralInk} style={styles.badgeText}>
                {plan.trialBadge}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="bodyStrong">{plan.priceLine}</AppText>
        {plan.monthlyEquivalent ? <AppText variant="caption">{plan.monthlyEquivalent}</AppText> : null}
      </View>
    </Pressable>
  );
}

function ActiveCard({ entitlement }: { entitlement: Entitlement }) {
  const detail = (() => {
    if (entitlement.status === 'gracePeriod') {
      return `Your last renewal payment didn't go through. Update your payment method in your ${storeAccountFor(Platform.OS)} settings to keep Puphii Pro.`;
    }
    if (entitlement.status !== 'active') return null;
    const date = entitlement.expiresAt ? formatLongDate(new Date(entitlement.expiresAt)) : null;
    if (!date) return null;
    if (entitlement.period === 'trial') return entitlement.willRenew ? `Free trial until ${date}, then it renews.` : `Free trial ends ${date}.`;
    return entitlement.willRenew ? `Renews ${date}.` : `Ends ${date}. It won't renew.`;
  })();
  return (
    <Card style={styles.active} accessibilityLiveRegion="polite">
      <Image source={FACES.winking} style={styles.activeMascot} resizeMode="contain" accessible={false} />
      <View style={styles.flex}>
        <AppText variant="cardTitle">Puphii Pro is active</AppText>
        {detail ? <AppText variant="bodySmall">{detail}</AppText> : null}
        <AppText variant="caption">Manage or cancel it in your {storeAccountFor(Platform.OS)} settings.</AppText>
      </View>
    </Card>
  );
}

const NOTICE_TONES = {
  success: { background: colors.seafoam, border: colors.deepOcean, text: colors.textPrimary, icon: 'check' },
  info: { background: colors.skyBlue, border: colors.borderStrong, text: colors.textPrimary, icon: 'info' },
  error: { background: colors.peach, border: colors.coralPink, text: colors.coralInk, icon: 'info' },
} as const;

function Notice({ notice, onDismiss }: { notice: PaywallNotice; onDismiss: () => void }) {
  const tone = NOTICE_TONES[notice.tone];
  return (
    <View
      style={[styles.notice, { backgroundColor: tone.background, borderColor: tone.border }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Icon name={tone.icon} size={20} color={tone.text} />
      <AppText variant="bodySmall" color={tone.text} style={styles.noticeText}>
        {notice.message}
      </AppText>
      <IconButton icon="close" accessibilityLabel="Dismiss message" onPress={onDismiss} color={tone.text} size={18} />
    </View>
  );
}

function LegalLink({ label, url }: { label: string; url: string | null }) {
  if (!url) {
    return (
      <View style={styles.legalLink} accessible accessibilityLabel={`${label} link not configured`}>
        <AppText variant="caption">{label} (not configured)</AppText>
      </View>
    );
  }
  return (
    <Pressable accessibilityRole="link" onPress={() => Linking.openURL(url).catch(() => undefined)} style={styles.legalLink} hitSlop={4}>
      <AppText variant="caption" color={colors.textPrimary} style={styles.underline}>
        {label}
      </AppText>
    </Pressable>
  );
}

/** Development builds only: what still has to be supplied before release builds show this screen. */
function ConfigNotice({ issues }: { issues: string[] }) {
  return (
    <View style={styles.config}>
      <AppText variant="overline">Before release · dev builds only</AppText>
      <AppText variant="caption">Release builds hide Puphii Pro until these are set:</AppText>
      {issues.map((issue) => (
        <AppText key={issue} variant="caption">
          • {issue}
        </AppText>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl, alignItems: 'center' },
  column: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, gap: spacing.lg },
  hero: { alignItems: 'center', gap: spacing.xs },
  mascot: { width: 120, height: 120 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: spacing.lg },
  proPill: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xxs, borderRadius: radii.pill, backgroundColor: colors.coralDeep },
  proText: { fontSize: 13, lineHeight: 18 },
  lede: { marginTop: spacing.xs, maxWidth: 340 },
  benefits: { gap: spacing.md },
  benefitRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  benefitIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.coralDeep,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xl },
  unavailable: { alignItems: 'center', gap: spacing.sm },
  unavailableMascot: { width: 72, height: 72 },
  retry: { alignSelf: 'stretch', marginTop: spacing.xs },
  plans: { gap: spacing.md },
  plan: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 76,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  planSelected: { backgroundColor: colors.peach, borderColor: colors.coralDeep },
  planTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: spacing.sm },
  planTitle: { fontFamily: fontFamilies.bold },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.coralPink,
  },
  badgeText: { fontFamily: fontFamilies.bold },
  radio: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  radioSelected: { backgroundColor: colors.coralDeep, borderColor: colors.coralDeep },
  disclosure: { lineHeight: 18 },
  cta: { marginTop: spacing.xs },
  restore: {
    minHeight: TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    alignSelf: 'center',
    paddingHorizontal: spacing.lg,
  },
  dimmed: { opacity: 0.6 },
  legal: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  legalLink: { minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.xs },
  underline: { textDecorationLine: 'underline' },
  privacy: { marginTop: -spacing.xs },
  active: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  activeMascot: { width: 56, height: 56 },
  notice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingLeft: spacing.md,
    paddingVertical: spacing.xs,
  },
  noticeText: { flex: 1, paddingVertical: spacing.sm },
  config: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    backgroundColor: colors.surfaceGlass,
  },
});
