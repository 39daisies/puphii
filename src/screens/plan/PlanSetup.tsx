import React, { useMemo, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Banner } from '../../components/Banner';
import { PrimaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { NumberField } from '../../components/Fields';
import { Icon } from '../../components/Icon';
import { SectionHeader } from '../../components/SettingsRows';
import { PlanActionResult } from '../../data/planController';
import { PuffLog } from '../../data/types';
import { PlanSettings } from '../../plan/actions';
import { baselineFromEstimate, baselineFromHistory } from '../../plan/baseline';
import {
  ADJUST_ANYTIME,
  BASELINE_SOURCE_LABEL,
  BASELINE_TITLE,
  baselineSummary,
  ESTIMATE_HINT,
  ESTIMATE_LABEL,
  GOAL_COPY,
  GOAL_QUESTION,
  PACE_TITLE,
  perDay,
  PLAN_ERROR_COPY,
  PLAN_INTRO,
  PLAN_TAGLINE,
  PREVIEW_CAVEAT,
  PREVIEW_TITLE,
  previousPlanNote,
  SETTLE_HINT,
  SETTLE_TITLE,
  settleLine,
  START_PLAN_LABEL,
  startingLevel,
  TRACK_ONLY_NOTE,
  USE_ESTIMATE_LABEL,
  USE_HISTORY_LABEL,
} from '../../plan/copy';
import { DayKey } from '../../plan/days';
import { MilestoneId, Pace, PACE_PRESETS, PLAN_GOALS, PlanGoal, PlanRecord } from '../../plan/model';
import { defaultSettleAt, lastPlanEnded, settleLimits, setupPreview } from '../../plan/view';
import { FACES } from '../../mascot/faces';
import { colors, spacing } from '../../theme';
import { ChoiceCard, PaceChooser, PreviewRows, Stepper } from './controls';
import { longDay } from './planBars';
import { MilestonesCard } from './PlanDashboard';

type Props = {
  plan: PlanRecord;
  logs: readonly PuffLog[];
  today: DayKey;
  /** Milestones acknowledged on this visit, still badged "New" while the page is open. */
  newMilestones: readonly MilestoneId[];
  onStart: (settings: PlanSettings) => PlanActionResult;
};

/** Setting up a plan, or choosing to just track. One scrolling page, no steps to get lost in. */
export function PlanSetup({ plan, logs, today, newMilestones, onStart }: Props) {
  const history = useMemo(() => baselineFromHistory(logs, plan.confirmedZeroDays, today), [logs, plan.confirmedZeroDays, today]);
  const [goal, setGoal] = useState<PlanGoal>('track');
  const [source, setSource] = useState<'history' | 'estimate'>(history.status === 'ok' ? 'history' : 'estimate');
  const [estimate, setEstimate] = useState<number | null>(null);
  const [pace, setPace] = useState<Pace>({ preset: 'steady', percent: PACE_PRESETS.steady });
  const [settle, setSettle] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const useHistory = source === 'history' && history.status === 'ok';
  const baselinePerDay = useHistory ? history.perDay : baselineFromEstimate(estimate);
  const startTarget = baselinePerDay === null ? null : Math.ceil(baselinePerDay);
  const settleAt = startTarget === null ? 0 : Math.min(settleLimits(startTarget).max, settle ?? defaultSettleAt(startTarget));
  const planning = goal === 'reduce' || goal === 'quit';
  const preview = planning && baselinePerDay !== null ? setupPreview({ goal, baselinePerDay, pace, settleAt }) : null;
  const ended = lastPlanEnded(plan);

  const start = () => {
    if (!planning || baselinePerDay === null) return;
    const result = onStart({ goal, baseline: { perDay: baselinePerDay, source: useHistory ? 'history' : 'estimate' }, pace, settleAt });
    setError(result.ok ? null : PLAN_ERROR_COPY[result.error]);
  };

  return (
    <>
      <View style={styles.intro}>
        <Image source={FACES.curious} style={styles.mascot} resizeMode="contain" accessible={false} />
        <View style={styles.flex}>
          <AppText variant="headline">{PLAN_TAGLINE}</AppText>
          <AppText variant="bodySmall">{PLAN_INTRO}</AppText>
        </View>
      </View>

      {ended ? (
        <View style={styles.spaced}>
          <Banner message={previousPlanNote(longDay(ended))} />
        </View>
      ) : null}

      <SectionHeader title={GOAL_QUESTION} />
      <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={GOAL_QUESTION}>
        {PLAN_GOALS.map((option) => (
          <ChoiceCard
            key={option}
            title={GOAL_COPY[option].label}
            description={GOAL_COPY[option].description}
            selected={goal === option}
            onPress={() => {
              setGoal(option);
              setError(null);
            }}
          />
        ))}
      </View>

      {!planning ? (
        <View style={styles.note}>
          <Icon name="info" size={18} color={colors.textMuted} />
          <AppText variant="bodySmall" style={styles.flex}>
            {TRACK_ONLY_NOTE}
          </AppText>
        </View>
      ) : (
        <>
          <SectionHeader title={BASELINE_TITLE} />
          <View style={styles.choices}>
            {history.status === 'ok' ? (
              <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={BASELINE_TITLE}>
                <ChoiceCard
                  title={USE_HISTORY_LABEL}
                  description={baselineSummary(history)}
                  detail={`${BASELINE_SOURCE_LABEL.history}: ${startingLevel(history.perDay)}`}
                  selected={source === 'history'}
                  onPress={() => setSource('history')}
                />
                <ChoiceCard title={USE_ESTIMATE_LABEL} selected={source === 'estimate'} onPress={() => setSource('estimate')} />
              </View>
            ) : (
              <AppText variant="bodySmall">{baselineSummary(history)}</AppText>
            )}
            {!useHistory ? (
              <Card style={styles.card}>
                <NumberField
                  label={ESTIMATE_LABEL}
                  value={estimate}
                  onChange={setEstimate}
                  validate={(value) => (baselineFromEstimate(value) === null ? PLAN_ERROR_COPY.invalidBaseline : null)}
                  suffix="a day"
                />
                <AppText variant="caption">{ESTIMATE_HINT}</AppText>
                {baselinePerDay !== null ? (
                  <AppText variant="label" accessibilityLiveRegion="polite">
                    {BASELINE_SOURCE_LABEL.estimate}: {startingLevel(baselinePerDay)}
                  </AppText>
                ) : null}
              </Card>
            ) : null}
          </View>

          <SectionHeader title={PACE_TITLE} />
          <PaceChooser pace={pace} onChange={setPace} baselinePerDay={baselinePerDay} />

          {goal === 'reduce' && startTarget !== null ? (
            <Card style={[styles.card, styles.spacedLarge]}>
              <Stepper
                label={SETTLE_TITLE}
                hint={SETTLE_HINT}
                value={settleAt}
                min={settleLimits(startTarget).min}
                max={settleLimits(startTarget).max}
                onChange={setSettle}
                format={perDay}
              />
            </Card>
          ) : null}

          {preview ? (
            <>
              <SectionHeader title={PREVIEW_TITLE} />
              <Card style={styles.card}>
                <PreviewRows rows={preview.rows} />
                <AppText variant="bodySmall" color={colors.textPrimary}>
                  {settleLine(preview.settleAt, preview.settleWeek)}
                </AppText>
                <AppText variant="caption">{PREVIEW_CAVEAT}</AppText>
              </Card>
            </>
          ) : null}

          {error ? (
            <View style={styles.spaced}>
              <Banner message={error} />
            </View>
          ) : null}
          <PrimaryButton
            label={START_PLAN_LABEL}
            onPress={start}
            disabled={baselinePerDay === null}
            accessibilityHint={baselinePerDay === null ? `Enter ${ESTIMATE_LABEL.toLowerCase()} first` : ADJUST_ANYTIME}
            style={styles.start}
          />
          <AppText variant="caption" align="center" style={styles.spacedSmall}>
            {ADJUST_ANYTIME}
          </AppText>
        </>
      )}

      {plan.milestones.length ? <MilestonesCard plan={plan} newIds={newMilestones} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  mascot: { width: 64, height: 64 },
  spaced: { marginTop: spacing.lg },
  spacedSmall: { marginTop: spacing.sm },
  spacedLarge: { marginTop: spacing.xxl },
  choices: { gap: spacing.sm },
  card: { gap: spacing.md },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.md },
  start: { marginTop: spacing.xxl },
});
