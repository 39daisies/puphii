import React, { useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { Bar, BarChart } from '../components/BarChart';
import { IconButton, SecondaryButton } from '../components/Buttons';
import { Card } from '../components/Card';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { SegmentedControl } from '../components/SegmentedControl';
import { addLocalDays, dailySeries, DayGroup, groupLogsByDay, localDayKey, weeklySeries } from '../data/puffLogic';
import { usePuphii } from '../data/PuphiiStore';
import { groupSkipsByDay, SkipDayGroup } from '../data/skips';
import { PuffLog, TimedEvent } from '../data/types';
import { useToday } from '../hooks/useToday';
import { FACES } from '../mascot/faces';
import { colors, MAX_CONTENT_WIDTH, radii, spacing } from '../theme';
import { formatFullDay, formatLongDate, formatShortDate, formatTime, formatWeekday, pluralize } from '../utils/format';

export type HistoryRange = 'week' | 'month' | 'all';
export type HistoryEventKind = 'puffs' | 'skips';

const RANGE_OPTIONS = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'all', label: 'All' },
] as const;

const EVENT_OPTIONS = [
  { value: 'puffs', label: 'Puffs' },
  { value: 'skips', label: 'Skips' },
] as const;

const DAYS_PAGE = 7;
const ROWS_PER_DAY = 5;

type Props = {
  header?: React.ReactNode;
  range: HistoryRange;
  eventKind: HistoryEventKind;
  onRangeChange: (range: HistoryRange) => void;
  onEventKindChange: (kind: HistoryEventKind) => void;
};

export function HistoryScreen({ header, range, eventKind, onRangeChange, onEventKindChange }: Props) {
  const { logs, skips, deleteLog } = usePuphii();
  const today = useToday();
  const insets = useSafeAreaInsets();
  const [visibleDays, setVisibleDays] = useState(DAYS_PAGE);
  const [pendingDelete, setPendingDelete] = useState<PuffLog | null>(null);

  const isSkip = eventKind === 'skips';
  const events: readonly TimedEvent[] = isSkip ? skips : logs;
  const tone = isSkip ? 'mint' : 'coral';
  const noun = isSkip ? 'skip' : 'puff';
  const nounPlural = isSkip ? 'skips' : 'puffs';

  const todayKey = localDayKey(today);
  const yesterdayKey = localDayKey(addLocalDays(today, -1));
  const puffGroups = useMemo(() => groupLogsByDay(logs), [logs]);
  const skipGroups = useMemo(() => groupSkipsByDay(skips), [skips]);

  const { bars, chartTitle, stats, dense } = useMemo(() => {
    const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
    const avg = (total: number, days: number) => (days ? (total / days).toFixed(1) : '0');
    const groupCount = isSkip ? skipGroups.length : puffGroups.length;

    if (range === 'week') {
      const days = dailySeries(events, today, 7);
      const total = sum(days.map((d) => d.count));
      return {
        chartTitle: 'Last 7 days',
        dense: false,
        bars: days.map<Bar>((d) => ({
          key: d.key,
          value: d.count,
          label: formatWeekday(d.date),
          sublabel: String(d.date.getDate()),
          highlight: d.key === todayKey,
          spokenLabel: d.key === todayKey ? 'Today' : formatFullDay(d.date),
          spokenValue: pluralize(d.count, `logged ${noun}`),
          tone,
        })),
        stats: [
          { label: 'Today', value: String(days[days.length - 1].count) },
          { label: 'This week', value: String(total) },
          { label: 'Daily avg', value: avg(total, 7) },
        ],
      };
    }
    if (range === 'month') {
      const days = dailySeries(events, today, 30);
      const total = sum(days.map((d) => d.count));
      return {
        chartTitle: 'Last 30 days',
        dense: true,
        bars: days.map<Bar>((d, index) => ({
          key: d.key,
          value: d.count,
          label: index % 7 === 1 || d.key === todayKey ? formatShortDate(d.date) : '',
          highlight: d.key === todayKey,
          spokenLabel: d.key === todayKey ? 'Today' : formatFullDay(d.date),
          spokenValue: pluralize(d.count, `logged ${noun}`),
          tone,
        })),
        stats: [
          { label: 'Today', value: String(days[days.length - 1].count) },
          { label: '30 days', value: String(total) },
          { label: 'Daily avg', value: avg(total, 30) },
        ],
      };
    }
    const weeks = weeklySeries(events, today, 8);
    return {
      chartTitle: 'Weekly totals',
      dense: false,
      bars: weeks.map<Bar>((w, index) => ({
        key: w.key,
        value: w.count,
        label: formatShortDate(w.start),
        highlight: index === weeks.length - 1,
        spokenLabel: index === weeks.length - 1 ? 'This week' : `Week of ${formatLongDate(w.start)}`,
        spokenValue: pluralize(w.count, `logged ${noun}`),
        tone,
      })),
      stats: [
        { label: `All ${nounPlural}`, value: String(events.length) },
        { label: 'Days logged', value: String(groupCount) },
        { label: 'Avg / day', value: avg(events.length, groupCount) },
      ],
    };
  }, [range, events, today, todayKey, isSkip, skipGroups.length, puffGroups.length, noun, nounPlural, tone]);

  const todayPuffGroup: DayGroup = puffGroups.find((g) => g.key === todayKey) ?? { key: todayKey, date: today, logs: [] };
  const todaySkipGroup: SkipDayGroup = skipGroups.find((g) => g.key === todayKey) ?? { key: todayKey, date: today, skips: [] };
  const earlierPuffs = puffGroups.filter((g) => g.key !== todayKey);
  const earlierSkips = skipGroups.filter((g) => g.key !== todayKey);
  const shownEarlierPuffs = earlierPuffs.slice(0, visibleDays);
  const shownEarlierSkips = earlierSkips.slice(0, visibleDays);
  const earlierCount = isSkip ? earlierSkips.length : earlierPuffs.length;
  const emptyAll = events.length === 0;

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top }]} showsVerticalScrollIndicator={false}>
        {header ?? <ScreenHeader title="History" />}
        <SegmentedControl options={EVENT_OPTIONS} value={eventKind} onChange={onEventKindChange} />
        <View style={styles.rangeControl}>
          <SegmentedControl options={RANGE_OPTIONS} value={range} onChange={onRangeChange} />
        </View>

        <Card style={[styles.chartCard, isSkip && styles.skipCard]}>
          <AppText variant="cardTitle">{chartTitle}</AppText>
          <View style={styles.chart}>
            <BarChart
              data={bars}
              tone={tone}
              showValues={!dense}
              dense={dense}
              height={dense ? 110 : 120}
              accessibilityTitle={`Logged ${nounPlural}`}
            />
          </View>
          <View style={styles.stats}>
            {stats.map((stat) => (
              <View key={stat.label} style={styles.stat} accessible accessibilityLabel={`${stat.label}: ${stat.value}`}>
                <AppText variant="statValue">{stat.value}</AppText>
                <AppText variant="caption">{stat.label}</AppText>
              </View>
            ))}
          </View>
        </Card>

        {isSkip ? (
          <>
            <SkipDaySection group={todaySkipGroup} title="Today" emptyText="No skips logged today." />
            {shownEarlierSkips.map((group) => (
              <SkipDaySection
                key={group.key}
                group={group}
                title={group.key === yesterdayKey ? 'Yesterday' : formatWeekday(group.date)}
              />
            ))}
          </>
        ) : (
          <>
            <PuffDaySection group={todayPuffGroup} title="Today" onDelete={setPendingDelete} emptyText="No puffs logged today." />
            {shownEarlierPuffs.map((group) => (
              <PuffDaySection
                key={group.key}
                group={group}
                title={group.key === yesterdayKey ? 'Yesterday' : formatWeekday(group.date)}
                onDelete={setPendingDelete}
              />
            ))}
          </>
        )}

        {earlierCount > visibleDays ? (
          <SecondaryButton
            label="Show earlier days"
            onPress={() => setVisibleDays((count) => count + DAYS_PAGE)}
            style={styles.more}
          />
        ) : null}

        {emptyAll ? (
          <View style={styles.empty}>
            <Image source={FACES.happy} style={styles.emptyMascot} resizeMode="contain" />
            <AppText variant="body" align="center">
              {isSkip
                ? 'Your skip history will appear here after you log your first skip.'
                : 'Your history will appear here after you log your first puff.'}
            </AppText>
          </View>
        ) : null}
      </ScrollView>

      <ConfirmDialog
        visible={!!pendingDelete}
        title="Delete this log?"
        message={
          pendingDelete
            ? `The puff logged at ${formatTime(pendingDelete.timestamp)} on ${formatLongDate(new Date(pendingDelete.timestamp))} will be removed.`
            : ''
        }
        confirmLabel="Delete"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteLog(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </View>
  );
}

function PuffDaySection({
  group,
  title,
  onDelete,
  emptyText,
}: {
  group: DayGroup;
  title: string;
  onDelete: (log: PuffLog) => void;
  emptyText?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.logs : group.logs.slice(0, ROWS_PER_DAY);
  const hidden = group.logs.length - visible.length;

  return (
    <View style={styles.daySection}>
      <View style={styles.dayHeader}>
        <AppText variant="sectionTitle" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="bodySmall" style={styles.dayDate}>
          {formatLongDate(group.date)}
        </AppText>
        <View style={styles.pill}>
          <AppText variant="caption" color={colors.coralInk}>
            {pluralize(group.logs.length, 'puff')}
          </AppText>
        </View>
      </View>
      <Card style={styles.logCard}>
        {group.logs.length === 0 ? (
          <AppText variant="bodySmall" style={styles.emptyRow}>
            {emptyText}
          </AppText>
        ) : (
          visible.map((log, index) => (
            <View
              key={log.id}
              style={[styles.logRow, (index < visible.length - 1 || hidden > 0 || expanded) && styles.logDivider]}
              accessible={false}
            >
              <AppText variant="time" style={styles.time}>
                {formatTime(log.timestamp)}
              </AppText>
              <AppText variant="caption" color={colors.textMuted} style={styles.meta}>
                {productLabel(log)}
              </AppText>
              <Image source={FACES.idle} style={styles.rowMascot} resizeMode="contain" accessible={false} />
              <View style={styles.flex} />
              <IconButton
                icon="trash"
                size={20}
                color={colors.textMuted}
                accessibilityLabel={`Delete puff logged at ${formatTime(log.timestamp)}`}
                onPress={() => onDelete(log)}
              />
            </View>
          ))
        )}
        {hidden > 0 || (expanded && group.logs.length > ROWS_PER_DAY) ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setExpanded((value) => !value)}
            style={({ pressed }) => [styles.showAll, pressed && { opacity: 0.6 }]}
          >
            <AppText variant="label" color={colors.deepOcean}>
              {expanded ? 'Show less' : `Show all ${group.logs.length}`}
            </AppText>
            <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
              <Icon name="chevronDown" size={18} color={colors.deepOcean} />
            </View>
          </Pressable>
        ) : null}
      </Card>
    </View>
  );
}

function SkipDaySection({ group, title, emptyText }: { group: SkipDayGroup; title: string; emptyText?: string }) {
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? group.skips : group.skips.slice(0, ROWS_PER_DAY);
  const hidden = group.skips.length - visible.length;

  return (
    <View style={styles.daySection}>
      <View style={styles.dayHeader}>
        <AppText variant="sectionTitle" accessibilityRole="header">
          {title}
        </AppText>
        <AppText variant="bodySmall" style={styles.dayDate}>
          {formatLongDate(group.date)}
        </AppText>
        <View style={[styles.pill, styles.skipPill]}>
          <AppText variant="caption" color={colors.textPrimaryStrong}>
            {pluralize(group.skips.length, 'skip')}
          </AppText>
        </View>
      </View>
      <Card style={[styles.logCard, styles.skipCard]}>
        {group.skips.length === 0 ? (
          <AppText variant="bodySmall" style={styles.emptyRow}>
            {emptyText}
          </AppText>
        ) : (
          visible.map((skip, index) => (
            <View
              key={skip.id}
              style={[styles.logRow, (index < visible.length - 1 || hidden > 0 || expanded) && styles.logDivider]}
              accessible
              accessibilityLabel={`Skip logged at ${formatTime(skip.timestamp)}`}
            >
              <AppText variant="time" style={styles.time}>
                {formatTime(skip.timestamp)}
              </AppText>
              <AppText variant="caption" color={colors.textMuted}>
                Skip
              </AppText>
              <Image source={FACES.happy} style={styles.rowMascot} resizeMode="contain" accessible={false} />
            </View>
          ))
        )}
        {hidden > 0 || (expanded && group.skips.length > ROWS_PER_DAY) ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setExpanded((value) => !value)}
            style={({ pressed }) => [styles.showAll, pressed && { opacity: 0.6 }]}
          >
            <AppText variant="label" color={colors.deepOcean}>
              {expanded ? 'Show less' : `Show all ${group.skips.length}`}
            </AppText>
            <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
              <Icon name="chevronDown" size={18} color={colors.deepOcean} />
            </View>
          </Pressable>
        ) : null}
      </Card>
    </View>
  );
}

function productLabel(log: PuffLog): string {
  if (log.product === 'vape') return 'Vape puff';
  if (log.product === 'cigarette') return 'Cigarette';
  return 'Puff';
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
  rangeControl: { marginTop: spacing.md },
  chartCard: { marginTop: spacing.lg, paddingTop: spacing.lg },
  skipCard: { borderColor: colors.seafoam },
  chart: { marginTop: spacing.md },
  stats: {
    flexDirection: 'row',
    marginTop: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
  },
  stat: { flex: 1, alignItems: 'center' },
  daySection: { marginTop: spacing.xxl },
  dayHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },
  dayDate: { flex: 1 },
  pill: {
    backgroundColor: colors.peach,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderWidth: 1,
    borderColor: colors.coralPink,
  },
  skipPill: {
    backgroundColor: 'rgba(168, 220, 204, 0.45)',
    borderColor: colors.seafoam,
  },
  logCard: { paddingVertical: spacing.xs },
  logRow: { flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: spacing.md },
  logDivider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  time: { minWidth: 76, fontVariant: ['tabular-nums'] },
  meta: { minWidth: 72 },
  rowMascot: { width: 34, height: 34 },
  flex: { flex: 1 },
  emptyRow: { paddingVertical: spacing.md },
  showAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs, minHeight: 44 },
  more: { marginTop: spacing.lg },
  empty: { alignItems: 'center', marginTop: spacing.xxl, gap: spacing.sm },
  emptyMascot: { width: 120, height: 120 },
});
