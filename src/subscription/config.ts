import { PlanId } from './entitlement';

/** While false, every feature stays available exactly as it is today. */
export const SUBSCRIPTION_GATING_ENABLED = false;

/**
 * Prices, currencies and the trial's length are set in App Store Connect and Google Play
 * and must be shown from the store's product details, never from constants here.
 */
export type PlanConfig = {
  /** Store product IDs, or null until the products are created. */
  productIds: { ios: string | null; android: string | null };
  /** ISO 8601 billing period, used to check the store's products match the plan. */
  billingPeriod: 'P1Y' | 'P1M';
  hasFreeTrial: boolean;
};

export const PLANS: Record<PlanId, PlanConfig> = {
  annual: { productIds: { ios: null, android: null }, billingPeriod: 'P1Y', hasFreeTrial: true },
  monthly: { productIds: { ios: null, android: null }, billingPeriod: 'P1M', hasFreeTrial: false },
};
