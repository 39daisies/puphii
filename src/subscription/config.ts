import { PlanId } from './entitlement';
import { KeySource, StorePlatform } from './sdkKeys';

/** While false, every feature stays available exactly as it is today. */
export const SUBSCRIPTION_GATING_ENABLED = false;

/**
 * Identifier of the RevenueCat entitlement that unlocks Puphii's premium experience. Shared by
 * every store, the Test Store included. Null would keep the SDK from starting.
 */
export const REVENUECAT_ENTITLEMENT_ID: string | null = 'puphii_pro';

/**
 * Prices, currencies and the trial's length are set in App Store Connect and Google Play
 * and must be shown from the store's product details, never from constants here.
 */
export type PlanConfig = {
  /**
   * Store product IDs, or null until the products are created. iOS: the App Store product ID.
   * Android: `subscriptionId:basePlanId`, as RevenueCat lists Google Play products.
   */
  productIds: { ios: string | null; android: string | null };
  /** The package holding this plan in an offering, the same for every store. */
  packageId: string;
  /** ISO 8601 billing period, used to check the store's products match the plan. */
  billingPeriod: 'P1Y' | 'P1M' | 'P1W';
  hasFreeTrial: boolean;
};

export const PLANS: Record<PlanId, PlanConfig> = {
  annual: { productIds: { ios: 'puphii_annual_2999', android: null }, packageId: '$rc_annual', billingPeriod: 'P1Y', hasFreeTrial: true },
  monthly: { productIds: { ios: 'puphii_monthly_499', android: null }, packageId: '$rc_monthly', billingPeriod: 'P1M', hasFreeTrial: false },
  weekly: { productIds: { ios: 'puphii_weekly_199', android: null }, packageId: '$rc_weekly', billingPeriod: 'P1W', hasFreeTrial: false },
};

/**
 * The offering the paywall uses when RevenueCat's current offering doesn't hold the configured
 * products. Its packages hold one product per store: the App Store and Test Store products above.
 */
export const PAYWALL_OFFERING_ID = 'default_v2';

/**
 * Links the paywall must show. Null until the owner publishes the documents: never a placeholder
 * URL. Release builds hide the paywall until both are set (see `paywallConfigIssues`).
 */
export const LEGAL_URLS: { termsOfUse: string | null; privacyPolicy: string | null } = {
  termsOfUse: null,
  privacyPolicy: null,
};

/**
 * What Puphii Pro includes, one line each, as shown on the paywall. Null until the product owner
 * defines it: with gating off nothing is restricted, so no benefit may be implied until it exists.
 */
export const PRO_BENEFITS: readonly string[] | null = null;

/** RevenueCat Test Store products. Never mixed into the App Store or Google Play IDs above. */
export const TEST_STORE_PRODUCT_IDS: Record<PlanId, string> = { annual: 'yearly_2999', monthly: 'monthly_499', weekly: 'weekly_199' };

/**
 * Each plan's product ID for the store the SDK key belongs to. A `testStore` key is only ever
 * accepted in development builds, so release builds always get the App Store or Google Play IDs.
 */
export function productIdsFor(source: KeySource, platform: StorePlatform): Record<PlanId, string | null> {
  if (source === 'testStore') return { ...TEST_STORE_PRODUCT_IDS };
  return {
    annual: PLANS.annual.productIds[platform],
    monthly: PLANS.monthly.productIds[platform],
    weekly: PLANS.weekly.productIds[platform],
  };
}
