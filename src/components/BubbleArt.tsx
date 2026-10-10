import React from 'react';
import Svg, { Circle, Defs, Ellipse, RadialGradient, Stop } from 'react-native-svg';
import { colors } from '../theme';

const TINTS = [colors.oceanBlue, colors.seafoam, colors.peach] as const;

/** A soft, translucent bubble. Memoised because the game redraws its field every frame. */
export const BubbleArt = React.memo(function BubbleArt({ size, tint = 0 }: { size: number; tint?: number }) {
  const index = Math.abs(tint) % TINTS.length;
  const color = TINTS[index];
  const id = `puphii-bubble-${index}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" accessible={false} pointerEvents="none">
      <Defs>
        <RadialGradient id={id} cx="38" cy="34" r="68" gradientUnits="userSpaceOnUse">
          <Stop offset="0" stopColor={colors.white} stopOpacity={0.95} />
          <Stop offset="0.55" stopColor={color} stopOpacity={0.6} />
          <Stop offset="1" stopColor={color} stopOpacity={1} />
        </RadialGradient>
      </Defs>
      <Circle cx={50} cy={50} r={46} fill={`url(#${id})`} stroke={colors.white} strokeWidth={3.5} />
      {/* A faint deep-ocean rim keeps the bubble distinct from the pale water behind it. */}
      <Circle cx={50} cy={50} r={48} fill="none" stroke={colors.deepOcean} strokeOpacity={0.35} strokeWidth={1.6} />
      <Ellipse cx={35} cy={31} rx={12} ry={7} fill={colors.white} opacity={0.9} transform="rotate(-32 35 31)" />
    </Svg>
  );
});
