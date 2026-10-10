import { PLANS, TEST_STORE_PRODUCT_IDS } from '../subscription/config';
import type { ExpectedOffering } from './testStoreHarness';

/**
 * The RevenueCat Test Store offering the development harness loads by identifier. It is not the
 * current offering, so it never reaches the app's own screens. Development builds only.
 */
export const TEST_STORE_OFFERING_ID = 'default_v2';

/** What `default_v2` is set up with in the RevenueCat dashboard. */
export const TEST_STORE_EXPECTED: ExpectedOffering = {
  offeringId: TEST_STORE_OFFERING_ID,
  plans: {
    annual: {
      packageId: PLANS.annual.packageId,
      productId: TEST_STORE_PRODUCT_IDS.annual,
      billingPeriod: PLANS.annual.billingPeriod,
      price: { amount: 29.99, currencyCode: 'USD' },
      freeTrialDays: 7,
    },
    monthly: {
      packageId: PLANS.monthly.packageId,
      productId: TEST_STORE_PRODUCT_IDS.monthly,
      billingPeriod: PLANS.monthly.billingPeriod,
      price: { amount: 4.99, currencyCode: 'USD' },
      freeTrialDays: null,
    },
  },
};
