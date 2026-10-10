import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, fontFamilies, spacing } from '../theme';
import { pluralize } from '../utils/format';
import { AppText } from './AppText';

export type Bar = {
  key: string;
  value: number;
  label: string;
  sublabel?: string;
  highlight?: boolean;
  /** Not reached yet: drawn as an empty slot rather than as zero. */
  future?: boolean;
  /** Spoken description, e.g. "Monday October 5". */
  spokenLabel: string;
};

type Props = {
  data: Bar[];
  height?: number;
  showValues?: boolean;
  dense?: boolean;
  /** Makes each bar a button so its count can be inspected. */
  onSelect?: (key: string) => void;
  selectedKey?: string | null;
};

const LABEL_ROW = 18;
const VALUE_ROW = 18;
const DENSE_LABEL_WIDTH = 40;

export const spokenBar = (bar: Bar) =>
  `${bar.spokenLabel}: ${bar.future ? 'not yet' : pluralize(bar.value, 'logged puff')}`;

export function BarChart({ data, height = 128, showValues = true, dense = false, onSelect, selectedKey }: Props) {
  const max = Math.max(1, ...data.map((bar) => (bar.future ? 0 : bar.value)));
  const interactive = !!onSelect;
  const labelRows = dense ? 0 : data.some((bar) => bar.sublabel) ? 2 : 1;

  return (
    <View
      accessible={!interactive}
      accessibilityRole={interactive ? undefined : 'image'}
      accessibilityLabel={interactive ? undefined : `Logged puffs. ${data.map(spokenBar).join(', ')}`}
    >
      <View style={styles.row}>
        {data.map((bar) => {
          const selected = bar.key === selectedKey;
          const column = (
            <>
              <View style={[styles.plot, { height: height + (showValues ? VALUE_ROW : 0) }]}>
                {showValues && !bar.future ? (
                  <AppText variant="chartValue" align="center" color={bar.highlight ? colors.coralInk : colors.textPrimary}>
                    {bar.value}
                  </AppText>
                ) : null}
                <BarShape bar={bar} max={max} height={height} dense={dense} selected={selected} />
              </View>
              <View style={[styles.labelCell, { minHeight: LABEL_ROW * labelRows }]}>
                {dense ? null : <AxisLabel text={bar.label} highlight={bar.highlight} selected={selected} />}
                {bar.sublabel ? <AxisLabel text={bar.sublabel} highlight={bar.highlight} /> : null}
                {bar.highlight ? <View style={styles.todayDot} /> : null}
              </View>
            </>
          );
          const columnStyle = [styles.column, dense && styles.columnDense];
          return interactive ? (
            <Pressable
              key={bar.key}
              accessibilityRole="button"
              accessibilityLabel={spokenBar(bar)}
              aria-selected={selected}
              onPress={() => onSelect(bar.key)}
              style={columnStyle}
            >
              {column}
            </Pressable>
          ) : (
            <View key={bar.key} style={columnStyle}>
              {column}
            </View>
          );
        })}
      </View>

      {dense ? (
        // Dense columns are too narrow for their own labels, so sparse labels share one row, centered under their bar.
        <View style={styles.denseLabels} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" aria-hidden>
          {data.map((bar, index) =>
            bar.label ? (
              <View key={bar.key} style={[styles.denseLabel, { left: `${((index + 0.5) / data.length) * 100}%` }]}>
                <AxisLabel text={bar.label} highlight={bar.highlight} selected={bar.key === selectedKey} />
              </View>
            ) : null,
          )}
        </View>
      ) : null}
    </View>
  );
}

function BarShape({ bar, max, height, dense, selected }: { bar: Bar; max: number; height: number; dense: boolean; selected: boolean }) {
  if (bar.future) return <View style={[styles.futureSlot, dense && styles.barDense]} />;
  const barHeight = bar.value === 0 ? 4 : Math.max(dense ? 6 : 10, (bar.value / max) * height);
  return (
    <View
      style={[
        styles.bar,
        dense && styles.barDense,
        {
          height: barHeight,
          backgroundColor: bar.value === 0 ? colors.border : bar.highlight ? colors.coralPink : colors.oceanBlue,
          borderColor: selected ? colors.deepOcean : bar.highlight && bar.value > 0 ? colors.coralDeep : 'transparent',
        },
      ]}
    />
  );
}

function AxisLabel({ text, highlight, selected }: { text: string; highlight?: boolean; selected?: boolean }) {
  if (!text) return null;
  return (
    <AppText
      variant="chartLabel"
      align="center"
      numberOfLines={1}
      color={highlight ? colors.coralInk : selected ? colors.textPrimary : undefined}
      style={highlight || selected ? styles.strongLabel : undefined}
    >
      {text}
    </AppText>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  column: { flex: 1, alignItems: 'center', marginHorizontal: 3 },
  columnDense: { marginHorizontal: 1 },
  plot: { alignSelf: 'stretch', alignItems: 'center', justifyContent: 'flex-end', gap: spacing.xs },
  bar: {
    width: '100%',
    maxWidth: 30,
    borderTopLeftRadius: 9,
    borderTopRightRadius: 9,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    borderWidth: 1.5,
  },
  barDense: { maxWidth: 8, borderTopLeftRadius: 4, borderTopRightRadius: 4, borderWidth: 1 },
  futureSlot: {
    width: '100%',
    maxWidth: 30,
    height: 4,
    borderRadius: 2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
  },
  labelCell: { alignSelf: 'stretch', alignItems: 'center', marginTop: spacing.sm },
  denseLabels: { height: LABEL_ROW, marginTop: spacing.xs },
  denseLabel: { position: 'absolute', top: 0, width: DENSE_LABEL_WIDTH, marginLeft: -DENSE_LABEL_WIDTH / 2 },
  strongLabel: { fontFamily: fontFamilies.bold },
  todayDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.coralDeep, marginTop: 3 },
});
