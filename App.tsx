import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Image, Modal, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { SubscriptionCheckingScreen } from './src/components/SubscriptionGate';
import { TabBar, TabKey } from './src/components/TabBar';
import { PepRallyProvider } from './src/data/PepRallyProvider';
import { PuphiiProvider } from './src/data/PuphiiStore';
import { useAppSession } from './src/hooks/useAppSession';
import { FACES } from './src/mascot/faces';
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

/** Resolves subscription before the tab shell. Missing legal URLs never unlock. */
function AccessRoot() {
  const { access } = useEntitlement();
  const [lockedDataOpen, setLockedDataOpen] = useState(false);

  if (!PRO_GATING_ACTIVE) {
    return <AppShell />;
  }

  if (access.pro === 'checking') {
    return <SubscriptionCheckingScreen />;
  }

  if (access.pro === 'denied') {
    if (lockedDataOpen) {
      return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setLockedDataOpen(false)}>
          <LockedDataSheet onClose={() => setLockedDataOpen(false)} />
        </Modal>
      );
    }
    return <PaywallGate onOpenData={() => setLockedDataOpen(true)} />;
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

function AppShell() {
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
  screen: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.skyBlue, padding: 24 },
  loadingMascot: { width: 180, height: 180 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: colors.deepOcean, marginTop: 16, textAlign: 'center' },
  errorBody: { fontSize: 13, color: colors.textMuted, marginTop: 8, textAlign: 'center' },
});
