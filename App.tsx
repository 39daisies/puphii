import React, { useCallback, useEffect, useState } from 'react';
import { BackHandler, Image, StatusBar, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { TabBar, TabKey } from './src/components/TabBar';
import { PuphiiProvider } from './src/data/PuphiiStore';
import { FACES } from './src/mascot/faces';
import { BubbleBreakScreen } from './src/screens/BubbleBreakScreen';
import { HomeScreen } from './src/screens/HomeScreen';
import { INITIAL_INSIGHTS_STATE, InsightsScreen, InsightsState } from './src/screens/InsightsScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { colors, fontAssets } from './src/theme';

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
          <AppShell />
        </PuphiiProvider>
      )}
    </SafeAreaProvider>
  );
}

function AppShell() {
  const [tab, setTab] = useState<TabKey>('home');
  // Bubble Break opens over the current tab rather than being a tab of its own.
  const [playing, setPlaying] = useState(false);
  const [insights, setInsights] = useState<InsightsState>(INITIAL_INSIGHTS_STATE);
  const updateInsights = useCallback((patch: Partial<InsightsState>) => setInsights((state) => ({ ...state, ...patch })), []);

  const goTo = useCallback((next: TabKey) => {
    setPlaying(false);
    setTab(next);
  }, []);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (playing) {
        setPlaying(false);
        return true;
      }
      if (tab === 'home') return false;
      setTab('home');
      return true;
    });
    return () => subscription.remove();
  }, [tab, playing]);

  return (
    <View style={styles.shell}>
      <View style={styles.screen}>
        {playing ? (
          <BubbleBreakScreen onExit={() => goTo('home')} />
        ) : (
          <>
            {tab === 'home' && (
              <HomeScreen
                onOpenSettings={() => setTab('you')}
                onOpenInsights={() => {
                  updateInsights({ section: 'overview', period: 'week', offset: 0 });
                  setTab('insights');
                }}
                onOpenBubbleBreak={() => setPlaying(true)}
              />
            )}
            {tab === 'insights' && <InsightsScreen state={insights} onChange={updateInsights} />}
            {tab === 'you' && <SettingsScreen />}
          </>
        )}
      </View>
      <TabBar active={tab} onChange={goTo} />
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
