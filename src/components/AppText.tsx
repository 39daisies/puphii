import React from 'react';
import { Text, TextProps } from 'react-native';
import { maxFontScale, TextVariant, textStyles } from '../theme';

type Props = TextProps & {
  variant?: TextVariant;
  color?: string;
  align?: 'left' | 'center' | 'right';
};

export function AppText({ variant = 'body', color, align, style, maxFontSizeMultiplier, ...rest }: Props) {
  return (
    <Text
      {...rest}
      maxFontSizeMultiplier={maxFontSizeMultiplier ?? maxFontScale[variant]}
      style={[textStyles[variant], color ? { color } : null, align ? { textAlign: align } : null, style]}
    />
  );
}
