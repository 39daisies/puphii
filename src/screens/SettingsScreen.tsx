import React, { useEffect, useState } from 'react';
import { BackHandler, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import appConfig from '../../app.json';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { DialogButton, SecondaryButton } from '../components/Buttons';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { OceanBackground } from '../components/OceanBackground';
import { ScreenHeader } from '../components/ScreenHeader';
import { NavRow, SectionHeader, ToggleRow } from '../components/SettingsRows';
import { Wordmark } from '../components/Wordmark';
import { groupLogsByDay } from '../data/puffLogic';
import { usePuphii } from '../data/PuphiiStore';
import { REACTION_MODES, ReactionMode } from '../data/types';
import { FACES, MODE_COPY } from '../mascot/faces';
import { cancelDailyReminder, scheduleDailyReminder } from '../services/reminders';
import { playPuffSound, selectionHaptic } from '../services/feedback';
import { colors, fontFamilies, radii, spacing } from '../theme';
import { formatLongDate, formatTime } from '../utils/format';

type Page = 'main' | 'reminders' | 'data' | 'about';

const REMINDER_TIMES = [
  { hour: 9, minute: 0 },
  { hour: 13, minute: 0 },
  { hour: 18, minute: 0 },
  { hour: 21, minute: 0 },
];

const timeLabel = (hour: number, minute: number) => formatTime(new Date(2026, 0, 1, hour, minute));

/** `footer` is only ever passed by development builds; release builds show the screen without it. */
export function SettingsScreen({ footer }: { footer?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [page, setPage] = useState<Page>('main');

  useEffect(() => {
    if (page === 'main') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      setPage('main');
      return true;
    });
    return () => subscription.remove();
  }, [page]);

  const back = () => setPage('main');

  return (
    <View style={styles.root}>
      <OceanBackground variant="calm" />
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top }]} showsVerticalScrollIndicator={false}>
        {page === 'main' && <MainSettings onNavigate={setPage} />}
        {page === 'reminders' && <RemindersPage onBack={back} />}
        {page === 'data' && <DataPage onBack={back} />}
        {page === 'about' && <AboutPage onBack={back} />}
        {page === 'main' && footer}
      </ScrollView>
    </View>
  );
}

function MainSettings({ onNavigate }: { onNavigate: (page: Page) => void }) {
  const { settings, updateSettings } = usePuphii();

  const selectMode = (mode: ReactionMode) => {
    if (mode === settings.mode) return;
    updateSettings({ mode });
    if (settings.hapticsEnabled) selectionHaptic();
  };

  return (
    <>
      <ScreenHeader title="You" />

      <SectionHeader title="Reaction Mode" caption="Choose how Puphii reacts after each puff." />
      <View style={styles.modes} accessibilityRole="radiogroup">
        {REACTION_MODES.map((mode) => {
          const selected = settings.mode === mode;
          const copy = MODE_COPY[mode];
          return (
            <Pressable
              key={mode}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityLabel={`${copy.title}. ${copy.subtitle}`}
              onPress={() => selectMode(mode)}
              style={({ pressed }) => [styles.modeCard, selected && styles.modeCardSelected, pressed && { opacity: 0.85 }]}
            >
              <Image source={FACES[copy.thumbnail]} style={styles.modeThumb} resizeMode="contain" />
              <View style={styles.modeText}>
                <AppText variant="cardTitle" style={styles.modeTitle}>
                  {copy.title}
                </AppText>
                <AppText variant="bodySmall">{copy.subtitle}</AppText>
              </View>
              <View style={[styles.radio, selected && styles.radioSelected]}>
                {selected ? <Icon name="heart" size={16} color={colors.white} fill={colors.white} strokeWidth={1.4} /> : null}
              </View>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.inlineNote}>
        <Icon name="info" size={18} color={colors.textMuted} />
        <AppText variant="caption" style={styles.flex}>
          Puphii's faces are playful feedback, not a measurement of your health.
        </AppText>
      </View>

      <SectionHeader title="Feedback" />
      <Card style={styles.group}>
        <ToggleRow
          icon="sound"
          label="Sound"
          description="A soft bubble pop when you log"
          value={settings.soundEnabled}
          onValueChange={(soundEnabled) => {
            updateSettings({ soundEnabled });
            if (soundEnabled) playPuffSound();
          }}
        />
        <ToggleRow
          icon="haptic"
          label="Haptics"
          description={Platform.OS === 'web' ? 'Available on iOS and Android' : 'A gentle tap when you log'}
          value={settings.hapticsEnabled}
          onValueChange={(hapticsEnabled) => {
            updateSettings({ hapticsEnabled });
            if (hapticsEnabled) selectionHaptic();
          }}
          last
        />
      </Card>

      <SectionHeader title="App Settings" />
      <Card style={styles.group}>
        <NavRow
          icon="bell"
          label="Reminders"
          detail={settings.remindersEnabled ? timeLabel(settings.reminderHour, settings.reminderMinute) : 'Off'}
          onPress={() => onNavigate('reminders')}
        />
        <NavRow icon="database" label="Data Management" onPress={() => onNavigate('data')} />
        <NavRow icon="info" label="About Puphii" onPress={() => onNavigate('about')} last />
      </Card>
    </>
  );
}

function RemindersPage({ onBack }: { onBack: () => void }) {
  const { settings, updateSettings } = usePuphii();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<'denied' | 'unavailable' | null>(null);

  const schedule = async (hour: number, minute: number) => {
    setBusy(true);
    const result = await scheduleDailyReminder(hour, minute);
    setBusy(false);
    if (result === 'scheduled') {
      setProblem(null);
      updateSettings({ remindersEnabled: true, reminderHour: hour, reminderMinute: minute });
    } else {
      setProblem(result);
      updateSettings({ remindersEnabled: false });
    }
  };

  const toggle = async (enabled: boolean) => {
    if (enabled) {
      await schedule(settings.reminderHour, settings.reminderMinute);
    } else {
      setProblem(null);
      updateSettings({ remindersEnabled: false });
      await cancelDailyReminder();
    }
  };

  return (
    <>
      <ScreenHeader title="Reminders" onBack={onBack} />
      <Card style={styles.group}>
        <ToggleRow
          icon="bell"
          label="Daily check-in"
          description="One gentle nudge a day. Off by default."
          value={settings.remindersEnabled}
          onValueChange={toggle}
          disabled={busy}
          last
        />
      </Card>

      {settings.remindersEnabled ? (
        <>
          <SectionHeader title="Time" />
          <View style={styles.chips}>
            {REMINDER_TIMES.map(({ hour, minute }) => {
              const selected = settings.reminderHour === hour && settings.reminderMinute === minute;
              return (
                <Pressable
                  key={hour}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  aria-disabled={busy}
                  disabled={busy}
                  onPress={() => schedule(hour, minute)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <AppText variant="label" color={selected ? colors.coralInk : colors.textPrimary}>
                    {timeLabel(hour, minute)}
                  </AppText>
                </Pressable>
              );
            })}
          </View>
        </>
      ) : null}

      {problem === 'denied' ? (
        <View style={styles.spaced}>
          <Banner message="Notifications are turned off for Puphii. You can allow them in your device settings." />
          {Platform.OS !== 'web' ? (
            <SecondaryButton label="Open device settings" onPress={() => Linking.openSettings().catch(() => undefined)} style={styles.spaced} />
          ) : null}
        </View>
      ) : null}
      {problem === 'unavailable' ? (
        <View style={styles.spaced}>
          <Banner message="Reminders aren't available here. They work in the iOS and Android app." />
        </View>
      ) : null}

      <AppText variant="bodySmall" style={styles.spaced}>
        Puphii only asks for notification permission when you turn reminders on. Reminders are scheduled on this device; nothing
        is sent to a server.
      </AppText>
    </>
  );
}

function DataPage({ onBack }: { onBack: () => void }) {
  const { logs, clearLogs, resetAll, storageError, dismissStorageError } = usePuphii();
  const [confirm, setConfirm] = useState<'history' | 'all' | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const days = groupLogsByDay(logs);
  const first = days.length ? days[days.length - 1].date : null;

  return (
    <>
      <ScreenHeader title="Data" onBack={onBack} />
      <Card style={styles.statsCard}>
        <Stat label="Puffs logged" value={String(logs.length)} />
        <Stat label="Days with logs" value={String(days.length)} />
        <Stat label="First log" value={first ? formatLongDate(first) : '—'} small />
      </Card>

      <View style={styles.inlineNote}>
        <Icon name="database" size={18} color={colors.textMuted} />
        <AppText variant="bodySmall" style={styles.flex}>
          Your puff logs, settings, savings calculator details and Bubble Break scores are stored only on this device. Puphii doesn't send them
          anywhere: there's no account, cloud sync, advertising or analytics.
          {Platform.select({
            ios: " They're excluded from iCloud and computer backups, so deleting Puphii also deletes them.",
            android: " They're excluded from device backups, so uninstalling Puphii also deletes them.",
            default: '',
          })}
        </AppText>
      </View>

      {storageError ? (
        <View style={styles.spaced}>
          <Banner message={storageError} onDismiss={dismissStorageError} />
        </View>
      ) : null}
      {done ? (
        <View style={styles.spaced}>
          <Banner message={done} onDismiss={() => setDone(null)} />
        </View>
      ) : null}

      <SectionHeader title="Clear data" caption="These actions can't be undone." />
      <View style={styles.dangerActions}>
        <DialogButton label="Clear puff history" tone="destructive" onPress={() => setConfirm('history')} style={styles.dangerButton} />
        <DialogButton label="Reset everything" tone="destructiveOutline" onPress={() => setConfirm('all')} style={styles.dangerButton} />
      </View>

      <ConfirmDialog
        visible={confirm === 'history'}
        title="Clear puff history?"
        message={`All ${logs.length} logged puffs will be permanently deleted from this device. Your settings, savings calculator details and Bubble Break scores stay as they are.`}
        confirmLabel="Clear history"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          clearLogs();
          setConfirm(null);
          setDone('Puff history cleared.');
        }}
      />
      <ConfirmDialog
        visible={confirm === 'all'}
        title="Reset everything?"
        message="All puff logs, savings calculator details and Bubble Break scores are deleted, settings return to their defaults and reminders are turned off."
        confirmLabel="Reset"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          resetAll();
          void cancelDailyReminder();
          setConfirm(null);
          setDone('Puphii has been reset.');
        }}
      />
    </>
  );
}

function Stat({ label, value, small }: { label: string; value: string; small?: boolean }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="statValue" style={small ? styles.statSmall : undefined} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" align="center">
        {label}
      </AppText>
    </View>
  );
}

function AboutPage({ onBack }: { onBack: () => void }) {
  return (
    <>
      <ScreenHeader title="About" onBack={onBack} />
      <View style={styles.aboutHero}>
        <Image source={FACES.winking} style={styles.aboutMascot} resizeMode="contain" accessible={false} />
        <Wordmark size={44} />
        <AppText variant="headline" align="center" style={styles.tagline}>
          Don't just count it.{'\n'}Count it scared.
        </AppText>
      </View>
      <Card style={styles.aboutCard}>
        <AppText variant="body" color={colors.textPrimary}>
          Puphii is a simple, private puff counter. Tap once each time you smoke or vape, and a small pufferfish reacts.
        </AppText>
        <AppText variant="body">
          Puphii's reactions are playful feedback. They are not a measurement of physical harm, a diagnosis or medical advice.
          If you're worried about your health, please talk to a healthcare professional.
        </AppText>
      </Card>
      <AppText variant="caption" align="center" style={styles.credits}>
        Version {appConfig.expo.version}
        {'\n'}Display type: Fraunces · UI type: Inter (both SIL Open Font License)
      </AppText>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xxxl },
  flex: { flex: 1 },
  modes: { gap: spacing.md },
  modeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  modeCardSelected: { backgroundColor: colors.peach, borderColor: colors.coralPink },
  modeThumb: { width: 56, height: 56 },
  modeText: { flex: 1, gap: 2 },
  modeTitle: { fontFamily: fontFamilies.bold },
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
  inlineNote: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  group: { paddingVertical: spacing.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    minHeight: 44,
    minWidth: 84,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.peach, borderColor: colors.coralPink },
  spaced: { marginTop: spacing.lg },
  statsCard: { flexDirection: 'row', paddingVertical: spacing.lg },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  statSmall: { fontSize: 18, lineHeight: 32 },
  dangerActions: { gap: spacing.md },
  dangerButton: { flex: 0 },
  aboutHero: { alignItems: 'center', gap: spacing.sm, marginBottom: spacing.xl },
  aboutMascot: { width: 140, height: 140 },
  tagline: { marginTop: spacing.xs },
  aboutCard: { gap: spacing.md },
  credits: { marginTop: spacing.xl },
});
