import React from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { colors, spacing } from '../theme';
import { AppText } from './AppText';
import { Icon, IconName } from './Icon';

function RowIcon({ name }: { name: IconName }) {
  return (
    <View style={styles.iconWrap}>
      <Icon name={name} size={20} color={colors.deepOcean} strokeWidth={1.9} />
    </View>
  );
}

export function NavRow({
  icon,
  label,
  detail,
  onPress,
  last,
}: {
  icon: IconName;
  label: string;
  detail?: string;
  onPress: () => void;
  last?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, !last && styles.divider, pressed && styles.pressed]}
    >
      <RowIcon name={icon} />
      <AppText variant="label" style={styles.label}>
        {label}
      </AppText>
      {detail ? <AppText variant="bodySmall">{detail}</AppText> : null}
      <Icon name="chevronRight" size={20} color={colors.textMuted} />
    </Pressable>
  );
}

export function ToggleRow({
  icon,
  label,
  description,
  value,
  onValueChange,
  disabled,
  last,
}: {
  icon: IconName;
  label: string;
  description?: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <RowIcon name={icon} />
      <View style={styles.label}>
        <AppText variant="label">{label}</AppText>
        {description ? <AppText variant="bodySmall">{description}</AppText> : null}
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: '#C9DEE8', true: colors.coralDeep }}
        thumbColor={colors.white}
        {...({ activeThumbColor: colors.white } as object)}
        ios_backgroundColor="#C9DEE8"
      />
    </View>
  );
}

export function SectionHeader({ title, caption }: { title: string; caption?: string }) {
  return (
    <View style={styles.section}>
      <AppText variant="sectionTitle" accessibilityRole="header">
        {title}
      </AppText>
      {caption ? <AppText variant="bodySmall">{caption}</AppText> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 56, paddingVertical: spacing.sm },
  divider: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.borderStrong },
  pressed: { opacity: 0.6 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.skyBlue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { flex: 1 },
  section: { marginTop: spacing.xxl, marginBottom: spacing.md, gap: 2 },
});
