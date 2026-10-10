import { TextStyle } from 'react-native';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_800ExtraBold,
} from '@expo-google-fonts/inter';
import { colors } from './tokens';

/**
 * Font family names registered with expo-font. Every text style references one of
 * these explicitly; `fontWeight` is never combined with a custom family because
 * Android would otherwise fall back to a synthesized or system face.
 */
export const fontFamilies = {
  display: 'Fraunces-BlackSoft',
  regular: 'Inter-Regular',
  medium: 'Inter-Medium',
  semibold: 'Inter-SemiBold',
  bold: 'Inter-Bold',
  extrabold: 'Inter-ExtraBold',
} as const;

export const fontAssets = {
  // Fraunces wght 900 (Black), SOFT 100, WONK 0, opsz 72: the Cooper Black-style instance.
  [fontFamilies.display]: require('../../assets/fonts/Fraunces-BlackSoft.ttf'),
  [fontFamilies.regular]: Inter_400Regular,
  [fontFamilies.medium]: Inter_500Medium,
  [fontFamilies.semibold]: Inter_600SemiBold,
  [fontFamilies.bold]: Inter_700Bold,
  [fontFamilies.extrabold]: Inter_800ExtraBold,
};

const display = (fontSize: number, lineHeight: number, letterSpacing = 0): TextStyle => ({
  fontFamily: fontFamilies.display,
  fontSize,
  lineHeight,
  letterSpacing,
  color: colors.textPrimary,
});

const inter = (
  family: keyof typeof fontFamilies,
  fontSize: number,
  lineHeight: number,
  letterSpacing = 0,
  color: string = colors.textPrimary,
): TextStyle => ({ fontFamily: fontFamilies[family], fontSize, lineHeight, letterSpacing, color });

export const textStyles = {
  // Display (Fraunces Black)
  wordmark: display(36, 42, -0.4),
  screenTitle: display(30, 36, -0.3),
  count: display(64, 70, -1),
  headline: display(22, 28, -0.2),
  statValue: display(28, 32, -0.4),

  // UI (Inter)
  sectionTitle: inter('bold', 18, 24, -0.1),
  cardTitle: inter('semibold', 16, 21),
  body: inter('regular', 15, 22, 0, colors.textMuted),
  bodyStrong: inter('semibold', 15, 22),
  bodySmall: inter('regular', 13, 19, 0, colors.textMuted),
  caption: inter('medium', 12, 16, 0.1, colors.textMuted),
  overline: inter('bold', 11, 14, 1.2, colors.textMuted),
  button: inter('extrabold', 20, 24, 0.6, colors.textOnCoral),
  buttonSecondary: inter('semibold', 17, 22),
  label: inter('semibold', 15, 20),
  tab: inter('medium', 11, 14, 0.1, colors.textMuted),
  tabActive: inter('bold', 11, 14, 0.1, colors.coralInk),
  chartValue: inter('bold', 12, 15),
  chartLabel: inter('medium', 11, 14, 0, colors.textMuted),
  time: inter('semibold', 16, 20),
} as const satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof textStyles;

/** Upper bound for Dynamic Type scaling so layouts stay intact on large settings. */
export const maxFontScale: Record<TextVariant, number> = {
  wordmark: 1.15,
  screenTitle: 1.25,
  count: 1.2,
  headline: 1.3,
  statValue: 1.3,
  sectionTitle: 1.5,
  cardTitle: 1.5,
  body: 1.6,
  bodyStrong: 1.6,
  bodySmall: 1.6,
  caption: 1.5,
  overline: 1.4,
  button: 1.3,
  buttonSecondary: 1.4,
  label: 1.5,
  tab: 1.25,
  tabActive: 1.25,
  chartValue: 1.3,
  chartLabel: 1.3,
  time: 1.5,
};
