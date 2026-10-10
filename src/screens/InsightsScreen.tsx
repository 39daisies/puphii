import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ScreenHeader } from '../components/ScreenHeader';
import { SegmentedControl } from '../components/SegmentedControl';
import { InsightsPeriod } from '../data/insights';
import { spacing } from '../theme';
import { HistoryRange, HistoryScreen } from './HistoryScreen';
import { InsightsOverview } from './InsightsOverview';
import { LearnScreen } from './LearnScreen';
import { SavingsScreen } from './SavingsScreen';

export type InsightsSection = 'overview' | 'savings' | 'history' | 'learn';

/** Kept by the app shell so each section's selections survive switching sections and tabs. */
export type InsightsState = {
  section: InsightsSection;
  period: InsightsPeriod;
  offset: number;
  historyRange: HistoryRange;
};

export const INITIAL_INSIGHTS_STATE: InsightsState = { section: 'overview', period: 'week', offset: 0, historyRange: 'week' };

const SECTIONS = [
  { value: 'overview', label: 'Overview' },
  { value: 'savings', label: 'Savings' },
  { value: 'history', label: 'History' },
  { value: 'learn', label: 'Learn' },
] as const;

type Props = { state: InsightsState; onChange: (patch: Partial<InsightsState>) => void };

export function InsightsScreen({ state, onChange }: Props) {
  const header = (
    <View style={styles.header}>
      <ScreenHeader title="Insights" />
      <SegmentedControl options={SECTIONS} value={state.section} onChange={(section) => onChange({ section })} variant="underline" />
    </View>
  );

  if (state.section === 'overview') {
    return (
      <InsightsOverview
        header={header}
        period={state.period}
        offset={state.offset}
        onPeriodChange={(period) => onChange({ period, offset: 0 })}
        onOffsetChange={(offset) => onChange({ offset })}
      />
    );
  }
  if (state.section === 'savings') return <SavingsScreen header={header} />;
  if (state.section === 'history') {
    return <HistoryScreen header={header} range={state.historyRange} onRangeChange={(historyRange) => onChange({ historyRange })} />;
  }
  return <LearnScreen header={header} />;
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.lg },
});
