import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { PrimaryButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { SectionHeader } from '../../components/SettingsRows';
import { PlanRevision } from '../../plan/actions';
import {
  CURRENT_TARGET_LABEL,
  DAILY_TARGET_FROM_TODAY,
  fromTodayLine,
  KEPT_ON_CHANGE,
  NO_FURTHER_CHANGES,
  PACE_SETTLED_NOTE,
  PACE_TITLE,
  paceLabel,
  PAUSED_PREVIEW_NOTE,
  perDay,
  PREVIEW_CAVEAT,
  PREVIEW_TITLE,
  REVISE_NOTE,
  SAVE_CHANGES_LABEL,
  SETTLE_HINT,
  SETTLE_TITLE,
  upcomingChangeLine,
} from '../../plan/copy';
import { DayKey } from '../../plan/days';
import { BASELINE_LIMITS, Pace, PlanSegment } from '../../plan/model';
import { revisionPreview, settleLimits } from '../../plan/view';
import { colors, spacing } from '../../theme';
import { PaceChooser, Stepper } from './controls';
import { longDay } from './planBars';

type EditorProps = {
  segment: PlanSegment;
  /** Today's scheduled target, which a change continues from. */
  currentTarget: number;
  today: DayKey;
  paused: boolean;
  onSave: (revision: PlanRevision) => void;
};

/** A new pace from today. The target continues from where it is, so nothing jumps. */
export function PaceEditor({ segment, currentTarget, today, paused, onSave }: EditorProps) {
  const [pace, setPace] = useState<Pace>(segment.pace);
  const settled = segment.goal === 'reduce' && currentTarget <= segment.settleAt;
  const changed = pace.preset !== segment.pace.preset || pace.percent !== segment.pace.percent;

  return (
    <>
      <AppText variant="bodySmall">{REVISE_NOTE}</AppText>
      <SectionHeader title={PACE_TITLE} caption={`Now: ${paceLabel(segment.pace.preset, segment.pace.percent)}`} />
      <PaceChooser pace={pace} onChange={setPace} baselinePerDay={segment.baselinePerDay} />
      {settled ? (
        <Note text={PACE_SETTLED_NOTE} />
      ) : (
        <ChangePreview
          schedule={{ baselinePerDay: segment.baselinePerDay, pace, startTarget: currentTarget, settleAt: segment.settleAt }}
          today={today}
          paused={paused}
        />
      )}
      <PrimaryButton label={SAVE_CHANGES_LABEL} onPress={() => onSave({ pace })} disabled={!changed || settled} accessibilityHint={KEPT_ON_CHANGE} style={styles.save} />
    </>
  );
}

/** A new daily target and, when cutting down, a new settle level, from today. */
export function ReviseEditor({ segment, currentTarget, today, paused, onSave }: EditorProps) {
  const reduce = segment.goal === 'reduce';
  const [target, setTarget] = useState(currentTarget);
  const [settle, setSettle] = useState(segment.settleAt);
  const limits = settleLimits(target);
  const settleAt = reduce ? Math.min(limits.max, settle) : 0;
  const changed = target !== currentTarget || settleAt !== segment.settleAt;
  const valid = !reduce || settleAt < target;

  return (
    <>
      <AppText variant="bodySmall">{REVISE_NOTE}</AppText>
      <Card style={[styles.card, styles.spaced]}>
        <AppText variant="bodySmall" color={colors.textPrimary}>
          {CURRENT_TARGET_LABEL}: {perDay(currentTarget)}
        </AppText>
        <Stepper
          label={DAILY_TARGET_FROM_TODAY}
          value={target}
          min={reduce ? 1 : 0}
          max={BASELINE_LIMITS.max}
          onChange={setTarget}
          format={perDay}
        />
        {reduce ? (
          <Stepper label={SETTLE_TITLE} hint={SETTLE_HINT} value={settleAt} min={limits.min} max={limits.max} onChange={setSettle} format={perDay} />
        ) : null}
      </Card>
      <ChangePreview schedule={{ baselinePerDay: segment.baselinePerDay, pace: segment.pace, startTarget: target, settleAt }} today={today} paused={paused} />
      <PrimaryButton
        label={SAVE_CHANGES_LABEL}
        onPress={() => onSave(reduce ? { target, settleAt } : { target })}
        disabled={!changed || !valid}
        accessibilityHint={KEPT_ON_CHANGE}
        style={styles.save}
      />
    </>
  );
}

function ChangePreview({ schedule, today, paused }: { schedule: Parameters<typeof revisionPreview>[0]; today: DayKey; paused: boolean }) {
  const preview = revisionPreview(schedule, today);
  return (
    <>
      <SectionHeader title={PREVIEW_TITLE} />
      <Card style={styles.card}>
        <View style={styles.rows} accessibilityRole="list">
          <Row text={fromTodayLine(preview.today)} />
          {preview.changes.map((change) => (
            <Row key={change.day} text={upcomingChangeLine(longDay(change.day), change.target)} />
          ))}
        </View>
        {preview.changes.length === 0 ? <AppText variant="bodySmall">{NO_FURTHER_CHANGES}</AppText> : null}
        {paused ? <AppText variant="caption">{PAUSED_PREVIEW_NOTE}</AppText> : null}
        <AppText variant="caption">{PREVIEW_CAVEAT}</AppText>
      </Card>
    </>
  );
}

function Row({ text }: { text: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={text}>
      <AppText variant="label">{text}</AppText>
    </View>
  );
}

function Note({ text }: { text: string }) {
  return (
    <View style={styles.note}>
      <Icon name="info" size={18} color={colors.textMuted} />
      <AppText variant="bodySmall" style={styles.flex}>
        {text}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: spacing.md },
  spaced: { marginTop: spacing.lg },
  rows: { gap: spacing.xs },
  row: { minHeight: 40, justifyContent: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: 10, backgroundColor: colors.skyBlue },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  save: { marginTop: spacing.xxl },
});
