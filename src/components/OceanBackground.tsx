import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme';

type Variant = 'reef' | 'calm';

type BubbleProps = { cx: number; cy: number; r: number; tint?: string };

function Bubble({ cx, cy, r, tint = colors.white }: BubbleProps) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill="url(#bubbleFill)" stroke={tint} strokeOpacity={0.9} strokeWidth={1.2} />
      <Path
        d={`M${cx - r * 0.55} ${cy - r * 0.15} A${r * 0.6} ${r * 0.6} 0 0 1 ${cx - r * 0.1} ${cy - r * 0.58}`}
        stroke={colors.white}
        strokeWidth={Math.max(1.2, r * 0.16)}
        strokeLinecap="round"
        fill="none"
        opacity={0.95}
      />
    </G>
  );
}

export function Coral({ x, y, scale, color, flip = false }: { x: number; y: number; scale: number; color: string; flip?: boolean }) {
  const stroke = { stroke: color, strokeWidth: 11, strokeLinecap: 'round' as const, fill: 'none' };
  return (
    <G transform={`translate(${x} ${y}) scale(${flip ? -scale : scale} ${scale})`}>
      <Path d="M0 0 C2 -24 -3 -46 0 -74" {...stroke} />
      <Path d="M0 -26 C-14 -32 -22 -48 -25 -70" {...stroke} />
      <Path d="M-24 -62 C-34 -68 -38 -78 -40 -92" {...stroke} />
      <Path d="M1 -44 C15 -50 23 -62 25 -86" {...stroke} />
      <Path d="M24 -70 C32 -74 36 -80 38 -94" {...stroke} />
      <Path d="M0 -70 C-4 -82 -2 -94 -6 -106" {...stroke} />
    </G>
  );
}

export function Seaweed({ x, y, scale, color }: { x: number; y: number; scale: number; color: string }) {
  return (
    <G transform={`translate(${x} ${y}) scale(${scale})`}>
      <Path
        d="M0 0 C-10 -20 9 -40 0 -62 C-9 -84 7 -98 2 -118"
        stroke={color}
        strokeWidth={8}
        strokeLinecap="round"
        fill="none"
      />
      <Path d="M14 0 C6 -16 20 -30 13 -48 C7 -64 18 -74 15 -88" stroke={color} strokeWidth={7} strokeLinecap="round" fill="none" />
    </G>
  );
}

/** Decorative backdrop; hidden from assistive technology. */
export function OceanBackground({ variant = 'reef' }: { variant?: Variant }) {
  const { width: w, height: h } = useWindowDimensions();

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Svg width={w} height={h}>
        <Defs>
          <LinearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={variant === 'reef' ? colors.skyBlue : colors.warmCream} />
            <Stop offset="0.5" stopColor={variant === 'reef' ? '#D7F0FB' : colors.warmCream} />
            <Stop offset="1" stopColor={variant === 'reef' ? colors.oceanBlue : colors.warmCream} />
          </LinearGradient>
          <RadialGradient id="bubbleFill" cx="0.4" cy="0.35" r="0.65">
            <Stop offset="0" stopColor={colors.white} stopOpacity={0.15} />
            <Stop offset="0.75" stopColor={colors.white} stopOpacity={0.35} />
            <Stop offset="1" stopColor={colors.oceanBlue} stopOpacity={0.55} />
          </RadialGradient>
          <RadialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={colors.white} stopOpacity={0.75} />
            <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Rect x={0} y={0} width={w} height={h} fill="url(#sea)" />

        {variant === 'reef' ? (
          <>
            <Circle cx={w * 0.5} cy={h * 0.3} r={w * 0.48} fill="url(#glow)" />
            <Seaweed x={w * 0.03} y={h * 0.66} scale={1.05} color={colors.seafoam} />
            <Coral x={w * 0.11} y={h * 0.68} scale={1.1} color={colors.coralPink} />
            <Coral x={w * 0.2} y={h * 0.66} scale={0.6} color={colors.peach} flip />
            <Coral x={w * 0.9} y={h * 0.68} scale={1.15} color={colors.coralPink} flip />
            <Seaweed x={w * 0.95} y={h * 0.64} scale={0.9} color={colors.seafoam} />
            <Coral x={w * 0.8} y={h * 0.66} scale={0.55} color={colors.peach} />

            <Bubble cx={w * 0.1} cy={h * 0.16} r={13} />
            <Bubble cx={w * 0.17} cy={h * 0.25} r={7} />
            <Bubble cx={w * 0.08} cy={h * 0.38} r={18} />
            <Bubble cx={w * 0.88} cy={h * 0.2} r={9} />
            <Bubble cx={w * 0.93} cy={h * 0.33} r={15} />
            <Bubble cx={w * 0.84} cy={h * 0.44} r={6} />
          </>
        ) : (
          <>
            <Circle cx={w * 0.06} cy={h * 0.035} r={34} fill={colors.peach} opacity={0.55} />
            <Circle cx={w * 0.17} cy={h * 0.02} r={14} fill={colors.peach} opacity={0.45} />
            <Bubble cx={w * 0.92} cy={h * 0.07} r={12} tint={colors.oceanBlue} />
            <Bubble cx={w * 0.84} cy={h * 0.03} r={6} tint={colors.oceanBlue} />
          </>
        )}
      </Svg>
    </View>
  );
}
