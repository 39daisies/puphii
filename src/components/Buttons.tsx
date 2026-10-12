import React, { useState } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, radii, shadows, spacing, TOUCH_TARGET } from '../theme';
import { AppText } from './AppText';
import { Icon, IconName } from './Icon';

type BaseProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
};

const PRIMARY_HEIGHT = 64;

export function PrimaryButton({ label, onPress, disabled, accessibilityLabel, accessibilityHint, style }: BaseProps) {
  const [width, setWidth] = useState(0);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.primary, shadows.button, pressed && styles.primaryPressed, disabled && styles.disabled, style]}
    >
      {({ pressed }) => (
        <>
          {/* Percentage sizes render too narrow on iOS, and an SVG that receives touches swallows the press. */}
          <View
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
          >
            {width > 0 ? (
              <Svg width={width} height={PRIMARY_HEIGHT}>
                <Defs>
                  <LinearGradient id="coralFill" x1="0" y1="0" x2="0" y2="1">
                    <Stop offset="0" stopColor={pressed ? colors.coralDeepPressed : '#E87A66'} />
                    <Stop offset="1" stopColor={pressed ? '#C34F3C' : '#D9604C'} />
                  </LinearGradient>
                </Defs>
                <Rect x={0} y={0} width={width} height={PRIMARY_HEIGHT} rx={PRIMARY_HEIGHT / 2} fill="url(#coralFill)" />
                <Rect
                  x={1.5}
                  y={1.5}
                  width={width - 3}
                  height={PRIMARY_HEIGHT - 3}
                  rx={PRIMARY_HEIGHT / 2 - 1.5}
                  fill="none"
                  stroke={colors.coralPink}
                  strokeWidth={2}
                />
              </Svg>
            ) : null}
          </View>
          <AppText variant="button" align="center">
            {label}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

type SecondaryProps = BaseProps & { icon?: IconName };

export function SecondaryButton({ label, onPress, disabled, icon, accessibilityLabel, accessibilityHint, style }: SecondaryProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.secondary, shadows.soft, pressed && styles.secondaryPressed, disabled && styles.disabled, style]}
    >
      {icon ? <Icon name={icon} size={20} color={colors.textPrimary} strokeWidth={2.1} /> : null}
      <AppText variant="buttonSecondary">{label}</AppText>
    </Pressable>
  );
}

type DialogButtonProps = BaseProps & { tone?: 'neutral' | 'primary' | 'destructive' | 'destructiveOutline' };

const DIALOG_TONES = {
  neutral: { container: { backgroundColor: colors.skyBlue, borderWidth: 1.5, borderColor: colors.oceanBlue }, text: colors.textPrimary },
  primary: { container: { backgroundColor: colors.deepOcean }, text: colors.white },
  destructive: { container: { backgroundColor: colors.danger }, text: colors.white },
  destructiveOutline: { container: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.danger }, text: colors.danger },
} as const;

export function DialogButton({ label, onPress, tone = 'neutral', style }: DialogButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.dialogButton, DIALOG_TONES[tone].container, pressed && { opacity: 0.85 }, style]}
    >
      <AppText variant="label" color={DIALOG_TONES[tone].text} align="center">
        {label}
      </AppText>
    </Pressable>
  );
}

export function IconButton({
  icon,
  onPress,
  accessibilityLabel,
  color = colors.textPrimary,
  size = 26,
  style,
}: {
  icon: IconName;
  onPress: () => void;
  accessibilityLabel: string;
  color?: string;
  size?: number;
  style?: ViewStyle;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.6 }, style]}
    >
      <View pointerEvents="none">
        <Icon name={icon} size={size} color={color} strokeWidth={2} />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  primary: {
    height: PRIMARY_HEIGHT,
    borderRadius: PRIMARY_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xxl,
    backgroundColor: colors.coralDeep,
    overflow: 'visible',
  },
  primaryPressed: { transform: [{ scale: 0.98 }] },
  disabled: { opacity: 0.5 },
  secondary: {
    minHeight: 52,
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surfaceGlass,
    borderWidth: 1.5,
    borderColor: colors.oceanBlue,
  },
  secondaryPressed: { backgroundColor: colors.skyBlue },
  dialogButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  iconButton: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
