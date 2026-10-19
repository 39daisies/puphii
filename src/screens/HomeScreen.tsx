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
import { CompactButton, IconButton, MODE_LOG_HEIGHT, ModeLogButton, SecondaryButton } from '../components/Buttons';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { ReefBackdrop, SwimmingPuphii } from '../components/ReefScene';
import { Wordmark } from '../components/Wordmark';
import { formatAverage, periodRange, periodSeries, summarizePeriod } from '../data/insights';
import { countOnDay, dayKeyOfLog, localDayKey } from '../data/puffLogic';
import { latestSkipToday } from '../data/skips';
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
  MANAGE_ACTIONS,
  OPEN_PLAN_HINT,
  puffUnit,
  RESUMED_NOTICE,
  TODAY_TITLE,
  WEEK_CHART_SPOKEN_TITLE,
  weekSummaryLine,
  YOUR_PLAN_ROW,
} from '../plan/copy';
import { targetCardModel } from '../plan/targetCard';
import { homePlanView, unseenMilestones } from '../plan/view';
import { playPuffSound, playSkipSound, puffHaptic, selectionHaptic } from '../services/feedback';
import { colors, fontFamilies, MAX_CONTENT_WIDTH, radii, shadows, spacing, TOUCH_TARGET } from '../theme';
import { formatFullDay, formatTime, formatWeekday, pluralize } from '../utils/format';
import { MilestoneNotice } from './plan/MilestoneNotice';
import { ChartLegend } from './plan/PlanDashboard';
import { planBars } from './plan/planBars';
import { SkipMilestoneNotice } from './plan/SkipMilestoneNotice';

const CARD_PADDING = spacing.xl;
const MOTION_BUTTON_HEIGHT = 36;
const PLAN_LINK_HEIGHT = 32;

type HomeMode = 'puff' | 'skip';

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
  const {
    ready,
    logs,
    skips,
    settings,
    addPuff,
    undoLatestToday,
    addSkip,
    undoLatestSkipToday,
    unseenSkipMilestoneIds,
    acknowledgeSkipMilestones,
    storageError,
    dismissStorageError,
    plan,
    planActions,
  } = usePuphii();
  const today = useToday();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const reduceMotion = useReducedMotion();
  const appActive = useAppActive();
  const mascotRef = useRef<MascotHandle>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [mode, setMode] = useState<HomeMode>('puff');
  const [scene, setScene] = useState({ width: 0, height: 0 });
  const onSceneLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setScene((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
  }, []);

  const todayKey = localDayKey(today);
  const todayCount = useMemo(() => countOnDay(logs, today), [logs, today]);
  const latest = logs.length ? logs[logs.length - 1] : null;
  const canUndo = ready && !!latest && dayKeyOfLog(latest) === todayKey;
  const skipsToday = useMemo(() => countOnDay(skips, today), [skips, today]);
  const canUndoSkip = ready && latestSkipToday(skips, todayKey) !== null;
  const isPuff = mode === 'puff';
  const heroCount = isPuff ? todayCount : skipsToday;
  const accent = isPuff ? colors.deepOcean : colors.seafoam;
  const accentInk = isPuff ? colors.deepOcean : colors.textPrimaryStrong;
  const canUndoMode = isPuff ? canUndo : canUndoSkip;
  const digits = String(heroCount).length;

  const tall = height >= 800;
  const compact = height < 700;
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH) - spacing.xl * 2;
  // The card's 1 pt border sits outside the scene.
  const sceneWidth = scene.width || contentWidth - 2;
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
  const targetCard = useMemo(() => (planView?.kind === 'plan' ? targetCardModel(planView) : null), [planView]);
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
  const dismissSkipMilestones = useCallback(
    () => acknowledgeSkipMilestones(unseenSkipMilestoneIds),
    [acknowledgeSkipMilestones, unseenSkipMilestoneIds],
  );

  const resumePlan = useCallback(() => {
    if (planActions.resume().ok) AccessibilityInfo.announceForAccessibility(RESUMED_NOTICE);
  }, [planActions]);

  const bump = useRef(new Animated.Value(1)).current;
  const previousHero = useRef({ mode, count: heroCount });
  useEffect(() => {
    if (previousHero.current.mode !== mode) {
      previousHero.current = { mode, count: heroCount };
      return;
    }
    if (heroCount > previousHero.current.count) {
      bump.stopAnimation();
      bump.setValue(1.12);
      Animated.spring(bump, { toValue: 1, friction: 4, tension: 160, useNativeDriver: true }).start();
    }
    previousHero.current = { mode, count: heroCount };
  }, [heroCount, mode, bump]);

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

  const onSkip = useCallback(() => {
    const skip = addSkip();
    if (!skip) return;
    mascotRef.current?.cheer();
    if (settings.hapticsEnabled) selectionHaptic();
    if (settings.soundEnabled) playSkipSound();
    setStatus(`Skip logged at ${formatTime(skip.timestamp)}`);
    AccessibilityInfo.announceForAccessibility('Skip logged');
  }, [addSkip, settings.hapticsEnabled, settings.soundEnabled]);

  const onUndoSkip = useCallback(() => {
    const removed = undoLatestSkipToday();
    if (!removed) return;
    if (settings.hapticsEnabled) selectionHaptic();
    setStatus(`Removed the ${formatTime(removed.timestamp)} skip`);
    AccessibilityInfo.announceForAccessibility('Last skip removed');
  }, [undoLatestSkipToday, settings.hapticsEnabled]);

  const latestSkip = canUndoSkip ? latestSkipToday(skips, todayKey) : null;
  const statusText =
    status ??
    (isPuff
      ? latest && canUndo
        ? `Last logged at ${formatTime(latest.timestamp)}`
        : 'Log each puff as it happens.'
      : latestSkip
        ? `Skip logged at ${formatTime(latestSkip.timestamp)}`
        : 'Log a skip when you choose not to act on an urge.');

  const selectMode = useCallback(
    (next: HomeMode) => {
      if (next === mode) return;
      setMode(next);
      setStatus(null);
      if (settings.hapticsEnabled) selectionHaptic();
    },
    [mode, settings.hapticsEnabled],
  );

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
              style={[styles.countPlate, { width: layout.plateWidth, borderColor: accent }]}
              accessible
              accessibilityLabel={
                isPuff ? `Today's count: ${pluralize(heroCount, 'puff')}` : `Today's skips: ${pluralize(heroCount, 'skip')}`
              }
            >
              <AppText variant="label" color={accentInk}>
                {isPuff ? "Today's count" : "Today's skips"}
              </AppText>
              <Animated.View style={[styles.countWrap, { transform: [{ scale: bump }] }]}>
                <AppText
                  variant="count"
                  color={accentInk}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  maxFontSizeMultiplier={1}
                  style={{ fontSize: layout.countSize, lineHeight: Math.round(layout.countSize * 1.1) }}
                >
                  {heroCount}
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
          <View
            style={styles.modeSwitch}
            accessibilityRole="tablist"
            accessibilityLabel="Counter mode"
          >
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: isPuff }}
              accessibilityLabel="Puffs"
              onPress={() => selectMode('puff')}
              style={[styles.modeTab, isPuff && { backgroundColor: colors.coralPink }]}
            >
              <AppText variant="buttonSecondary" color={isPuff ? colors.coralInk : colors.textMuted} align="center">
                Puffs
              </AppText>
            </Pressable>
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: !isPuff }}
              accessibilityLabel="Skips"
              onPress={() => selectMode('skip')}
              style={[styles.modeTab, !isPuff && { backgroundColor: colors.seafoam }]}
            >
              <AppText variant="buttonSecondary" color={!isPuff ? colors.textPrimaryStrong : colors.textMuted} align="center">
                Skips
              </AppText>
            </Pressable>
          </View>
          <View style={styles.actionRow}>
            <ModeLogButton
              label={isPuff ? '+ Puff' : '+ Skip'}
              tone={isPuff ? 'coral' : 'mint'}
              accessibilityLabel={isPuff ? 'Log a puff' : `Log a skip. ${pluralize(skipsToday, 'skip')} today`}
              accessibilityHint={
                isPuff
                  ? 'Records one puff with the current time'
                  : 'Records an urge you chose not to act on. It is not counted as a puff'
              }
              onPress={isPuff ? onPuff : onSkip}
              disabled={!ready}
              style={styles.flex}
            />
            <CompactButton
              label="Undo"
              icon="undo"
              height={MODE_LOG_HEIGHT}
              accessibilityLabel={isPuff ? 'Undo last puff' : 'Undo last skip'}
              accessibilityHint={
                isPuff
                  ? 'Removes the most recent puff logged today'
                  : 'Removes the most recent skip logged today. Puffs are not changed'
              }
              onPress={isPuff ? onUndo : onUndoSkip}
              disabled={!canUndoMode}
            />
          </View>
        </View>

        {newMilestoneIds.length ? (
          <MilestoneNotice ids={newMilestoneIds} onOpen={onOpenPlan} onDismiss={acknowledgeMilestones} />
        ) : null}

        {unseenSkipMilestoneIds.length ? (
          <SkipMilestoneNotice ids={unseenSkipMilestoneIds} onDismiss={dismissSkipMilestones} />
        ) : null}

        {planView?.kind === 'plan' && targetCard ? (
          <Card style={styles.targetCard}>
            <View style={styles.targetHeader}>
              <View style={styles.flex}>
                <AppText variant="overline" accessibilityRole="header" style={styles.targetTitle}>
                  {planView.paused ? TODAY_TITLE : HOME_TARGET_TITLE}
                </AppText>
                <AppText variant="caption" numberOfLines={1}>
                  {targetCard.weekLine}
                </AppText>
              </View>
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={YOUR_PLAN_ROW}
                accessibilityHint={OPEN_PLAN_HINT}
                onPress={onOpenPlan}
                hitSlop={(TOUCH_TARGET - PLAN_LINK_HEIGHT) / 2}
                style={({ pressed }) => [styles.planLink, pressed && { opacity: 0.6 }]}
              >
                <AppText variant="caption" color={colors.textPrimary} style={styles.seeAllText}>
                  {YOUR_PLAN_ROW}
                </AppText>
                <Icon name="chevronRight" size={16} color={colors.textPrimary} />
              </Pressable>
            </View>
            <View style={styles.targetRow} accessible accessibilityLabel={targetCard.spoken}>
              <AppText variant="statValue" numberOfLines={1} adjustsFontSizeToFit style={styles.targetCount}>
                {targetCard.count}
                {targetCard.target === null ? null : (
                  <AppText variant="statValue" color={colors.textMuted} style={styles.targetOf}>
                    {` / ${targetCard.target}`}
                  </AppText>
                )}
                <AppText variant="label" color={colors.textMuted}>
                  {` ${puffUnit(targetCard.target ?? targetCard.count)}`}
                </AppText>
              </AppText>
              <View style={[styles.targetBadge, targetCard.tone === 'above' && styles.targetBadgeAbove]}>
                <AppText variant="caption" color={targetCard.tone === 'above' ? colors.coralInk : colors.textPrimary} style={styles.seeAllText}>
                  {targetCard.badge}
                </AppText>
              </View>
            </View>
            {targetCard.fill === null ? null : (
              <View style={styles.targetTrack} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <View
                  style={[
                    styles.targetFill,
                    { width: `${Math.round(targetCard.fill * 100)}%` as const },
                    targetCard.tone === 'above' && styles.targetFillAbove,
                  ]}
                />
              </View>
            )}
            <AppText variant="caption" style={styles.skipContext}>
              {skipsToday > 0
                ? `${pluralize(skipsToday, 'skip')} today · ${pluralize(skips.length, 'skip')} total. Skips don't change this target.`
                : skips.length > 0
                  ? `${pluralize(skips.length, 'skip')} logged overall. Skips don't change this target.`
                  : `Skips don't change this target.`}
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
    borderWidth: 2,
    ...shadows.soft,
  },
  countWrap: { alignSelf: 'flex-start' },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs + 2,
    minHeight: TOUCH_TARGET,
    paddingHorizontal: CARD_PADDING,
    paddingVertical: spacing.xs,
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
  actions: { gap: spacing.sm },
  modeSwitch: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1.5,
    borderColor: colors.oceanBlue,
  },
  modeTab: {
    flex: 1,
    minHeight: TOUCH_TARGET,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
  },
  actionRow: { flexDirection: 'row', gap: spacing.sm },
  weekCard: { padding: spacing.lg, gap: spacing.md },
  weekHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  seeAll: { flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingLeft: spacing.sm },
  seeAllText: { fontFamily: fontFamilies.semibold },
  targetCard: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, gap: spacing.sm },
  targetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  targetTitle: { textTransform: 'uppercase' },
  planLink: { flexDirection: 'row', alignItems: 'center', gap: spacing.xxs, minHeight: PLAN_LINK_HEIGHT, paddingLeft: spacing.sm },
  targetRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  targetCount: { flex: 1, fontSize: 30, lineHeight: 34 },
  targetOf: { fontSize: 24 },
  targetBadge: {
    paddingHorizontal: spacing.sm + 2,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.skyBlue,
    borderWidth: 1,
    borderColor: colors.oceanBlue,
  },
  targetBadgeAbove: { backgroundColor: colors.peach, borderColor: colors.coralPink },
  targetTrack: { height: 8, borderRadius: radii.pill, backgroundColor: colors.border, overflow: 'hidden' },
  targetFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.deepOcean },
  targetFillAbove: { backgroundColor: colors.coralDeep },
  skipContext: { marginTop: spacing.xxs },
  inviteCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingLeft: spacing.lg, paddingRight: spacing.xs },
  inviteMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingVertical: spacing.xs },
});
