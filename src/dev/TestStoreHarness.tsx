import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { registerDevMenuItems } from 'expo-dev-client';
import Purchases from 'react-native-purchases';
import { SafeAreaView } from 'react-native-safe-area-context';
import { REVENUECAT_ENTITLEMENT_ID, SUBSCRIPTION_GATING_ENABLED } from '../subscription/config';
import { useEntitlement } from '../subscription/EntitlementProvider';
import { KEY_MESSAGES } from '../subscription/revenueCat';
import { appSdkKey, hasNativeStore } from '../subscription/revenueCatSdk';
import { colors, spacing } from '../theme';
import { TEST_STORE_EXPECTED } from './testStoreConfig';
import { createOpenRequests, createTestStoreHarness, describeEntitlement, HarnessState, TestStoreSdk } from './testStoreHarness';

/**
 * Development builds only: App.tsx loads this file behind `__DEV__`, so production bundles
 * never contain it. Opened from the development menu or the DEV ONLY button App.tsx places at
 * the bottom of the You screen.
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
  return (
    <View style={styles.devEntry}>
      <Text style={styles.devEntryLabel}>DEV ONLY · not in release builds</Text>
      <HarnessButton label="Open RevenueCat Test Store" disabled={false} onPress={openRequests.request} />
      {hasNativeStore ? null : (
        <Text style={styles.muted}>This is Expo Go, which has no store connection. Open the Puphii development build instead.</Text>
      )}
    </View>
  );
}

const usingTestStore = appSdkKey.ok && appSdkKey.source === 'testStore';

function keyDescription(): string {
  if (!appSdkKey.ok) return `Key problem: ${KEY_MESSAGES[appSdkKey.reason]}`;
  return appSdkKey.source === 'testStore'
    ? 'Key: RevenueCat Test Store (simulated purchases)'
    : 'Key: App Store / Google Play. Buying is disabled here; set the Test Store key to simulate purchases.';
}

function TestStoreScreen({ onClose }: { onClose: () => void }) {
  const { entitlement, access, refresh, restorePurchases } = useEntitlement();
  const harness = useMemo(
    () =>
      createTestStoreHarness({
        sdk: testStoreSdk,
        entitlementId: REVENUECAT_ENTITLEMENT_ID,
        entitlements: { refresh, restorePurchases },
        usingTestStore,
        expected: TEST_STORE_EXPECTED,
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
        console.log(`[Puphii] Test Store: ${entry.message}`);
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
          <Text style={styles.title}>RevenueCat Test Store</Text>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={12}>
            <Text style={styles.link}>Close</Text>
          </Pressable>
        </View>
        <Text style={styles.note}>Development builds only. Purchases here are simulated and never charged.</Text>

        <ScrollView contentContainerStyle={styles.content}>
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
                <HarnessButton label="Buy" disabled={busy || !usingTestStore} onPress={() => void harness.purchase(row.key)} />
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
