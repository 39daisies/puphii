import { PlanId } from './entitlement';
import { KeySource, StorePlatform } from './sdkKeys';

/**
 * When true, the app requires an active store entitlement (or trial) for normal use.
 * Missing legal URLs must never unlock the app — only this kill switch disables enforcement.
 */
export const SUBSCRIPTION_GATING_ENABLED = true;

/**
 * Identifier of the RevenueCat entitlement that unlocks Puphii. Shared by every store, the Test
 * Store included. Null would keep the SDK from starting.
 */
export const REVENUECAT_ENTITLEMENT_ID: string | null = 'puphii_pro';

/**
 * Prices, currencies and introductory-offer lengths are set in App Store Connect / Google Play
 * and must be shown from the store's product details, never from constants here.
 *
 * TARGET (manual ASC configuration — not proven live by this repo):
 * - Annual $29.99 / year · 7-day free trial
 * - Monthly $4.99 / month · 3-day free trial
 * - Weekly $1.99 / week · no introductory offer
 *
 * `hasFreeTrial` records that TARGET intent for harness alignment. The paywall never claims a
 * trial from this flag alone — only from store intro + RevenueCat eligibility (and never for
 * plans listed in `NO_INTRO_OFFER_PLANS`).
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
  /** TARGET: this plan should carry a free introductory offer in App Store Connect. */
  hasFreeTrial: boolean;
};

export const PLANS: Record<PlanId, PlanConfig> = {
  annual: { productIds: { ios: 'puphii_annual_2999', android: null }, packageId: '$rc_annual', billingPeriod: 'P1Y', hasFreeTrial: true },
  monthly: { productIds: { ios: 'puphii_monthly_499', android: null }, packageId: '$rc_monthly', billingPeriod: 'P1M', hasFreeTrial: true },
  weekly: { productIds: { ios: 'puphii_weekly_199', android: null }, packageId: '$rc_weekly', billingPeriod: 'P1W', hasFreeTrial: false },
};

/**
 * The offering the paywall uses when RevenueCat's current offering doesn't hold the configured
 * products. Its packages hold one product per store: the App Store and Test Store products above.
 */
export const PAYWALL_OFFERING_ID = 'default_v2';

/**
 * Links the paywall must show. Null until the owner publishes the documents at stable https URLs.
 * Never a placeholder. Missing links block purchases and are listed on the paywall; they never unlock
 * the app. Drafts live in `docs/APP_PRIVACY_POLICY.md` and `docs/APP_TERMS_OF_USE.md`.
 */
export const LEGAL_URLS: { termsOfUse: string | null; privacyPolicy: string | null } = {
  termsOfUse: null,
  privacyPolicy: null,
};

/** Optional support contact. Shown on the paywall when set (https or mailto). */
export const SUPPORT_URL: string | null = null;

/**
 * Whole-app subscription benefits (not feature-by-feature Pro). Every line must stay accurate.
 */
export const APP_BENEFITS: readonly string[] = [
  'Log puffs and skips with Puphii’s reactions and sounds',
  'Insights, history, savings estimates, and your reduction plan',
  'Bubble Break and all settings on this device',
];

/** @deprecated Prefer APP_BENEFITS — kept as alias for existing imports. */
export const PRO_BENEFITS: readonly string[] | null = APP_BENEFITS;

/**
 * @deprecated Feature-tier labels are retired; subscription unlocks the whole app.
 * Kept empty so old imports fail closed rather than advertising freemium.
 */
export const PRO_FEATURE_BENEFITS = {} as const;

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
