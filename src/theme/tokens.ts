import { Platform, ViewStyle } from 'react-native';

/** Approved Puphii palette. */
export const palette = {
  skyBlue: '#E8F6FF',
  oceanBlue: '#BFE6F7',
  seafoam: '#A8DCCC',
  deepOcean: '#176B91',
  coralPink: '#FFB7A7',
  peach: '#FFD6CC',
  warmCream: '#FFFDF6',
} as const;

/**
 * Semantic colors. Derived shades exist only where the palette value cannot meet
 * WCAG contrast on its own: `coralDeep` carries white bold button text (>= 3:1),
 * `coralInk` is coral-family text on cream/peach (>= 4.5:1).
 */
export const colors = {
  ...palette,
  coralDeep: '#E06A57',
  coralDeepPressed: '#CF5B48',
  coralInk: '#A8402F',
  textPrimary: palette.deepOcean,
  textMuted: '#4A7489',
  textOnCoral: '#FFFFFF',
  white: '#FFFFFF',
  surface: palette.warmCream,
  surfaceGlass: 'rgba(255, 253, 246, 0.82)',
  border: '#D3EAF5',
  borderStrong: '#A9CFE1',
  divider: '#E3F1F8',
  disabled: '#9DB8C6',
  shadowOcean: '#3E7FA0',
  scrim: 'rgba(16, 52, 74, 0.38)',
  danger: '#B3412F',
} as const;

export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  pill: 999,
} as const;

/** Minimum touch target per platform accessibility guidance. */
export const TOUCH_TARGET = 44;

/** Screens stay phone-width on tablets and the web. */
export const MAX_CONTENT_WIDTH = 440;

function shadow(color: string, opacity: number, radius: number, offsetY: number, elevation: number): ViewStyle {
  return Platform.select<ViewStyle>({
    android: { elevation, shadowColor: color },
    default: {
      shadowColor: color,
      shadowOpacity: opacity,
      shadowRadius: radius,
      shadowOffset: { width: 0, height: offsetY },
    },
  });
}

export const shadows = {
  card: shadow(colors.shadowOcean, 0.14, 16, 6, 3),
  soft: shadow(colors.shadowOcean, 0.1, 10, 3, 2),
  button: shadow(colors.coralDeep, 0.35, 14, 6, 5),
} as const;
