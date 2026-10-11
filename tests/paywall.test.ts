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

const APPLE = productIdsFor('platform', 'ios');
const TEST_STORE = productIdsFor('testStore', 'ios');
const ENTITLEMENT = REVENUECAT_ENTITLEMENT_ID!;
const REQUEST_DATE = '2026-10-10T12:00:00.000Z';

const DAY_TRIAL = { price: 0, priceString: '$0.00', cycles: 1, period: 'P1W', periodUnit: 'DAY', periodNumberOfUnits: 7 };
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
    packageType: identifier === '$rc_annual' ? 'ANNUAL' : 'MONTHLY',
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
  pkg('$rc_monthly', 'puphii_monthly_499', '$4.99', 'P1M'),
];
/** `default_v2` as the Test Store sees it. */
const testStoreV2 = () => [
  pkg('$rc_annual', 'yearly_2999', '$29.99', 'P1Y', { intro: DAY_TRIAL, perMonth: '$2.49' }),
  pkg('$rc_monthly', 'monthly_499', '$4.99', 'P1M'),
];
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
  });
  return { controller, calls, control };
}

const planIds = (plans: { plan: PlanId }[]) => plans.map((p) => p.plan);

describe('Apple product to package mapping', () => {
  test('the App Store products and packages are the configured ones', () => {
    assert.deepEqual(APPLE, { annual: 'puphii_annual_2999', monthly: 'puphii_monthly_499' });
    assert.equal(PLANS.annual.packageId, '$rc_annual');
    assert.equal(PLANS.monthly.packageId, '$rc_monthly');
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
      ],
    );
  });

  test('uses the current offering when it already holds the configured products', () => {
    const resolution = resolvePaywallOffering(offerings('launch', { launch: appleV2(), default_v2: appleV2() }), APPLE);
    assert.ok(resolution.ok);
    assert.equal(resolution.offeringId, 'launch');
  });

  test('an offering with both plans wins over a current offering with only one', () => {
    const resolution = resolvePaywallOffering(offerings('default', { default: [appleV2()[1]], default_v2: appleV2() }), APPLE);
    assert.ok(resolution.ok);
    assert.equal(resolution.offeringId, 'default_v2');
    assert.deepEqual(planIds(resolution.plans), ['annual', 'monthly']);
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

  test('missing offerings or products explain what was expected without offering anything', () => {
    for (const response of [offerings(null, {}), offerings('default', { default: ORIGINAL }), dashboard([])]) {
      const resolution = resolvePaywallOffering(response, APPLE);
      assert.equal(resolution.ok, false);
      if (!resolution.ok) {
        assert.match(resolution.detail, /\$rc_annual → puphii_annual_2999/);
        assert.match(resolution.detail, /\$rc_monthly → puphii_monthly_499/);
      }
    }
  });

  test('a store with no configured products is never offered anything', () => {
    const android = productIdsFor('platform', 'android');
    assert.deepEqual(android, { annual: null, monthly: null });
    assert.equal(resolvePaywallOffering(dashboard(), android).ok, false);
  });
});

describe('price and trial text come only from store metadata', () => {
  const resolved = resolvePaywallOffering(dashboard(), APPLE);
  const [annual, monthly] = resolved.ok ? resolved.plans : [];

  test('prices are the localized strings the store reports', () => {
    const yen = { plan: 'annual' as const, pkg: pkg('$rc_annual', 'puphii_annual_2999', '¥4,500', 'P1Y', { perMonth: '¥375' }) };
    const display = describePlan(yen, 'ineligible', 'ios');
    assert.equal(display.price, '¥4,500');
    assert.equal(display.priceLine, '¥4,500 / year');
    assert.equal(display.monthlyEquivalent, '¥375 per month, billed yearly');
    assert.match(display.disclosure, /¥4,500 per year/);
    assert.ok(!display.disclosure.includes('$'));
    assert.equal(describePlan(monthly, 'unknown', 'ios').priceLine, '$4.99 / month');
    assert.equal(describePlan(monthly, 'unknown', 'ios').monthlyEquivalent, null);
  });

  test('the trial is claimed only when the product offers it free and RevenueCat confirms eligibility', () => {
    const eligible = describePlan(annual, 'eligible', 'ios');
    assert.equal(eligible.trialBadge, '7-day free trial');
    assert.equal(eligible.cta, 'Start free trial');
    assert.match(eligible.disclosure, /^Free for 7 days, then \$29\.99 per year\./);
    assert.match(eligible.disclosure, /charged \$29\.99 when the trial ends/);

    for (const eligibility of ['ineligible', 'unknown'] as const) {
      const display = describePlan(annual, eligibility, 'ios');
      assert.equal(display.trialBadge, null, eligibility);
      assert.equal(display.cta, 'Subscribe', eligibility);
      assert.ok(!/free/i.test(display.disclosure), eligibility);
    }
    assert.match(describePlan(annual, 'ineligible', 'ios').disclosure, /charged to your Apple Account when you confirm/);
    assert.match(describePlan(annual, 'unknown', 'ios').disclosure, /If you qualify for an introductory offer, the store shows it before you confirm/);
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
    for (const display of [describePlan(annual, 'eligible', 'ios'), describePlan(annual, 'ineligible', 'ios'), describePlan(monthly, 'unknown', 'ios')]) {
      assert.match(display.disclosure, /renews automatically every (year|month)/);
      assert.match(display.disclosure, /at least 24 hours before the end of the current period/);
      assert.match(display.disclosure, /Manage or cancel it anytime in your Apple Account settings/);
    }
    assert.match(describePlan(monthly, 'unknown', 'android').disclosure, /Google Account/);
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
    assert.deepEqual(planIds(state.plans), ['annual', 'monthly']);
    assert.equal(state.selected, 'annual');
    assert.deepEqual(calls.eligibility, [['puphii_annual_2999']], 'eligibility is only checked for products with a free trial');
    assert.deepEqual(state.trial, { annual: 'eligible' });
  });

  test('a failed eligibility check means no trial is claimed', async () => {
    const { controller, control } = fakes();
    control.eligibility = () => Promise.reject(new Error('offline'));
    await controller.load();
    const state = controller.current();
    assert.equal(state.phase, 'ready');
    assert.deepEqual(state.trial, { annual: 'unknown' });
    assert.equal(describePlan(state.plans[0], state.trial.annual!, 'ios').trialBadge, null);
  });

  test('ineligible customers never see the trial', async () => {
    const { controller, control } = fakes();
    control.eligibility = (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, { status: INTRO_ELIGIBILITY.INELIGIBLE }])));
    await controller.load();
    assert.deepEqual(controller.current().trial, { annual: 'ineligible' });
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
    assert.deepEqual(TEST_STORE_PRODUCT_IDS, { annual: 'yearly_2999', monthly: 'monthly_499' });
    assert.deepEqual(TEST_STORE, { annual: 'yearly_2999', monthly: 'monthly_499' });
    for (const id of Object.values(TEST_STORE)) assert.ok(!Object.values(APPLE).includes(id));
  });

  test('with the Test Store key, the paywall offers the Test Store products from default_v2', async () => {
    const { controller, control, calls } = fakes({ productIds: TEST_STORE });
    control.offerings = () => Promise.resolve(dashboard(testStoreV2()));
    await controller.load();
    assert.equal(controller.current().phase, 'ready');
    assert.deepEqual(
      controller.current().plans.map((p) => p.pkg.product.identifier),
      ['yearly_2999', 'monthly_499'],
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
  test('gating stays off, so the paywall restricts nothing', () => {
    assert.equal(SUBSCRIPTION_GATING_ENABLED, false);
    const inactive: Entitlement = { status: 'inactive', reason: 'neverSubscribed', lastPlan: null, annualTrial: 'unknown', verification: ACTIVE.verification };
    for (const entitlement of [inactive, { status: 'unknown' } as Entitlement, { status: 'error', error: { kind: 'network', message: '' } } as Entitlement]) {
      assert.equal(accessFor(entitlement, { gatingEnabled: SUBSCRIPTION_GATING_ENABLED, allowMock: false }).core, 'granted');
    }
  });

  test('the paywall is never opened on launch, only from the You screen', () => {
    const app = read('App.tsx');
    assert.match(app, /const \[paywallOpen, setPaywallOpen\] = useState\(false\);/);
    assert.equal((app.match(/setPaywallOpen\(true\)/g) ?? []).length, 1);
    assert.match(app, /onOpenPro=\{PRO_ENTRY \? \(\) => setPaywallOpen\(true\) : undefined\}/);
    assert.match(app, /<PaywallScreen visible=\{paywallOpen\} onClose=\{\(\) => setPaywallOpen\(false\)\} \/>/);
    for (const screen of ['HomeScreen', 'InsightsScreen', 'BubbleBreakScreen']) {
      assert.ok(!/Paywall|paywall/.test(read('src', 'screens', `${screen}.tsx`)), `${screen} must not open the paywall`);
    }
  });

  test('the You screen shows the Puphii Pro row only when it is given an entry point', () => {
    const settings = read('src', 'screens', 'SettingsScreen.tsx');
    assert.match(settings, /\{onOpenPro \? <NavRow icon="heart" label="Puphii Pro" detail=\{proStatusLabel\(entitlement\)\} onPress=\{onOpenPro\} \/> : null\}/);
  });

  test('no screen reads subscription status to hide or lock features', () => {
    for (const screen of ['HomeScreen', 'InsightsScreen', 'BubbleBreakScreen']) {
      assert.ok(!/useEntitlement|access\.core/.test(read('src', 'screens', `${screen}.tsx`)), screen);
    }
  });
});

describe('release configuration', () => {
  test('legal links and benefits are unset, not invented', () => {
    assert.deepEqual(LEGAL_URLS, { termsOfUse: null, privacyPolicy: null });
    assert.equal(PRO_BENEFITS, null);
    assert.ok(!/https?:\/\//.test(read('src', 'screens', 'PaywallScreen.tsx')), 'no hard-coded links in the paywall');
  });

  test('release builds hide the paywall until the legal links and benefits are configured', () => {
    assert.equal(paywallConfigIssues().length, 3);
    assert.equal(showPaywallEntry(false), false);
    assert.equal(showPaywallEntry(true), true, 'development builds can always test it');
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

  test('the paywall logs nothing and validates no receipts itself', () => {
    for (const file of [read('src', 'subscription', 'paywall.ts'), read('src', 'screens', 'PaywallScreen.tsx')]) {
      assert.ok(!/console\./.test(file));
      assert.ok(!/receipt(Data|Url|URL)|appStoreReceipt|verifyReceipt|transactionReceipt/.test(file));
      assert.ok(!/sk_[A-Za-z0-9]/.test(file));
    }
  });

  test('the paywall shows restore, legal links, a close action and the store disclosure', () => {
    const screen = read('src', 'screens', 'PaywallScreen.tsx');
    for (const text of ['Restore Purchases', 'Terms of Use', 'Privacy Policy', 'Close Puphii Pro', 'selected.disclosure', 'Loading subscription options', 'Try again']) {
      assert.ok(screen.includes(text), text);
    }
  });
});
