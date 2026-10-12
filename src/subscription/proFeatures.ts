import { PRO_FEATURE_BENEFITS } from './config';
import type { ProAccess } from './entitlement';

/**
 * The single place that decides what Puphii Pro covers. Logging, Undo, Pause, today's count, the
 * current week's overview, Bubble Break, settings, and viewing or deleting logs are never listed.
 */
export type ProFeature = keyof typeof PRO_FEATURE_BENEFITS;

export function overviewFeature(period: 'week' | 'month' | 'year', offset: number): ProFeature | null {
  if (period !== 'week') return 'monthlyYearlyTrends';
  return offset < 0 ? 'pastPeriods' : null;
}

/** Only the charts: the day-by-day log list, with delete, is someone's own data and stays free. */
export const historyFeature = (range: 'week' | 'month' | 'all'): ProFeature | null => (range === 'week' ? null : 'extendedHistory');

/** Per-month and per-year estimates, "If you used less" scenarios and the savings goal timeline. */
export const SPENDING_PROJECTIONS: ProFeature = 'spendingProjections';

export const canUse = (pro: ProAccess, feature: ProFeature | null): boolean => feature === null || pro === 'granted';

/**
 * Gating only applies where Pro can be bought: the paywall entry is shown (legal links and
 * benefits configured, or a development build) and the store SDK can start. Elsewhere nothing
 * is locked, so release builds stay fully free until monetization is ready.
 */
export const proGatingActive = ({ enabled, paywallAvailable, storeReady }: { enabled: boolean; paywallAvailable: boolean; storeReady: boolean }) =>
  enabled && paywallAvailable && storeReady;
