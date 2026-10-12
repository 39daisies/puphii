import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import type { CustomerInfo, MakePurchaseResult, PurchasesEntitlementInfo, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import {
  checkOffering,
  createOpenRequests,
  createTestStoreHarness,
  describeEntitlement,
  describeOutcome,
  describeRestore,
  EntitlementActions,
  findOffering,
  harnessStoreFor,
  HarnessStore,
  missingOfferingMessage,
  NO_PURCHASES,
  productRows,
  PURCHASE_ERROR_CODES,
  purchaseErrorOutcome,
  sandboxWarning,
  summarizeCustomer,
  TEST_STORE_TRIAL_NOTE,
  TestStoreSdk,
} from '../src/dev/testStoreHarness';
import { APP_STORE_EXPECTED, APP_STORE_OFFERING_ID } from '../src/dev/appStoreConfig';
import { TEST_STORE_EXPECTED, TEST_STORE_OFFERING_ID } from '../src/dev/testStoreConfig';
import { PLANS, SUBSCRIPTION_GATING_ENABLED, TEST_STORE_PRODUCT_IDS } from '../src/subscription/config';
import { accessFor, Entitlement, RestoreResult } from '../src/subscription/entitlement';
import { entitlementFromCustomerInfo } from '../src/subscription/revenueCat';
import { selectSdkKey } from '../src/subscription/sdkKeys';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rc = require('@revenuecat/purchases-typescript-internal');

/** Test-only identifiers; nothing here exists in a RevenueCat project. */
const ENTITLEMENT = 'test-entitlement';
const REQUEST_DATE = '2026-10-10T12:00:00.000Z';

function pkg(
  identifier: string,
  productId: string,
  priceString: string,
  period: string | null,
  intro: object | null = null,
  currencyCode = 'USD',
): PurchasesPackage {
  const price = Number(priceString.replace(/[^\d.]/g, ''));
  return {
    identifier,
    packageType: 'CUSTOM',
    product: { identifier: productId, title: `Title ${productId}`, priceString, price, currencyCode, subscriptionPeriod: period, introPrice: intro },
  } as unknown as PurchasesPackage;
}

function offerings(current: string | null, all: Record<string, PurchasesPackage[]>): PurchasesOfferings {
  const entries = Object.fromEntries(Object.entries(all).map(([id, packages]) => [id, { identifier: id, availablePackages: packages }]));
  return { all: entries, current: current ? entries[current] : null } as unknown as PurchasesOfferings;
}

function testStoreEntry(overrides: Partial<PurchasesEntitlementInfo> = {}): PurchasesEntitlementInfo {
  return {
    identifier: ENTITLEMENT,
    isActive: true,
    willRenew: true,
    periodType: 'NORMAL',
    productIdentifier: 'teststore.product',
    productPlanIdentifier: null,
    store: 'TEST_STORE',
    isSandbox: true,
    expirationDate: '2026-10-10T13:00:00.000Z',
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

/** The harness's real expectation for the Test Store offering. */
const EXPECTED = TEST_STORE_EXPECTED;
const WEEK_TRIAL = { price: 0, priceString: '$0.00', cycles: 1, periodUnit: 'WEEK', periodNumberOfUnits: 1 };
const DAY_TRIAL = { price: 0, priceString: '$0.00', cycles: 1, periodUnit: 'DAY', periodNumberOfUnits: 7 };
/** The original offering, still current in RevenueCat and not what the harness tests. */
const ORIGINAL = [pkg('$rc_annual', 'yearly', '$29.99', 'P1Y', DAY_TRIAL), pkg('$rc_monthly', 'monthly', '$4.99', 'P1M')];
const v2 = (annualIntro: object | null = DAY_TRIAL) => [
  pkg('$rc_annual', 'yearly_2999', '$29.99', 'P1Y', annualIntro),
  pkg('$rc_monthly', 'monthly_499', '$4.99', 'P1M'),
  pkg('$rc_weekly', 'weekly_199', '$1.99', 'P1W'),
];
const NO_PRODUCTS = { annual: null, monthly: null, weekly: null };
/** RevenueCat's response as set up in the dashboard: `default` current, `default_v2` alongside it. */
const planned = (annualIntro: object | null = DAY_TRIAL) => offerings('default', { default: ORIGINAL, default_v2: v2(annualIntro) });
const withV2 = (packages: PurchasesPackage[]) => offerings('default', { default: ORIGINAL, default_v2: packages });

const storeError = (code: string, extra: object = {}) => Object.assign(new Error(`store error ${code}`), { code, ...extra });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakes({ configured = true, store = 'testStore' as HarnessStore, expected = EXPECTED } = {}) {
  const calls = { getOfferings: 0, purchase: [] as string[], getCustomerInfo: 0, refresh: 0, restore: 0 };
  const control = {
    offerings: (): Promise<PurchasesOfferings> => Promise.resolve(withV2([pkg('$rc_annual', 'teststore.annual', '$29.99', 'P1Y')])),
    purchase: (p: PurchasesPackage): Promise<MakePurchaseResult> =>
      Promise.resolve({ productIdentifier: p.product.identifier, customerInfo: customer([testStoreEntry()]) } as MakePurchaseResult),
    customerInfo: (): Promise<CustomerInfo> => Promise.resolve(customer()),
    restore: (): Promise<RestoreResult> => Promise.resolve({ outcome: 'nothingToRestore', entitlement: { status: 'unknown' } }),
    entitlement: { status: 'unknown' } as Entitlement,
    refreshFails: false,
  };
  const sdk: TestStoreSdk = {
    isConfigured: () => Promise.resolve(configured),
    getOfferings() {
      calls.getOfferings += 1;
      return control.offerings();
    },
    purchasePackage(p) {
      calls.purchase.push(p.product.identifier);
      return control.purchase(p);
    },
    getCustomerInfo() {
      calls.getCustomerInfo += 1;
      return control.customerInfo();
    },
  };
  const entitlements: EntitlementActions = {
    refresh() {
      calls.refresh += 1;
      return control.refreshFails ? Promise.reject(new Error('refresh failed')) : Promise.resolve(control.entitlement);
    },
    restorePurchases() {
      calls.restore += 1;
      return control.restore();
    },
  };
  const harness = createTestStoreHarness({ sdk, entitlementId: ENTITLEMENT, entitlements, store, expected });
  return { harness, calls, control };
}

const ROOT = join(__dirname, '..', '..');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}
const APP_FILES = sourceFiles(join(ROOT, 'src')).concat(join(ROOT, 'App.tsx'));
const read = (path: string) => readFileSync(path, 'utf8');

describe('Test Store harness isolation', () => {
  test('only App.tsx loads the harness, and only behind __DEV__', () => {
    const app = read(join(ROOT, 'App.tsx'));
    assert.match(app, /__DEV__ \? require\('\.\/src\/dev\/TestStoreHarness'\)/);
    assert.ok(!/^import .*src\/dev/m.test(app), 'App.tsx must not import dev tools statically');
    for (const file of APP_FILES) {
      if (file.includes(`${join('src', 'dev')}`) || file.endsWith('App.tsx')) continue;
      assert.ok(!/['"](\.\.?\/)+dev\//.test(read(file)), `${relative(ROOT, file)} imports development tools`);
    }
  });

  test('the DEV ONLY shortcut reaches the You screen only through the __DEV__ require', () => {
    const app = read(join(ROOT, 'App.tsx'));
    assert.match(app, /const DevTools: DevToolsModule \| null = __DEV__ \? require\('\.\/src\/dev\/TestStoreHarness'\) : null;/);
    assert.match(app, /footer=\{DevTools \? <DevTools\.TestStoreHarnessButton \/> : undefined\}/);
    assert.equal((app.match(/<DevTools\.TestStoreHarnessButton/g) ?? []).length, 1, 'rendered in one place only');

    const settings = read(join(ROOT, 'src', 'screens', 'SettingsScreen.tsx'));
    assert.match(settings, /export function SettingsScreen\(\{ footer, onOpenPro \}: \{ footer\?: React\.ReactNode; onOpenPro\?: \(\) => void \}\)/);
    assert.match(settings, /\{page === 'main' && footer\}/);
    assert.ok(!/TestStore|RevenueCat|Purchases/.test(settings), 'the You screen itself knows nothing about the Test Store');

    const harness = read(join(ROOT, 'src', 'dev', 'TestStoreHarness.tsx'));
    assert.match(harness, /export function TestStoreHarnessButton\(\)/);
    assert.match(harness, /DEV ONLY · not in release builds/);
    assert.match(harness, /onPress=\{openRequests\.request\}/);
  });

  test('the Test Store key is read only in development builds', () => {
    const adapter = read(join(ROOT, 'src', 'subscription', 'revenueCatSdk.ts'));
    const reads = adapter.match(/process\.env\.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY/g) ?? [];
    assert.equal(reads.length, 1);
    assert.match(adapter, /__DEV__ \? process\.env\.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY : undefined/);
    assert.match(adapter, /isDevelopmentBuild: __DEV__/);
  });

  test('purchases are only started from the development harness and the Puphii Pro paywall', () => {
    const allowed = [join('src', 'subscription', 'paywall.ts'), join('src', 'subscription', 'revenueCatSdk.ts')];
    for (const file of APP_FILES) {
      if (/purchasePackage|purchaseStoreProduct|purchaseProduct\(/.test(read(file))) {
        assert.ok(file.includes(join('src', 'dev')) || allowed.some((path) => file.endsWith(path)), `${relative(ROOT, file)} starts a purchase`);
      }
    }
    for (const file of APP_FILES) {
      if (file.includes(join('src', 'dev')) || file.endsWith('revenueCatSdk.ts')) continue;
      assert.ok(!/Purchases\.purchase/.test(read(file)), `${relative(ROOT, file)} calls the native SDK directly`);
    }
  });

  test('nothing personal is sent to RevenueCat and subscription code never touches stored data', () => {
    for (const file of APP_FILES) {
      const text = read(file);
      assert.ok(
        !/Purchases\.(setAttributes|setEmail|setDisplayName|setPhoneNumber|logIn|collectDeviceIdentifiers|setAd|setMixpanel|setPushToken)/.test(text),
        `${relative(ROOT, file)} sends user data to RevenueCat`,
      );
      if (file.includes(join('src', 'dev')) || file.includes(join('src', 'subscription'))) {
        assert.ok(!/async-storage|\.\.\/data\//.test(text), `${relative(ROOT, file)} reads or writes app data`);
      }
    }
  });

  test('gating stays off, so a Test Store subscription changes no screen', () => {
    assert.equal(SUBSCRIPTION_GATING_ENABLED, false);
    for (const info of [customer(), customer([testStoreEntry()]), customer([testStoreEntry({ isActive: false })])]) {
      const entitlement = entitlementFromCustomerInfo(info, ENTITLEMENT, NO_PRODUCTS);
      assert.equal(accessFor(entitlement, { gatingEnabled: SUBSCRIPTION_GATING_ENABLED, allowMock: false }).core, 'granted');
    }
  });
});

describe('Test Store products and outcomes', () => {
  test('lists only the packages of the offering it is given, with prices, periods and trials', () => {
    const rows = productRows(findOffering(planned(WEEK_TRIAL), 'default_v2')!, 'default');
    assert.deepEqual(
      rows.map((r) => [r.key, r.isCurrentOffering, r.productId, r.price, r.period, r.introOffer]),
      [
        ['default_v2/$rc_annual', false, 'yearly_2999', '$29.99', 'P1Y', 'Free trial: 1 week'],
        ['default_v2/$rc_monthly', false, 'monthly_499', '$4.99', 'P1M', null],
        ['default_v2/$rc_weekly', false, 'weekly_199', '$1.99', 'P1W', null],
      ],
    );
    assert.equal(productRows(findOffering(planned(), 'default')!, 'default')[0].isCurrentOffering, true);
  });

  test('a paid introductory offer is described as such, and an empty offering gives no rows', () => {
    const paid = { price: 0.99, priceString: '$0.99', cycles: 1, periodUnit: 'MONTH', periodNumberOfUnits: 3 };
    const [row] = productRows(findOffering(offerings(null, { x: [pkg('p', 'x.p', '$9.99', 'P1Y', paid)] }), 'x')!, null);
    assert.equal(row.introOffer, 'Introductory price $0.99 for 3 months');
    assert.deepEqual(productRows(findOffering(offerings(null, { x: [] }), 'x')!, null), []);
  });

  test('cancel, simulated failure, pending and other errors are told apart', () => {
    assert.deepEqual(purchaseErrorOutcome(storeError('1')), { kind: 'cancelled' });
    assert.deepEqual(purchaseErrorOutcome(storeError('2', { userCancelled: true })), { kind: 'cancelled' });
    assert.equal(purchaseErrorOutcome(storeError('42')).kind, 'simulatedFailure');
    assert.deepEqual(purchaseErrorOutcome(storeError('20')), { kind: 'pending' });
    const failed = purchaseErrorOutcome(storeError('10', { readableErrorCode: 'NETWORK_ERROR', underlyingErrorMessage: 'offline' }));
    assert.ok(failed.kind === 'failed' && /code 10/.test(failed.detail) && /NETWORK_ERROR/.test(failed.detail) && /offline/.test(failed.detail));
    assert.equal(purchaseErrorOutcome(null).kind, 'failed');
    assert.match(describeOutcome({ kind: 'cancelled' }), /cancelled/i);
  });

  test('purchase error codes match the installed RevenueCat SDK', () => {
    for (const [name, code] of Object.entries(PURCHASE_ERROR_CODES)) assert.equal(rc.PURCHASES_ERROR_CODE[name], code, name);
  });

  test('customer info is summarised for the configured entitlement only', () => {
    const summary = summarizeCustomer(customer([testStoreEntry(), testStoreEntry({ identifier: 'other' })]), ENTITLEMENT);
    assert.deepEqual(summary.activeEntitlements, ['other', ENTITLEMENT].sort());
    assert.equal(summary.entitlement?.store, 'TEST_STORE');
    assert.equal(summary.entitlement?.isSandbox, true);
    assert.equal(summarizeCustomer(customer(), ENTITLEMENT).entitlement, null);
    assert.equal(summarizeCustomer(customer([testStoreEntry()]), null).entitlement, null);
  });

  test('Test Store purchases map like any store purchase; their product is not a configured plan', () => {
    const active = entitlementFromCustomerInfo(customer([testStoreEntry({ periodType: 'TRIAL' })]), ENTITLEMENT, NO_PRODUCTS);
    assert.ok(active.status === 'active' && active.period === 'trial' && active.plan === null);
    assert.deepEqual(describeEntitlement(active).slice(0, 2), ['Status: active (free trial)', 'Plan: not one of the configured store products']);
    assert.deepEqual(describeEntitlement({ status: 'error', error: { kind: 'notConfigured', message: 'x' } }), ['Status: error (notConfigured)', 'x']);
  });
});

describe('Test Store offering setup', () => {
  test('the harness expects default_v2 with the replacement products and the planned prices and trial', () => {
    assert.equal(TEST_STORE_OFFERING_ID, 'default_v2');
    assert.equal(EXPECTED.offeringId, 'default_v2');
    assert.deepEqual(EXPECTED.plans, {
      annual: { packageId: '$rc_annual', productId: 'yearly_2999', billingPeriod: 'P1Y', price: { amount: 29.99, currencyCode: 'USD' }, freeTrialDays: 7 },
      monthly: { packageId: '$rc_monthly', productId: 'monthly_499', billingPeriod: 'P1M', price: { amount: 4.99, currencyCode: 'USD' }, freeTrialDays: null },
      weekly: { packageId: '$rc_weekly', productId: 'weekly_199', billingPeriod: 'P1W', price: { amount: 1.99, currencyCode: 'USD' }, freeTrialDays: null },
    });
  });

  test('it reuses the app configuration instead of repeating identifiers', () => {
    for (const plan of ['annual', 'monthly', 'weekly'] as const) {
      assert.equal(EXPECTED.plans[plan].packageId, PLANS[plan].packageId);
      assert.equal(EXPECTED.plans[plan].productId, TEST_STORE_PRODUCT_IDS[plan]);
      assert.equal(EXPECTED.plans[plan].billingPeriod, PLANS[plan].billingPeriod);
      assert.equal(EXPECTED.plans[plan].freeTrialDays !== null, PLANS[plan].hasFreeTrial);
    }
  });
});

describe('Explicit offering lookup', () => {
  test('finds default_v2 by identifier although default is the current offering', () => {
    const response = planned();
    assert.equal(response.current?.identifier, 'default');
    assert.equal(findOffering(response, 'default_v2')?.identifier, 'default_v2');
    assert.equal(missingOfferingMessage(response, 'default_v2'), null);
  });

  test('a missing offering gives null and an explanation, never the current offering instead', () => {
    const response = offerings('default', { default: ORIGINAL });
    assert.equal(findOffering(response, 'default_v2'), null);
    assert.equal(missingOfferingMessage(response, 'default_v2'), 'RevenueCat didn\'t return the offering "default_v2". Offerings returned: default (current).');
    assert.equal(missingOfferingMessage(offerings(null, {}), 'default_v2'), 'RevenueCat didn\'t return the offering "default_v2". Offerings returned: none.');
    for (const inherited of ['constructor', 'toString', '__proto__']) assert.equal(findOffering(response, inherited), null, inherited);
  });

  test('an offering without packages is explained', () => {
    assert.equal(missingOfferingMessage(withV2([]), 'default_v2'), 'The offering "default_v2" has no packages.');
  });
});

describe('Test Store offering check', () => {
  test('default_v2 as set up in the dashboard passes, judged on SDK product data', () => {
    for (const trial of [DAY_TRIAL, WEEK_TRIAL]) {
      const check = checkOffering(planned(trial), EXPECTED);
      assert.equal(check.ok, true, check.lines.join('\n'));
    }
    assert.deepEqual(checkOffering(planned(), EXPECTED).lines, [
      'OK offering: default_v2 (loaded by identifier; not current)',
      'OK annual: $rc_annual → yearly_2999, P1Y, $29.99 (29.99 USD), Free trial: 7 days',
      'OK monthly: $rc_monthly → monthly_499, P1M, $4.99 (4.99 USD), no trial',
      'OK weekly: $rc_weekly → weekly_199, P1W, $1.99 (1.99 USD), no trial',
    ]);
    const current = offerings('default_v2', { default: ORIGINAL, default_v2: v2() });
    assert.equal(checkOffering(current, EXPECTED).lines[0], 'OK offering: default_v2 (current)');
  });

  test('a missing default_v2 fails the check without falling back to the current offering', () => {
    assert.deepEqual(checkOffering(offerings('default', { default: ORIGINAL }), EXPECTED), {
      ok: false,
      lines: ['Mismatch: RevenueCat didn\'t return the offering "default_v2". Offerings returned: default (current).'],
    });
  });

  test('packages mapped to the original products, swapped products and missing packages are reported', () => {
    const original = checkOffering(withV2(ORIGINAL), EXPECTED);
    assert.equal(original.ok, false);
    assert.match(original.lines[1], /^Mismatch annual: product is yearly, expected yearly_2999 \(/);
    assert.match(original.lines[2], /^Mismatch monthly: product is monthly, expected monthly_499 \(/);

    const swapped = checkOffering(
      withV2([pkg('$rc_annual', 'monthly_499', '$4.99', 'P1M'), pkg('$rc_monthly', 'yearly_2999', '$29.99', 'P1Y', DAY_TRIAL)]),
      EXPECTED,
    );
    assert.match(
      swapped.lines[1],
      /^Mismatch annual: product is monthly_499, expected yearly_2999; period is P1M, expected P1Y; price is 4.99 USD, expected 29.99 USD; expected a 7-day free trial, found none/,
    );
    assert.match(
      swapped.lines[2],
      /^Mismatch monthly: product is yearly_2999, expected monthly_499; period is P1Y, expected P1M; price is 29.99 USD, expected 4.99 USD; expected no introductory offer/,
    );

    const missing = checkOffering(withV2([v2()[0]]), EXPECTED);
    assert.equal(missing.ok, false);
    assert.equal(missing.lines[2], 'Mismatch monthly: package $rc_monthly is not in the offering "default_v2".');
  });

  test('a wrong price or currency is reported', () => {
    const higher = checkOffering(withV2([pkg('$rc_annual', 'yearly_2999', '$39.99', 'P1Y', DAY_TRIAL), v2()[1]]), EXPECTED);
    assert.equal(higher.ok, false);
    assert.match(higher.lines[1], /price is 39.99 USD, expected 29.99 USD/);
    const yen = checkOffering(withV2([v2()[0], pkg('$rc_monthly', 'monthly_499', '¥4.99', 'P1M', null, 'JPY')]), EXPECTED);
    assert.match(yen.lines[2], /price is 4.99 JPY, expected 4.99 USD/);
  });

  test('the annual trial must be a free 7-day offer; none, paid or a different length is reported', () => {
    assert.match(checkOffering(planned(null), EXPECTED).lines[1], /expected a 7-day free trial, found none/);
    const paid = { price: 0.99, priceString: '$0.99', cycles: 1, periodUnit: 'WEEK', periodNumberOfUnits: 1 };
    assert.match(checkOffering(planned(paid), EXPECTED).lines[1], /expected a 7-day free trial, found "Introductory price \$0\.99 for 1 week"/);
    const threeDays = { ...DAY_TRIAL, periodNumberOfUnits: 3 };
    assert.match(checkOffering(planned(threeDays), EXPECTED).lines[1], /expected a 7-day free trial, found "Free trial: 3 days"/);
    const month = { ...DAY_TRIAL, periodUnit: 'MONTH', periodNumberOfUnits: 1 };
    assert.match(checkOffering(planned(month), EXPECTED).lines[1], /expected a 7-day free trial, found "Free trial: 1 month"/);
    const twoWeeks = { ...WEEK_TRIAL, cycles: 2 };
    assert.equal(checkOffering(planned(twoWeeks), EXPECTED).ok, false);
  });

  test('the monthly plan must have no introductory offer at all', () => {
    const check = checkOffering(withV2([v2()[0], pkg('$rc_monthly', 'monthly_499', '$4.99', 'P1M', WEEK_TRIAL), v2()[2]]), EXPECTED);
    assert.equal(check.ok, false);
    assert.match(check.lines[2], /expected no introductory offer, found "Free trial: 1 week"/);
  });

  test('the weekly plan must be weekly_199, billed every week, with no introductory offer', () => {
    const [annual, monthly] = v2();
    const missing = checkOffering(withV2([annual, monthly]), EXPECTED);
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.lines.slice(1), [
      'OK annual: $rc_annual → yearly_2999, P1Y, $29.99 (29.99 USD), Free trial: 7 days',
      'OK monthly: $rc_monthly → monthly_499, P1M, $4.99 (4.99 USD), no trial',
      'Mismatch weekly: package $rc_weekly is not in the offering "default_v2".',
    ]);
    const trial = checkOffering(withV2([annual, monthly, pkg('$rc_weekly', 'weekly_199', '$1.99', 'P1W', DAY_TRIAL)]), EXPECTED);
    assert.match(trial.lines[3], /^Mismatch weekly: expected no introductory offer, found "Free trial: 7 days"/);
    const monthlyPeriod = checkOffering(withV2([annual, monthly, pkg('$rc_weekly', 'weekly_199', '$1.99', 'P1M')]), EXPECTED);
    assert.match(monthlyPeriod.lines[3], /^Mismatch weekly: period is P1M, expected P1W/);
    const appStoreProduct = checkOffering(withV2([annual, monthly, pkg('$rc_weekly', 'puphii_weekly_199', '$1.99', 'P1W')]), EXPECTED);
    assert.match(appStoreProduct.lines[3], /^Mismatch weekly: product is puphii_weekly_199, expected weekly_199/);
  });

  test('loading products lists only default_v2, runs the check and logs its result', async () => {
    const good = fakes();
    good.control.offerings = () => Promise.resolve(planned());
    await good.harness.loadProducts();
    assert.deepEqual(good.harness.current().products.map((r) => r.key), ['default_v2/$rc_annual', 'default_v2/$rc_monthly', 'default_v2/$rc_weekly']);
    assert.equal(good.harness.current().productsMessage, null);
    assert.equal(good.harness.current().offeringCheck?.ok, true);
    assert.match(good.harness.current().log[0].message, /"default_v2" matches its expected setup/);
    assert.match(good.harness.current().log[1].message, /Loaded 3 products from "default_v2"/);

    const bad = fakes();
    await bad.harness.loadProducts();
    assert.equal(bad.harness.current().offeringCheck?.ok, false);
    assert.match(bad.harness.current().log[0].message, /doesn't match/);

    bad.control.offerings = () => Promise.reject(storeError('10'));
    await bad.harness.loadProducts();
    assert.equal(bad.harness.current().offeringCheck, null);
  });

  test('a missing default_v2 lists nothing to buy, explains why and does not crash', async () => {
    const { harness, calls, control } = fakes();
    control.offerings = () => Promise.resolve(offerings('default', { default: ORIGINAL }));
    await harness.loadProducts();
    const state = harness.current();
    assert.deepEqual(state.products, []);
    assert.match(state.productsMessage ?? '', /didn't return the offering "default_v2"/);
    assert.equal(state.offeringCheck?.ok, false);
    assert.equal(state.busy, null);
    assert.equal(await harness.purchase('default/$rc_annual'), null);
    assert.deepEqual(calls.purchase, []);
  });
});

describe('Opening the Test Store screen without the development menu', () => {
  test('a request opens every listening screen host, and stops after unsubscribing', () => {
    const requests = createOpenRequests();
    requests.request();
    let opened = 0;
    const unsubscribe = requests.subscribe(() => (opened += 1));
    requests.request();
    requests.request();
    assert.equal(opened, 2);
    unsubscribe();
    requests.request();
    assert.equal(opened, 2);
  });

  test('separate signals do not open each other', () => {
    const a = createOpenRequests();
    const b = createOpenRequests();
    let opened = 0;
    b.subscribe(() => (opened += 1));
    a.request();
    assert.equal(opened, 0);
  });
});

describe('Test Store harness', () => {
  test('does nothing but explain when RevenueCat is not configured', async () => {
    const { harness, calls } = fakes({ configured: false });
    await harness.loadProducts();
    assert.equal(await harness.purchase('default_v2/$rc_annual'), null);
    await harness.restore();
    await harness.refresh();
    assert.deepEqual(calls, { getOfferings: 0, purchase: [], getCustomerInfo: 0, refresh: 0, restore: 0 });
    assert.match(harness.current().productsMessage ?? '', /not configured/);
    assert.equal(harness.current().busy, null);
  });

  test('loads the products RevenueCat returns', async () => {
    const { harness } = fakes();
    await harness.loadProducts();
    assert.deepEqual(harness.current().products.map((r) => r.productId), ['teststore.annual']);
    assert.equal(harness.current().productsMessage, null);
  });

  test('explains an empty or failing product request', async () => {
    const empty = fakes();
    empty.control.offerings = () => Promise.resolve(offerings(null, {}));
    await empty.harness.loadProducts();
    assert.match(empty.harness.current().productsMessage ?? '', /didn't return the offering "default_v2"/);

    const failing = fakes();
    failing.control.offerings = () => Promise.reject(storeError('23', { readableErrorCode: 'CONFIGURATION_ERROR' }));
    await failing.harness.loadProducts();
    assert.match(failing.harness.current().productsMessage ?? '', /CONFIGURATION_ERROR/);
    assert.equal(failing.harness.current().busy, null);
  });

  test('a completed purchase shows the new customer info and refreshes the app’s status', async () => {
    const { harness, calls, control } = fakes();
    control.entitlement = { status: 'active', plan: null, period: 'paid', expiresAt: null, willRenew: true, verification: { origin: 'store', verifiedAt: REQUEST_DATE } };
    await harness.loadProducts();
    const outcome = await harness.purchase('default_v2/$rc_annual');
    assert.deepEqual(outcome, { kind: 'purchased', productId: 'teststore.annual' });
    assert.deepEqual(calls.purchase, ['teststore.annual']);
    assert.equal(calls.refresh, 1);
    assert.equal(harness.current().customer?.entitlement?.isActive, true);
    assert.match(harness.current().log[0].message, /Purchase completed/);
  });

  test('cancelled and failed purchases change nothing and are reported', async () => {
    const { harness, calls, control } = fakes();
    await harness.loadProducts();
    control.purchase = () => Promise.reject(storeError('1', { userCancelled: true }));
    assert.deepEqual(await harness.purchase('default_v2/$rc_annual'), { kind: 'cancelled' });
    control.purchase = () => Promise.reject(storeError('42', { readableErrorCode: 'TEST_STORE_SIMULATED_PURCHASE_ERROR' }));
    assert.equal((await harness.purchase('default_v2/$rc_annual'))?.kind, 'simulatedFailure');
    assert.equal(calls.refresh, 0);
    assert.equal(harness.current().customer?.entitlement, null);
    assert.match(harness.current().log[0].message, /Nothing granted/);
    assert.match(harness.current().log[1].message, /Simulated purchase failure/);
    assert.match(harness.current().log[2].message, /Nothing granted/);
    assert.match(harness.current().log[3].message, /cancelled/);
  });

  test('only one action runs at a time, so a double tap buys once', async () => {
    const { harness, calls, control } = fakes();
    await harness.loadProducts();
    const pending = deferred<MakePurchaseResult>();
    control.purchase = () => pending.promise;
    const first = harness.purchase('default_v2/$rc_annual');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(harness.current().busy, 'purchasing');
    assert.equal(await harness.purchase('default_v2/$rc_annual'), null);
    await harness.refresh();
    pending.resolve({ productIdentifier: 'teststore.annual', customerInfo: customer([testStoreEntry()]) } as MakePurchaseResult);
    await first;
    assert.deepEqual(calls.purchase, ['teststore.annual']);
    assert.equal(harness.current().busy, null);
  });

  test('never buys without a Test Store or App Store key, such as with the Google Play key', async () => {
    const { harness, calls } = fakes({ store: 'none' });
    await harness.loadProducts();
    assert.equal(harness.current().products.length, 1, 'products can still be inspected');
    assert.equal(await harness.purchase('default_v2/$rc_annual'), null);
    assert.deepEqual(calls.purchase, []);
    assert.equal(harness.current().log[0].message, NO_PURCHASES);
    assert.match(NO_PURCHASES, /only run with the RevenueCat Test Store key .* or, on iOS, the App Store key/);
  });

  test('an unknown product key is refused', async () => {
    const { harness, calls } = fakes();
    await harness.loadProducts();
    assert.equal(await harness.purchase('missing/package'), null);
    assert.deepEqual(calls.purchase, []);
  });

  test('a purchase in progress is shown next to the Buy buttons until it settles', async () => {
    const { harness, control } = fakes();
    await harness.loadProducts();
    assert.equal(harness.current().purchaseStatus, null);
    const pending = deferred<MakePurchaseResult>();
    control.purchase = () => pending.promise;
    const purchase = harness.purchase('default_v2/$rc_annual');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(harness.current().purchaseStatus?.tone, 'progress');
    assert.match(harness.current().purchaseStatus?.message ?? '', /teststore\.annual.*Test Store Purchase/);
    pending.resolve({ productIdentifier: 'teststore.annual', customerInfo: customer([testStoreEntry()]) } as MakePurchaseResult);
    await purchase;
    assert.deepEqual(harness.current().purchaseStatus, { tone: 'success', message: 'Purchase completed: teststore.annual' });
  });

  test('every purchase outcome is shown next to the Buy buttons, errors as errors', async () => {
    const { harness, control } = fakes();
    await harness.loadProducts();
    const cases: [Error, string, RegExp][] = [
      [storeError('1', { userCancelled: true }), 'info', /cancelled/],
      [storeError('20'), 'info', /pending/i],
      [storeError('42', { readableErrorCode: 'TEST_STORE_SIMULATED_PURCHASE_ERROR' }), 'error', /Simulated purchase failure/],
      [storeError('2', { readableErrorCode: 'STORE_PROBLEM_ERROR' }), 'error', /STORE_PROBLEM_ERROR/],
    ];
    for (const [error, tone, message] of cases) {
      control.purchase = () => Promise.reject(error);
      await harness.purchase('default_v2/$rc_annual');
      assert.equal(harness.current().purchaseStatus?.tone, tone, error.message);
      assert.match(harness.current().purchaseStatus?.message ?? '', message);
    }
  });

  test('a refused purchase is shown as an error, not only in the results list', async () => {
    const notConfigured = fakes({ configured: false });
    await notConfigured.harness.purchase('default_v2/$rc_annual');
    assert.equal(notConfigured.harness.current().purchaseStatus?.tone, 'error');
    assert.match(notConfigured.harness.current().purchaseStatus?.message ?? '', /not configured/);

    const platformKey = fakes({ store: 'none' });
    await platformKey.harness.loadProducts();
    await platformKey.harness.purchase('default_v2/$rc_annual');
    assert.equal(platformKey.harness.current().purchaseStatus?.tone, 'error');

    const unknown = fakes();
    await unknown.harness.loadProducts();
    await unknown.harness.purchase('missing/package');
    assert.match(unknown.harness.current().purchaseStatus?.message ?? '', /no longer listed/);
  });

  test('a completed purchase stays completed when refreshing the status afterwards fails', async () => {
    const { harness, control } = fakes();
    control.refreshFails = true;
    await harness.loadProducts();
    assert.deepEqual(await harness.purchase('default_v2/$rc_annual'), { kind: 'purchased', productId: 'teststore.annual' });
    assert.equal(harness.current().purchaseStatus?.tone, 'success');
    assert.equal(harness.current().customer?.entitlement?.isActive, true);
    assert.match(harness.current().log[0].message, /Purchase completed, but refreshing the subscription status failed/);
    assert.match(harness.current().log[1].message, /Purchase completed: teststore\.annual/);
    assert.equal(harness.current().busy, null);
  });

  test('an unexpected purchase result is reported as an error instead of a purchase', async () => {
    for (const result of [undefined, null, {}, { productIdentifier: 'teststore.annual' }, { customerInfo: customer() }]) {
      const { harness, calls, control } = fakes();
      await harness.loadProducts();
      control.purchase = () => Promise.resolve(result as unknown as MakePurchaseResult);
      const outcome = await harness.purchase('default_v2/$rc_annual');
      assert.equal(outcome?.kind, 'failed', JSON.stringify(result));
      assert.equal(harness.current().purchaseStatus?.tone, 'error');
      assert.match(harness.current().purchaseStatus?.message ?? '', /unexpected purchase result/);
      assert.equal(calls.refresh, 0);
      assert.equal(harness.current().customer?.entitlement, null);
      assert.equal(harness.current().entitlementCheck?.tone, 'unchanged');
      assert.equal(harness.current().busy, null);
    }
  });

  test('the screen shows the purchase status directly under the Buy buttons', () => {
    const screen = read(join(ROOT, 'src', 'dev', 'TestStoreHarness.tsx'));
    const products = screen.indexOf('<Section title="Products">');
    const status = screen.indexOf('state.purchaseStatus ?');
    const actions = screen.indexOf('label="Reload products"');
    assert.ok(products >= 0 && products < status && status < actions);
  });

  test('restore reports each outcome and reloads customer info', async () => {
    const { harness, calls, control } = fakes();
    await harness.restore();
    assert.match(harness.current().log[0].message, /no subscription found/);
    control.restore = () => Promise.resolve({ outcome: 'restored', entitlement: { status: 'unknown' } });
    await harness.restore();
    assert.match(harness.current().log[0].message, /active subscription/);
    control.restore = () => Promise.resolve({ outcome: 'failed', error: { kind: 'network', message: 'offline' } });
    await harness.restore();
    assert.match(harness.current().log[0].message, /Restore failed \(network\)/);
    assert.equal(calls.restore, 3);
    assert.equal(calls.getCustomerInfo, 3);
  });

  test('refresh asks RevenueCat again and shows the result', async () => {
    const { harness, calls, control } = fakes();
    control.customerInfo = () => Promise.resolve(customer([testStoreEntry({ isActive: false })]));
    control.entitlement = { status: 'error', error: { kind: 'network', message: 'offline' } };
    await harness.refresh();
    assert.equal(calls.refresh, 1);
    assert.equal(harness.current().customer?.entitlement?.isActive, false);
    assert.match(harness.current().log[0].message, /Refreshed: Status: error \(network\)/);

    control.customerInfo = () => Promise.reject(storeError('10'));
    await harness.refresh();
    assert.match(harness.current().log[0].message, /Couldn't read customer info/);
  });

  test('the log keeps the latest results only', async () => {
    const { harness } = fakes();
    for (let i = 0; i < 20; i += 1) await harness.restore();
    assert.equal(harness.current().log.length, 12);
  });
});

describe('Test Store trial eligibility and restore wording', () => {
  const verification = { origin: 'store' as const, verifiedAt: REQUEST_DATE };
  const notSubscribed: Entitlement = { status: 'inactive', reason: 'expired', lastPlan: 'annual', annualTrial: 'eligible', verification };

  test('with the Test Store key, trial eligibility is labelled as untestable', () => {
    const lines = describeEntitlement(notSubscribed, { testStore: true });
    assert.equal(lines[1], 'Annual free trial: eligible');
    assert.equal(lines[lines.length - 1], TEST_STORE_TRIAL_NOTE);
    assert.ok(!describeEntitlement(notSubscribed).includes(TEST_STORE_TRIAL_NOTE), 'not with a store key');
    const active: Entitlement = { status: 'active', plan: 'annual', period: 'trial', expiresAt: null, willRenew: true, verification };
    assert.ok(!describeEntitlement(active, { testStore: true }).includes(TEST_STORE_TRIAL_NOTE), 'no eligibility is shown while subscribed');
  });

  test('the screen passes whether the Test Store key is in use', () => {
    const screen = read(join(ROOT, 'src', 'dev', 'TestStoreHarness.tsx'));
    assert.match(screen, /describeEntitlement\(entitlement, \{ testStore: usingTestStore \}\)/);
  });

  test('restore results say what was found', () => {
    assert.equal(describeRestore({ outcome: 'restored', entitlement: { status: 'unknown' } }), 'Restore found an active subscription.');
    assert.equal(describeRestore({ outcome: 'nothingToRestore', entitlement: notSubscribed }), 'Restore completed: no subscription found.');
    assert.match(describeRestore({ outcome: 'foundInactive', entitlement: notSubscribed }), /^Restore found a subscription that has ended \(Status: not subscribed \(expired\)\)/);
    assert.match(
      describeRestore({ outcome: 'foundInactive', entitlement: { status: 'billingRetry', plan: 'annual', verification } }),
      /renewal is failing: no access until payment is fixed/,
    );
    assert.equal(
      describeRestore({ outcome: 'failed', error: { kind: 'receiptInUse', message: 'linked elsewhere' } }),
      'Restore failed (receiptInUse): linked elsewhere',
    );
  });
});

describe('Simulated purchase failure', () => {
  /** What RevenueCat rejects with after "Test failed purchase": no transaction, no customer info. */
  const simulatedFailure = () =>
    storeError(rc.PURCHASES_ERROR_CODE.TEST_STORE_SIMULATED_PURCHASE_ERROR, {
      readableErrorCode: 'TEST_STORE_SIMULATED_PURCHASE_ERROR',
      userCancelled: false,
    });
  const activeTrial = (overrides: Partial<PurchasesEntitlementInfo> = {}) =>
    customer([testStoreEntry({ productIdentifier: 'yearly_2999', periodType: 'TRIAL', ...overrides })]);
  /** Customer info read before the purchase, then after it. */
  const sequence = (...infos: CustomerInfo[]) => {
    let call = 0;
    return () => Promise.resolve(infos[Math.min(call++, infos.length - 1)]);
  };

  async function failPurchase(customerInfo: () => Promise<CustomerInfo>) {
    const f = fakes();
    f.control.customerInfo = customerInfo;
    f.control.purchase = () => Promise.reject(simulatedFailure());
    await f.harness.loadProducts();
    const outcome = await f.harness.purchase('default_v2/$rc_annual');
    return { ...f, outcome, state: f.harness.current() };
  }

  test('a subscribed customer keeps the existing entitlement: the purchase fails, the subscription stays active', async () => {
    const { outcome, state, calls } = await failPurchase(sequence(activeTrial()));

    assert.equal(outcome?.kind, 'simulatedFailure', 'the purchase result is a failure');
    assert.equal(state.purchaseStatus?.tone, 'error');
    assert.match(state.purchaseStatus?.message ?? '', /Simulated purchase failure handled: code 42 · TEST_STORE_SIMULATED_PURCHASE_ERROR/);

    assert.equal(state.entitlementCheck?.tone, 'unchanged', 'the existing subscription is not removed');
    assert.match(state.entitlementCheck?.message ?? '', /^Existing subscription kept: test-entitlement is active \(yearly_2999, trial, expires /);
    assert.equal(state.customer?.entitlement?.isActive, true);
    assert.equal(state.customer?.entitlement?.productIdentifier, 'yearly_2999');
    assert.deepEqual(state.customer?.activeEntitlements, [ENTITLEMENT]);
    assert.equal(entitlementFromCustomerInfo(activeTrial(), ENTITLEMENT, TEST_STORE_PRODUCT_IDS).status, 'active');
    assert.equal(calls.refresh, 0, "the app's subscription status is not touched by a failed purchase");
  });

  test('an unsubscribed customer is not granted anything', async () => {
    const { outcome, state, calls } = await failPurchase(sequence(customer()));
    assert.equal(outcome?.kind, 'simulatedFailure');
    assert.equal(state.entitlementCheck?.tone, 'unchanged');
    assert.equal(state.entitlementCheck?.message, 'Nothing granted: test-entitlement has never been granted.');
    assert.equal(state.customer?.entitlement, null);
    assert.deepEqual(state.customer?.activeEntitlements, []);
    assert.equal(calls.refresh, 0);
  });

  test('an expired entitlement stays expired', async () => {
    const { state } = await failPurchase(sequence(activeTrial({ isActive: false })));
    assert.equal(state.entitlementCheck?.tone, 'unchanged');
    assert.match(state.entitlementCheck?.message ?? '', /^Nothing granted: test-entitlement is inactive \(last product yearly_2999\)/);
    assert.equal(state.customer?.entitlement?.isActive, false);
  });

  test('a failed purchase is never reported as completed, whatever the customer already has', async () => {
    for (const info of [customer(), activeTrial(), activeTrial({ isActive: false })]) {
      const { outcome, state } = await failPurchase(sequence(info));
      assert.notEqual(outcome?.kind, 'purchased');
      assert.doesNotMatch(state.purchaseStatus?.message ?? '', /completed/i);
      assert.doesNotMatch(state.log.map((entry) => entry.message).join('\n'), /Purchase completed/);
    }
  });

  test('a subscription that disappears or appears during a failed purchase is flagged, not reported as kept', async () => {
    const lost = await failPurchase(sequence(activeTrial(), activeTrial({ isActive: false })));
    assert.equal(lost.outcome?.kind, 'simulatedFailure');
    assert.equal(lost.state.entitlementCheck?.tone, 'changed');
    assert.match(lost.state.entitlementCheck?.message ?? '', /before, test-entitlement is active .*now, test-entitlement is inactive/);

    const granted = await failPurchase(sequence(customer(), activeTrial()));
    assert.equal(granted.state.entitlementCheck?.tone, 'changed');
    assert.match(granted.state.entitlementCheck?.message ?? '', /before, test-entitlement has never been granted; now, test-entitlement is active/);

    const switched = await failPurchase(sequence(activeTrial(), activeTrial({ productIdentifier: 'monthly_499' })));
    assert.equal(switched.state.entitlementCheck?.tone, 'changed');
  });

  test('a sandbox renewal that only moves the expiry date is not a change', async () => {
    const { state } = await failPurchase(
      sequence(activeTrial({ expirationDate: '2026-10-10T13:00:00.000Z' }), activeTrial({ expirationDate: '2026-10-10T14:00:00.000Z' })),
    );
    assert.equal(state.entitlementCheck?.tone, 'unchanged');
    assert.match(state.entitlementCheck?.message ?? '', /expires 2026-10-10T14:00:00.000Z/);
  });

  test("unreadable customer info leaves the subscription unchecked instead of claiming it was kept", async () => {
    let call = 0;
    const { state } = await failPurchase(() => (call++ === 0 ? Promise.resolve(activeTrial()) : Promise.reject(storeError('10'))));
    assert.equal(state.purchaseStatus?.tone, 'error');
    assert.equal(state.entitlementCheck?.tone, 'unverified');
    assert.match(state.entitlementCheck?.message ?? '', /after the purchase attempt/);
    assert.equal(state.customer, null, 'customer info on screen is left as it was, not replaced by a guess');

    const before = await failPurchase(() => Promise.reject(storeError('10')));
    assert.equal(before.state.entitlementCheck?.tone, 'unverified');
    assert.match(before.state.entitlementCheck?.message ?? '', /before the purchase attempt/);
  });

  test('a completed purchase gets no "subscription after this attempt" check', async () => {
    const { harness, control } = fakes();
    control.customerInfo = sequence(customer());
    await harness.loadProducts();
    await harness.purchase('default_v2/$rc_annual');
    assert.equal(harness.current().purchaseStatus?.tone, 'success');
    assert.equal(harness.current().entitlementCheck, null);
  });
});

describe('App Store sandbox purchases in the development harness', () => {
  /** default_v2 as RevenueCat returns it with the iOS key: the same packages, holding the App Store products. */
  const appStoreV2 = (currencyCode = 'USD', annualIntro: object | null = WEEK_TRIAL) =>
    withV2([
      pkg('$rc_annual', 'puphii_annual_2999', currencyCode === 'USD' ? '$29.99' : '¥4,500', 'P1Y', annualIntro, currencyCode),
      pkg('$rc_monthly', 'puphii_monthly_499', currencyCode === 'USD' ? '$4.99' : '¥750', 'P1M', null, currencyCode),
      pkg('$rc_weekly', 'puphii_weekly_199', currencyCode === 'USD' ? '$1.99' : '¥300', 'P1W', null, currencyCode),
    ]);
  const appStoreEntry = (overrides: Partial<PurchasesEntitlementInfo> = {}) =>
    testStoreEntry({ productIdentifier: 'puphii_annual_2999', store: 'APP_STORE', periodType: 'TRIAL', ...overrides });

  test('the store comes from the validated SDK key: Test Store key, iOS App Store key, or nothing to buy with', () => {
    const key = (platform: string, platformKey: string | undefined, testStoreKey?: string) =>
      selectSdkKey({ platform, platformKey, testStoreKey, isDevelopmentBuild: true });
    assert.equal(harnessStoreFor(key('ios', 'appl_abc123', 'test_abc123'), 'ios'), 'testStore', 'the Test Store key wins in development');
    assert.equal(harnessStoreFor(key('ios', 'appl_abc123'), 'ios'), 'appStore');
    assert.equal(harnessStoreFor(key('android', 'goog_abc123'), 'android'), 'none', 'Google Play is never bought from here');
    assert.equal(harnessStoreFor(key('ios', undefined), 'ios'), 'none');
    assert.equal(harnessStoreFor(key('ios', 'sk_abc123'), 'ios'), 'none', 'a secret key is refused before it gets here');
    assert.equal(harnessStoreFor(key('ios', 'test_abc123'), 'ios'), 'none', 'a Test Store key in the App Store variable is refused');
    assert.equal(harnessStoreFor({ ok: true, apiKey: 'goog_abc123', source: 'platform' }, 'ios'), 'none');
  });

  test('the App Store expectations use the App Store product IDs from config.ts and never the Test Store ones', () => {
    assert.equal(APP_STORE_OFFERING_ID, 'default_v2');
    assert.deepEqual(APP_STORE_EXPECTED.plans, {
      annual: { packageId: '$rc_annual', productId: 'puphii_annual_2999', billingPeriod: 'P1Y', price: null, freeTrialDays: 7 },
      monthly: { packageId: '$rc_monthly', productId: 'puphii_monthly_499', billingPeriod: 'P1M', price: null, freeTrialDays: null },
      weekly: { packageId: '$rc_weekly', productId: 'puphii_weekly_199', billingPeriod: 'P1W', price: null, freeTrialDays: null },
    });
    for (const plan of ['annual', 'monthly', 'weekly'] as const) {
      assert.equal(APP_STORE_EXPECTED.plans[plan].productId, PLANS[plan].productIds.ios);
      assert.equal(APP_STORE_EXPECTED.plans[plan].packageId, TEST_STORE_EXPECTED.plans[plan].packageId, 'one package per plan, shared by both stores');
      assert.notEqual(APP_STORE_EXPECTED.plans[plan].productId, TEST_STORE_EXPECTED.plans[plan].productId);
      assert.equal(TEST_STORE_EXPECTED.plans[plan].productId, TEST_STORE_PRODUCT_IDS[plan]);
    }
  });

  test('the App Store products pass in any storefront currency; prices are shown, not judged', () => {
    for (const currency of ['USD', 'JPY']) {
      const check = checkOffering(appStoreV2(currency), APP_STORE_EXPECTED);
      assert.equal(check.ok, true, check.lines.join('\n'));
    }
    assert.match(checkOffering(appStoreV2('JPY'), APP_STORE_EXPECTED).lines[1], /^OK annual: \$rc_annual → puphii_annual_2999, P1Y, ¥4,500 \(4500 JPY\), Free trial: 1 week$/);
    assert.equal(checkOffering(appStoreV2('JPY'), APP_STORE_EXPECTED).lines[3], 'OK weekly: $rc_weekly → puphii_weekly_199, P1W, ¥300 (300 JPY), no trial');
  });

  test('the App Store trial and periods are still judged', () => {
    assert.match(checkOffering(appStoreV2('USD', null), APP_STORE_EXPECTED).lines[1], /expected a 7-day free trial, found none/);
    const swapped = checkOffering(
      withV2([pkg('$rc_annual', 'puphii_monthly_499', '$4.99', 'P1M'), pkg('$rc_monthly', 'puphii_annual_2999', '$29.99', 'P1Y', WEEK_TRIAL)]),
      APP_STORE_EXPECTED,
    );
    assert.match(swapped.lines[1], /^Mismatch annual: product is puphii_monthly_499, expected puphii_annual_2999; period is P1M, expected P1Y/);
    assert.match(swapped.lines[2], /^Mismatch monthly: product is puphii_annual_2999, expected puphii_monthly_499; period is P1Y, expected P1M/);
  });

  test("each store's products fail the other store's check, so a mixed-up offering is caught", () => {
    const testStoreProducts = checkOffering(planned(), APP_STORE_EXPECTED);
    assert.equal(testStoreProducts.ok, false);
    assert.match(testStoreProducts.lines[1], /product is yearly_2999, expected puphii_annual_2999/);
    const appStoreProducts = checkOffering(appStoreV2(), TEST_STORE_EXPECTED);
    assert.equal(appStoreProducts.ok, false);
    assert.match(appStoreProducts.lines[1], /product is puphii_annual_2999, expected yearly_2999/);
    assert.match(testStoreProducts.lines[3], /product is weekly_199, expected puphii_weekly_199/);
    assert.match(appStoreProducts.lines[3], /product is puphii_weekly_199, expected weekly_199/);
  });

  test("a purchase goes through Apple's sheet, with the store's own prompt", async () => {
    const { harness, calls, control } = fakes({ store: 'appStore', expected: APP_STORE_EXPECTED });
    control.offerings = () => Promise.resolve(appStoreV2());
    control.purchase = (p) => Promise.resolve({ productIdentifier: p.product.identifier, customerInfo: customer([appStoreEntry()]) } as MakePurchaseResult);
    await harness.loadProducts();
    assert.equal(harness.current().offeringCheck?.ok, true);
    const pending = deferred<MakePurchaseResult>();
    const original = control.purchase;
    control.purchase = (p) => pending.promise.then(() => original(p));
    const purchase = harness.purchase('default_v2/$rc_annual');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.match(harness.current().purchaseStatus?.message ?? '', /puphii_annual_2999.*Apple's purchase sheet.*sandbox Apple Account/);
    assert.doesNotMatch(harness.current().purchaseStatus?.message ?? '', /Test Store/);
    pending.resolve({} as MakePurchaseResult);
    assert.deepEqual(await purchase, { kind: 'purchased', productId: 'puphii_annual_2999' });
    assert.deepEqual(calls.purchase, ['puphii_annual_2999']);
    assert.equal(calls.refresh, 1);
    assert.equal(harness.current().customer?.entitlement?.store, 'APP_STORE');
    assert.ok(!harness.current().log.some((entry) => /Warning/.test(entry.message)), 'a sandbox purchase raises no warning');
  });

  test('an App Store purchase RevenueCat does not mark as sandbox is flagged', async () => {
    const { harness, control } = fakes({ store: 'appStore', expected: APP_STORE_EXPECTED });
    control.offerings = () => Promise.resolve(appStoreV2());
    control.purchase = (p) =>
      Promise.resolve({ productIdentifier: p.product.identifier, customerInfo: customer([appStoreEntry({ isSandbox: false })]) } as MakePurchaseResult);
    await harness.loadProducts();
    await harness.purchase('default_v2/$rc_annual');
    assert.equal(harness.current().purchaseStatus?.tone, 'success', 'the purchase result itself is reported as it happened');
    assert.match(harness.current().log.map((entry) => entry.message).join('\n'), /Warning: RevenueCat did not mark this App Store purchase as sandbox/);
  });

  test('the sandbox warning is for App Store purchases only', () => {
    const live = summarizeCustomer(customer([appStoreEntry({ isSandbox: false })]), ENTITLEMENT);
    const sandbox = summarizeCustomer(customer([appStoreEntry()]), ENTITLEMENT);
    assert.match(sandboxWarning('appStore', live) ?? '', /not mark this App Store purchase as sandbox/);
    assert.equal(sandboxWarning('appStore', sandbox), null);
    assert.equal(sandboxWarning('testStore', live), null);
    assert.equal(sandboxWarning('appStore', summarizeCustomer(customer(), ENTITLEMENT)), null);
  });

  test('cancelling Apple\'s sheet changes nothing and is reported', async () => {
    const { harness, calls, control } = fakes({ store: 'appStore', expected: APP_STORE_EXPECTED });
    control.offerings = () => Promise.resolve(appStoreV2());
    control.purchase = () => Promise.reject(storeError('1', { userCancelled: true }));
    await harness.loadProducts();
    assert.deepEqual(await harness.purchase('default_v2/$rc_annual'), { kind: 'cancelled' });
    assert.equal(calls.refresh, 0);
    assert.equal(harness.current().entitlementCheck?.tone, 'unchanged');
  });

  test('the screen picks the store and its expectations from the SDK key only', () => {
    const screen = read(join(ROOT, 'src', 'dev', 'TestStoreHarness.tsx'));
    assert.match(screen, /const store = harnessStoreFor\(appSdkKey, Platform\.OS\);/);
    assert.match(screen, /const expected = store === 'appStore' \? APP_STORE_EXPECTED : TEST_STORE_EXPECTED;/);
    assert.match(screen, /disabled=\{busy \|\| store === 'none'\}/);
  });

  test('the App Store expectations stay development-only', () => {
    for (const file of APP_FILES) {
      if (file.includes(join('src', 'dev'))) continue;
      assert.ok(!/appStoreConfig|APP_STORE_EXPECTED/.test(read(file)), `${relative(ROOT, file)} uses the harness's App Store expectations`);
    }
  });
});
