import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { CustomerInfo, MakePurchaseResult, PurchasesEntitlementInfo, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import {
  LEGAL_URLS,
  PAYWALL_OFFERING_ID,
  PLANS,
  PRO_BENEFITS,
  PRO_FEATURE_BENEFITS,
  productIdsFor,
  REVENUECAT_ENTITLEMENT_ID,
  SUBSCRIPTION_GATING_ENABLED,
  TEST_STORE_PRODUCT_IDS,
} from '../src/subscription/config';
import { accessFor, Entitlement, PlanId, RestoreResult } from '../src/subscription/entitlement';
import {
  createPaywallController,
  describePlan,
  freeTrialLength,
  hasProAccess,
  NO_INTRO_OFFER_PLANS,
  PaywallSdk,
  paywallConfigIssues,
  proStatusLabel,
  PURCHASE_CODES,
  purchaseErrorNotice,
  resolvePaywallOffering,
  showPaywallEntry,
  storeAccountFor,
  storeNameFor,
  verifiedPlans,
} from '../src/subscription/paywall';
import { INTRO_ELIGIBILITY } from '../src/subscription/revenueCat';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rc = require('@revenuecat/purchases-typescript-internal');

const ROOT = join(__dirname, '..', '..');
const read = (...path: string[]) => readFileSync(join(ROOT, ...path), 'utf8');
const occurrences = (text: string, part: string) => text.split(part).length - 1;

const APPLE = productIdsFor('platform', 'ios');
const TEST_STORE = productIdsFor('testStore', 'ios');
const ENTITLEMENT = REVENUECAT_ENTITLEMENT_ID!;
const REQUEST_DATE = '2026-10-10T12:00:00.000Z';
const TEST_LEGAL_URLS = {
  termsOfUse: 'https://example.com/terms',
  privacyPolicy: 'https://example.com/privacy',
};

const DAY_TRIAL = { price: 0, priceString: '$0.00', cycles: 1, period: 'P1W', periodUnit: 'DAY', periodNumberOfUnits: 7 };
const THREE_DAY_TRIAL = { price: 0, priceString: '$0.00', cycles: 1, period: 'P3D', periodUnit: 'DAY', periodNumberOfUnits: 3 };
const WEEK_TRIAL = { price: 0, priceString: '$0.00', cycles: 1, period: 'P1W', periodUnit: 'WEEK', periodNumberOfUnits: 1 };
const PAID_INTRO = { price: 0.99, priceString: '$0.99', cycles: 1, period: 'P1M', periodUnit: 'MONTH', periodNumberOfUnits: 1 };

function pkg(
  identifier: string,
  productId: string,
  priceString: string,
  period: string | null,
  { intro = null as object | null, perMonth = null as string | null } = {},
): PurchasesPackage {
  return {
    identifier,
    packageType: ({ $rc_annual: 'ANNUAL', $rc_monthly: 'MONTHLY', $rc_weekly: 'WEEKLY' } as Record<string, string>)[identifier] ?? 'CUSTOM',
    product: {
      identifier: productId,
      title: `Title ${productId}`,
      priceString,
      price: Number(priceString.replace(/[^\d.]/g, '')),
      currencyCode: 'USD',
      subscriptionPeriod: period,
      introPrice: intro,
      pricePerMonthString: perMonth,
    },
  } as unknown as PurchasesPackage;
}

function offerings(current: string | null, all: Record<string, PurchasesPackage[]>): PurchasesOfferings {
  const entries = Object.fromEntries(Object.entries(all).map(([id, packages]) => [id, { identifier: id, availablePackages: packages }]));
  return { all: entries, current: current ? entries[current] : null } as unknown as PurchasesOfferings;
}

/** `default_v2` as the App Store sees it: one Apple product per package. */
const appleV2 = (annualIntro: object | null = DAY_TRIAL) => [
  pkg('$rc_annual', 'puphii_annual_2999', '$29.99', 'P1Y', { intro: annualIntro, perMonth: '$2.49' }),
  pkg('$rc_monthly', 'puphii_monthly_499', '$4.99', 'P1M', { intro: THREE_DAY_TRIAL }),
  pkg('$rc_weekly', 'puphii_weekly_199', '$1.99', 'P1W', { perMonth: '$7.96' }),
];
/** `default_v2` as the Test Store sees it. */
const testStoreV2 = () => [
  pkg('$rc_annual', 'yearly_2999', '$29.99', 'P1Y', { intro: DAY_TRIAL, perMonth: '$2.49' }),
  pkg('$rc_monthly', 'monthly_499', '$4.99', 'P1M', { intro: THREE_DAY_TRIAL }),
  pkg('$rc_weekly', 'weekly_199', '$1.99', 'P1W'),
];
/** `default_v2` as the App Store sees it, with a different weekly package in place of the real one, or none. */
const appleWithWeekly = (weekly: PurchasesPackage | null) => [...appleV2().slice(0, 2), ...(weekly ? [weekly] : [])];
/** The original offering, still current in RevenueCat, with other products. */
const ORIGINAL = [pkg('$rc_annual', 'yearly', '$29.99', 'P1Y'), pkg('$rc_monthly', 'monthly', '$4.99', 'P1M')];
const dashboard = (v2: PurchasesPackage[] = appleV2()) => offerings('default', { default: ORIGINAL, default_v2: v2 });

function proEntry(overrides: Partial<PurchasesEntitlementInfo> = {}): PurchasesEntitlementInfo {
  return {
    identifier: ENTITLEMENT,
    isActive: true,
    willRenew: true,
    periodType: 'TRIAL',
    productIdentifier: 'puphii_annual_2999',
    productPlanIdentifier: null,
    store: 'APP_STORE',
    isSandbox: true,
    expirationDate: '2026-10-17T12:00:00.000Z',
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    verification: 'NOT_REQUESTED',
    ...overrides,
  } as PurchasesEntitlementInfo;
}

function customer(entries: PurchasesEntitlementInfo[] = []): CustomerInfo {
  const all = Object.fromEntries(entries.map((e) => [e.identifier, e]));
  const active = Object.fromEntries(entries.filter((e) => e.isActive).map((e) => [e.identifier, e]));
  return { entitlements: { all, active, verification: 'NOT_REQUESTED' }, requestDate: REQUEST_DATE } as unknown as CustomerInfo;
}

const storeError = (code: string, extra: object = {}) => Object.assign(new Error(`store error ${code}`), { code, ...extra });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const ACTIVE: Entitlement = {
  status: 'active',
  plan: 'annual',
  period: 'paid',
  expiresAt: '2027-10-10T12:00:00.000Z',
  willRenew: true,
  verification: { origin: 'store', verifiedAt: REQUEST_DATE },
};

function fakes({ sdkAvailable = true, configured = true, productIds = APPLE, platform = 'ios' } = {}) {
  const calls = { getOfferings: 0, purchase: [] as string[], eligibility: [] as string[][], refresh: 0, restore: 0 };
  const control = {
    offerings: (): Promise<PurchasesOfferings> => Promise.resolve(dashboard()),
    purchase: (p: PurchasesPackage): Promise<MakePurchaseResult> =>
      Promise.resolve({ productIdentifier: p.product.identifier, customerInfo: customer([proEntry({ productIdentifier: p.product.identifier })]) } as MakePurchaseResult),
    eligibility: (ids: string[]): Promise<Record<string, { status: number }>> =>
      Promise.resolve(Object.fromEntries(ids.map((id) => [id, { status: INTRO_ELIGIBILITY.ELIGIBLE }]))),
    restore: (): Promise<RestoreResult> => Promise.resolve({ outcome: 'nothingToRestore', entitlement: { status: 'unknown' } }),
    refreshFails: false,
  };
  const sdk: PaywallSdk = {
    isConfigured: () => Promise.resolve(configured),
    getOfferings() {
      calls.getOfferings += 1;
      return control.offerings();
    },
    purchasePackage(p) {
      calls.purchase.push(p.product.identifier);
      return control.purchase(p);
    },
    checkTrialEligibility(ids) {
      calls.eligibility.push(ids);
      return control.eligibility(ids);
    },
  };
  const controller = createPaywallController({
    sdk: sdkAvailable ? sdk : null,
    productIds,
    entitlementId: ENTITLEMENT,
    entitlements: {
      refresh() {
        calls.refresh += 1;
        return control.refreshFails ? Promise.reject(new Error('refresh failed')) : Promise.resolve(ACTIVE);
      },
      restorePurchases() {
        calls.restore += 1;
        return control.restore();
      },
    },
    platform,
    legalLinks: TEST_LEGAL_URLS,
  });
  return { controller, calls, control };
}

const planIds = (plans: { plan: PlanId }[]) => plans.map((p) => p.plan);

describe('Apple product to package mapping', () => {
  test('the App Store products and packages are the configured ones', () => {
    assert.deepEqual(APPLE, { annual: 'puphii_annual_2999', monthly: 'puphii_monthly_499', weekly: 'puphii_weekly_199' });
    assert.equal(PLANS.annual.packageId, '$rc_annual');
    assert.equal(PLANS.monthly.packageId, '$rc_monthly');
    assert.equal(PLANS.weekly.packageId, '$rc_weekly');
    assert.equal(rc.PACKAGE_TYPE.WEEKLY, 'WEEKLY');
    assert.equal(PAYWALL_OFFERING_ID, 'default_v2');
    assert.equal(REVENUECAT_ENTITLEMENT_ID, 'puphii_pro');
  });

  test('falls back to default_v2 when the current offering holds other products', () => {
    const resolution = resolvePaywallOffering(dashboard(), APPLE);
    assert.ok(resolution.ok);
    assert.equal(resolution.offeringId, 'default_v2');
    assert.deepEqual(
      resolution.plans.map((p) => [p.plan, p.pkg.identifier, p.pkg.product.identifier]),
      [
        ['annual', '$rc_annual', 'puphii_annual_2999'],
        ['monthly', '$rc_monthly', 'puphii_monthly_499'],
        ['weekly', '$rc_weekly', 'puphii_weekly_199'],
      ],
    );
  });

  test('uses the current offering when it already holds the configured products', () => {
    const resolution = resolvePaywallOffering(offerings('launch', { launch: appleV2(), default_v2: appleV2() }), APPLE);
    assert.ok(resolution.ok);
    assert.equal(resolution.offeringId, 'launch');
  });

  test('the offering with the most verified plans wins; on a tie, the current one', () => {
    const fewer = resolvePaywallOffering(offerings('default', { default: [appleV2()[1]], default_v2: appleV2() }), APPLE);
    assert.ok(fewer.ok);
    assert.equal(fewer.offeringId, 'default_v2');
    assert.deepEqual(planIds(fewer.plans), ['annual', 'monthly', 'weekly']);

    const withoutWeekly = resolvePaywallOffering(offerings('default', { default: appleWithWeekly(null), default_v2: appleV2() }), APPLE);
    assert.ok(withoutWeekly.ok);
    assert.equal(withoutWeekly.offeringId, 'default_v2', 'a current offering missing weekly loses to one that has it');

    const partialFallback = resolvePaywallOffering(
      offerings('default', { default: [appleV2()[1]], default_v2: appleWithWeekly(null) }),
      APPLE,
    );
    assert.ok(partialFallback.ok);
    assert.equal(partialFallback.offeringId, 'default_v2', 'annual and monthly beat monthly alone');

    const tie = resolvePaywallOffering(offerings('launch', { launch: appleWithWeekly(null), default_v2: appleWithWeekly(null) }), APPLE);
    assert.ok(tie.ok);
    assert.equal(tie.offeringId, 'launch');
  });

  test('plans are offered as Annual, Monthly, Weekly, whatever order the offering lists them in', () => {
    const reversed = [...appleV2()].reverse();
    const resolution = resolvePaywallOffering(offerings('default_v2', { default_v2: reversed }), APPLE);
    assert.ok(resolution.ok);
    assert.deepEqual(planIds(resolution.plans), ['annual', 'monthly', 'weekly']);
  });

  test('Test Store products are never offered on the App Store, and the reverse', () => {
    assert.deepEqual(verifiedPlans({ identifier: 'default_v2', availablePackages: testStoreV2() } as never, APPLE), []);
    assert.deepEqual(verifiedPlans({ identifier: 'default_v2', availablePackages: appleV2() } as never, TEST_STORE), []);
  });

  test('a package with the wrong product, package ID or billing period is dropped', () => {
    const offering = (packages: PurchasesPackage[]) => ({ identifier: 'x', availablePackages: packages }) as never;
    assert.deepEqual(verifiedPlans(offering([pkg('$rc_annual', 'puphii_monthly_499', '$4.99', 'P1M')]), APPLE), []);
    assert.deepEqual(verifiedPlans(offering([pkg('$rc_annual', 'puphii_annual_2999', '$29.99', 'P1M')]), APPLE), []);
    assert.deepEqual(verifiedPlans(offering([pkg('$rc_six_month', 'puphii_annual_2999', '$29.99', 'P1Y')]), APPLE), []);
    assert.deepEqual(planIds(verifiedPlans(offering([appleV2()[1]]), APPLE)), ['monthly']);
  });

  test('a missing or invalid weekly package leaves Annual and Monthly on offer', () => {
    const invalid: [string, PurchasesPackage | null][] = [
      ['missing', null],
      ['wrong product', pkg('$rc_weekly', 'puphii_monthly_499', '$4.99', 'P1W')],
      ['Test Store product', pkg('$rc_weekly', 'weekly_199', '$1.99', 'P1W')],
      ['monthly period', pkg('$rc_weekly', 'puphii_weekly_199', '$1.99', 'P1M')],
      ['no period', pkg('$rc_weekly', 'puphii_weekly_199', '$1.99', null)],
      ['custom package', pkg('$rc_custom_weekly', 'puphii_weekly_199', '$1.99', 'P1W')],
    ];
    for (const [name, weekly] of invalid) {
      const resolution = resolvePaywallOffering(dashboard(appleWithWeekly(weekly)), APPLE);
      assert.ok(resolution.ok, name);
      assert.equal(resolution.offeringId, 'default_v2', name);
      assert.deepEqual(planIds(resolution.plans), ['annual', 'monthly'], name);
    }
    // Free and paid intros do not disqualify a correctly identified weekly package.
    for (const [name, intro] of [['free trial', THREE_DAY_TRIAL], ['paid intro', PAID_INTRO]] as const) {
      const weekly = pkg('$rc_weekly', 'puphii_weekly_199', '$1.99', 'P1W', { intro });
      const resolution = resolvePaywallOffering(dashboard(appleWithWeekly(weekly)), APPLE);
      assert.ok(resolution.ok, name);
      assert.deepEqual(planIds(resolution.plans), ['annual', 'monthly', 'weekly'], name);
    }
  });

  test('a monthly product with an introductory offer is still offered alongside weekly', () => {
    assert.deepEqual(NO_INTRO_OFFER_PLANS, ['weekly']);
    const [annual, , weekly] = appleV2();
    for (const intro of [DAY_TRIAL, WEEK_TRIAL, PAID_INTRO]) {
      const monthly = pkg('$rc_monthly', 'puphii_monthly_499', '$4.99', 'P1M', { intro });
      const resolution = resolvePaywallOffering(dashboard([annual, monthly, weekly]), APPLE);
      assert.ok(resolution.ok);
      assert.deepEqual(planIds(resolution.plans), ['annual', 'monthly', 'weekly'], JSON.stringify(intro));
      assert.equal(resolution.plans[1].pkg, monthly);
    }
  });

  test('Test Store weekly products are never offered on the App Store, and the reverse', () => {
    const weeklyOnly = (packages: PurchasesPackage[]) => ({ identifier: 'default_v2', availablePackages: [packages[2]] }) as never;
    assert.deepEqual(verifiedPlans(weeklyOnly(testStoreV2()), APPLE), []);
    assert.deepEqual(verifiedPlans(weeklyOnly(appleV2()), TEST_STORE), []);
    assert.deepEqual(planIds(verifiedPlans(weeklyOnly(testStoreV2()), TEST_STORE)), ['weekly']);
  });

  test('missing offerings or products explain what was expected without offering anything', () => {
    for (const response of [offerings(null, {}), offerings('default', { default: ORIGINAL }), dashboard([])]) {
      const resolution = resolvePaywallOffering(response, APPLE);
      assert.equal(resolution.ok, false);
      if (!resolution.ok) {
        assert.match(resolution.detail, /\$rc_annual → puphii_annual_2999/);
        assert.match(resolution.detail, /\$rc_monthly → puphii_monthly_499/);
        assert.match(resolution.detail, /\$rc_weekly → puphii_weekly_199/);
      }
    }
  });

  test('a store with no configured products is never offered anything', () => {
    const android = productIdsFor('platform', 'android');
    assert.deepEqual(android, { annual: null, monthly: null, weekly: null });
    assert.equal(resolvePaywallOffering(dashboard(), android).ok, false);
  });
});

describe('price and trial text come only from store metadata', () => {
  const resolved = resolvePaywallOffering(dashboard(), APPLE);
  const [annual, monthly, weekly] = resolved.ok ? resolved.plans : [];

  test('prices are the localized strings the store reports', () => {
    const yen = { plan: 'annual' as const, pkg: pkg('$rc_annual', 'puphii_annual_2999', '¥4,500', 'P1Y', { perMonth: '¥375' }) };
    const display = describePlan(yen, 'ineligible', 'ios');
    assert.equal(display.price, '¥4,500');
    assert.equal(display.priceLine, '¥4,500 / year');
    assert.equal(display.monthlyEquivalent, 'About ¥375 per month');
    assert.equal(display.billingLine, 'Renews every year until you cancel.');
    assert.match(display.disclosure, /¥4,500 per year/);
    assert.equal(display.accessibilityLabel, 'Yearly plan. ¥4,500 per year, about ¥375 per month. Renews every year until you cancel.');
    assert.ok(![display.disclosure, display.accessibilityLabel, display.ctaAccessibilityLabel].join(' ').includes('$'));
    assert.equal(describePlan(monthly, 'unknown', 'ios').priceLine, '$4.99 / month');
    assert.equal(describePlan(monthly, 'unknown', 'ios').monthlyEquivalent, null);
    assert.equal(describePlan(monthly, 'unknown', 'ios').billingLine, 'Renews every month until you cancel.');

    const yenWeekly = describePlan({ plan: 'weekly', pkg: pkg('$rc_weekly', 'puphii_weekly_199', '¥300', 'P1W') }, 'unknown', 'ios');
    assert.equal(yenWeekly.priceLine, '¥300 / week');
    assert.equal(yenWeekly.billingLine, 'Renews every week until you cancel.');
    assert.match(yenWeekly.disclosure, /^¥300 per week/);
    assert.equal(yenWeekly.accessibilityLabel, 'Weekly plan. ¥300 per week. Renews every week until you cancel.');
    assert.ok(![yenWeekly.priceLine, yenWeekly.disclosure, yenWeekly.accessibilityLabel].join(' ').includes('$'));
  });

  test('the weekly plan states that it is charged every week and renews until cancelled', () => {
    const display = describePlan(weekly, 'unknown', 'ios');
    assert.equal(display.title, 'Weekly');
    assert.equal(display.price, '$1.99');
    assert.equal(display.priceLine, '$1.99 / week');
    assert.equal(display.billingLine, 'Renews every week until you cancel.');
    assert.equal(
      display.disclosure,
      '$1.99 per week, charged to your Apple Account when you confirm. Renews automatically every week unless cancelled at least 24 hours before the current period ends. Cancel anytime in your Apple Account settings.',
    );
    assert.equal(display.monthlyEquivalent, null, 'no approximate per-month figure for a weekly plan, even when the SDK has one');
    assert.equal(display.trialBadge, null, 'unknown eligibility never claims a trial');
    assert.equal(display.cta, 'Subscribe');
  });

  test('weekly never advertises a free trial even if the store product has an intro', () => {
    const withIntro = { plan: 'weekly' as const, pkg: pkg('$rc_weekly', 'puphii_weekly_199', '$1.99', 'P1W', { intro: THREE_DAY_TRIAL }) };
    for (const eligibility of ['eligible', 'ineligible', 'unknown'] as const) {
      const display = describePlan(withIntro, eligibility, 'ios');
      assert.equal(display.trialBadge, null, eligibility);
      assert.equal(display.cta, 'Subscribe', eligibility);
      assert.ok(!/free trial/i.test(display.disclosure + display.billingLine), eligibility);
    }
  });

  test('a monthly introductory offer is described from store data, as before weekly support', () => {
    const freeMonthly = { plan: 'monthly' as const, pkg: pkg('$rc_monthly', 'puphii_monthly_499', '$4.99', 'P1M', { intro: THREE_DAY_TRIAL }) };
    const eligible = describePlan(freeMonthly, 'eligible', 'ios');
    assert.equal(eligible.trialBadge, '3-day free trial');
    assert.equal(eligible.cta, 'Start free trial');
    assert.match(eligible.disclosure, /^Free for 3 days, then \$4\.99 per month, charged to your Apple Account when the trial ends/);
    assert.equal(eligible.billingLine, 'After the free trial, renews every month until you cancel.');
    assert.equal(eligible.accessibilityLabel, 'Monthly plan. 3-day free trial, then $4.99 per month. Renews every month until you cancel.');
    const unknown = describePlan(freeMonthly, 'unknown', 'ios');
    assert.equal(unknown.trialBadge, null);
    assert.match(unknown.disclosure, /If you qualify for an introductory offer, Apple shows it before you confirm/);
    const ineligible = describePlan(freeMonthly, 'ineligible', 'ios');
    assert.equal(ineligible.trialBadge, null);
    assert.ok(!/free/i.test(ineligible.disclosure + ineligible.billingLine));

    const paidMonthly = { plan: 'monthly' as const, pkg: pkg('$rc_monthly', 'puphii_monthly_499', '$4.99', 'P1M', { intro: PAID_INTRO }) };
    const paid = describePlan(paidMonthly, 'eligible', 'ios');
    assert.equal(paid.trialBadge, null, 'a paid introductory offer is never called a free trial');
    assert.equal(paid.cta, 'Subscribe');
  });

  test('the annual billing line mentions the trial only when it is claimed', () => {
    assert.equal(describePlan(annual, 'eligible', 'ios').billingLine, 'After the free trial, renews every year until you cancel.');
    for (const eligibility of ['ineligible', 'unknown'] as const) {
      assert.equal(describePlan(annual, eligibility, 'ios').billingLine, 'Renews every year until you cancel.', eligibility);
    }
  });

  test('the trial is claimed only when the product offers it free and RevenueCat confirms eligibility', () => {
    const eligible = describePlan(annual, 'eligible', 'ios');
    assert.equal(eligible.trialBadge, '7-day free trial');
    assert.equal(eligible.cta, 'Start free trial');
    assert.equal(
      eligible.disclosure,
      'Free for 7 days, then $29.99 per year, charged to your Apple Account when the trial ends. Renews automatically every year unless cancelled at least 24 hours before the trial or current period ends. Cancel anytime in your Apple Account settings.',
    );

    for (const eligibility of ['ineligible', 'unknown'] as const) {
      const display = describePlan(annual, eligibility, 'ios');
      assert.equal(display.trialBadge, null, eligibility);
      assert.equal(display.cta, 'Subscribe', eligibility);
      assert.ok(!/free|trial/i.test(display.disclosure + display.ctaAccessibilityLabel + display.accessibilityLabel), eligibility);
    }
    assert.equal(
      describePlan(annual, 'ineligible', 'ios').disclosure,
      '$29.99 per year, charged to your Apple Account when you confirm. Renews automatically every year unless cancelled at least 24 hours before the current period ends. Cancel anytime in your Apple Account settings.',
    );
    assert.match(describePlan(annual, 'unknown', 'ios').disclosure, /If you qualify for an introductory offer, Apple shows it before you confirm/);
  });

  test('no intro offer or a paid intro offer is never shown as a free trial', () => {
    for (const intro of [null, PAID_INTRO]) {
      const plan = { plan: 'annual' as const, pkg: pkg('$rc_annual', 'puphii_annual_2999', '$29.99', 'P1Y', { intro }) };
      assert.equal(freeTrialLength(plan.pkg), null);
      const display = describePlan(plan, 'eligible', 'ios');
      assert.equal(display.trialBadge, null);
      assert.match(display.disclosure, /when you confirm/);
    }
  });

  test('the trial length is read from the offer, whichever unit the store uses', () => {
    assert.deepEqual(freeTrialLength(pkg('$rc_annual', 'a', '$1', 'P1Y', { intro: DAY_TRIAL })), { amount: 7, unit: 'day' });
    assert.deepEqual(freeTrialLength(pkg('$rc_annual', 'a', '$1', 'P1Y', { intro: WEEK_TRIAL })), { amount: 7, unit: 'day' });
    assert.deepEqual(freeTrialLength(pkg('$rc_annual', 'a', '$1', 'P1Y', { intro: { ...DAY_TRIAL, periodNumberOfUnits: 3 } })), { amount: 3, unit: 'day' });
    assert.deepEqual(freeTrialLength(pkg('$rc_annual', 'a', '$1', 'P1Y', { intro: { ...WEEK_TRIAL, periodUnit: 'MONTH' } })), { amount: 1, unit: 'month' });
    assert.equal(describePlan({ plan: 'annual', pkg: pkg('$rc_annual', 'a', '$1', 'P1Y', { intro: { ...DAY_TRIAL, periodNumberOfUnits: 3 } }) }, 'eligible', 'ios').trialBadge, '3-day free trial');
  });

  test('every disclosure states the billing period, auto-renewal and how to cancel', () => {
    for (const display of [
      describePlan(annual, 'eligible', 'ios'),
      describePlan(annual, 'ineligible', 'ios'),
      describePlan(monthly, 'unknown', 'ios'),
      describePlan(weekly, 'unknown', 'ios'),
    ]) {
      assert.match(display.disclosure, /Renews automatically every (year|month|week)/);
      assert.match(display.disclosure, /unless cancelled at least 24 hours before the (trial or )?current period ends/);
      assert.match(display.disclosure, /Cancel anytime in your Apple Account settings\.$/);
      assert.match(display.disclosure, /charged to your Apple Account/);
    }
    assert.match(describePlan(monthly, 'unknown', 'android').disclosure, /Google Account/);
    assert.match(describePlan(weekly, 'unknown', 'android').disclosure, /Google Account/);
  });

  test('the disclosure stays short: at most four sentences and 45 words', () => {
    for (const display of everyDisplay()) {
      const sentences = display.disclosure.split(/(?<=\.) /).length;
      assert.ok(sentences <= 4, `${display.plan}: ${sentences} sentences`);
      assert.ok(display.disclosure.split(' ').length <= 45, `${display.plan}: ${display.disclosure}`);
    }
  });

  const everyDisplay = () =>
    [annual, monthly, weekly].flatMap((plan) => (['eligible', 'ineligible', 'unknown'] as const).map((eligibility) => describePlan(plan, eligibility, 'ios')));

  test('the card states the price once, and the selected plan terms state it once more', () => {
    for (const display of everyDisplay()) {
      const card = [display.title, display.trialBadge ?? '', display.priceLine, display.monthlyEquivalent ?? '', display.billingLine].join(' ');
      assert.equal(occurrences(card, display.price), 1, `${display.plan} card`);
      assert.equal(occurrences(display.disclosure, display.price), 1, `${display.plan} disclosure`);
      assert.match(display.billingLine, new RegExp(`renews every ${display.priceLine.split(' / ')[1]} until you cancel\\.$`, 'i'));
    }
  });

  test('each plan card is announced with its price, period, any claimed trial and renewal, each once', () => {
    assert.deepEqual(
      [describePlan(annual, 'eligible', 'ios'), describePlan(annual, 'ineligible', 'ios'), describePlan(monthly, 'unknown', 'ios'), describePlan(weekly, 'unknown', 'ios')].map(
        (display) => display.accessibilityLabel,
      ),
      [
        'Yearly plan. 7-day free trial, then $29.99 per year, about $2.49 per month. Renews every year until you cancel.',
        'Yearly plan. $29.99 per year, about $2.49 per month. Renews every year until you cancel.',
        'Monthly plan. $4.99 per month. Renews every month until you cancel.',
        'Weekly plan. $1.99 per week. Renews every week until you cancel.',
      ],
    );
    for (const display of everyDisplay()) {
      assert.equal(occurrences(display.accessibilityLabel, display.price), 1, display.plan);
      assert.ok(!display.accessibilityLabel.includes(' / '), 'no "slash" read aloud');
      assert.equal(occurrences(display.accessibilityLabel, 'free trial'), display.trialBadge ? 1 : 0, display.plan);
      assert.equal(occurrences(display.accessibilityLabel, 'Renews every'), 1, display.plan);
    }
  });

  test('the purchase button names the action, plan and price without repeating the trial', () => {
    assert.equal(describePlan(annual, 'eligible', 'ios').ctaAccessibilityLabel, 'Start free trial, Yearly plan, then $29.99 per year');
    assert.equal(describePlan(annual, 'ineligible', 'ios').ctaAccessibilityLabel, 'Subscribe, Yearly plan, $29.99 per year');
    assert.equal(describePlan(monthly, 'unknown', 'ios').ctaAccessibilityLabel, 'Subscribe, Monthly plan, $4.99 per month');
    assert.equal(describePlan(weekly, 'eligible', 'ios').ctaAccessibilityLabel, 'Subscribe, Weekly plan, $1.99 per week');
  });

  test('each platform names its own store', () => {
    assert.deepEqual(['ios', 'android', 'web'].map(storeNameFor), ['Apple', 'Google Play', 'your app store']);
    assert.deepEqual(['ios', 'android', 'web'].map(storeAccountFor), ['Apple Account', 'Google Account', 'app store account']);
  });
});

describe('puphii_pro is the only source of Pro status', () => {
  test('active and grace-period entitlements count; everything else does not', () => {
    assert.equal(hasProAccess(ACTIVE), true);
    assert.equal(proStatusLabel(ACTIVE), 'Active');
    assert.equal(proStatusLabel({ ...ACTIVE, period: 'trial' }), 'Free trial');
    const grace: Entitlement = { status: 'gracePeriod', plan: 'annual', expiresAt: null, verification: ACTIVE.verification };
    assert.equal(hasProAccess(grace), true);
    const none: Entitlement[] = [
      { status: 'unknown' },
      { status: 'billingRetry', plan: 'annual', verification: ACTIVE.verification },
      { status: 'inactive', reason: 'expired', lastPlan: 'annual', annualTrial: 'unknown', verification: ACTIVE.verification },
      { status: 'error', error: { kind: 'network', message: 'offline' } },
    ];
    for (const entitlement of none) {
      assert.equal(hasProAccess(entitlement), false, entitlement.status);
      assert.equal(proStatusLabel(entitlement), undefined, entitlement.status);
    }
  });
});

describe('paywall controller', () => {
  test('loads the verified Apple plans and selects the annual plan first', async () => {
    const { controller, calls } = fakes();
    await controller.load();
    const state = controller.current();
    assert.equal(state.phase, 'ready');
    assert.equal(state.offeringId, 'default_v2');
    assert.deepEqual(planIds(state.plans), ['annual', 'monthly', 'weekly']);
    assert.equal(state.selected, 'annual');
    assert.deepEqual(calls.eligibility, [['puphii_annual_2999', 'puphii_monthly_499']], 'weekly never checked for intro eligibility');
    assert.deepEqual(state.trial, { annual: 'eligible', monthly: 'eligible' });
  });

  test('without a usable weekly package the paywall still loads Annual and Monthly, with Annual selected', async () => {
    for (const weekly of [null, pkg('$rc_weekly', 'weekly_199', '$1.99', 'P1W')]) {
      const { controller, control, calls } = fakes();
      control.offerings = () => Promise.resolve(dashboard(appleWithWeekly(weekly)));
      await controller.load();
      const state = controller.current();
      assert.equal(state.phase, 'ready');
      assert.deepEqual(planIds(state.plans), ['annual', 'monthly']);
      assert.equal(state.selected, 'annual');
      assert.deepEqual(calls.eligibility, [['puphii_annual_2999', 'puphii_monthly_499']]);
      controller.select('weekly');
      assert.equal(controller.current().selected, 'annual', 'a plan that is not offered cannot be selected');
    }
  });

  test('a monthly free trial keeps monthly on offer and has its eligibility checked', async () => {
    const { controller, control, calls } = fakes();
    const [annual, , weekly] = appleV2();
    control.offerings = () => Promise.resolve(dashboard([annual, pkg('$rc_monthly', 'puphii_monthly_499', '$4.99', 'P1M', { intro: DAY_TRIAL }), weekly]));
    await controller.load();
    const state = controller.current();
    assert.equal(state.phase, 'ready');
    assert.deepEqual(planIds(state.plans), ['annual', 'monthly', 'weekly']);
    assert.equal(state.selected, 'annual');
    assert.deepEqual(calls.eligibility, [['puphii_annual_2999', 'puphii_monthly_499']]);
    assert.deepEqual(state.trial, { annual: 'eligible', monthly: 'eligible' });
  });

  test('the weekly plan can be selected and bought, and only its own product is purchased', async () => {
    const { controller, calls } = fakes();
    await controller.load();
    controller.select('weekly');
    assert.equal(controller.current().selected, 'weekly');
    assert.equal(await controller.purchase(), 'purchased');
    assert.deepEqual(calls.purchase, ['puphii_weekly_199']);
    assert.equal(calls.refresh, 1);
  });

  test('a failed eligibility check means no trial is claimed', async () => {
    const { controller, control } = fakes();
    control.eligibility = () => Promise.reject(new Error('offline'));
    await controller.load();
    const state = controller.current();
    assert.equal(state.phase, 'ready');
    assert.deepEqual(state.trial, { annual: 'unknown', monthly: 'unknown' });
    assert.equal(describePlan(state.plans[0], state.trial.annual!, 'ios').trialBadge, null);
  });

  test('ineligible customers never see the trial', async () => {
    const { controller, control } = fakes();
    control.eligibility = (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, { status: INTRO_ELIGIBILITY.INELIGIBLE }])));
    await controller.load();
    assert.deepEqual(controller.current().trial, { annual: 'ineligible', monthly: 'ineligible' });
  });

  test('missing offerings, products, SDK or configuration show an unavailable state', async () => {
    const cases: [ReturnType<typeof fakes>, RegExp][] = [];
    const empty = fakes();
    empty.control.offerings = () => Promise.resolve(offerings(null, {}));
    cases.push([empty, /aren't available right now/]);
    const wrong = fakes();
    wrong.control.offerings = () => Promise.resolve(dashboard(testStoreV2()));
    cases.push([wrong, /aren't available right now/]);
    cases.push([fakes({ sdkAvailable: false }), /aren't available in this version/]);
    cases.push([fakes({ configured: false }), /aren't set up in this build/]);
    const offline = fakes();
    offline.control.offerings = () => Promise.reject(storeError('10'));
    cases.push([offline, /Check your connection/]);
    for (const [{ controller }, message] of cases) {
      await controller.load();
      const state = controller.current();
      assert.equal(state.phase, 'unavailable');
      assert.deepEqual(state.plans, []);
      assert.match(state.unavailable!.message, message);
      assert.equal(await controller.purchase(), 'notReady');
    }
  });

  test('retrying after a failure loads the plans', async () => {
    const { controller, control } = fakes();
    control.offerings = () => Promise.reject(storeError('10'));
    await controller.load();
    assert.equal(controller.current().phase, 'unavailable');
    control.offerings = () => Promise.resolve(dashboard());
    await controller.load();
    assert.equal(controller.current().phase, 'ready');
  });

  test('a purchase that activates puphii_pro succeeds and refreshes the entitlement', async () => {
    const { controller, calls } = fakes();
    await controller.load();
    controller.select('monthly');
    assert.equal(await controller.purchase(), 'purchased');
    assert.deepEqual(calls.purchase, ['puphii_monthly_499']);
    assert.equal(calls.refresh, 1);
    assert.equal(controller.current().notice?.tone, 'success');
    assert.equal(controller.current().busy, null);
  });

  test('a completed purchase without an active puphii_pro is not reported as success', async () => {
    const { controller, control, calls } = fakes();
    const others = [
      customer(),
      customer([proEntry({ identifier: 'another_entitlement' })]),
      customer([proEntry({ isActive: false })]),
    ];
    await controller.load();
    for (const info of others) {
      control.purchase = (p) => Promise.resolve({ productIdentifier: p.product.identifier, customerInfo: info } as MakePurchaseResult);
      assert.equal(await controller.purchase(), 'notActive');
      assert.equal(controller.current().notice?.tone, 'info');
      assert.match(controller.current().notice!.message, /isn't active yet/);
    }
    assert.equal(calls.refresh, others.length, 'the entitlement service is still asked');
  });

  test('a malformed purchase result is a failure, never access', async () => {
    const { controller, control } = fakes();
    await controller.load();
    control.purchase = () => Promise.resolve(undefined as unknown as MakePurchaseResult);
    assert.equal(await controller.purchase(), 'failed');
    assert.equal(controller.current().notice?.tone, 'error');
  });

  test('a refresh failure after a successful purchase keeps the purchase result', async () => {
    const { controller, control } = fakes();
    control.refreshFails = true;
    await controller.load();
    assert.equal(await controller.purchase(), 'purchased');
  });

  test('cancellation is reported calmly and grants nothing', async () => {
    const { controller, control, calls } = fakes();
    await controller.load();
    for (const error of [storeError('1'), storeError('99', { userCancelled: true })]) {
      control.purchase = () => Promise.reject(error);
      assert.equal(await controller.purchase(), 'cancelled');
      assert.deepEqual(controller.current().notice, { tone: 'info', message: 'Purchase cancelled. Nothing was charged.' });
    }
    assert.equal(calls.refresh, 0);
  });

  test('purchase failures map to accurate messages', async () => {
    const cases: [string, 'failed' | 'pending', RegExp][] = [
      ['10', 'failed', /Couldn't reach the App Store/],
      ['35', 'failed', /Couldn't reach the App Store/],
      ['3', 'failed', /isn’t allowed to make purchases/],
      ['5', 'failed', /plan isn't available/],
      ['6', 'failed', /Restore Purchases/],
      ['2', 'failed', /The App Store couldn't complete the purchase/],
      ['20', 'pending', /waiting for approval/],
      ['999', 'failed', /couldn't be completed/],
    ];
    for (const [code, outcome, message] of cases) {
      const { controller, control } = fakes();
      await controller.load();
      control.purchase = () => Promise.reject(storeError(code));
      assert.equal(await controller.purchase(), outcome, code);
      assert.match(controller.current().notice!.message, message, code);
      assert.equal(controller.current().notice!.tone, outcome === 'pending' ? 'info' : 'error', code);
    }
  });

  test('duplicate purchases and restores are ignored while one is running', async () => {
    const { controller, control, calls } = fakes();
    await controller.load();
    const pending = deferred<MakePurchaseResult>();
    control.purchase = () => pending.promise;
    const first = controller.purchase();
    assert.equal(controller.current().busy, 'purchasing');
    assert.equal(await controller.purchase(), 'busy');
    assert.equal(await controller.restore(), 'busy');
    controller.select('monthly');
    assert.equal(controller.current().selected, 'annual', 'the plan cannot change mid-purchase');
    await controller.load();
    assert.equal(calls.getOfferings, 1, 'no reload mid-purchase');
    pending.resolve({ productIdentifier: 'puphii_annual_2999', customerInfo: customer([proEntry()]) } as MakePurchaseResult);
    assert.equal(await first, 'purchased');
    assert.deepEqual(calls.purchase, ['puphii_annual_2999']);
    assert.equal(calls.restore, 0);
    assert.equal(controller.current().busy, null);
  });

  test('restore reports what RevenueCat found', async () => {
    const results: [RestoreResult, 'success' | 'info' | 'error', RegExp][] = [
      [{ outcome: 'restored', entitlement: ACTIVE }, 'success', /has been restored/],
      [{ outcome: 'nothingToRestore', entitlement: { status: 'unknown' } }, 'info', /No Puphii Pro subscription was found for this Apple Account/],
      [
        { outcome: 'foundInactive', entitlement: { status: 'inactive', reason: 'expired', lastPlan: 'annual', annualTrial: 'unknown', verification: ACTIVE.verification } },
        'info',
        /has ended/,
      ],
      [{ outcome: 'foundInactive', entitlement: { status: 'billingRetry', plan: 'annual', verification: ACTIVE.verification } }, 'info', /renewal payment is failing/],
      [{ outcome: 'failed', error: { kind: 'network', message: 'Check your connection.' } }, 'error', /Couldn't restore purchases\. Check your connection\./],
    ];
    for (const [result, tone, message] of results) {
      const { controller, control, calls } = fakes();
      control.restore = () => Promise.resolve(result);
      assert.equal(await controller.restore(), result.outcome);
      assert.equal(controller.current().notice!.tone, tone);
      assert.match(controller.current().notice!.message, message);
      assert.equal(calls.restore, 1);
      assert.equal(controller.current().busy, null);
    }
  });

  test('a restore that throws is a failure', async () => {
    const { controller, control } = fakes();
    control.restore = () => Promise.reject(storeError('10'));
    assert.equal(await controller.restore(), 'failed');
    assert.equal(controller.current().notice!.tone, 'error');
  });

  test('restore works even when no plans could be loaded', async () => {
    const { controller, control } = fakes({ sdkAvailable: false });
    control.restore = () => Promise.resolve({ outcome: 'restored', entitlement: ACTIVE });
    await controller.load();
    assert.equal(await controller.restore(), 'restored');
  });

  test('the paywall error codes are RevenueCat’s', () => {
    for (const [name, code] of Object.entries(PURCHASE_CODES)) assert.equal(rc.PURCHASES_ERROR_CODE[name], code, name);
    assert.equal(purchaseErrorNotice(storeError('6'), 'android').notice.message.includes('Google Account'), true);
  });
});

describe('Test Store configuration is preserved', () => {
  test('the Test Store products are unchanged and stay separate from the App Store ones', () => {
    assert.deepEqual(TEST_STORE_PRODUCT_IDS, { annual: 'yearly_2999', monthly: 'monthly_499', weekly: 'weekly_199' });
    assert.deepEqual(TEST_STORE, { annual: 'yearly_2999', monthly: 'monthly_499', weekly: 'weekly_199' });
    for (const id of Object.values(TEST_STORE)) assert.ok(!Object.values(APPLE).includes(id));
  });

  test('with the Test Store key, the paywall offers the Test Store products from default_v2', async () => {
    const { controller, control, calls } = fakes({ productIds: TEST_STORE });
    control.offerings = () => Promise.resolve(dashboard(testStoreV2()));
    await controller.load();
    assert.equal(controller.current().phase, 'ready');
    assert.deepEqual(
      controller.current().plans.map((p) => p.pkg.product.identifier),
      ['yearly_2999', 'monthly_499', 'weekly_199'],
    );
    await controller.purchase();
    assert.deepEqual(calls.purchase, ['yearly_2999']);
  });

  test('the development harness is untouched and still behind __DEV__', () => {
    const app = read('App.tsx');
    assert.match(app, /const DevTools: DevToolsModule \| null = __DEV__ \? require\('\.\/src\/dev\/TestStoreHarness'\) : null;/);
    assert.ok(!/src\/dev/.test(read('src', 'screens', 'PaywallScreen.tsx')));
    assert.ok(!/src\/dev|\.\.\/dev\//.test(read('src', 'subscription', 'paywall.ts')));
  });
});

describe('navigation and access', () => {
  test('with gating active, people without Pro are locked out of Pro features only until status is confirmed', () => {
    assert.equal(SUBSCRIPTION_GATING_ENABLED, true);
    const inactive: Entitlement = { status: 'inactive', reason: 'neverSubscribed', lastPlan: null, annualTrial: 'unknown', verification: ACTIVE.verification };
    const pro = (entitlement: Entitlement, gatingEnabled: boolean) => accessFor(entitlement, { gatingEnabled, allowMock: false }).pro;
    assert.equal(pro(inactive, true), 'denied');
    assert.equal(pro({ status: 'unknown' }, true), 'checking');
    assert.equal(pro({ status: 'error', error: { kind: 'network', message: '' } }, true), 'checking');
    for (const entitlement of [inactive, { status: 'unknown' } as Entitlement]) assert.equal(pro(entitlement, false), 'granted');
  });

  test('unsubscribed users see the lock gate; entitled users open manage paywall from You', () => {
    const app = read('App.tsx');
    assert.match(app, /AccessRoot/);
    assert.match(app, /PaywallGate/);
    assert.match(app, /SubscriptionCheckingScreen/);
    assert.match(app, /const \[paywallOpen, setPaywallOpen\] = useState\(false\);/);
    assert.match(app, /const openManageSubscription = useCallback\(\(\) => setPaywallOpen\(true\), \[\]\);/);
    assert.match(app, /onOpenPro=\{openManageSubscription\}/);
    assert.match(app, /<PaywallScreen visible=\{paywallOpen\} onClose=\{\(\) => setPaywallOpen\(false\)\} \/>/);
    assert.equal((app.match(/<ProEntryProvider/g) ?? []).length, 0);
    for (const screen of ['HomeScreen', 'InsightsScreen', 'BubbleBreakScreen']) {
      assert.ok(!/Paywall|paywall/.test(read('src', 'screens', `${screen}.tsx`)), `${screen} must not open the paywall`);
    }
  });

  test('the You screen shows the Puphii Pro row only when it is given an entry point', () => {
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    assert.match(settings, /label="Subscription"/);
  });

  test('Home, Bubble Break and the Insights shell never read subscription status', () => {
    for (const screen of ['HomeScreen', 'InsightsScreen', 'BubbleBreakScreen']) {
      assert.ok(!/useEntitlement|access\.pro|ProGate|useProFeature/.test(read('src', 'screens', `${screen}.tsx`)), screen);
    }
  });
});

describe('release configuration', () => {
  test('legal links are unset, not invented, and the benefits are the gated features', () => {
    assert.deepEqual(LEGAL_URLS, { termsOfUse: null, privacyPolicy: null });
    assert.ok(PRO_BENEFITS && PRO_BENEFITS.length >= 3);
    assert.ok(!/https?:\/\//.test(read('src', 'screens', 'PaywallScreen.tsx')), 'no hard-coded links in the paywall');
  });

  test('legal links gate purchases, not app unlock; showPaywallEntry stays available', () => {
    assert.deepEqual(paywallConfigIssues().map((issue) => issue.split(' (')[0]), ['Terms of Use URL', 'Privacy Policy URL'], 'only the legal links are missing');
    assert.equal(paywallConfigIssues(undefined, null).length, 3);
    assert.equal(showPaywallEntry(false), true);
    assert.equal(showPaywallEntry(true), true);
    const ready = { termsOfUse: 'https://example.org/terms', privacyPolicy: 'https://example.org/privacy' };
    assert.deepEqual(paywallConfigIssues(ready, ['Something real']), []);
    assert.equal(showPaywallEntry(false, paywallConfigIssues(ready, ['Something real'])), true);
  });

  test('placeholder or insecure links do not count as configured', () => {
    for (const url of ['', 'TODO', 'http://example.org/terms', 'https://', 'example.org/terms', 'https:// example.org']) {
      assert.equal(paywallConfigIssues({ termsOfUse: url, privacyPolicy: url }, ['x']).length, 2, url);
    }
    assert.equal(paywallConfigIssues({ termsOfUse: 'https://example.org/t', privacyPolicy: 'https://example.org/p' }, []).length, 1);
    assert.equal(paywallConfigIssues({ termsOfUse: 'https://example.org/t', privacyPolicy: 'https://example.org/p' }, [' ']).length, 1);
  });

  test('the iOS privacy manifest declares the purchase history RevenueCat collects', () => {
    const manifest = JSON.parse(read('app.json')).expo.ios.privacyManifests;
    assert.equal(manifest.NSPrivacyTracking, false);
    assert.deepEqual(manifest.NSPrivacyCollectedDataTypes, [
      {
        NSPrivacyCollectedDataType: 'NSPrivacyCollectedDataTypePurchaseHistory',
        NSPrivacyCollectedDataTypeLinked: false,
        NSPrivacyCollectedDataTypeTracking: false,
        NSPrivacyCollectedDataTypePurposes: ['NSPrivacyCollectedDataTypePurposeAppFunctionality'],
      },
    ]);
  });

  test('release-readiness checks live in the developer tools, not on the paywall', () => {
    const screen = read('src', 'screens', 'PaywallScreen.tsx');
    assert.ok(!/paywallConfigIssues|ConfigNotice|Before release|__DEV__|\.detail\b/.test(screen));
    assert.ok(!/LEGAL_URLS\.\w+ in|PRO_BENEFITS in|src\/|config\.ts|RevenueCat/.test(screen.replace(/^import .*$/gm, '')), 'no code paths or SDK names shown');
    const tools = read('src', 'dev', 'TestStoreHarness.tsx');
    assert.match(tools, /function ReleaseReadiness\(\)/);
    assert.match(tools, /const issues = paywallConfigIssues\(\);/);
    assert.match(tools, /paywallConfigIssues/);
    assert.match(tools, /<ReleaseReadiness \/>/);
  });

  test('the subscription terms sit directly under the purchase button', () => {
    const screen = read('src', 'screens', 'PaywallScreen.tsx');
    assert.match(screen, /onPress=\{\(\) => void controller\.purchase\(\)\}\s*\/>\s*<AppText[^>]*style=\{styles\.disclosure\}>\s*\{selected\.disclosure\}/);
    assert.ok(!/anonymous/i.test(screen), 'the data-processing explanation lives in the Privacy Policy');
  });

  test('the paywall logs nothing and validates no receipts itself', () => {
    for (const file of [read('src', 'subscription', 'paywall.ts'), read('src', 'screens', 'PaywallScreen.tsx')]) {
      assert.ok(!/console\./.test(file));
      assert.ok(!/receipt(Data|Url|URL)|appStoreReceipt|verifyReceipt|transactionReceipt/.test(file));
      assert.ok(!/sk_[A-Za-z0-9]/.test(file));
    }
  });

  test('the paywall shows restore, legal links, a close action and the store disclosure', () => {
    const screen = read('src', 'screens', 'PaywallScreen.tsx');
    for (const text of [
      'Restore Purchases',
      'Terms of Use',
      'Privacy Policy',
      'Close subscription',
      'selected.disclosure',
      '{plan.billingLine}',
      'accessibilityLabel={plan.accessibilityLabel}',
      'selected.ctaAccessibilityLabel',
      'Loading subscription options',
      'Try again',
    ]) {
      assert.ok(screen.includes(text), text);
    }
  });

  test('plan cards and the disclosure wrap and scroll instead of truncating', () => {
    const screen = read('src', 'screens', 'PaywallScreen.tsx');
    assert.ok(!/numberOfLines|adjustsFontSizeToFit|ellipsizeMode/.test(screen));
    assert.ok(screen.includes('<ScrollView'));
    const planStyle = /\n  plan: \{([^}]*)\}/.exec(screen)?.[1] ?? '';
    assert.match(planStyle, /minHeight: 76/);
    assert.ok(!/\bheight:/.test(planStyle.replace('minHeight', '')), 'plan cards grow with their text');
  });
});

describe('paywall contrast (WCAG AA: 4.5:1 for normal text, 3:1 for non-text indicators)', () => {
  const tokens = read('src', 'theme', 'tokens.ts');
  const screen = read('src', 'screens', 'PaywallScreen.tsx');
  const backdropSource = read('src', 'components', 'OceanBackground.tsx');
  const hex = (name: string): string => {
    const match = new RegExp(`\\b${name}: (?:'(#[0-9A-Fa-f]{6})'|palette\\.(\\w+))`).exec(tokens);
    assert.ok(match, name);
    return match[1] ?? hex(match[2]);
  };
  const luminance = (color: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (light + 0.05) / (dark + 0.05);
  };
  /** The token a piece of the screen uses, read from the screen's source. */
  const tokenIn = (pattern: RegExp) => {
    const name = pattern.exec(screen)?.[1];
    assert.ok(name, String(pattern));
    return name;
  };
  /** Every solid color the reef backdrop paints; its translucent layers only blend between these and white. */
  const backdrop = [
    ...new Set([...backdropSource.matchAll(/colors\.(\w+)/g)].map((match) => hex(match[1]))),
    ...[...backdropSource.matchAll(/'(#[0-9A-Fa-f]{6})'/g)].map((match) => match[1]),
  ];
  const assertTextOverBackdrop = (token: string, what: string) => {
    for (const background of backdrop) {
      const ratio = contrast(hex(token), background);
      assert.ok(ratio >= 4.5, `${what} (${token}) on ${background}: ${ratio.toFixed(2)}`);
    }
  };

  test('the backdrop colors include the gradient, seaweed and coral', () => {
    for (const token of ['skyBlue', 'oceanBlue', 'seafoam', 'coralPink', 'peach']) assert.ok(backdrop.includes(hex(token)), token);
    assert.ok(backdrop.length >= 7);
  });

  test('text on the selected (peach) plan card', () => {
    for (const text of ['textPrimaryStrong', 'textMutedStrong']) {
      assert.ok(contrast(hex(text), hex('peach')) >= 4.5, `${text} on peach: ${contrast(hex(text), hex('peach')).toFixed(2)}`);
    }
    assert.ok(contrast(hex('coralInk'), hex('white')) >= 4.5, 'trial badge text on its white pill');
    assert.ok(contrast(hex('textMuted'), hex('peach')) < 4.5, 'why textMuted is not used on peach');
  });

  test('text on unselected (white) plan cards', () => {
    for (const text of ['textPrimary', 'textMuted']) assert.ok(contrast(hex(text), hex('white')) >= 4.5, text);
  });

  test('the renewal disclosure over every color of the reef backdrop', () => {
    assertTextOverBackdrop(tokenIn(/color=\{colors\.(\w+)\} style=\{styles\.disclosure\}/), 'disclosure');  });

  test('the legal-link captions over every color of the reef backdrop', () => {
    assertTextOverBackdrop(tokenIn(/<AppText variant="caption" color=\{colors\.(\w+)\} style=\{styles\.underline\}>/), 'legal link');
    assertTextOverBackdrop(tokenIn(/<AppText variant="caption" color=\{colors\.(\w+)\}>\s*\{label\} \(not configured\)/), 'unconfigured legal link');
    assertTextOverBackdrop(tokenIn(/<AppText variant="caption" color=\{colors\.(\w+)\} accessible=\{false\}>\s*·/), 'legal separator');
    assert.ok(contrast(hex('textMuted'), hex('coralPink')) < 4.5, 'why textMuted is not used over the backdrop');
    assert.ok(contrast(hex('textPrimary'), hex('coralPink')) < 4.5, 'why textPrimary is not used over the backdrop');
  });

  test('Restore Purchases over every color of the reef backdrop', () => {
    const token = tokenIn(/<AppText variant="label" color=\{colors\.(\w+)\}>\s*\{state\.busy === 'restoring' \? 'Restoring…' : 'Restore Purchases'\}/);
    assert.equal(token, 'textPrimaryStrong');
    assertTextOverBackdrop(token, 'Restore Purchases');
  });

  test('the selected radio stands out from the peach card and shows a check, not just a color', () => {
    const card = hex(tokenIn(/planSelected: \{ backgroundColor: colors\.(\w+)/));
    const fill = hex(tokenIn(/radioSelected: \{ backgroundColor: colors\.(\w+)/));
    const ring = hex(tokenIn(/radioSelected: \{ backgroundColor: colors\.\w+, borderColor: colors\.(\w+)/));
    const check = hex(tokenIn(/\{selected \? <Icon name="check" size=\{16\} color=\{colors\.(\w+)\}[^\n]*?\/> : null\}/));
    assert.ok(contrast(ring, card) >= 3, `radio ring on the selected card: ${contrast(ring, card).toFixed(2)}`);
    assert.ok(contrast(check, fill) >= 3, `check mark on the radio fill: ${contrast(check, fill).toFixed(2)}`);
    assert.ok(contrast(fill, card) < 3, 'why the fill alone is not enough');
    assert.match(/\n  radio: \{([^}]*)\}/.exec(screen)?.[1] ?? '', /borderWidth: 2,/);
  });

  test('the screen uses the stronger colors where the background needs them', () => {
    assert.match(screen, /const ink = selected \? colors\.textPrimaryStrong : colors\.textPrimary;/);
    assert.match(screen, /const muted = selected \? colors\.textMutedStrong : colors\.textMuted;/);
    assert.match(screen, /variant="cardTitle" color=\{ink\}/);
    assert.match(screen, /variant="bodyStrong" color=\{ink\}/);
    assert.equal(occurrences(screen, 'variant="caption" color={muted}'), 2);
  });
});
