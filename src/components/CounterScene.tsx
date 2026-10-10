import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import { colors } from '../theme';
import { Coral, Seaweed } from './OceanBackground';

/**
 * A band from a gently waving top edge down to the bottom of the scene. The edge sits
 * at `left` under the count and rises to `right` under Puphii, so waves never reach
 * the digits even when the count is at its largest.
 */
function wavePath(width: number, height: number, left: number, right: number, amplitude: number, wavelength: number, phase: number) {
  const base = (x: number) => {
    const t = Math.min(1, Math.max(0, (x / width - 0.45) / 0.45));
    return left + (right - left) * t * t * (3 - 2 * t);
  };
  const y = (x: number) => (base(x) + amplitude * Math.sin((x / wavelength) * Math.PI * 2 + phase)).toFixed(1);
  let d = `M0 ${height} L0 ${y(0)}`;
  for (let x = 6; x < width; x += 6) d += ` L${x} ${y(x)}`;
  return `${d} L${width} ${y(width)} L${width} ${height} Z`;
}

function SceneBubble({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <G>
      <Circle cx={cx} cy={cy} r={r} fill={colors.white} fillOpacity={0.45} stroke={colors.oceanBlue} strokeWidth={1} />
      <Circle cx={cx - r * 0.35} cy={cy - r * 0.35} r={r * 0.28} fill={colors.white} />
    </G>
  );
}

/**
 * Pale, static underwater scenery for the counter card. Purely decorative: it sits
 * behind the card's content, never takes touches and is hidden from screen readers.
 * Scenery keeps to the corners and the bottom edge, clear of the count and Puphii.
 */
export const CounterScene = React.memo(function CounterScene({ width: w, height: h }: { width: number; height: number }) {
  if (!w || !h) return null;
  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      aria-hidden
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={w} height={h} accessible={false}>
        <Defs>
          <LinearGradient id="counterSceneWater" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.skyBlue} stopOpacity={0} />
            <Stop offset="0.42" stopColor={colors.skyBlue} stopOpacity={1} />
            <Stop offset="1" stopColor={colors.oceanBlue} stopOpacity={0.55} />
          </LinearGradient>
          <RadialGradient id="counterSceneGlow" cx="0.5" cy="0.5" r="0.5">
            <Stop offset="0" stopColor={colors.white} stopOpacity={0.7} />
            <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
          </RadialGradient>
          <LinearGradient id="counterSceneRay" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={colors.white} stopOpacity={0.5} />
            <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
          </LinearGradient>
        </Defs>

        <Rect x={0} y={0} width={w} height={h} fill="url(#counterSceneWater)" />
        <Circle cx={w * 0.7} cy={h * 0.3} r={w * 0.5} fill="url(#counterSceneGlow)" />
        <Path d={`M${w * 0.5} 0 L${w * 0.58} 0 L${w * 0.47} ${h} L${w * 0.36} ${h} Z`} fill="url(#counterSceneRay)" />
        <Path d={`M${w * 0.63} 0 L${w * 0.67} 0 L${w * 0.6} ${h} L${w * 0.54} ${h} Z`} fill="url(#counterSceneRay)" />

        <Path d={wavePath(w, h, h - 16, h - 44, 2.5, w * 0.5, 0.6)} fill={colors.oceanBlue} fillOpacity={0.4} />
        <Path d={wavePath(w, h, h - 10, h - 30, 2, w * 0.38, 2.1)} fill={colors.oceanBlue} fillOpacity={0.55} />

        <G opacity={0.6}>
          <Seaweed x={2} y={h - 4} scale={0.34} color={colors.seafoam} />
        </G>
        <G opacity={0.7}>
          <Seaweed x={w - 18} y={h - 6} scale={0.46} color={colors.seafoam} />
        </G>
        <G opacity={0.75}>
          <Coral x={w - 46} y={h - 8} scale={0.24} color={colors.coralPink} />
        </G>

        <Path d={wavePath(w, h, h - 5, h - 12, 1.5, w * 0.7, 4)} fill={colors.warmCream} />

        <SceneBubble cx={w - 26} cy={18} r={4.5} />
        <SceneBubble cx={w - 13} cy={32} r={2.8} />
        <SceneBubble cx={9} cy={h * 0.42} r={3} />
        <SceneBubble cx={w - 16} cy={h - 54} r={2.4} />
      </Svg>
    </View>
  );
});
