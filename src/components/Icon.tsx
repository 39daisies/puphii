import React from 'react';
import Svg, { Circle, Ellipse, Path, Rect } from 'react-native-svg';
import { colors } from '../theme';

export type IconName =
  | 'home'
  | 'history'
  | 'learn'
  | 'settings'
  | 'bell'
  | 'database'
  | 'info'
  | 'undo'
  | 'chevronRight'
  | 'chevronLeft'
  | 'chevronDown'
  | 'heart'
  | 'cloud'
  | 'sound'
  | 'haptic'
  | 'trash'
  | 'check'
  | 'external'
  | 'clock'
  | 'user'
  | 'close'
  | 'pause'
  | 'play'
  | 'gamepad';

type Props = {
  name: IconName;
  size?: number;
  color?: string;
  /** Optional fill for solid-style icons (active tab, hearts, clouds). */
  fill?: string;
  strokeWidth?: number;
};

function gearPath(teeth = 8, outer = 9.6, inner = 7.3, cx = 12, cy = 12): string {
  const step = (Math.PI * 2) / teeth;
  const point = (radius: number, angle: number) =>
    `${(cx + radius * Math.cos(angle)).toFixed(2)} ${(cy + radius * Math.sin(angle)).toFixed(2)}`;
  const parts: string[] = [];
  for (let i = 0; i < teeth; i += 1) {
    const a = i * step - Math.PI / 2;
    parts.push(
      `${i === 0 ? 'M' : 'L'}${point(inner, a - step * 0.36)}`,
      `L${point(outer, a - step * 0.17)}`,
      `L${point(outer, a + step * 0.17)}`,
      `L${point(inner, a + step * 0.36)}`,
    );
  }
  return `${parts.join(' ')} Z`;
}

const GEAR = gearPath();

export function Icon({ name, size = 24, color = colors.textPrimary, fill = 'none', strokeWidth = 1.9 }: Props) {
  const stroke = { stroke: color, strokeWidth, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

  const body = (() => {
    switch (name) {
      case 'home':
        return (
          <>
            <Path d="M5.6 10v8.8a1.4 1.4 0 0 0 1.4 1.4h3.3v-5h3.4v5H17a1.4 1.4 0 0 0 1.4-1.4V10" fill={fill} {...stroke} />
            <Path d="M3.4 11.4 12 4l8.6 7.4" fill="none" {...stroke} />
          </>
        );
      case 'history':
        return (
          <>
            <Rect x={4.6} y={12} width={3.2} height={7.4} rx={1.2} fill={fill} {...stroke} />
            <Rect x={10.4} y={5.2} width={3.2} height={14.2} rx={1.2} fill={fill} {...stroke} />
            <Rect x={16.2} y={9} width={3.2} height={10.4} rx={1.2} fill={fill} {...stroke} />
          </>
        );
      case 'learn':
        return (
          <>
            <Path
              d="M12 6.6C10.2 5.2 7.7 4.6 3.8 4.8v13.6c3.9-.2 6.4.4 8.2 1.8 1.8-1.4 4.3-2 8.2-1.8V4.8c-3.9-.2-6.4.4-8.2 1.8Z"
              fill={fill}
              {...stroke}
            />
            <Path d="M12 6.6v13.6" {...stroke} />
          </>
        );
      case 'settings':
        return (
          <>
            <Path d={GEAR} fill={fill} {...stroke} />
            <Circle cx={12} cy={12} r={3} fill={fill === 'none' ? 'none' : colors.white} {...stroke} />
          </>
        );
      case 'bell':
        return (
          <>
            <Path d="M6 16.4V11a6 6 0 1 1 12 0v5.4l1.6 2.1H4.4L6 16.4Z" fill={fill} {...stroke} />
            <Path d="M10 21a2.1 2.1 0 0 0 4 0" {...stroke} />
          </>
        );
      case 'database':
        return (
          <>
            <Ellipse cx={12} cy={6.2} rx={7} ry={2.7} fill={fill} {...stroke} />
            <Path d="M5 6.2v11.6c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7V6.2" fill="none" {...stroke} />
            <Path d="M5 12c0 1.5 3.1 2.7 7 2.7s7-1.2 7-2.7" fill="none" {...stroke} />
          </>
        );
      case 'info':
        return (
          <>
            <Circle cx={12} cy={12} r={8.8} fill={fill} {...stroke} />
            <Path d="M12 11v5.4" {...stroke} />
            <Circle cx={12} cy={7.9} r={1.1} fill={color} />
          </>
        );
      case 'undo':
        return (
          <>
            <Path d="M5.2 13.2a7 7 0 1 0 2.1-6.1" fill="none" {...stroke} />
            <Path d="M5 4.6v4.2h4.2" fill="none" {...stroke} />
          </>
        );
      case 'chevronRight':
        return <Path d="m9.5 5.8 6.2 6.2-6.2 6.2" fill="none" {...stroke} />;
      case 'chevronLeft':
        return <Path d="m14.5 5.8-6.2 6.2 6.2 6.2" fill="none" {...stroke} />;
      case 'chevronDown':
        return <Path d="m5.8 9.5 6.2 6.2 6.2-6.2" fill="none" {...stroke} />;
      case 'heart':
        return (
          <Path
            d="M12 20.2S3.8 15.4 3.8 9.4A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 8.2 2.2c0 6-8.2 10.8-8.2 10.8Z"
            fill={fill}
            {...stroke}
          />
        );
      case 'cloud':
        return (
          <Path
            d="M7.3 18.4h9.9a3.9 3.9 0 0 0 .5-7.8 5.3 5.3 0 0 0-10.3-1.3 4.6 4.6 0 0 0-.1 9.1Z"
            fill={fill}
            {...stroke}
          />
        );
      case 'sound':
        return (
          <>
            <Path d="M4 9.4h3.4L12 5.6v12.8l-4.6-3.8H4V9.4Z" fill={fill} {...stroke} />
            <Path d="M15.4 9.2a4 4 0 0 1 0 5.6M17.9 6.8a7.4 7.4 0 0 1 0 10.4" fill="none" {...stroke} />
          </>
        );
      case 'haptic':
        return (
          <>
            <Rect x={8} y={3.8} width={8} height={16.4} rx={2.2} fill={fill} {...stroke} />
            <Path d="M4.6 9v6M19.4 9v6" {...stroke} />
          </>
        );
      case 'trash':
        return (
          <>
            <Path d="M4.8 7h14.4M9.6 7V5.2h4.8V7" fill="none" {...stroke} />
            <Path d="m6.6 7 .9 12.1a1.6 1.6 0 0 0 1.6 1.5h5.8a1.6 1.6 0 0 0 1.6-1.5L17.4 7" fill={fill} {...stroke} />
            <Path d="M10.2 11v5.6M13.8 11v5.6" {...stroke} />
          </>
        );
      case 'check':
        return <Path d="m5.6 12.6 4.2 4.2 8.6-9.4" fill="none" {...stroke} />;
      case 'close':
        return <Path d="M6.4 6.4l11.2 11.2M17.6 6.4 6.4 17.6" fill="none" {...stroke} />;
      case 'external':
        return (
          <>
            <Path d="M14 4.8h5.2V10M19.2 4.8l-8 8" fill="none" {...stroke} />
            <Path d="M17 13.6v4.6a1.6 1.6 0 0 1-1.6 1.6H6.2a1.6 1.6 0 0 1-1.6-1.6V9a1.6 1.6 0 0 1 1.6-1.6h4.6" fill="none" {...stroke} />
          </>
        );
      case 'clock':
        return (
          <>
            <Circle cx={12} cy={12} r={8.6} fill={fill} {...stroke} />
            <Path d="M12 7.6V12l3 2" fill="none" {...stroke} />
          </>
        );
      case 'user':
        return (
          <>
            <Circle cx={12} cy={8.2} r={3.8} fill={fill} {...stroke} />
            <Path d="M4.6 20.2c.6-3.9 3.6-6.2 7.4-6.2s6.8 2.3 7.4 6.2Z" fill={fill} {...stroke} />
          </>
        );
      case 'pause':
        return <Path d="M9 6.4v11.2M15 6.4v11.2" fill="none" {...stroke} />;
      case 'play':
        return <Path d="M8.4 6.2v11.6a.8.8 0 0 0 1.2.7l9-5.8a.8.8 0 0 0 0-1.4l-9-5.8a.8.8 0 0 0-1.2.7Z" fill={fill} {...stroke} />;
      case 'gamepad':
        return (
          <>
            <Path
              d="M7.6 7.4h8.8a4.4 4.4 0 0 1 4.3 3.6l.9 5a2.5 2.5 0 0 1-4.3 2.2l-1.8-1.8H8.5l-1.8 1.8a2.5 2.5 0 0 1-4.3-2.2l.9-5a4.4 4.4 0 0 1 4.3-3.6Z"
              fill={fill}
              {...stroke}
            />
            <Path d="M8 10.4v3.6M6.2 12.2h3.6" fill="none" {...stroke} />
            <Circle cx={15.4} cy={11.2} r={1} fill={color} />
            <Circle cx={17.6} cy={13.3} r={1} fill={color} />
          </>
        );
    }
  })();

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
      {body}
    </Svg>
  );
}
