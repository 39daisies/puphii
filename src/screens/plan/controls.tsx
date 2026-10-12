import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { Icon, IconName } from '../../components/Icon';
import { CUSTOM_PACE_HINT, PACE_DISCLAIMER, PACE_LABELS, paceDescription, perDay, previewRowLabel, spokenSentences } from '../../plan/copy';
import { CUSTOM_PACE_LIMITS, Pace, PACE_PRESETS, PacePreset } from '../../plan/model';
import { PreviewRow } from '../../plan/view';
import { colors, fontFamilies, radii, spacing, TOUCH_TARGET } from '../../theme';

/** A selectable card in a radio group: title, description and an optional detail line. */
export function ChoiceCard({
  title,
  description,
  detail,
  selected,
  onPress,
}: {
  title: string;
  description?: string;
  detail?: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={spokenSentences([title, description, detail])}
      onPress={onPress}
      style={({ pressed }) => [styles.choice, selected && styles.selected, pressed && styles.pressed]}
    >
      <View style={styles.flex}>
        <AppText variant="cardTitle" style={styles.bold} color={selected ? colors.textPrimaryStrong : colors.textPrimary}>
          {title}
        </AppText>
        {description ? (
          <AppText variant="bodySmall" color={selected ? colors.textMutedStrong : undefined}>
            {description}
          </AppText>
        ) : null}
        {detail ? (
          <AppText variant="label" color={selected ? colors.textPrimaryStrong : colors.textPrimary} style={styles.detail}>
            {detail}
          </AppText>
        ) : null}
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <Icon name="check" size={16} color={colors.white} strokeWidth={2.6} /> : null}
      </View>
    </Pressable>
  );
}

/** A whole-number stepper with 44-point buttons and a spoken value. */
export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  format = (current) => String(current),
  hint,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  format?: (value: number) => string;
  hint?: string;
}) {
  const text = format(value);
  return (
    <View style={styles.stepperBlock}>
      <AppText variant="label">{label}</AppText>
      {hint ? <AppText variant="bodySmall">{hint}</AppText> : null}
      <View style={styles.stepper}>
        <StepButton symbol="−" label={`Decrease ${label.toLowerCase()}`} disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} />
        <View style={styles.stepperValue} accessible accessibilityLiveRegion="polite" accessibilityLabel={`${label}: ${text}`}>
          <AppText variant="sectionTitle" align="center">
            {text}
          </AppText>
        </View>
        <StepButton symbol="+" label={`Increase ${label.toLowerCase()}`} disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} />
      </View>
    </View>
  );
}

function StepButton({ symbol, label, disabled, onPress }: { symbol: string; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.step, disabled && styles.stepDisabled, pressed && styles.pressed]}
    >
      <AppText variant="sectionTitle" align="center" style={styles.stepText}>
        {symbol}
      </AppText>
    </Pressable>
  );
}

const PRESETS: PacePreset[] = ['gentle', 'steady', 'faster', 'custom'];
const DEFAULT_CUSTOM_PERCENT = 8;

/** Gentle, Steady, Faster or Custom, with what the chosen pace means for this baseline. */
export function PaceChooser({ pace, onChange, baselinePerDay }: { pace: Pace; onChange: (pace: Pace) => void; baselinePerDay: number | null }) {
  return (
    <View style={styles.gap}>
      <View style={styles.paceGrid} accessibilityRole="radiogroup" accessibilityLabel="Pace">
        {PRESETS.map((preset) => {
          const selected = pace.preset === preset;
          const percent = preset === 'custom' ? (selected ? pace.percent : null) : PACE_PRESETS[preset];
          return (
            <Pressable
              key={preset}
              accessibilityRole="radio"
              aria-checked={selected}
              accessibilityLabel={`${PACE_LABELS[preset]}${percent !== null ? `, ${percent}% a week` : ', choose your own percentage'}`}
              onPress={() =>
                onChange(preset === 'custom' ? { preset, percent: pace.preset === 'custom' ? pace.percent : DEFAULT_CUSTOM_PERCENT } : { preset, percent: PACE_PRESETS[preset] })
              }
              style={({ pressed }) => [styles.paceChip, selected && styles.selected, pressed && styles.pressed]}
            >
              <AppText variant="label" align="center" style={selected ? styles.bold : undefined} color={selected ? colors.coralInk : colors.textPrimary}>
                {PACE_LABELS[preset]}
              </AppText>
              <AppText variant="caption" align="center" color={selected ? colors.textMutedStrong : undefined}>
                {percent !== null ? `${percent}% a week` : 'Your choice'}
              </AppText>
            </Pressable>
          );
        })}
      </View>
      {pace.preset === 'custom' ? (
        <Stepper
          label="Custom pace"
          hint={CUSTOM_PACE_HINT}
          value={pace.percent}
          min={CUSTOM_PACE_LIMITS.min}
          max={CUSTOM_PACE_LIMITS.max}
          onChange={(percent) => onChange({ preset: 'custom', percent })}
          format={(percent) => `${percent}% a week`}
        />
      ) : null}
      {baselinePerDay !== null ? (
        <AppText variant="bodySmall" color={colors.textPrimary}>
          {paceDescription(baselinePerDay, pace.percent)}
        </AppText>
      ) : null}
      <View style={styles.note}>
        <Icon name="info" size={18} color={colors.textMuted} />
        <AppText variant="caption" style={styles.flex}>
          {PACE_DISCLAIMER}
        </AppText>
      </View>
    </View>
  );
}

/** Week-by-week targets for a new plan, read out as a list. */
export function PreviewRows({ rows }: { rows: readonly PreviewRow[] }) {
  return (
    <View style={styles.rows} accessibilityRole="list">
      {rows.map((row) => {
        const label = previewRowLabel(row.week, row.settles);
        return (
          <View key={row.week} style={[styles.row, row.settles && styles.rowSettles]} accessible accessibilityLabel={`${label}: daily target ${row.target}`}>
            <AppText variant="label" style={styles.flex}>
              {label}
            </AppText>
            <AppText variant="bodyStrong">{perDay(row.target)}</AppText>
          </View>
        );
      })}
    </View>
  );
}

/** A plan action in a list: icon, label and what it does. */
export function ActionRow({
  icon,
  label,
  detail,
  onPress,
  last,
  chevron,
}: {
  icon: IconName;
  label: string;
  detail: string;
  onPress: () => void;
  last?: boolean;
  chevron?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={detail}
      onPress={onPress}
      style={({ pressed }) => [styles.action, !last && styles.divider, pressed && styles.pressed]}
    >
      <View style={styles.actionIcon}>
        <Icon name={icon} size={20} color={colors.deepOcean} strokeWidth={1.9} />
      </View>
      <View style={styles.flex}>
        <AppText variant="label">{label}</AppText>
        <AppText variant="bodySmall">{detail}</AppText>
      </View>
      {chevron ? <Icon name="chevronRight" size={20} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

/** A small text badge, such as "New". Text, not color, carries the meaning. */
export function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <AppText variant="caption" color={colors.coralInk} style={styles.bold}>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  bold: { fontFamily: fontFamilies.bold },
  gap: { gap: spacing.md },
  pressed: { opacity: 0.8 },
  choice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 64,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  selected: { backgroundColor: colors.peach, borderColor: colors.coralPink },
  detail: { marginTop: spacing.xs },
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
  radioSelected: { backgroundColor: colors.coralInk, borderColor: colors.coralInk },
  stepperBlock: { gap: spacing.xs },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.xs },
  stepperValue: { flex: 1 },
  step: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.oceanBlue,
  },
  stepDisabled: { opacity: 0.35 },
  stepText: { lineHeight: 26 },
  paceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  paceChip: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: 56,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  note: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  rows: { gap: spacing.xs },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: colors.skyBlue,
  },
  rowSettles: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.seafoam },
  action: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 64, paddingVertical: spacing.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  actionIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.skyBlue, alignItems: 'center', justifyContent: 'center' },
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xxs,
    borderRadius: radii.pill,
    backgroundColor: colors.peach,
    borderWidth: 1,
    borderColor: colors.coralPink,
  },
});
