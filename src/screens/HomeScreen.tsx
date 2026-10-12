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
import { IconButton, PrimaryButton, SecondaryButton } from '../components/Buttons';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { ReefBackdrop, SwimmingPuphii } from '../components/ReefScene';
import { Wordmark } from '../components/Wordmark';
import { formatAverage, periodRange, periodSeries, summarizePeriod } from '../data/insights';
import { countOnDay, dayKeyOfLog, localDayKey } from '../data/puffLogic';
import { usePuphii } from '../data/PuphiiStore';
import { useAppActive } from '../hooks/useAppActive';
import { useReducedMotion } from '../hooks/useReducedMotion';
import { useToday } from '../hooks/useToday';
import { MascotHandle } from '../mascot/Mascot';
import { PLATE_PADDING, reefLayout, SCENE_INSET } from '../mascot/reefMotion';
import {
  HOME_INVITE_DISMISS,
  HOME_INVITE_LABEL,
  HOME_INVITE_TEXT,
  HOME_NEW_GOAL_DISMISS,
  HOME_NEW_GOAL_LABEL,
  HOME_NEW_GOAL_TEXT,
  HOME_TARGET_TITLE,
  homeTargetLine,
  MANAGE_ACTIONS,
  OPEN_PLAN_HINT,
  planWeekLine,
  RESUMED_NOTICE,
  TODAY_TITLE,
  todayNote,
  WEEK_CHART_SPOKEN_TITLE,
  weekSummaryLine,
  YOUR_PLAN_ROW,
} from '../plan/copy';
import { homePlanView, unseenMilestones } from '../plan/view';
import { playPuffSound, puffHaptic, selectionHaptic } from '../services/feedback';
import { colors, fontFamilies, MAX_CONTENT_WIDTH, radii, shadows, spacing, TOUCH_TARGET } from '../theme';
import { formatFullDay, formatTime, formatWeekday, pluralize } from '../utils/format';
import { MilestoneNotice } from './plan/MilestoneNotice';
import { ChartLegend } from './plan/PlanDashboard';
import { planBars } from './plan/planBars';

const CARD_PADDING = spacing.xl;
const MOTION_BUTTON_HEIGHT = 36;

type Props = {
  onOpenSettings: () => void;
  /** Your Plan, on the You tab. */
  onOpenPlan: () => void;
  onOpenInsights: () => void;
  /** The reef animation is paused for this session (kept by the app shell across tabs). */
  motionPaused: boolean;
  onToggleMotion: () => void;
  /** The goal suggestion was hidden earlier in this app session (kept by the app shell). */
  inviteHidden: boolean;
  onHideInvite: () => void;
};

export function HomeScreen({
  onOpenSettings,
  onOpenPlan,
  onOpenInsights,
  motionPaused,
  onToggleMotion,
  inviteHidden,
  onHideInvite,
}: Props) {
  const { ready, logs, settings, addPuff, undoLatestToday, storageError, dismissStorageError, plan, planActions } = usePuphii();
  const today = useToday();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
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
  // The card's 1 pt border sits outside the scene.
  const sceneWidth = scene.width || contentWidth - 2;
  const digits = String(todayCount).length;
  const layout = useMemo(() => reefLayout({ sceneWidth, screenHeight: height, digits }), [sceneWidth, height, digits]);
  const sceneHeight = scene.height || layout.sceneMinHeight;
  const sectionGap = tall ? spacing.xl : spacing.lg;
  // Home unmounts on other tabs, which stops every loop with it.
  const animating = appActive && !motionPaused && !reduceMotion;

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

  const planView = useMemo(() => (ready ? homePlanView(plan, logs, todayKey) : null), [ready, plan, logs, todayKey]);
  const invite =
    planView?.kind === 'invite' && planView.ended
      ? { label: HOME_NEW_GOAL_LABEL, text: HOME_NEW_GOAL_TEXT, dismiss: HOME_NEW_GOAL_DISMISS }
      : { label: HOME_INVITE_LABEL, text: HOME_INVITE_TEXT, dismiss: HOME_INVITE_DISMISS };
  // With a plan, the week shows each day's target, and finished days without activity as empty slots.
  const chartBars = useMemo(
    () =>
      planView?.kind === 'plan'
        ? planBars(planView.days, todayKey).map((bar) => (bar.key === todayKey ? { ...bar, spokenLabel: 'Today' } : bar))
        : week.bars,
    [planView, todayKey, week.bars],
  );

  // A new day can start or end a pause, move the target and settle milestones, while Home stays open.
  useEffect(() => {
    if (appActive) planActions.refresh();
  }, [todayKey, appActive, planActions]);

  const newMilestoneIds = useMemo(() => (ready ? unseenMilestones(plan).map((milestone) => milestone.id) : []), [ready, plan]);
  const acknowledgeMilestones = useCallback(() => planActions.markMilestonesSeen(newMilestoneIds), [planActions, newMilestoneIds]);

  const resumePlan = useCallback(() => {
    if (planActions.resume().ok) AccessibilityInfo.announceForAccessibility(RESUMED_NOTICE);
  }, [planActions]);

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
          <View style={[styles.heroScene, { minHeight: layout.sceneMinHeight }]} onLayout={onSceneLayout}>
            <ReefBackdrop width={scene.width} height={scene.height} running={animating} />
            <View
              style={[styles.countPlate, { width: layout.plateWidth }]}
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
                  style={{ fontSize: layout.countSize, lineHeight: Math.round(layout.countSize * 1.1) }}
                >
                  {todayCount}
                </AppText>
              </Animated.View>
            </View>
            <SwimmingPuphii ref={mascotRef} layout={layout} sceneHeight={sceneHeight} running={animating} still={reduceMotion} />
          </View>
          <View style={styles.statusRow}>
            <Icon name="clock" size={16} color={colors.textMuted} />
            <AppText variant="caption" style={styles.flex} accessibilityLiveRegion="polite">
              {statusText}
            </AppText>
            {reduceMotion ? null : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={motionPaused ? 'Resume ocean animation' : 'Pause ocean animation'}
                onPress={onToggleMotion}
                hitSlop={(TOUCH_TARGET - MOTION_BUTTON_HEIGHT) / 2}
                style={({ pressed }) => [styles.motionButton, pressed && { backgroundColor: colors.oceanBlue }]}
              >
                <Icon name={motionPaused ? 'play' : 'pause'} size={14} color={colors.textPrimary} strokeWidth={2.4} />
                <AppText variant="caption" color={colors.textPrimary} style={styles.motionLabel}>
                  {motionPaused ? 'Resume' : 'Pause'}
                </AppText>
              </Pressable>
            )}
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

        {newMilestoneIds.length ? (
          <MilestoneNotice ids={newMilestoneIds} onOpen={onOpenPlan} onDismiss={acknowledgeMilestones} />
        ) : null}

        {planView?.kind === 'plan' ? (
          <Card style={styles.weekCard}>
            <View style={styles.weekHeader}>
              <View style={styles.flex} accessible accessibilityRole="header">
                <AppText variant="cardTitle">{planView.paused ? TODAY_TITLE : HOME_TARGET_TITLE}</AppText>
                <AppText variant="caption">{planWeekLine(planView.week, planView.paused)}</AppText>
              </View>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={YOUR_PLAN_ROW}
                accessibilityHint={OPEN_PLAN_HINT}
                onPress={onOpenPlan}
                hitSlop={8}
                style={({ pressed }) => [styles.seeAll, pressed && { opacity: 0.6 }]}
              >
                <AppText variant="label" color={colors.textPrimary} style={styles.seeAllText}>
                  {YOUR_PLAN_ROW}
                </AppText>
                <Icon name="chevronRight" size={18} color={colors.textPrimary} />
              </Pressable>
            </View>
            <AppText variant="sectionTitle">{homeTargetLine(planView.progress)}</AppText>
            <AppText variant="bodySmall" color={colors.textPrimary}>
              {todayNote(planView.progress)}
            </AppText>
            {planView.paused ? (
              <SecondaryButton
                label={MANAGE_ACTIONS.resume.label}
                icon="play"
                accessibilityHint={MANAGE_ACTIONS.resume.detail}
                onPress={resumePlan}
              />
            ) : null}
          </Card>
        ) : null}

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
          {planView?.kind === 'plan' ? (
            <>
              <BarChart data={chartBars} height={compact ? 44 : 56} accessibilityTitle={WEEK_CHART_SPOKEN_TITLE} />
              {chartBars.some((bar) => bar.target != null || bar.untracked) ? <ChartLegend /> : null}
              <AppText variant="bodySmall" color={colors.textPrimary}>
                {weekSummaryLine(planView.summary)}
              </AppText>
            </>
          ) : (
            <BarChart data={chartBars} height={compact ? 44 : 56} />
          )}
        </Card>

        {planView?.kind === 'invite' && !inviteHidden ? (
          <Card style={styles.inviteCard}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={invite.label}
              accessibilityHint={invite.text}
              onPress={onOpenPlan}
              style={({ pressed }) => [styles.inviteMain, pressed && { opacity: 0.6 }]}
            >
              <View style={styles.flex}>
                <AppText variant="cardTitle">{invite.label}</AppText>
                <AppText variant="caption">{invite.text}</AppText>
              </View>
              <Icon name="chevronRight" size={18} color={colors.textPrimary} />
            </Pressable>
            <IconButton icon="close" accessibilityLabel={invite.dismiss} onPress={onHideInvite} size={20} />
          </Card>
        ) : null}
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
    padding: SCENE_INSET,
    borderTopLeftRadius: radii.xl - 1,
    borderTopRightRadius: radii.xl - 1,
    overflow: 'hidden',
    backgroundColor: colors.oceanBlue,
  },
  // Opaque, so the photo and passing fish never sit behind the digits.
  countPlate: {
    alignSelf: 'flex-start',
    paddingHorizontal: PLATE_PADDING,
    paddingTop: spacing.sm + 2,
    paddingBottom: spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: colors.warmCream,
    ...shadows.soft,
  },
  countWrap: { alignSelf: 'flex-start' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: 52,
    paddingHorizontal: CARD_PADDING,
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  motionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: MOTION_BUTTON_HEIGHT,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.skyBlue,
    borderWidth: 1.5,
    borderColor: colors.oceanBlue,
  },
  motionLabel: { fontFamily: fontFamilies.semibold },
  actions: { gap: spacing.md },
  weekCard: { padding: spacing.lg, gap: spacing.md },
  weekHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  seeAll: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: spacing.sm },
  seeAllText: { fontFamily: fontFamilies.semibold },
  inviteCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.xs },
  inviteMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingVertical: spacing.xs },
});
