import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { registerDevMenuItems } from 'expo-dev-client';
import Purchases from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { REVENUECAT_ENTITLEMENT_ID, SUBSCRIPTION_GATING_ENABLED } from '../subscription/config';
import { useEntitlement } from '../subscription/EntitlementProvider';
import { paywallConfigIssues } from '../subscription/paywall';
import { KEY_MESSAGES } from '../subscription/revenueCat';
import { appSdkKey, hasNativeStore } from '../subscription/revenueCatSdk';
import { colors, spacing } from '../theme';
import { APP_STORE_EXPECTED } from './appStoreConfig';
import { TEST_STORE_EXPECTED } from './testStoreConfig';
import {
  createOpenRequests,
  createTestStoreHarness,
  describeEntitlement,
  harnessStoreFor,
  HarnessState,
  STORE_LABEL,
  TestStoreSdk,
} from './testStoreHarness';

/**
 * Development builds only: App.tsx loads this file behind `__DEV__`, so production bundles
 * never contain it. Opened from the development menu or the DEV ONLY button App.tsx places at
 * the bottom of the You screen. Buys through the Test Store with the Test Store key, or through
 * the App Store sandbox with the iOS key.
 */
const testStoreSdk: TestStoreSdk = {
  isConfigured: () => Purchases.isConfigured(),
  getOfferings: () => Purchases.getOfferings(),
  purchasePackage: (pkg) => Purchases.purchasePackage(pkg),
  getCustomerInfo: () => Purchases.getCustomerInfo(),
};

const MENU_ITEM = 'RevenueCat Test Store';
const openRequests = createOpenRequests();

export function TestStoreHarnessHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => openRequests.subscribe(() => setOpen(true)), []);

  useEffect(() => {
    if (!hasNativeStore) return;
    registerDevMenuItems([{ name: MENU_ITEM, callback: () => setOpen(true), shouldCollapse: true }]).catch((error) =>
      console.warn('[Puphii] Could not add the Test Store item to the development menu', error),
    );
  }, []);

  return open ? <TestStoreScreen onClose={() => setOpen(false)} /> : null;
}

/** Temporary shortcut for when the development menu can't be opened. */
export function TestStoreHarnessButton() {
  const missing = paywallConfigIssues().length;
  return (
    <View style={styles.devEntry}>
      <Text style={styles.devEntryLabel}>DEV ONLY · not in release builds</Text>
      <HarnessButton label="Open RevenueCat Test Store" disabled={false} onPress={openRequests.request} />
      <Text style={styles.muted}>
        {missing ? `Puphii Pro release check: ${missing} item${missing === 1 ? '' : 's'} missing. Details inside.` : 'Puphii Pro release check: ready.'}
      </Text>
      {hasNativeStore ? null : (
        <Text style={styles.muted}>This is Expo Go, which has no store connection. Open the Puphii development build instead.</Text>
      )}
    </View>
  );
}

const store = harnessStoreFor(appSdkKey, Platform.OS);
const usingTestStore = store === 'testStore';
const expected = store === 'appStore' ? APP_STORE_EXPECTED : TEST_STORE_EXPECTED;

function keyDescription(): string {
  if (!appSdkKey.ok) return `Key problem: ${KEY_MESSAGES[appSdkKey.reason]}`;
  switch (store) {
    case 'testStore':
      return 'Key: RevenueCat Test Store (simulated purchases)';
    case 'appStore':
      return 'Key: App Store. Purchases use Apple’s sandbox; sign in with a sandbox Apple Account when asked. The Test Store key is not set.';
    case 'none':
      return 'Key: Google Play. Buying is disabled here; set the Test Store key to simulate purchases.';
  }
}

const SCREEN_NOTE: Record<typeof store, string> = {
  testStore: 'Development builds only. Purchases here are simulated and never charged.',
  appStore: 'Development builds only. Purchases go through the App Store sandbox and are never charged.',
  none: 'Development builds only. Products can be inspected; nothing can be bought with this key.',
};

function TestStoreScreen({ onClose }: { onClose: () => void }) {
  const { entitlement, access, refresh, restorePurchases } = useEntitlement();
  const harness = useMemo(
    () =>
      createTestStoreHarness({
        sdk: testStoreSdk,
        entitlementId: REVENUECAT_ENTITLEMENT_ID,
        entitlements: { refresh, restorePurchases },
        store,
        expected,
      }),
    [refresh, restorePurchases],
  );
  const [state, setState] = useState<HarnessState>(harness.current());

  useEffect(() => {
    let lastLogged = 0;
    const unsubscribe = harness.subscribe((next) => {
      setState(next);
      for (const entry of [...next.log].reverse()) {
        if (entry.id <= lastLogged) continue;
        lastLogged = entry.id;
        console.log(`[Puphii] ${STORE_LABEL[store]}: ${entry.message}`);
      }
    });
    void harness.loadProducts();
    return unsubscribe;
  }, [harness]);

  const busy = state.busy !== null;

  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Text style={styles.title}>{store === 'appStore' ? 'RevenueCat · App Store sandbox' : 'RevenueCat Test Store'}</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text style={styles.link}>Close</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>{SCREEN_NOTE[store]}</Text>

        <ScrollView contentContainerStyle={styles.content}>
          <ReleaseReadiness />

          <Section title="Subscription status (from RevenueCat)">
            {describeEntitlement(entitlement, { testStore: usingTestStore }).map((line) => (
              <Text key={line} style={styles.body}>
                {line}
              </Text>
            ))}
            <Text style={styles.body}>
              App access: {access.core}
              {SUBSCRIPTION_GATING_ENABLED ? '' : ' (gating off: every screen stays available)'}
            </Text>
            <Text style={styles.muted}>{keyDescription()}</Text>
            <Text style={styles.muted}>Entitlement identifier: {REVENUECAT_ENTITLEMENT_ID ?? 'not set in config.ts'}</Text>
          </Section>

          <Section title="Customer info">
            {state.customer ? (
              <>
                <Text style={styles.body}>Active entitlements: {state.customer.activeEntitlements.join(', ') || 'none'}</Text>
                {state.customer.entitlement ? (
                  <Text style={styles.body}>
                    {state.customer.entitlement.id}: {state.customer.entitlement.isActive ? 'active' : 'inactive'} ·{' '}
                    {state.customer.entitlement.productIdentifier} · {state.customer.entitlement.store} ·{' '}
                    {state.customer.entitlement.periodType} · expires {state.customer.entitlement.expirationDate ?? 'never'}
                    {state.customer.entitlement.isSandbox ? ' · sandbox' : ''}
                  </Text>
                ) : (
                  <Text style={styles.body}>The configured entitlement has never been granted.</Text>
                )}
                <Text style={styles.muted}>Checked at {state.customer.requestDate}</Text>
              </>
            ) : (
              <Text style={styles.muted}>Refresh or purchase to read customer info.</Text>
            )}
          </Section>

          {state.offeringCheck ? (
            <Section title="Setup check">
              {state.offeringCheck.lines.map((line) => (
                <Text key={line} style={styles.body}>
                  {line}
                </Text>
              ))}
              <Text style={styles.muted}>
                The trial shown is what the product offers. Whether this customer can still use it is reported in the subscription status above.
              </Text>
            </Section>
          ) : null}

          <Section title="Products">
            {state.productsMessage ? <Text style={styles.body}>{state.productsMessage}</Text> : null}
            {state.products.map((row) => (
              <View key={row.key} style={styles.product}>
                <View style={styles.productText}>
                  <Text style={styles.body}>
                    {row.title || row.productId} · {row.price}
                    {row.period ? ` / ${row.period}` : ''}
                  </Text>
                  <Text style={styles.muted}>
                    {row.offering}
                    {row.isCurrentOffering ? ' (current)' : ''} · {row.packageId} · {row.productId}
                  </Text>
                  {row.introOffer ? <Text style={styles.muted}>{row.introOffer}</Text> : null}
                </View>
                <HarnessButton label="Buy" disabled={busy || store === 'none'} onPress={() => void harness.purchase(row.key)} />
              </View>
            ))}
            {state.purchaseStatus ? (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.purchaseStatus, state.purchaseStatus.tone === 'error' && styles.purchaseStatusError]}
              >
                {state.purchaseStatus.tone === 'progress' ? <ActivityIndicator color={colors.deepOcean} /> : null}
                <Text style={[styles.body, styles.purchaseStatusText, state.purchaseStatus.tone === 'error' && styles.errorText]}>
                  Purchase result: {state.purchaseStatus.message}
                </Text>
              </View>
            ) : null}
            {state.entitlementCheck ? (
              <View
                accessibilityLiveRegion="polite"
                style={[styles.purchaseStatus, state.entitlementCheck.tone !== 'unchanged' && styles.purchaseStatusError]}
              >
                <Text style={[styles.body, styles.purchaseStatusText, state.entitlementCheck.tone !== 'unchanged' && styles.errorText]}>
                  Subscription after this attempt: {state.entitlementCheck.message}
                </Text>
              </View>
            ) : null}
          </Section>

          <View style={styles.actions}>
            <HarnessButton label="Reload products" disabled={busy} onPress={() => void harness.loadProducts()} />
            <HarnessButton label="Restore purchases" disabled={busy} onPress={() => void harness.restore()} />
            <HarnessButton label="Refresh status" disabled={busy} onPress={() => void harness.refresh()} />
          </View>
          {busy ? <ActivityIndicator color={colors.deepOcean} style={styles.spinner} /> : null}

          <Section title="Results">
            {state.log.length ? (
              state.log.map((entry) => (
                <Text key={entry.id} style={styles.body}>
                  {entry.message}
                </Text>
              ))
            ) : (
              <Text style={styles.muted}>Nothing yet.</Text>
            )}
          </Section>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

/** What still has to be supplied before release builds offer Puphii Pro on the You screen. */
function ReleaseReadiness() {
  const issues = paywallConfigIssues();
  return (
    <Section title="Before release · Puphii Pro">
      {issues.length ? (
        <>
          <Text style={styles.body}>Release builds hide Puphii Pro until these are set:</Text>
          {issues.map((issue) => (
            <Text key={issue} style={[styles.body, styles.errorText]}>
              • {issue}
            </Text>
          ))}
        </>
      ) : (
        <Text style={styles.body}>Legal links and Pro benefits are set. Release builds show Puphii Pro.</Text>
      )}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function HarnessButton({ label, onPress, disabled }: { label: string; onPress: () => void; disabled: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, (disabled || pressed) && styles.buttonDimmed]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.white },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  title: { fontSize: 18, fontWeight: '700', color: colors.textPrimary },
  link: { fontSize: 16, color: colors.coralInk, fontWeight: '600' },
  note: { fontSize: 13, color: colors.textMuted, paddingHorizontal: spacing.lg, paddingTop: spacing.xs },
  content: { padding: spacing.lg, gap: spacing.lg },
  section: { gap: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong, paddingTop: spacing.md },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  body: { fontSize: 14, color: colors.textPrimary },
  muted: { fontSize: 12, color: colors.textMuted },
  product: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xs },
  productText: { flex: 1, gap: spacing.xxs },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  button: { backgroundColor: colors.deepOcean, borderRadius: 8, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  buttonDimmed: { opacity: 0.5 },
  buttonLabel: { color: colors.white, fontWeight: '600', fontSize: 14 },
  spinner: { alignSelf: 'flex-start' },
  purchaseStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  purchaseStatusError: { borderColor: colors.danger },
  purchaseStatusText: { flex: 1 },
  errorText: { color: colors.danger, fontWeight: '600' },
  devEntry: {
    gap: spacing.xs,
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    alignItems: 'flex-start',
  },
  devEntryLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5 },
});
