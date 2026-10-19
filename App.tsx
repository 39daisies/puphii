import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Image, Modal, Pressable, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { SubscriptionCheckingScreen } from './src/components/SubscriptionGate';
import { TabBar, TabKey } from './src/components/TabBar';
import { PepRallyProvider } from './src/data/PepRallyProvider';
import { PuphiiProvider, usePuphii } from './src/data/PuphiiStore';
import { useAppSession } from './src/hooks/useAppSession';
import { FACES } from './src/mascot/faces';
import { needsFirstLaunchOnboarding } from './src/onboarding/model';
import { OnboardingScreen } from './src/onboarding/OnboardingScreen';
import { activeSegment } from './src/plan/schedule';
import { HomeScreen } from './src/screens/HomeScreen';
import { INITIAL_INSIGHTS_STATE, InsightsScreen, InsightsState } from './src/screens/InsightsScreen';
import { PaywallGate, PaywallScreen } from './src/screens/PaywallScreen';
import { PlayScreen, usePlaySessions } from './src/screens/PlayScreen';
import { SettingsScreen, YouPage, YouStartPage } from './src/screens/SettingsScreen';
import { EntitlementProvider, PRO_GATING_ACTIVE, useEntitlement } from './src/subscription/EntitlementProvider';
import { colors, fontAssets } from './src/theme';

type DevToolsModule = { TestStoreHarnessHost: React.ComponentType; TestStoreHarnessButton: React.ComponentType };
// Development-only tools. Metro drops this require from production bundles, where __DEV__ is false.
const DevTools: DevToolsModule | null = __DEV__ ? require('./src/dev/TestStoreHarness') : null;

export default function App() {
  const [fontsLoaded, fontError] = useFonts(fontAssets);

  useEffect(() => {
    if (fontError) console.error('[Puphii] Font loading failed', fontError);
  }, [fontError]);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="dark-content" backgroundColor={colors.skyBlue} />
      {fontError ? (
        <FontErrorScreen message={fontError.message} />
      ) : !fontsLoaded ? (
        <LoadingScreen />
      ) : (
        <PuphiiProvider>
          <EntitlementProvider>
            <PepRallyProvider>
              <AccessRoot />
              {DevTools ? <DevTools.TestStoreHarnessHost /> : null}
            </PepRallyProvider>
          </EntitlementProvider>
        </PuphiiProvider>
      )}
    </SafeAreaProvider>
  );
}

/**
 * First-launch: onboarding (plan preview) → paywall → Home.
 * Returning users with data or completed onboarding skip onboarding.
 * Missing legal URLs never unlock the app.
 */
function AccessRoot() {
  const { access } = useEntitlement();
  const {
    ready,
    appState,
    logs,
    skips,
    plan,
    onboardingDraft,
    updateOnboardingDraft,
    finishOnboarding,
    activatePendingPlanOnce,
  } = usePuphii();
  const [lockedDataOpen, setLockedDataOpen] = useState(false);
  // Ephemeral development-only screen preview. Never changes RevenueCat entitlement or release gating.
  const [devPreviewOpen, setDevPreviewOpen] = useState(false);

  const needsOnboarding = needsFirstLaunchOnboarding({
    ready,
    onboardingCompletedAt: appState?.onboardingCompletedAt ?? null,
    firstLaunchSource: appState?.firstLaunchSource ?? null,
    hasPlanSegments: plan.segments.length > 0 || !!activeSegment(plan),
    hasLogs: logs.length > 0,
    hasSkips: skips.length > 0,
  });

  useEffect(() => {
    if (access.pro === 'granted') activatePendingPlanOnce();
  }, [access.pro, activatePendingPlanOnce]);

  if (!PRO_GATING_ACTIVE) {
    return <AppShell />;
  }

  // This branch is unreachable in production, and the preview has no purchase bypass.
  // It is deliberately session-only and requires an explicit tap on the locked paywall.
  if (__DEV__ && devPreviewOpen) {
    return <AppShell devPreview onExitDevPreview={() => setDevPreviewOpen(false)} />;
  }

  if (!ready || access.pro === 'checking' || onboardingDraft === null) {
    return <SubscriptionCheckingScreen />;
  }

  if (needsOnboarding) {
    return (
      <OnboardingScreen
        draft={onboardingDraft}
        onChange={updateOnboardingDraft}
        onFinished={finishOnboarding}
      />
    );
  }

  if (access.pro === 'denied') {
    if (lockedDataOpen) {
      return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLockedDataOpen(false)}>
          <LockedDataSheet onClose={() => setLockedDataOpen(false)} />
        </Modal>
      );
    }
    return (
      <View style={styles.previewGate}>
        <PaywallGate onOpenData={() => setLockedDataOpen(true)} />
        {__DEV__ ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Preview app screens, development only"
            onPress={() => setDevPreviewOpen(true)}
            style={styles.devPreviewEntry}
          >
            <Text style={styles.devPreviewEntryText}>DEV ONLY · Preview app screens</Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return <AppShell />;
}

/** Data management for locked users — does not unlock the rest of the app. */
function LockedDataSheet({ onClose }: { onClose: () => void }) {
  return (
    <YouStartPage.Provider value="main">
      <SettingsScreen lockedToData onLockedBack={onClose} />
    </YouStartPage.Provider>
  );
}

function AppShell({ devPreview = false, onExitDevPreview }: { devPreview?: boolean; onExitDevPreview?: () => void } = {}) {
  const [tab, setTab] = useState<TabKey>('home');
  const playSessions = usePlaySessions();
  // The You tab opens on this page; any other way of arriving starts on its main list.
  const [youPage, setYouPage] = useState<YouPage>('main');
  const openPlan = useCallback(() => {
    setYouPage('plan');
    setTab('you');
  }, []);
  const [paywallOpen, setPaywallOpen] = useState(false);
  const openManageSubscription = useCallback(() => setPaywallOpen(true), []);
  // Held here so Pause survives tab changes; deliberately not saved between launches.
  const [reefPaused, setReefPaused] = useState(false);
  const toggleReef = useCallback(() => setReefPaused((paused) => !paused), []);
  // Hiding the goal suggestion lasts for this app session only; it comes back in a later one.
  const session = useAppSession();
  const [inviteHiddenIn, setInviteHiddenIn] = useState<number | null>(null);
  const hideInvite = useCallback(() => setInviteHiddenIn(session), [session]);
  const [insights, setInsights] = useState<InsightsState>(INITIAL_INSIGHTS_STATE);
  const updateInsights = useCallback((patch: Partial<InsightsState>) => setInsights((state) => ({ ...state, ...patch })), []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab === 'home') return false;
      setTab('home');
      return true;
    });
    return () => subscription.remove();
  }, [tab]);

  useEffect(() => {
    if (tab !== 'you') setYouPage('main');
  }, [tab]);

  return (
    <View style={styles.shell}>
      {__DEV__ && devPreview ? (
        <View style={styles.devPreviewBanner}>
          <Text style={styles.devPreviewBannerText}>DEV PREVIEW · No subscription granted · Local data may change</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Exit development preview" onPress={onExitDevPreview} hitSlop={10}>
            <Text style={styles.devPreviewExit}>Exit</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={styles.screen}>
        {tab === 'home' && (
          <HomeScreen
            onOpenSettings={() => setTab('you')}
            onOpenPlan={openPlan}
            onOpenInsights={() => {
              updateInsights({ section: 'overview', period: 'week', offset: 0 });
              setTab('insights');
            }}
            motionPaused={reefPaused}
            onToggleMotion={toggleReef}
            inviteHidden={inviteHiddenIn === session}
            onHideInvite={hideInvite}
          />
        )}
        {tab === 'insights' && <InsightsScreen state={insights} onChange={updateInsights} />}
        {tab === 'play' && <PlayScreen sessions={playSessions} />}
        {tab === 'you' && (
          <YouStartPage.Provider value={youPage}>
            <SettingsScreen
              footer={DevTools ? <DevTools.TestStoreHarnessButton /> : undefined}
              onOpenPro={openManageSubscription}
            />
          </YouStartPage.Provider>
        )}
      </View>
      <TabBar active={tab} onChange={setTab} />
      <PaywallScreen visible={paywallOpen} onClose={() => setPaywallOpen(false)} />
    </View>
  );
}

function LoadingScreen() {
  return (
    <View style={styles.center} accessibilityLabel="Loading Puphii">
      <Image source={FACES.idle} style={styles.loadingMascot} resizeMode="contain" />
    </View>
  );
}

// Deliberately uses the system font: the brand fonts are what failed to load.
function FontErrorScreen({ message }: { message: string }) {
  return (
    <View style={styles.center}>
      <Image source={FACES.exasperated} style={styles.loadingMascot} resizeMode="contain" />
      <Text style={styles.errorTitle}>Puphii couldn't load its fonts.</Text>
      <Text style={styles.errorBody}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: colors.warmCream },
  previewGate: { flex: 1 },
  devPreviewEntry: { position: 'absolute', bottom: 12, alignSelf: 'center', backgroundColor: colors.deepOcean, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 12, zIndex: 10 },
  devPreviewEntryText: { color: colors.white, fontWeight: '700', fontSize: 12 },
  devPreviewBanner: { backgroundColor: colors.deepOcean, paddingHorizontal: 12, paddingTop: 6, paddingBottom: 6, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  devPreviewBannerText: { color: colors.white, fontSize: 10, flexShrink: 1, paddingRight: 12 },
  devPreviewExit: { color: colors.white, fontWeight: '700', fontSize: 14 },
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.skyBlue, padding: 24 },
  loadingMascot: { width: 180, height: 180 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: colors.deepOcean, marginTop: 16, textAlign: 'center' },
  errorBody: { fontSize: 13, color: colors.textMuted, marginTop: 8, textAlign: 'center' },
});
