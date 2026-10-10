import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { parseNumberInput } from '../data/savings';
import { colors, fontFamilies, radii, spacing } from '../theme';
import { AppText } from './AppText';

const toText = (value: number | null) => (value == null ? '' : String(value));

type NumberFieldProps = {
  label: string;
  value: number | null;
  /** Receives a valid number, or null when the field is empty or its text can't be used. */
  onChange: (value: number | null) => void;
  /** Returns a message when a parsed number is out of range. */
  validate: (value: number) => string | null;
  suffix?: string;
  integer?: boolean;
};

export function NumberField({ label, value, onChange, validate, suffix, integer }: NumberFieldProps) {
  const [text, setText] = useState(() => toText(value));
  const [error, setError] = useState<string | null>(null);
  const committed = useRef(value);

  // A change from outside (such as a reset) replaces whatever was being typed.
  useEffect(() => {
    if (value === committed.current) return;
    committed.current = value;
    setText(toText(value));
    setError(null);
  }, [value]);

  const commit = (next: number | null) => {
    committed.current = next;
    onChange(next);
  };

  const onChangeText = (next: string) => {
    setText(next);
    const parsed = parseNumberInput(next);
    if (parsed.kind === 'empty') {
      setError(null);
      commit(null);
    } else if (parsed.kind === 'invalid') {
      setError('Use digits and at most one decimal point.');
      commit(null);
    } else {
      const problem = validate(parsed.value);
      setError(problem);
      commit(problem ? null : parsed.value);
    }
  };

  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <View style={[styles.box, error ? styles.boxError : null]}>
        <TextInput
          value={text}
          onChangeText={onChangeText}
          accessibilityLabel={label}
          accessibilityHint={error ?? undefined}
          aria-invalid={!!error}
          keyboardType={integer ? 'number-pad' : 'decimal-pad'}
          inputMode={integer ? 'numeric' : 'decimal'}
          returnKeyType="done"
          maxLength={18}
          style={styles.input}
          placeholderTextColor={colors.disabled}
        />
        {suffix ? (
          <AppText variant="label" color={colors.textMuted} style={styles.suffix}>
            {suffix}
          </AppText>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" color={colors.danger} accessibilityLiveRegion="polite">
          {error}
        </AppText>
      ) : null}
    </View>
  );
}

type TextFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength: number;
};

export function TextField({ label, value, onChange, placeholder, maxLength }: TextFieldProps) {
  return (
    <View style={styles.field}>
      <AppText variant="label">{label}</AppText>
      <View style={styles.box}>
        <TextInput
          value={value}
          onChangeText={onChange}
          accessibilityLabel={label}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          maxLength={maxLength}
          returnKeyType="done"
          style={styles.input}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.xs },
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.white,
    paddingHorizontal: spacing.md,
  },
  boxError: { borderColor: colors.danger },
  // 16px keeps iOS Safari from zooming into the field on focus.
  input: {
    flex: 1,
    minWidth: 0,
    minHeight: 44,
    fontFamily: fontFamilies.medium,
    fontSize: 16,
    color: colors.textPrimary,
    paddingVertical: spacing.sm,
  },
  suffix: { marginLeft: spacing.sm },
});
