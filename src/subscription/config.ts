import { PlanId } from './entitlement';
import { KeySource, StorePlatform } from './sdkKeys';

/**
 * Turns Puphii Pro gating on. It only takes effect where Pro can actually be bought: see
 * `proGatingActive`. While the paywall is hidden, every feature stays available.
 */
export const SUBSCRIPTION_GATING_ENABLED = true;

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
 * What each Puphii Pro feature is called on the paywall. Every key is an existing screen section
 * gated in the app (see `proFeatures.ts`): never list something the app doesn't gate.
 */
export const PRO_FEATURE_BENEFITS = {
  monthlyYearlyTrends: 'Monthly and yearly trends in your logged puffs',
  pastPeriods: 'Look back at any past week, month or year',
  extendedHistory: '30-day and all-time history charts',
  spendingProjections: 'Monthly and yearly spending estimates, savings scenarios and goal timelines',
} as const;

/** What Puphii Pro includes, one line each, as shown on the paywall. */
export const PRO_BENEFITS: readonly string[] | null = Object.values(PRO_FEATURE_BENEFITS);

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
