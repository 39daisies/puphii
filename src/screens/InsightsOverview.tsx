import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { Bar, BarChart, spokenBar } from '../components/BarChart';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { ProGate } from '../components/ProGate';
import { SegmentedControl } from '../components/SegmentedControl';
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
import { useToday } from '../hooks/useToday';
import { overviewFeature } from '../subscription/proFeatures';
import { colors, fontFamilies, MAX_CONTENT_WIDTH, radii, spacing, TOUCH_TARGET } from '../theme';
import { formatFullDay, formatMonth, formatMonthYear, formatWeekday, pluralize } from '../utils/format';

const PERIOD_OPTIONS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;

/** Month days that get an axis label; the rest stay blank so labels never collide. */
const MONTH_LABEL_DAYS = new Set([1, 8, 15, 22, 29]);

type Props = {
  header: React.ReactNode;
  period: InsightsPeriod;
  offset: number;
  onPeriodChange: (period: InsightsPeriod) => void;
  onOffsetChange: (offset: number) => void;
};

export function InsightsOverview({ header, period, offset, onPeriodChange, onOffsetChange }: Props) {
  const { logs } = usePuphii();
  const today = useToday();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const minOffset = useMemo(() => earliestOffset(logs, period, today), [logs, period, today]);
  const safeOffset = Math.min(0, Math.max(offset, Math.min(minOffset, 0)));
  const range = useMemo(() => periodRange(period, today, safeOffset), [period, today, safeOffset]);
  const summary = useMemo(() => summarizePeriod(logs, range), [logs, range]);
  const timeOfDay = useMemo(() => timeOfDayBreakdown(logs, range), [logs, range]);

  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH) - spacing.xl * 2;
  const narrowMonths = (contentWidth - spacing.lg * 2) / 12 < 30;

  const bars = useMemo(() => {
    const todayKey = localDayKey(today);
    const thisMonthKey = todayKey.slice(0, 7);
    return periodSeries(logs, range).map<Bar>((point) => {
      const future = point.count === null;
      const value = point.count ?? 0;
      if (period === 'year') {
        return {
          key: point.key,
          value,
          future,
          label: formatMonth(point.date, narrowMonths ? 'narrow' : 'short'),
          highlight: point.key === thisMonthKey,
          spokenLabel: formatMonthYear(point.date),
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
      };
    });
  }, [logs, range, period, today, narrowMonths]);

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

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top }]} showsVerticalScrollIndicator={false}>
        {header}
        <SegmentedControl options={PERIOD_OPTIONS} value={period} onChange={changePeriod} />

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

        <ProGate feature={overviewFeature(period, safeOffset)} onNotNow={() => changePeriod('week')}>
          <Card style={styles.card}>
            <View style={styles.stats}>
              <Stat value={String(summary.total)} label="Logged puffs" />
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
                {period === 'year' ? 'Logged puffs by month' : 'Logged puffs by day'}
              </AppText>
              <AppText variant="caption" accessibilityLiveRegion="polite" numberOfLines={1}>
                {selectedBar ? spokenBar(selectedBar) : `Tap a bar to see that ${unit}'s count.`}
              </AppText>
            </View>
            <BarChart
              data={bars}
              height={period === 'week' ? 110 : 120}
              showValues={period === 'week'}
              dense={period === 'month'}
              onSelect={(key) => setSelectedKey((current) => (current === key ? null : key))}
              selectedKey={selectedKey}
            />
          </Card>

          <Card style={styles.card}>
            <AppText variant="cardTitle" accessibilityRole="header">
              When you tend to log puffs
            </AppText>
            {timeOfDay.total < MIN_LOGS_FOR_PATTERNS ? (
              <AppText variant="bodySmall" style={styles.patternEmpty}>
                Keep logging to discover when your puffs tend to happen.
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
                        accessibilityLabel={`${label}, ${hours}: ${pluralize(share.count, 'logged puff')}, ${share.percent} percent`}
                      >
                        <View style={styles.partLabel}>
                          <AppText variant="label">{label}</AppText>
                          <AppText variant="caption">{hours}</AppText>
                        </View>
                        <View style={styles.partTrack}>
                          <View style={[styles.partFill, { width: `${share.percent}%` }]} />
                        </View>
                        <AppText variant="label" align="right" style={styles.partValue}>
                          {share.percent}%
                        </AppText>
                      </View>
                    );
                  })}
                </View>
                <AppText variant="caption" style={styles.note}>
                  Based on {pluralize(timeOfDay.total, 'puff')} logged during this period. It shows a pattern in your logs, not a
                  diagnosis.
                </AppText>
              </>
            )}
          </Card>
        </ProGate>

        <AppText variant="caption" align="center" style={styles.footnote}>
          These figures count the puffs you logged in Puphii. They don't measure nicotine or health.
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
  patternEmpty: { marginTop: spacing.sm },
  parts: { marginTop: spacing.md, gap: spacing.md },
  partRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  partLabel: { width: 92 },
  partTrack: { flex: 1, height: 10, borderRadius: radii.pill, backgroundColor: colors.divider, overflow: 'hidden' },
  partFill: { height: '100%', borderRadius: radii.pill, backgroundColor: colors.deepOcean },
  partValue: { width: 44, fontVariant: ['tabular-nums'] },
  note: { marginTop: spacing.md },
  footnote: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
});
