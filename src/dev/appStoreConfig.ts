import { PLANS } from '../subscription/config';
import type { ExpectedOffering } from './testStoreHarness';

/**
 * The offering the development harness loads by identifier when it buys through the App Store
 * sandbox. The same `default_v2` as the Test Store: each package holds one product per store, and
 * RevenueCat only returns the products of the store the SDK key belongs to. Development builds only.
 *
 * TARGET intros: annual 14d · monthly 7d · weekly 3d (must match ASC before the harness passes).
 */
export const APP_STORE_OFFERING_ID = 'default_v2';

/**
 * What `default_v2`'s App Store products are expected to hold. Prices are not judged: the sandbox
 * shows them in the tester's storefront currency.
 */
export const APP_STORE_EXPECTED: ExpectedOffering = {
  offeringId: APP_STORE_OFFERING_ID,
  plans: {
    annual: {
      packageId: PLANS.annual.packageId,
      productId: PLANS.annual.productIds.ios!,
      billingPeriod: PLANS.annual.billingPeriod,
      price: null,
      freeTrialDays: 14,
    },
    monthly: {
      packageId: PLANS.monthly.packageId,
      productId: PLANS.monthly.productIds.ios!,
      billingPeriod: PLANS.monthly.billingPeriod,
      price: null,
      freeTrialDays: 7,
    },
    weekly: {
      packageId: PLANS.weekly.packageId,
      productId: PLANS.weekly.productIds.ios!,
      billingPeriod: PLANS.weekly.billingPeriod,
      price: null,
      freeTrialDays: 3,
    },
  },
};
