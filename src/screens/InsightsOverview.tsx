import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { Bar, BarChart, spokenBar } from '../components/BarChart';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { SegmentedControl } from '../components/SegmentedControl';
import { dualPeriodSummary } from '../data/eventAggregates';
import {
  comparisonText,
  DAY_PARTS,
  earliestOffset,
  formatAverage,
  InsightsPeriod,
  MIN_LOGS_FOR_PATTERNS,
  periodDateLabel,
  periodRange,
  periodSeries,
  relativePeriodName,
  summarizePeriod,
  timeOfDayBreakdown,
} from '../data/insights';
import { localDayKey } from '../data/puffLogic';
import { usePuphii } from '../data/PuphiiStore';
import { TimedEvent } from '../data/types';
import { useToday } from '../hooks/useToday';
import { colors, fontFamilies, MAX_CONTENT_WIDTH, radii, spacing, TOUCH_TARGET } from '../theme';
import { formatFullDay, formatMonth, formatMonthYear, formatWeekday, pluralize } from '../utils/format';
import { InsightsEventKind } from './InsightsScreen';

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;

const EVENT_OPTIONS = [
  { value: 'puffs', label: 'Puffs' },
  { value: 'skips', label: 'Skips' },
  { value: 'compare', label: 'Compare' },
] as const;

/** Month days that get an axis label; the rest stay blank so labels never collide. */
const MONTH_LABEL_DAYS = new Set([1, 8, 15, 22, 29]);

type Props = {
  header: React.ReactNode;
  period: InsightsPeriod;
  offset: number;
  eventKind: InsightsEventKind;
  onPeriodChange: (period: InsightsPeriod) => void;
  onOffsetChange: (offset: number) => void;
  onEventKindChange: (kind: InsightsEventKind) => void;
};

export function InsightsOverview({
  header,
  period,
  offset,
  eventKind,
  onPeriodChange,
  onOffsetChange,
  onEventKindChange,
}: Props) {
  const { logs, skips } = usePuphii();
  const today = useToday();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const events: readonly TimedEvent[] = eventKind === 'skips' ? skips : logs;
  const isSkip = eventKind === 'skips';
  const tone = isSkip ? 'mint' : 'coral';
  const noun = isSkip ? 'skip' : 'puff';
  const nounPlural = isSkip ? 'skips' : 'puffs';

  const navigationEvents = useMemo(() => {
    if (eventKind !== 'compare') return events;
    return logs.length >= skips.length ? logs : skips;
  }, [eventKind, events, logs, skips]);

  const minOffset = useMemo(() => earliestOffset(navigationEvents, period, today), [navigationEvents, period, today]);
  const safeOffset = Math.min(0, Math.max(offset, Math.min(minOffset, 0)));
  const range = useMemo(() => periodRange(period, today, safeOffset), [period, today, safeOffset]);
  const summary = useMemo(() => summarizePeriod(events, range), [events, range]);
  const dual = useMemo(() => dualPeriodSummary(logs, skips, period, today, safeOffset), [logs, skips, period, today, safeOffset]);
  const timeOfDay = useMemo(() => timeOfDayBreakdown(events, range), [events, range]);

  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH) - spacing.xl * 2;
  const narrowMonths = (contentWidth - spacing.lg * 2) / 12 < 30;

  const bars = useMemo(() => {
    const todayKey = localDayKey(today);
    const thisMonthKey = todayKey.slice(0, 7);
    return periodSeries(events, range).map<Bar>((point) => {
      const future = point.count === null;
      const value = point.count ?? 0;
      const spokenValue = future ? undefined : pluralize(value, `logged ${noun}`);
      if (period === 'year') {
        return {
          key: point.key,
          value,
          future,
          label: formatMonth(point.date, narrowMonths ? 'narrow' : 'short'),
          highlight: point.key === thisMonthKey,
          spokenLabel: formatMonthYear(point.date),
          spokenValue,
          tone,
        };
      }
      const isToday = point.key === todayKey;
      return {
        key: point.key,
        value,
        future,
        label:
          period === 'week' ? formatWeekday(point.date) : MONTH_LABEL_DAYS.has(point.date.getDate()) ? String(point.date.getDate()) : '',
        sublabel: period === 'week' ? String(point.date.getDate()) : undefined,
        highlight: isToday,
        spokenLabel: isToday ? `Today, ${formatFullDay(point.date)}` : formatFullDay(point.date),
        spokenValue,
        tone,
      };
    });
  }, [events, range, period, today, narrowMonths, noun, tone]);

  const selectedBar = bars.find((bar) => bar.key === selectedKey) ?? null;
  const relative = relativePeriodName(range);
  const dateLabel = periodDateLabel(range, today);
  const unit = period === 'year' ? 'month' : 'day';
  const inProgress = range.elapsedDays < range.days;

  const changePeriod = (next: InsightsPeriod) => {
    setSelectedKey(null);
    onPeriodChange(next);
  };
  const changeOffset = (next: number) => {
    setSelectedKey(null);
    onOffsetChange(next);
  };
  const changeEventKind = (next: InsightsEventKind) => {
    setSelectedKey(null);
    onEventKindChange(next);
  };

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top }]} showsVerticalScrollIndicator={false}>
        {header}
        <SegmentedControl options={EVENT_OPTIONS} value={eventKind} onChange={changeEventKind} />
        <View style={styles.periodControl}>
          <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={changePeriod} />
        </View>

        <View style={styles.periodRow}>
          <StepButton
            direction="previous"
            label={`Previous ${period}`}
            disabled={safeOffset <= minOffset}
            onPress={() => changeOffset(safeOffset - 1)}
          />
          <View style={styles.periodTitle} accessible accessibilityRole="header" accessibilityLabel={relative ? `${relative}, ${dateLabel}` : dateLabel}>
            <AppText variant="sectionTitle" align="center" numberOfLines={1}>
              {relative ?? dateLabel}
            </AppText>
            {relative ? (
              <AppText variant="caption" align="center" numberOfLines={1}>
                {dateLabel}
              </AppText>
            ) : null}
          </View>
          <StepButton direction="next" label={`Next ${period}`} disabled={safeOffset >= 0} onPress={() => changeOffset(safeOffset + 1)} />
        </View>
        {safeOffset < -1 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => changeOffset(0)}
            hitSlop={8}
            style={({ pressed }) => [styles.backToCurrent, pressed && { opacity: 0.6 }]}
          >
            <AppText variant="label" color={colors.deepOcean} style={styles.linkText}>
              Back to this {period}
            </AppText>
          </Pressable>
        ) : null}
          {eventKind === 'compare' ? (
            <>
              <Card style={styles.card}>
                <AppText variant="cardTitle" accessibilityRole="header">
                  Puffs vs Skips
                </AppText>
                <AppText variant="caption" style={styles.compareNote}>
                  Separate event types — skips are not puffs and never change plan targets.
                </AppText>
                <View style={styles.compareRow}>
                  <CompareStat value={String(dual.puffs.total)} label="Puffs" tone="coral" />
                  <CompareStat value={String(dual.skips.total)} label="Skips" tone="mint" />
                </View>
                <View style={styles.compareAverages}>
                  <AppText variant="bodySmall" style={styles.flex}>
                    Puffs {formatAverage(dual.puffs.average)}/day · Skips {formatAverage(dual.skips.average)}/day
                    {inProgress ? ' so far' : ''}
                  </AppText>
                </View>
              </Card>
              <Card style={styles.card}>
                <AppText variant="caption" style={styles.compareFoot}>
                  Puff trend: {comparisonText(dual.puffs)}
                </AppText>
                <AppText variant="caption" style={styles.compareFoot}>
                  Skip trend: {comparisonText(dual.skips)}
                </AppText>
              </Card>
            </>
          ) : (
            <>
              <Card style={[styles.card, isSkip && styles.skipCard]}>
                <View style={styles.stats}>
                  <Stat value={String(summary.total)} label={`Logged ${nounPlural}`} />
                  <Stat
                    value={formatAverage(summary.average)}
                    label={inProgress ? 'Per day so far' : 'Per day'}
                    spoken={`Average per day${inProgress ? ' so far' : ''}: ${formatAverage(summary.average).replace('<', 'less than ')}`}
                  />
                  <Stat
                    value={String(summary.daysWithLogs)}
                    suffix={`/${range.elapsedDays}`}
                    label="Days with logs"
                    spoken={`${summary.daysWithLogs} of ${pluralize(range.elapsedDays, 'day')} had logs`}
                  />
                </View>
                <View style={styles.comparison} accessible>
                  <Icon name="history" size={18} color={colors.textMuted} />
                  <AppText variant="bodySmall" color={colors.textPrimary} style={styles.flex}>
                    {comparisonText(summary)}
                  </AppText>
                </View>
              </Card>

              <Card style={styles.card}>
                <View style={styles.cardHeader}>
                  <AppText variant="cardTitle" accessibilityRole="header">
                    {period === 'year' ? `Logged ${nounPlural} by month` : `Logged ${nounPlural} by day`}
                  </AppText>
                  <AppText variant="caption" accessibilityLiveRegion="polite" numberOfLines={1}>
                    {selectedBar ? spokenBar(selectedBar) : `Tap a bar to see that ${unit}'s count.`}
                  </AppText>
                </View>
                <BarChart
                  data={bars}
                  tone={tone}
                  height={period === 'week' ? 110 : 120}
                  showValues={period === 'week'}
                  dense={period === 'month'}
                  accessibilityTitle={`Logged ${nounPlural}`}
                  onSelect={(key) => setSelectedKey((current) => (current === key ? null : key))}
                  selectedKey={selectedKey}
                />
              </Card>

              <Card style={styles.card}>
                <AppText variant="cardTitle" accessibilityRole="header">
                  When you tend to log {nounPlural}
                </AppText>
                {timeOfDay.total < MIN_LOGS_FOR_PATTERNS ? (
                  <AppText variant="bodySmall" style={styles.patternEmpty}>
                    Keep logging to discover when your {nounPlural} tend to happen.
                  </AppText>
                ) : (
                  <>
                    <View style={styles.parts}>
                      {DAY_PARTS.map(({ part, label, hours }) => {
                        const share = timeOfDay.parts.find((entry) => entry.part === part)!;
                        return (
                          <View
                            key={part}
                            style={styles.partRow}
                            accessible
                            accessibilityLabel={`${label}, ${hours}: ${pluralize(share.count, `logged ${noun}`)}, ${share.percent} percent`}
                          >
                            <View style={styles.partLabel}>
                              <AppText variant="label">{label}</AppText>
                              <AppText variant="caption">{hours}</AppText>
                            </View>
                            <View style={styles.partTrack}>
                              <View
                                style={[
                                  styles.partFill,
                                  isSkip ? styles.partFillSkip : null,
                                  { width: `${share.percent}%` },
                                ]}
                              />
                            </View>
                            <AppText variant="label" align="right" style={styles.partValue}>
                              {share.percent}%
                            </AppText>
                          </View>
                        );
                      })}
                    </View>
                    <AppText variant="caption" style={styles.note}>
                      Based on {pluralize(timeOfDay.total, noun)} logged during this period. It shows a pattern in your logs, not a
                      diagnosis.
                    </AppText>
                  </>
                )}
              </Card>
            </>
          )}

        <AppText variant="caption" align="center" style={styles.footnote}>
          {eventKind === 'compare'
            ? 'Puffs and Skips are counted separately. Neither measures nicotine or health.'
            : isSkip
              ? 'These figures count the skips you logged in Puphii. Skips are not puffs and do not measure health.'
              : "These figures count the puffs you logged in Puphii. They don't measure nicotine or health."}
        </AppText>
      </ScrollView>
    </View>
  );
}

function StepButton({
  direction,
  label,
  disabled,
  onPress,
}: {
  direction: 'previous' | 'next';
  label: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.step, disabled && styles.stepDisabled, pressed && { opacity: 0.6 }]}
    >
      <View pointerEvents="none">
        <Icon name={direction === 'previous' ? 'chevronLeft' : 'chevronRight'} size={22} color={colors.textPrimary} strokeWidth={2.2} />
      </View>
    </Pressable>
  );
}

function Stat({ value, suffix, label, spoken }: { value: string; suffix?: string; label: string; spoken?: string }) {
  return (
    <View style={styles.stat} accessible accessibilityLabel={spoken ?? `${label}: ${value}`}>
      <AppText variant="statValue" numberOfLines={1} adjustsFontSizeToFit>
        {value}
        {suffix ? (
          <AppText variant="bodyStrong" color={colors.textMuted}>
            {suffix}
          </AppText>
        ) : null}
      </AppText>
      <AppText variant="caption" align="center">
        {label}
      </AppText>
    </View>
  );
}

function CompareStat({ value, label, tone }: { value: string; label: string; tone: 'coral' | 'mint' }) {
  return (
    <View
      style={[styles.compareStat, tone === 'coral' ? styles.compareStatCoral : styles.compareStatMint]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <AppText variant="statValue" numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </AppText>
      <AppText variant="caption" align="center" color={tone === 'coral' ? colors.coralInk : colors.textPrimaryStrong}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.skyBlue },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  flex: { flex: 1 },
  periodControl: { marginTop: spacing.md },
  periodRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.lg, gap: spacing.sm },
  periodTitle: { flex: 1, minWidth: 0 },
  step: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepDisabled: { opacity: 0.35 },
  backToCurrent: { alignSelf: 'center', minHeight: TOUCH_TARGET, justifyContent: 'center', paddingHorizontal: spacing.md },
  linkText: { fontFamily: fontFamilies.semibold, textDecorationLine: 'underline' },
  card: { marginTop: spacing.lg },
  skipCard: { borderColor: colors.seafoam },
  cardHeader: { gap: spacing.xxs, marginBottom: spacing.md },
  stats: { flexDirection: 'row' },
  stat: { flex: 1, alignItems: 'center', paddingHorizontal: spacing.xs },
  comparison: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  compareNote: { marginTop: spacing.xs, marginBottom: spacing.md },
  compareRow: { flexDirection: 'row', gap: spacing.md },
  compareStat: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
  },
  compareStatCoral: { backgroundColor: colors.peach, borderColor: colors.coralPink },
  compareStatMint: { backgroundColor: 'rgba(168, 220, 204, 0.35)', borderColor: colors.seafoam },
  compareAverages: { marginTop: spacing.md },
  compareFoot: { marginTop: spacing.sm },
  patternEmpty: { marginTop: spacing.sm },
  parts: { marginTop: spacing.md, gap: spacing.md },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  partLabel: { width: 92 },
  partTrack: { flex: 1, height: 10, borderRadius: radii.pill, backgroundColor: colors.divider, overflow: 'hidden' },
  partFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.deepOcean },
  partFillSkip: { backgroundColor: colors.seafoam },
  partValue: { width: 44, fontVariant: ['tabular-nums'] },
  note: { marginTop: spacing.md },
  footnote: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
});
