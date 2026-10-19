import React from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { BarChart } from '../../components/BarChart';
import { PrimaryButton, SecondaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { SectionHeader } from '../../components/SettingsRows';
import { countOnDay } from '../../data/puffLogic';
import { PuffLog, SkipLog } from '../../data/types';
import { FACES } from '../../mascot/faces';
import {
  averagesLine,
  BASELINE_SOURCE_LABEL,
  baselineProvenanceNote,
  CHART_LEGEND,
  CONFIRM_ZERO_HINT,
  CONFIRM_ZERO_LABEL,
  GOAL_COPY,
  homeTargetLine,
  MANAGE_ACTIONS,
  MANAGE_TITLE,
  MILESTONES_EMPTY,
  MILESTONES_TITLE,
  NEW_MILESTONE_BADGE,
  nextChangeLine,
  paceLabel,
  PLAN_DETAILS_TITLE,
  planWeekLine,
  reachedOnLine,
  REMOVE_CONFIRMATION_LABEL,
  spokenSentences,
  settledLine,
  settleDetail,
  startingLevel,
  TODAY_TITLE,
  todayNote,
  WEEK_CHART_CAPTION,
  WEEK_CHART_SPOKEN_TITLE,
  WEEK_CHART_TITLE,
  weekSummaryLine,
} from '../../plan/copy';
import { DayKey } from '../../plan/days';
import { MilestoneId, PlanRecord, PlanSegment } from '../../plan/model';
import { summarizeDays, todayProgress } from '../../plan/progress';
import {
  baselineProvenance,
  chartWeekStart,
  displayPlanWeek,
  earnedMilestones,
  nextTargetChanges,
  planStartDay,
  weekChartDays,
} from '../../plan/view';
import { colors, fontFamilies, spacing } from '../../theme';
import { pluralize } from '../../utils/format';
import { ActionRow, Badge } from './controls';
import { longDay, planBars } from './planBars';

export type ManageAction = keyof typeof MANAGE_ACTIONS;

type Props = {
  plan: PlanRecord;
  segment: PlanSegment;
  logs: readonly PuffLog[];
  /** Shown as context only — never feeds target math. */
  skips: readonly SkipLog[];
  today: DayKey;
  paused: boolean;
  newMilestones: readonly MilestoneId[];
  onConfirmZero: (confirmed: boolean) => void;
  onManage: (action: ManageAction) => void;
};

/** The active plan: today, this week against its targets, milestones, details and changes. */
export function PlanDashboard({ plan, segment, logs, skips, today, paused, newMilestones, onConfirmZero, onManage }: Props) {
  const progress = todayProgress(plan, logs, today);
  const week = displayPlanWeek(plan, today) ?? 1;
  const next = nextTargetChanges(plan, today)[0];
  const settled = !paused && !next && progress.kind === 'active' && progress.atSettleLevel;
  const headline = homeTargetLine(progress);
  const note = todayNote(progress);
  const todayDate = new Date(`${today}T12:00:00`);
  const skipsToday = countOnDay(skips, todayDate);

  return (
    <>
      <SectionHeader title={TODAY_TITLE} />
      <Card style={styles.card}>
        <View style={styles.todayRow}>
          <Image source={FACES.idle} style={styles.mascot} resizeMode="contain" accessible={false} />
          <View style={styles.flex}>
            {headline ? (
              <AppText variant="sectionTitle" accessibilityLiveRegion="polite">
                {headline}
              </AppText>
            ) : null}
            <AppText variant="label" color={colors.textMuted}>
              {planWeekLine(week, paused)}
            </AppText>
          </View>
        </View>
        {note ? (
          <AppText variant="bodySmall" color={colors.textPrimary}>
            {note}
          </AppText>
        ) : null}
        {next ? <AppText variant="bodySmall">{nextChangeLine(next.target, longDay(next.day))}</AppText> : null}
        {settled ? <AppText variant="bodySmall">{settledLine(segment.goal)}</AppText> : null}
        <AppText variant="caption" color={colors.textMuted}>
          {skipsToday > 0
            ? `${pluralize(skipsToday, 'skip')} today · ${pluralize(skips.length, 'skip')} total. Skips don't change plan targets.`
            : skips.length > 0
              ? `${pluralize(skips.length, 'skip')} logged overall. Skips don't change plan targets.`
              : `Skips don't change plan targets.`}
        </AppText>
        {paused ? (
          <PrimaryButton label={MANAGE_ACTIONS.resume.label} accessibilityHint={MANAGE_ACTIONS.resume.detail} onPress={() => onManage('resume')} />
        ) : progress.kind === 'active' && progress.count === 0 ? (
          progress.state === 'confirmedZero' ? (
            <SecondaryButton label={REMOVE_CONFIRMATION_LABEL} onPress={() => onConfirmZero(false)} />
          ) : (
            <SecondaryButton label={CONFIRM_ZERO_LABEL} icon="check" accessibilityHint={CONFIRM_ZERO_HINT} onPress={() => onConfirmZero(true)} />
          )
        ) : null}
      </Card>

      <WeekChartCard plan={plan} logs={logs} today={today} />

      <MilestonesCard plan={plan} newIds={newMilestones} />

      <PlanDetailsCard plan={plan} segment={segment} logs={logs} />

      <SectionHeader title={MANAGE_TITLE} />
      <Card style={styles.group}>
        <ActionRow icon="clock" {...MANAGE_ACTIONS.pace} onPress={() => onManage('pace')} chevron />
        <ActionRow icon="history" {...MANAGE_ACTIONS.revise} onPress={() => onManage('revise')} chevron />
        {paused ? (
          <ActionRow icon="play" {...MANAGE_ACTIONS.resume} onPress={() => onManage('resume')} />
        ) : (
          <ActionRow icon="pause" {...MANAGE_ACTIONS.pause} onPress={() => onManage('pause')} />
        )}
        <ActionRow icon="undo" {...MANAGE_ACTIONS.restart} onPress={() => onManage('restart')} />
        <ActionRow icon="close" {...MANAGE_ACTIONS.end} onPress={() => onManage('end')} last />
      </Card>
    </>
  );
}

/** The current calendar week only, like the free Insights overview; past weeks stay where Insights puts them. */
function WeekChartCard({ plan, logs, today }: { plan: PlanRecord; logs: readonly PuffLog[]; today: DayKey }) {
  const days = weekChartDays(plan, logs, chartWeekStart(today), today);
  const summary = summarizeDays(days);
  const averages = averagesLine(summary);

  return (
    <>
      <SectionHeader title={WEEK_CHART_TITLE} />
      <Card style={styles.card}>
        <BarChart data={planBars(days, today)} accessibilityTitle={WEEK_CHART_SPOKEN_TITLE} />
        <ChartLegend />
        <AppText variant="caption">{WEEK_CHART_CAPTION}</AppText>
        <AppText variant="bodySmall" color={colors.textPrimary}>
          {weekSummaryLine(summary)}
        </AppText>
        {averages ? <AppText variant="bodySmall">{averages}</AppText> : null}
      </Card>
    </>
  );
}

/** Shapes, not just colors, tell the three apart. The chart's spoken description covers the same ground. */
export function ChartLegend() {
  return (
    <View style={styles.legend} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
      <View style={styles.legendItem}>
        <View style={styles.legendBar} />
        <AppText variant="caption">{CHART_LEGEND.logged}</AppText>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.legendLine} />
        <AppText variant="caption">{CHART_LEGEND.target}</AppText>
      </View>
      <View style={styles.legendItem}>
        <View style={styles.legendDashed} />
        <AppText variant="caption">{CHART_LEGEND.untracked}</AppText>
      </View>
    </View>
  );
}

/** Earned milestones only, oldest first. Ones earned since the last visit carry a "New" badge. */
export function MilestonesCard({ plan, newIds }: { plan: PlanRecord; newIds: readonly MilestoneId[] }) {
  const milestones = earnedMilestones(plan);
  return (
    <>
      <SectionHeader title={MILESTONES_TITLE} />
      <Card style={styles.card}>
        {milestones.length === 0 ? <AppText variant="bodySmall">{MILESTONES_EMPTY}</AppText> : null}
        {milestones.map((milestone, index) => {
          const isNew = newIds.includes(milestone.id);
          const reached = reachedOnLine(longDay(milestone.reachedOn));
          return (
            <View
              key={milestone.id}
              style={[styles.milestone, index < milestones.length - 1 && styles.divider]}
              accessible
              accessibilityLabel={spokenSentences([isNew ? NEW_MILESTONE_BADGE : null, milestone.title, milestone.detail, reached])}
            >
              <View style={styles.milestoneIcon}>
                <Icon name="heart" size={18} color={colors.deepOcean} strokeWidth={1.9} />
              </View>
              <View style={styles.flex}>
                {isNew ? <Badge label={NEW_MILESTONE_BADGE} /> : null}
                <AppText variant="label" style={styles.bold}>
                  {milestone.title}
                </AppText>
                <AppText variant="bodySmall">{milestone.detail}</AppText>
                <AppText variant="caption">{reached}</AppText>
              </View>
            </View>
          );
        })}
      </Card>
    </>
  );
}

function PlanDetailsCard({ plan, segment, logs }: { plan: PlanRecord; segment: PlanSegment; logs: readonly PuffLog[] }) {
  const start = planStartDay(plan);
  const provenance = baselineProvenance(plan, logs);
  return (
    <>
      <SectionHeader title={PLAN_DETAILS_TITLE} />
      <Card style={styles.card}>
        <Detail label="Goal" value={GOAL_COPY[segment.goal].label} />
        {start ? <Detail label="Started" value={longDay(start)} /> : null}
        <Detail label="Pace" value={paceLabel(segment.pace.preset, segment.pace.percent)} />
        <Detail label="Daily target" value={settleDetail(segment.goal, segment.settleAt)} />
        {provenance ? (
          <View style={styles.detailBlock} accessible accessibilityLabel={`Starting level: ${startingLevel(provenance.perDay)}. ${BASELINE_SOURCE_LABEL[provenance.source]}. ${baselineProvenanceNote(provenance.source, provenance.checkable, longDay(provenance.since))}`}>
            <Detail label="Starting level" value={startingLevel(provenance.perDay)} />
            <AppText variant="label" color={colors.textPrimary}>
              {BASELINE_SOURCE_LABEL[provenance.source]}
            </AppText>
            <AppText variant="caption">{baselineProvenanceNote(provenance.source, provenance.checkable, longDay(provenance.since))}</AppText>
          </View>
        ) : null}
      </Card>
    </>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="bodySmall" style={styles.detailLabel}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={styles.detailValue}>
        {value}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontFamily: fontFamilies.bold },
  pressed: { opacity: 0.7 },
  card: { gap: spacing.md },
  group: { paddingVertical: spacing.xs },
  todayRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mascot: { width: 56, height: 56 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing.lg, rowGap: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendBar: { width: 10, height: 14, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: colors.oceanBlue },
  legendLine: { width: 16, height: 2.5, borderRadius: 2, backgroundColor: colors.deepOcean },
  legendDashed: { width: 16, height: 4, borderRadius: 2, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.borderStrong },
  milestone: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingBottom: spacing.md },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  milestoneIcon: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.skyBlue, alignItems: 'center', justifyContent: 'center' },
  detail: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', columnGap: spacing.md },
  detailLabel: { flexShrink: 0 },
  detailValue: { flexShrink: 1, textAlign: 'right' },
  detailBlock: { gap: spacing.xs, paddingTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong },
});
