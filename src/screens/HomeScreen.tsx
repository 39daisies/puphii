import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { Banner } from '../components/Banner';
import { Bar, BarChart } from '../components/BarChart';
import { BubbleArt } from '../components/BubbleArt';
import { IconButton, PrimaryButton, SecondaryButton } from '../components/Buttons';
import { Card } from '../components/Card';
import { CounterScene } from '../components/CounterScene';
import { Icon } from '../components/Icon';
import { Wordmark } from '../components/Wordmark';
import { formatAverage, periodRange, periodSeries, summarizePeriod } from '../data/insights';
import { countOnDay, dayKeyOfLog, localDayKey } from '../data/puffLogic';
import { usePuphii } from '../data/PuphiiStore';
import { useToday } from '../hooks/useToday';
import { Mascot, MascotHandle } from '../mascot/Mascot';
import { playPuffSound, puffHaptic, selectionHaptic } from '../services/feedback';
import { colors, fontFamilies, MAX_CONTENT_WIDTH, radii, spacing } from '../theme';
import { clamp, formatFullDay, formatTime, formatWeekday, pluralize } from '../utils/format';

const CARD_PADDING = spacing.xl;
/** Mascot.tsx reserves extra width around the fish for reaction effects. */
const MASCOT_FRAME = 1.25;
/** Approximate advance width of one Fraunces Black digit, as a fraction of font size. */
const DIGIT_WIDTH = 0.66;

type Props = { onOpenSettings: () => void; onOpenInsights: () => void; onOpenBubbleBreak: () => void };

export function HomeScreen({ onOpenSettings, onOpenInsights, onOpenBubbleBreak }: Props) {
  const { ready, logs, settings, addPuff, undoLatestToday, storageError, dismissStorageError } = usePuphii();
  const today = useToday();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const mascotRef = useRef<MascotHandle>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [scene, setScene] = useState({ width: 0, height: 0 });
  const onSceneLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setScene((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
  }, []);

  const todayKey = localDayKey(today);
  const todayCount = useMemo(() => countOnDay(logs, today), [logs, today]);
  const latest = logs.length ? logs[logs.length - 1] : null;
  const canUndo = ready && !!latest && dayKeyOfLog(latest) === todayKey;

  const tall = height >= 800;
  const compact = height < 700;
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH) - spacing.xl * 2;
  const mascotSize = Math.round(clamp(contentWidth * 0.38, 92, tall ? 148 : 128));
  const countColumnWidth = contentWidth - CARD_PADDING * 2 - mascotSize * MASCOT_FRAME - spacing.sm;
  const digits = Math.max(2, String(todayCount).length);
  const countSize = Math.floor(Math.min(tall ? 104 : compact ? 76 : 92, countColumnWidth / (digits * DIGIT_WIDTH)));
  const sectionGap = tall ? spacing.xl : spacing.lg;

  const week = useMemo(() => {
    const range = periodRange('week', today);
    const { total, average } = summarizePeriod(logs, range);
    const bars = periodSeries(logs, range).map<Bar>((day) => ({
      key: day.key,
      value: day.count ?? 0,
      future: day.count === null,
      label: formatWeekday(day.date),
      highlight: day.key === todayKey,
      spokenLabel: day.key === todayKey ? 'Today' : formatFullDay(day.date),
    }));
    return { bars, total, average: formatAverage(average) };
  }, [logs, today, todayKey]);

  const bump = useRef(new Animated.Value(1)).current;
  const previousCount = useRef(todayCount);
  useEffect(() => {
    if (todayCount > previousCount.current) {
      bump.stopAnimation();
      bump.setValue(1.12);
      Animated.spring(bump, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
    previousCount.current = todayCount;
  }, [todayCount, bump]);

  const onPuff = useCallback(() => {
    const log = addPuff();
    if (!log) return;
    mascotRef.current?.react(settings.mode);
    if (settings.hapticsEnabled) puffHaptic(settings.mode);
    if (settings.soundEnabled) playPuffSound();
    setStatus(`Logged at ${formatTime(log.timestamp)}`);
    AccessibilityInfo.announceForAccessibility('Puff logged');
  }, [addPuff, settings.mode, settings.hapticsEnabled, settings.soundEnabled]);

  const onUndo = useCallback(() => {
    const removed = undoLatestToday();
    if (!removed) return;
    mascotRef.current?.relieve();
    if (settings.hapticsEnabled) selectionHaptic();
    setStatus(`Removed the ${formatTime(removed.timestamp)} log`);
    AccessibilityInfo.announceForAccessibility('Last puff removed');
  }, [undoLatestToday, settings.hapticsEnabled]);

  const statusText =
    status ?? (latest && canUndo ? `Last logged at ${formatTime(latest.timestamp)}` : 'Log each puff as it happens.');

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xs, gap: sectionGap }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View style={styles.headerSide} />
          <Wordmark size={compact ? 26 : 30} />
          <View style={[styles.headerSide, styles.headerRight]}>
            <IconButton icon="settings" accessibilityLabel="Open settings" onPress={onOpenSettings} size={26} />
          </View>
        </View>

        {storageError ? <Banner message={storageError} onDismiss={dismissStorageError} /> : null}

        <Card style={styles.hero}>
          <View style={styles.heroScene} onLayout={onSceneLayout}>
            <CounterScene width={scene.width} height={scene.height} />
            <View style={styles.heroRow}>
              <View
                style={styles.countColumn}
                accessible
                accessibilityLabel={`Today's count: ${pluralize(todayCount, 'puff')}`}
              >
                <AppText variant="label" color={colors.textMuted}>
                  Today's count
                </AppText>
                <Animated.View style={[styles.countWrap, { transform: [{ scale: bump }] }]}>
                  <AppText
                    variant="count"
                    numberOfLines={1}
                    adjustsFontSizeToFit
                    maxFontSizeMultiplier={1}
                    style={{ fontSize: countSize, lineHeight: Math.round(countSize * 1.1) }}
                  >
                    {todayCount}
                  </AppText>
                </Animated.View>
              </View>
              <Mascot ref={mascotRef} size={mascotSize} />
            </View>
          </View>
          <View style={styles.statusRow}>
            <Icon name="clock" size={16} color={colors.textMuted} />
            <AppText variant="caption" style={styles.flex} accessibilityLiveRegion="polite">
              {statusText}
            </AppText>
          </View>
        </Card>

        <View style={styles.actions}>
          <PrimaryButton
            label="+ Log a puff"
            accessibilityLabel="Log a puff"
            accessibilityHint="Records one puff with the current time"
            onPress={onPuff}
            disabled={!ready}
          />
          <SecondaryButton
            label="Undo"
            icon="undo"
            accessibilityLabel="Undo last puff"
            accessibilityHint="Removes the most recent puff logged today"
            onPress={onUndo}
            disabled={!canUndo}
          />
        </View>

        <Card style={styles.weekCard}>
          <View style={styles.weekHeader}>
            <View style={styles.flex}>
              <AppText variant="cardTitle">This week</AppText>
              <AppText variant="caption">
                {pluralize(week.total, 'puff')} logged · {week.average} a day so far
              </AppText>
            </View>
            <Pressable
              accessibilityRole="link"
              accessibilityLabel="See insights"
              onPress={onOpenInsights}
              hitSlop={8}
              style={({ pressed }) => [styles.seeAll, pressed && { opacity: 0.6 }]}
            >
              <AppText variant="label" color={colors.textPrimary} style={styles.seeAllText}>
                Insights
              </AppText>
              <Icon name="chevronRight" size={18} color={colors.textPrimary} />
            </Pressable>
          </View>
          <BarChart data={week.bars} height={compact ? 44 : 56} />
        </Card>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bubble Break"
          accessibilityHint="Opens a 30-second bubble game"
          onPress={onOpenBubbleBreak}
          style={({ pressed }) => pressed && { opacity: 0.85 }}
        >
          <Card style={styles.playCard}>
            <View style={styles.playArt} pointerEvents="none">
              <View style={[styles.playBubble, { left: 0, top: 10 }]}>
                <BubbleArt size={30} tint={0} />
              </View>
              <View style={[styles.playBubble, { left: 20, top: 0 }]}>
                <BubbleArt size={22} tint={1} />
              </View>
              <View style={[styles.playBubble, { left: 24, top: 22 }]}>
                <BubbleArt size={18} tint={2} />
              </View>
            </View>
            <View style={styles.flex}>
              <AppText variant="cardTitle">Bubble Break</AppText>
              <AppText variant="caption">A 30-second pause when you need one.</AppText>
            </View>
            <Icon name="chevronRight" size={20} color={colors.textPrimary} />
          </Card>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.skyBlue },
  content: {
    flexGrow: 1,
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
  },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSide: { width: 44 },
  headerRight: { alignItems: 'flex-end' },
  hero: { padding: 0, borderRadius: radii.xl },
  // The card itself can't clip (that would hide its shadow on iOS), so the scenery
  // section clips to the card's inner top corners instead.
  heroScene: {
    padding: CARD_PADDING,
    paddingBottom: spacing.sm,
    borderTopLeftRadius: radii.xl - 1,
    borderTopRightRadius: radii.xl - 1,
    overflow: 'hidden',
  },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  countColumn: { flex: 1, minWidth: 0 },
  countWrap: { alignSelf: 'flex-start' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    paddingHorizontal: CARD_PADDING,
    paddingVertical: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  actions: { gap: spacing.md },
  weekCard: { padding: spacing.lg, gap: spacing.md },
  weekHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  seeAll: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: spacing.sm },
  seeAllText: { fontFamily: fontFamilies.semibold },
  playCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, minHeight: 64 },
  playArt: { width: 44, height: 40 },
  playBubble: { position: 'absolute' },
});
