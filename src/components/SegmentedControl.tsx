import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fontFamilies, radii, spacing } from '../theme';
import { AppText } from './AppText';

type Option<T extends string> = { value: T; label: string };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  variant = 'pill',
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `underline` is for switching between sections, `pill` for filtering within one. */
  variant?: 'pill' | 'underline';
}) {
  const underline = variant === 'underline';
  return (
    <View style={underline ? styles.underlineTrack : styles.track} accessibilityRole="tablist">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            aria-selected={selected}
            onPress={() => onChange(option.value)}
            style={
              underline
                ? [styles.underlineSegment, selected && styles.underlineSelected]
                : [styles.segment, selected && styles.selected]
            }
          >
            <AppText
              variant={underline ? 'bodyStrong' : 'label'}
              color={selected ? (underline ? colors.textPrimary : colors.coralInk) : colors.textMuted}
              style={selected ? styles.selectedText : undefined}
            >
              {option.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.white,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 3,
  },
  segment: {
    flex: 1,
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.md,
  },
  selected: { backgroundColor: colors.peach, borderWidth: 1, borderColor: colors.coralPink },
  selectedText: { fontFamily: fontFamilies.bold },
  underlineTrack: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
  },
  underlineSegment: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
    marginBottom: -StyleSheet.hairlineWidth,
  },
  underlineSelected: { borderBottomColor: colors.coralDeep },
});
