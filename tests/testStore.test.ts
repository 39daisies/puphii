import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import type { CustomerInfo, MakePurchaseResult, PurchasesEntitlementInfo, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import {
  checkOffering,
  createTestStoreHarness,
  describeEntitlement,
  describeOutcome,
  EntitlementActions,
  ExpectedOffering,
  productRows,
  PURCHASE_ERROR_CODES,
  purchaseErrorOutcome,
  summarizeCustomer,
  TestStoreSdk,
} from '../src/dev/testStoreHarness';
import { PLANS, productIdsFor, REVENUECAT_OFFERING_ID, SUBSCRIPTION_GATING_ENABLED } from '../src/subscription/config';
import { accessFor, Entitlement, RestoreResult } from '../src/subscription/entitlement';
import { entitlementFromCustomerInfo } from '../src/subscription/revenueCat';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const rc = require('@revenuecat/purchases-typescript-internal');

/** Test-only identifiers; nothing here exists in a RevenueCat project. */
const ENTITLEMENT = 'test-entitlement';
const REQUEST_DATE = '2026-10-10T12:00:00.000Z';

function pkg(identifier: string, productId: string, price: string, period: string | null, intro: object | null = null): PurchasesPackage {
  return {
    identifier,
    packageType: 'CUSTOM',
    product: { identifier: productId, title: `Title ${productId}`, priceString: price, subscriptionPeriod: period, introPrice: intro },
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

/** What the harness expects with the Test Store key, built from the app's real configuration. */
const TEST_STORE_IDS = productIdsFor('testStore', 'ios');
const EXPECTED: ExpectedOffering = {
  offeringId: REVENUECAT_OFFERING_ID,
  plans: {
    annual: { ...PLANS.annual, productId: TEST_STORE_IDS.annual },
    monthly: { ...PLANS.monthly, productId: TEST_STORE_IDS.monthly },
  },
};
const WEEK_TRIAL = { price: 0, priceString: '$0.00', periodUnit: 'WEEK', periodNumberOfUnits: 1 };
const DAY_TRIAL = { price: 0, priceString: '$0.00', periodUnit: 'DAY', periodNumberOfUnits: 7 };
/** The offering as planned in the RevenueCat dashboard. */
const planned = (annualIntro: object | null = DAY_TRIAL) =>
  offerings('default', {
    default: [pkg('$rc_annual', 'yearly', '$29.99', 'P1Y', annualIntro), pkg('$rc_monthly', 'monthly', '$4.99', 'P1M')],
  });

const storeError = (code: string, extra: object = {}) => Object.assign(new Error(`store error ${code}`), { code, ...extra });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function fakes({ configured = true, usingTestStore = true } = {}) {
  const calls = { getOfferings: 0, purchase: [] as string[], getCustomerInfo: 0, refresh: 0, restore: 0 };
  const control = {
    offerings: (): Promise<PurchasesOfferings> =>
      Promise.resolve(offerings('default', { default: [pkg('$rc_annual', 'teststore.annual', '$29.99', 'P1Y')] })),
    purchase: (p: PurchasesPackage): Promise<MakePurchaseResult> =>
      Promise.resolve({ productIdentifier: p.product.identifier, customerInfo: customer([testStoreEntry()]) } as MakePurchaseResult),
    customerInfo: (): Promise<CustomerInfo> => Promise.resolve(customer()),
    restore: (): Promise<RestoreResult> => Promise.resolve({ outcome: 'nothingToRestore', entitlement: { status: 'unknown' } }),
    entitlement: { status: 'unknown' } as Entitlement,
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
      return Promise.resolve(control.entitlement);
    },
    restorePurchases() {
      calls.restore += 1;
      return control.restore();
    },
  };
  const harness = createTestStoreHarness({ sdk, entitlementId: ENTITLEMENT, entitlements, usingTestStore, expected: EXPECTED });
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

  test('the Test Store key is read only in development builds', () => {
    const adapter = read(join(ROOT, 'src', 'subscription', 'revenueCatSdk.ts'));
    const reads = adapter.match(/process\.env\.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY/g) ?? [];
    assert.equal(reads.length, 1);
    assert.match(adapter, /__DEV__ \? process\.env\.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY : undefined/);
    assert.match(adapter, /isDevelopmentBuild: __DEV__/);
  });

  test('purchases are only started from the development harness', () => {
    for (const file of APP_FILES) {
      if (/purchasePackage|purchaseStoreProduct|purchaseProduct\(/.test(read(file))) {
        assert.ok(file.includes(join('src', 'dev')), `${relative(ROOT, file)} starts a purchase`);
      }
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
      const entitlement = entitlementFromCustomerInfo(info, ENTITLEMENT, { annual: null, monthly: null });
      assert.equal(accessFor(entitlement, { gatingEnabled: SUBSCRIPTION_GATING_ENABLED, allowMock: false }).core, 'granted');
    }
  });
});

describe('Test Store products and outcomes', () => {
  test('lists every package, current offering first, with prices, periods and trials', () => {
    const rows = productRows(
      offerings('main', {
        alt: [pkg('$rc_monthly', 'b.monthly', '$4.99', 'P1M')],
        main: [
          pkg('$rc_annual', 'a.annual', '$29.99', 'P1Y', { price: 0, priceString: '$0.00', periodUnit: 'WEEK', periodNumberOfUnits: 1 }),
          pkg('$rc_monthly', 'a.monthly', '$4.99', 'P1M'),
        ],
      }),
    );
    assert.deepEqual(
      rows.map((r) => [r.key, r.isCurrentOffering, r.price, r.period, r.introOffer]),
      [
        ['main/$rc_annual', true, '$29.99', 'P1Y', 'Free trial: 1 week'],
        ['main/$rc_monthly', true, '$4.99', 'P1M', null],
        ['alt/$rc_monthly', false, '$4.99', 'P1M', null],
      ],
    );
  });

  test('a paid introductory offer is described as such, and empty offerings give no rows', () => {
    const [row] = productRows(
      offerings(null, { x: [pkg('p', 'x.p', '$9.99', 'P1Y', { price: 0.99, priceString: '$0.99', periodUnit: 'MONTH', periodNumberOfUnits: 3 })] }),
    );
    assert.equal(row.introOffer, 'Introductory price $0.99 for 3 months');
    assert.deepEqual(productRows(offerings(null, {})), []);
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
    const active = entitlementFromCustomerInfo(customer([testStoreEntry({ periodType: 'TRIAL' })]), ENTITLEMENT, { annual: null, monthly: null });
    assert.ok(active.status === 'active' && active.period === 'trial' && active.plan === null);
    assert.deepEqual(describeEntitlement(active).slice(0, 2), ['Status: active (free trial)', 'Plan: not one of the configured store products']);
    assert.deepEqual(describeEntitlement({ status: 'error', error: { kind: 'notConfigured', message: 'x' } }), ['Status: error (notConfigured)', 'x']);
  });
});

describe('Test Store offering check', () => {
  test('the planned offering passes, with prices and trial length shown but not judged', () => {
    for (const trial of [DAY_TRIAL, WEEK_TRIAL]) {
      const check = checkOffering(planned(trial), EXPECTED);
      assert.equal(check.ok, true, check.lines.join('\n'));
      assert.equal(check.lines[0], 'OK current offering: default');
    }
    const { lines } = checkOffering(planned(), EXPECTED);
    assert.equal(lines[1], 'OK annual: $rc_annual → yearly, P1Y, $29.99, Free trial: 7 days');
    assert.equal(lines[2], 'OK monthly: $rc_monthly → monthly, P1M, $4.99, no trial');
  });

  test('a different or missing current offering is reported', () => {
    const other = offerings('promo', { promo: planned().current!.availablePackages });
    assert.match(checkOffering(other, EXPECTED).lines[0], /current offering is "promo", expected "default"/);
    assert.equal(checkOffering(other, EXPECTED).ok, false);
    const none = checkOffering(offerings(null, { default: planned().current!.availablePackages }), EXPECTED);
    assert.deepEqual(none, { ok: false, lines: ['Mismatch: RevenueCat has no current offering; expected "default".'] });
  });

  test('swapped products, wrong periods and missing packages are reported', () => {
    const swapped = checkOffering(
      offerings('default', {
        default: [pkg('$rc_annual', 'monthly', '$4.99', 'P1M'), pkg('$rc_monthly', 'yearly', '$29.99', 'P1Y', DAY_TRIAL)],
      }),
      EXPECTED,
    );
    assert.equal(swapped.ok, false);
    assert.match(swapped.lines[1], /^Mismatch annual: product is monthly, expected yearly; period is P1M, expected P1Y; expected a free trial, found none/);
    assert.match(swapped.lines[2], /^Mismatch monthly: product is yearly, expected monthly; period is P1Y, expected P1M; expected no introductory offer/);

    const missing = checkOffering(offerings('default', { default: [pkg('$rc_annual', 'yearly', '$29.99', 'P1Y', DAY_TRIAL)] }), EXPECTED);
    assert.equal(missing.ok, false);
    assert.equal(missing.lines[2], 'Mismatch monthly: package $rc_monthly is not in the current offering.');
  });

  test('the annual trial must be free; a paid intro offer or none is reported', () => {
    assert.match(checkOffering(planned(null), EXPECTED).lines[1], /expected a free trial, found none/);
    const paid = { price: 0.99, priceString: '$0.99', periodUnit: 'MONTH', periodNumberOfUnits: 1 };
    assert.match(checkOffering(planned(paid), EXPECTED).lines[1], /expected a free trial, found "Introductory price \$0\.99 for 1 month"/);
  });

  test('store products that are not configured yet are reported, not assumed', () => {
    const platform = productIdsFor('platform', 'ios');
    const expected: ExpectedOffering = {
      offeringId: REVENUECAT_OFFERING_ID,
      plans: { annual: { ...PLANS.annual, productId: platform.annual }, monthly: { ...PLANS.monthly, productId: platform.monthly } },
    };
    const check = checkOffering(planned(), expected);
    assert.equal(check.ok, false);
    assert.match(check.lines[1], /no product ID is configured for this store/);
  });

  test('loading products runs the check and logs its result', async () => {
    const good = fakes();
    good.control.offerings = () => Promise.resolve(planned());
    await good.harness.loadProducts();
    assert.equal(good.harness.current().offeringCheck?.ok, true);
    assert.match(good.harness.current().log[0].message, /matches the app configuration/);

    const bad = fakes();
    await bad.harness.loadProducts();
    assert.equal(bad.harness.current().offeringCheck?.ok, false);
    assert.match(bad.harness.current().log[0].message, /doesn't match/);

    bad.control.offerings = () => Promise.reject(storeError('10'));
    await bad.harness.loadProducts();
    assert.equal(bad.harness.current().offeringCheck, null);
  });
});

describe('Test Store harness', () => {
  test('does nothing but explain when RevenueCat is not configured', async () => {
    const { harness, calls } = fakes({ configured: false });
    await harness.loadProducts();
    assert.equal(await harness.purchase('default/$rc_annual'), null);
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
    assert.match(empty.harness.current().productsMessage ?? '', /no offerings/);

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
    const outcome = await harness.purchase('default/$rc_annual');
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
    assert.deepEqual(await harness.purchase('default/$rc_annual'), { kind: 'cancelled' });
    control.purchase = () => Promise.reject(storeError('42', { readableErrorCode: 'TEST_STORE_SIMULATED_PURCHASE_ERROR' }));
    assert.equal((await harness.purchase('default/$rc_annual'))?.kind, 'simulatedFailure');
    assert.equal(calls.refresh, 0);
    assert.equal(harness.current().customer, null);
    assert.match(harness.current().log[0].message, /Simulated purchase failure/);
    assert.match(harness.current().log[1].message, /cancelled/);
  });

  test('only one action runs at a time, so a double tap buys once', async () => {
    const { harness, calls, control } = fakes();
    await harness.loadProducts();
    const pending = deferred<MakePurchaseResult>();
    control.purchase = () => pending.promise;
    const first = harness.purchase('default/$rc_annual');
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(harness.current().busy, 'purchasing');
    assert.equal(await harness.purchase('default/$rc_annual'), null);
    await harness.refresh();
    pending.resolve({ productIdentifier: 'teststore.annual', customerInfo: customer([testStoreEntry()]) } as MakePurchaseResult);
    await first;
    assert.deepEqual(calls.purchase, ['teststore.annual']);
    assert.equal(harness.current().busy, null);
  });

  test('never buys through the App Store or Google Play, only the Test Store', async () => {
    const { harness, calls } = fakes({ usingTestStore: false });
    await harness.loadProducts();
    assert.equal(harness.current().products.length, 1, 'products can still be inspected');
    assert.equal(await harness.purchase('default/$rc_annual'), null);
    assert.deepEqual(calls.purchase, []);
    assert.match(harness.current().log[0].message, /only run with the RevenueCat Test Store key/);
  });

  test('an unknown product key is refused', async () => {
    const { harness, calls } = fakes();
    await harness.loadProducts();
    assert.equal(await harness.purchase('missing/package'), null);
    assert.deepEqual(calls.purchase, []);
  });

  test('restore reports each outcome and reloads customer info', async () => {
    const { harness, calls, control } = fakes();
    await harness.restore();
    assert.match(harness.current().log[0].message, /nothing to restore/);
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
