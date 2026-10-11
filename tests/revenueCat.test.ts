import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { CustomerInfo, PurchasesEntitlementInfo } from 'react-native-purchases';
import {
  PLANS,
  productIdsFor,
  REVENUECAT_ENTITLEMENT_ID,
  SUBSCRIPTION_GATING_ENABLED,
  TEST_STORE_PRODUCT_IDS,
} from '../src/subscription/config';
import { accessFor, Entitlement } from '../src/subscription/entitlement';
import { createMockEntitlementService, mockEntitlements } from '../src/subscription/mockEntitlements';
import {
  classifyError,
  Clock,
  createRevenueCatService,
  entitlementFromCustomerInfo,
  ERROR_CODES,
  errorDetail,
  EXPIRY_RECHECK_DELAY_MS,
  INTRO_ELIGIBILITY,
  NETWORK_RETRY_FIRST_MS,
  NETWORK_RETRY_MAX_MS,
  OVERDUE_RECHECK_INTERVAL_MS,
  OVERDUE_RECHECK_LIMIT,
  PurchasesSdk,
  redactKeys,
  restoreOutcomeFor,
  RevenueCatOptions,
  trialEligibilityFrom,
  VERIFICATION_FAILED,
} from '../src/subscription/revenueCat';
import { checkSdkKey, checkTestStoreKey, SdkKeyCheck, selectSdkKey } from '../src/subscription/sdkKeys';

// Shipped with react-native-purchases; loads in Node, unlike the React Native package itself.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const rc = require('@revenuecat/purchases-typescript-internal');

/** Test-only identifiers, deliberately different from the app's real ones. */
const ENTITLEMENT = 'test-entitlement';
const PRODUCTS = { annual: 'test.annual', monthly: 'test.monthly' };
/** The real product IDs, written out so a change to config.ts has to be deliberate. */
const APP_STORE = { annual: 'puphii_annual_2999', monthly: 'puphii_monthly_499' };
const TEST_STORE = { annual: 'yearly_2999', monthly: 'monthly_499' };
const IOS_KEY: SdkKeyCheck = { ok: true, apiKey: 'appl_TestOnlyKey123', source: 'platform' };
type Verified = PurchasesEntitlementInfo['verification'];
const REQUEST_DATE = '2026-10-10T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const daysFromRequest = (days: number) => new Date(Date.parse(REQUEST_DATE) + days * DAY).toISOString();

function entry(overrides: Partial<PurchasesEntitlementInfo> = {}): PurchasesEntitlementInfo {
  return {
    identifier: ENTITLEMENT,
    isActive: true,
    willRenew: true,
    periodType: 'NORMAL',
    productIdentifier: PRODUCTS.annual,
    productPlanIdentifier: null,
    isSandbox: true,
    expirationDate: daysFromRequest(30),
    unsubscribeDetectedAt: null,
    billingIssueDetectedAt: null,
    verification: 'NOT_REQUESTED',
    ...overrides,
  } as PurchasesEntitlementInfo;
}

function customer(entries: PurchasesEntitlementInfo[] = [], verification = 'NOT_REQUESTED'): CustomerInfo {
  const all = Object.fromEntries(entries.map((e) => [e.identifier, e]));
  const active = Object.fromEntries(entries.filter((e) => e.isActive).map((e) => [e.identifier, e]));
  return { entitlements: { all, active, verification }, requestDate: REQUEST_DATE } as unknown as CustomerInfo;
}

const map = (info: CustomerInfo, productIds: Record<'annual' | 'monthly', string | null> = PRODUCTS) =>
  entitlementFromCustomerInfo(info, ENTITLEMENT, productIds);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const storeError = (code: string) => Object.assign(new Error(`store error ${code}`), { code });

function fakeSdk() {
  const calls = { configure: [] as string[], getCustomerInfo: 0, invalidateCache: 0, restorePurchases: 0, eligibility: [] as string[][] };
  const listeners = new Set<(info: CustomerInfo) => void>();
  const sdk = {
    calls,
    listeners,
    nextCustomerInfo: (): Promise<CustomerInfo> => Promise.resolve(customer()),
    nextRestore: (): Promise<CustomerInfo> => Promise.resolve(customer()),
    nextEligibility: (ids: string[]): Promise<Record<string, { status: number }>> =>
      Promise.resolve(Object.fromEntries(ids.map((id) => [id, { status: INTRO_ELIGIBILITY.ELIGIBLE }]))),
    configureError: null as unknown,
    emit(info: CustomerInfo) {
      for (const listener of listeners) listener(info);
    },
  };
  const api: PurchasesSdk = {
    configure(apiKey) {
      if (sdk.configureError) throw sdk.configureError;
      calls.configure.push(apiKey);
    },
    getCustomerInfo() {
      calls.getCustomerInfo += 1;
      return sdk.nextCustomerInfo();
    },
    invalidateCustomerInfoCache() {
      calls.invalidateCache += 1;
      return Promise.resolve();
    },
    restorePurchases() {
      calls.restorePurchases += 1;
      return sdk.nextRestore();
    },
    addCustomerInfoUpdateListener: (listener) => listeners.add(listener),
    removeCustomerInfoUpdateListener: (listener) => listeners.delete(listener),
    checkTrialEligibility(productIds) {
      calls.eligibility.push(productIds);
      return sdk.nextEligibility(productIds);
    },
  };
  return Object.assign(sdk, { api });
}

function fakeAppState(initial = 'active') {
  let state = initial;
  const listeners = new Set<(state: string) => void>();
  return {
    listeners,
    source: {
      current: () => state,
      subscribe(listener: (state: string) => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    change(next: string) {
      state = next;
      for (const listener of listeners) listener(next);
    },
  };
}

/** Timers that only run when a test advances time. Starts at RevenueCat's request time. */
function fakeClock(start = Date.parse(REQUEST_DATE)) {
  let now = start;
  let nextId = 1;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout(callback, ms) {
      const id = nextId++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id as number);
    },
  };
  return {
    clock,
    /** Delays of the pending timers, from now. */
    pending: () => [...timers.values()].map((timer) => timer.at - now),
    async advance(ms: number) {
      now += ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= now).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        due[1].callback();
        await settle();
      }
      await settle();
    },
  };
}

function setup(overrides: Partial<RevenueCatOptions> = {}) {
  const sdk = fakeSdk();
  const appState = fakeAppState();
  const time = fakeClock();
  const logs: string[] = [];
  const service = createRevenueCatService({
    sdk: sdk.api,
    key: IOS_KEY,
    entitlementId: ENTITLEMENT,
    productIds: PRODUCTS,
    appState: appState.source,
    clock: time.clock,
    log: (message) => logs.push(message),
    ...overrides,
  });
  const seen: Entitlement[] = [];
  service.subscribe((entitlement) => seen.push(entitlement));
  return { sdk, appState, service, seen, time, logs };
}

const ROOT = join(__dirname, '..', '..');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('RevenueCat SDK keys', () => {
  test('accepts only the public key for the running platform', () => {
    assert.deepEqual(checkSdkKey('ios', ' appl_abc123 '), { ok: true, apiKey: 'appl_abc123', source: 'platform' });
    assert.deepEqual(checkSdkKey('android', 'goog_abc123'), { ok: true, apiKey: 'goog_abc123', source: 'platform' });
    assert.deepEqual(checkSdkKey('ios', 'goog_abc123'), { ok: false, reason: 'wrongPlatform' });
    assert.deepEqual(checkSdkKey('android', 'appl_abc123'), { ok: false, reason: 'wrongPlatform' });
    assert.deepEqual(checkSdkKey('android', 'amzn_abc123'), { ok: false, reason: 'wrongPlatform' });
  });

  test('refuses secret keys, missing keys and anything malformed', () => {
    assert.deepEqual(checkSdkKey('ios', 'sk_abc123'), { ok: false, reason: 'secretKey' });
    assert.deepEqual(checkSdkKey('ios', undefined), { ok: false, reason: 'missing' });
    assert.deepEqual(checkSdkKey('ios', '   '), { ok: false, reason: 'missing' });
    assert.deepEqual(checkSdkKey('ios', 'appl_abc 123'), { ok: false, reason: 'malformed' });
    assert.deepEqual(checkSdkKey('ios', 'abc123'), { ok: false, reason: 'malformed' });
    assert.deepEqual(checkSdkKey('web', 'appl_abc123'), { ok: false, reason: 'unsupportedPlatform' });
  });

  test('store key variables never accept a Test Store key, in any build', () => {
    assert.deepEqual(checkSdkKey('ios', 'test_abc123'), { ok: false, reason: 'testStoreKey' });
    assert.deepEqual(checkSdkKey('android', 'test_abc123'), { ok: false, reason: 'testStoreKey' });
    for (const isDevelopmentBuild of [true, false]) {
      assert.deepEqual(selectSdkKey({ platform: 'ios', platformKey: 'test_abc123', testStoreKey: undefined, isDevelopmentBuild }), {
        ok: false,
        reason: 'testStoreKey',
      });
    }
  });

  test('the Test Store key is used only in development builds', () => {
    const inputs = { platform: 'ios', platformKey: 'appl_abc123', testStoreKey: 'test_abc123' };
    assert.deepEqual(selectSdkKey({ ...inputs, isDevelopmentBuild: true }), { ok: true, apiKey: 'test_abc123', source: 'testStore' });
    assert.deepEqual(selectSdkKey({ ...inputs, isDevelopmentBuild: false }), { ok: true, apiKey: 'appl_abc123', source: 'platform' });
    assert.deepEqual(selectSdkKey({ ...inputs, platformKey: undefined, isDevelopmentBuild: false }), { ok: false, reason: 'missing' });
    assert.deepEqual(selectSdkKey({ ...inputs, platform: 'android', platformKey: 'goog_abc123', isDevelopmentBuild: true }), {
      ok: true,
      apiKey: 'test_abc123',
      source: 'testStore',
    });
  });

  test('without a Test Store key, development builds use the store key', () => {
    for (const testStoreKey of [undefined, '', '  ']) {
      assert.deepEqual(selectSdkKey({ platform: 'ios', platformKey: 'appl_abc123', testStoreKey, isDevelopmentBuild: true }), {
        ok: true,
        apiKey: 'appl_abc123',
        source: 'platform',
      });
    }
  });

  test('a bad Test Store key is reported, never swapped for the store key', () => {
    const select = (testStoreKey: string) => selectSdkKey({ platform: 'ios', platformKey: 'appl_abc123', testStoreKey, isDevelopmentBuild: true });
    assert.deepEqual(select('appl_abc123'), { ok: false, reason: 'notTestStoreKey' });
    assert.deepEqual(select('sk_abc123'), { ok: false, reason: 'secretKey' });
    assert.deepEqual(select('test abc'), { ok: false, reason: 'malformed' });
    assert.deepEqual(checkTestStoreKey('web', 'test_abc123'), { ok: false, reason: 'unsupportedPlatform' });
  });
});

describe('RevenueCat setup', () => {
  test('the entitlement and packages match the RevenueCat project', () => {
    assert.equal(REVENUECAT_ENTITLEMENT_ID, 'puphii_pro');
    assert.equal(PLANS.annual.packageId, '$rc_annual');
    assert.equal(PLANS.monthly.packageId, '$rc_monthly');
  });

  test('the App Store products match App Store Connect; Google Play has none yet', () => {
    assert.deepEqual(PLANS.annual.productIds, { ios: 'puphii_annual_2999', android: null });
    assert.deepEqual(PLANS.monthly.productIds, { ios: 'puphii_monthly_499', android: null });
    assert.deepEqual(productIdsFor('platform', 'ios'), APP_STORE);
    assert.deepEqual(productIdsFor('platform', 'android'), { annual: null, monthly: null });
  });

  test('Test Store products are kept apart from the App Store and Google Play products', () => {
    assert.deepEqual(TEST_STORE_PRODUCT_IDS, TEST_STORE);
    assert.deepEqual(productIdsFor('testStore', 'ios'), TEST_STORE);
    assert.deepEqual(productIdsFor('testStore', 'android'), TEST_STORE);
  });

  test('outside development builds the Test Store key, and so its product IDs, are never selected', () => {
    const key = selectSdkKey({ platform: 'ios', platformKey: undefined, testStoreKey: 'test_abc123', isDevelopmentBuild: false });
    assert.deepEqual(key, { ok: false, reason: 'missing' });
    const release = selectSdkKey({ platform: 'android', platformKey: 'goog_abc123', testStoreKey: 'test_abc123', isDevelopmentBuild: false });
    assert.ok(release.ok && release.source === 'platform');
    assert.deepEqual(productIdsFor(release.source, 'android'), { annual: null, monthly: null });
    const iosRelease = selectSdkKey({ platform: 'ios', platformKey: 'appl_abc123', testStoreKey: 'test_abc123', isDevelopmentBuild: false });
    assert.ok(iosRelease.ok && iosRelease.source === 'platform');
    assert.deepEqual(productIdsFor(iosRelease.source, 'ios'), APP_STORE);
  });

  test('a Test Store purchase of either product is reported as its plan', () => {
    const products = productIdsFor('testStore', 'ios');
    const annual = entitlementFromCustomerInfo(customer([entry({ productIdentifier: 'yearly_2999', periodType: 'TRIAL' })]), ENTITLEMENT, products);
    const monthly = entitlementFromCustomerInfo(customer([entry({ productIdentifier: 'monthly_499' })]), ENTITLEMENT, products);
    assert.ok(annual.status === 'active' && annual.plan === 'annual' && annual.period === 'trial');
    assert.ok(monthly.status === 'active' && monthly.plan === 'monthly' && monthly.period === 'paid');
  });

  test('products from the original Test Store offering still unlock the entitlement but are no plan', () => {
    const old = entitlementFromCustomerInfo(customer([entry({ productIdentifier: 'yearly' })]), ENTITLEMENT, productIdsFor('testStore', 'ios'));
    assert.ok(old.status === 'active' && old.plan === null);
  });
});

describe('App Store and Test Store products are never mixed', () => {
  const ids = (products: Record<string, string | null>) => Object.values(products).filter((id): id is string => id !== null);

  test('no product ID belongs to both stores, and each store has one per plan', () => {
    const apple = ids(productIdsFor('platform', 'ios'));
    const testStore = ids(productIdsFor('testStore', 'ios'));
    assert.equal(new Set(apple).size, 2);
    assert.equal(new Set(testStore).size, 2);
    for (const id of apple) assert.ok(!testStore.includes(id), `${id} is in both stores`);
    for (const id of apple) assert.match(id, /^puphii_/, 'App Store IDs carry the app prefix');
    for (const id of testStore) assert.doesNotMatch(id, /^puphii_/, 'Test Store IDs never carry it');
  });

  test('each plan keeps its period in both stores: annual is never mapped to a monthly product', () => {
    for (const source of ['platform', 'testStore'] as const) {
      const products = productIdsFor(source, 'ios');
      assert.match(products.annual ?? '', /annual|yearly/, source);
      assert.match(products.monthly ?? '', /monthly/, source);
    }
    assert.match(PLANS.annual.productIds.ios ?? '', /2999$/);
    assert.match(PLANS.monthly.productIds.ios ?? '', /499$/);
  });

  test('with the App Store key, App Store purchases are their plan and Test Store products are none', () => {
    const apple = productIdsFor('platform', 'ios');
    const annual = entitlementFromCustomerInfo(customer([entry({ productIdentifier: 'puphii_annual_2999', periodType: 'TRIAL' })]), ENTITLEMENT, apple);
    const monthly = entitlementFromCustomerInfo(customer([entry({ productIdentifier: 'puphii_monthly_499' })]), ENTITLEMENT, apple);
    assert.ok(annual.status === 'active' && annual.plan === 'annual' && annual.period === 'trial');
    assert.ok(monthly.status === 'active' && monthly.plan === 'monthly');
    for (const id of ids(TEST_STORE)) {
      const state = entitlementFromCustomerInfo(customer([entry({ productIdentifier: id })]), ENTITLEMENT, apple);
      assert.ok(state.status === 'active' && state.plan === null, id);
    }
  });

  test('with the Test Store key, App Store products are no plan', () => {
    for (const id of ids(APP_STORE)) {
      const state = entitlementFromCustomerInfo(customer([entry({ productIdentifier: id })]), ENTITLEMENT, productIdsFor('testStore', 'ios'));
      assert.ok(state.status === 'active' && state.plan === null, id);
    }
  });

  test('the trial eligibility check asks about the App Store annual product with the App Store key', async () => {
    const { sdk, service } = setup({ productIds: productIdsFor('platform', 'ios') });
    sdk.nextEligibility = (requested) =>
      Promise.resolve(Object.fromEntries(requested.map((id) => [id, { status: id === 'puphii_annual_2999' ? INTRO_ELIGIBILITY.ELIGIBLE : INTRO_ELIGIBILITY.UNKNOWN }])));
    service.start();
    await settle();
    assert.deepEqual(sdk.calls.eligibility, [['puphii_annual_2999']]);
    const state = service.current();
    assert.ok(state.status === 'inactive' && state.annualTrial === 'eligible');
  });

  test('product IDs are written only in config.ts; everything else reads them from there', () => {
    const files = sourceFiles(join(ROOT, 'src')).concat(join(ROOT, 'App.tsx'));
    for (const id of [...ids(APP_STORE), ...ids(TEST_STORE)]) {
      for (const file of files) {
        if (file.endsWith(join('subscription', 'config.ts'))) continue;
        assert.ok(!readFileSync(file, 'utf8').includes(`'${id}'`), `${file} hardcodes ${id}`);
      }
    }
  });

  test('the SDK is never configured without a store module, a valid key and an entitlement ID', () => {
    const cases: [Partial<RevenueCatOptions>, string][] = [
      [{ sdk: null }, 'storeUnavailable'],
      [{ key: { ok: false, reason: 'missing' } }, 'notConfigured'],
      [{ key: { ok: false, reason: 'secretKey' } }, 'notConfigured'],
      [{ entitlementId: null }, 'notConfigured'],
    ];
    for (const [overrides, kind] of cases) {
      const { sdk, service, appState } = setup(overrides);
      service.start();
      const state = service.current();
      assert.ok(state.status === 'error' && state.error.kind === kind, JSON.stringify(overrides));
      assert.deepEqual(sdk.calls.configure, []);
      assert.equal(sdk.listeners.size, 0);
      assert.equal(appState.listeners.size, 0);
    }
  });

  test('a secret key is reported as such, never sent anywhere', () => {
    const { service } = setup({ key: checkSdkKey('ios', 'sk_notReal') });
    service.start();
    const state = service.current();
    assert.ok(state.status === 'error' && /secret key/.test(state.error.message));
  });

  test('a configuration failure becomes an error state instead of crashing the app', () => {
    const { sdk, service } = setup();
    sdk.configureError = storeError(ERROR_CODES.CONFIGURATION_ERROR);
    service.start();
    const state = service.current();
    assert.ok(state.status === 'error' && state.error.kind === 'notConfigured');
    assert.equal(sdk.listeners.size, 0);
  });

  test('restoring without a store connection fails cleanly', async () => {
    const { sdk, service } = setup({ sdk: null });
    service.start();
    const result = await service.restorePurchases();
    assert.ok(result.outcome === 'failed' && result.error.kind === 'storeUnavailable');
    assert.equal(sdk.calls.restorePurchases, 0);
  });

  test('the app source holds no secret key and reads keys only from public build variables', () => {
    const files = sourceFiles(join(ROOT, 'src')).concat(join(ROOT, 'App.tsx'));
    for (const file of files) assert.ok(!/\bsk_[A-Za-z0-9]{8,}/.test(readFileSync(file, 'utf8')), `${file} contains a secret key`);
    const adapter = readFileSync(join(ROOT, 'src', 'subscription', 'revenueCatSdk.ts'), 'utf8');
    assert.ok(adapter.includes('process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY'));
    assert.ok(adapter.includes('process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY'));
    assert.ok(/\.env\b/.test(readFileSync(join(ROOT, '.gitignore'), 'utf8')), '.env files are git-ignored');
  });

  test('Apple signing and App Store Connect key files are git-ignored', () => {
    const ignored = readFileSync(join(ROOT, '.gitignore'), 'utf8').split('\n').map((line) => line.trim());
    for (const pattern of ['.env*.local', '*.p8', '*.p12', '*.mobileprovision', '*.cer']) assert.ok(ignored.includes(pattern), pattern);
  });
});

describe('EAS build profiles', () => {
  type Profile = { developmentClient?: boolean; distribution?: string; environment?: string; env?: Record<string, string>; extends?: string };
  const eas = JSON.parse(readFileSync(join(ROOT, 'eas.json'), 'utf8')) as { build: Record<string, Profile> };

  test('preview and production builds take their variables from the matching EAS environment', () => {
    assert.deepEqual(eas.build.preview, { distribution: 'internal', environment: 'preview' });
    assert.deepEqual(eas.build.production, { environment: 'production' });
    assert.equal(eas.build.development.environment, 'development');
  });

  test('only development profiles build the development client', () => {
    for (const name of ['preview', 'production']) {
      assert.ok(!eas.build[name].developmentClient, name);
      assert.equal(eas.build[name].extends, undefined, `${name} must not inherit the development client`);
    }
  });

  test('eas.json holds no API keys and never sets the Test Store key', () => {
    const text = readFileSync(join(ROOT, 'eas.json'), 'utf8');
    assert.doesNotMatch(text, /\b(appl|goog|amzn|test|sk)_[A-Za-z0-9]{6,}/);
    assert.doesNotMatch(text, /EXPO_PUBLIC_REVENUECAT_/);
    for (const profile of Object.values(eas.build)) assert.equal(profile.env, undefined);
  });
});

describe('customer info mapping', () => {
  test('nothing purchased is "never subscribed"', () => {
    const state = map(customer());
    assert.ok(state.status === 'inactive' && state.reason === 'neverSubscribed' && state.lastPlan === null);
  });

  test('an active free trial and paid time are told apart', () => {
    const trial = map(customer([entry({ periodType: 'TRIAL' })]));
    const paid = map(customer([entry({ productIdentifier: PRODUCTS.monthly })]));
    assert.ok(trial.status === 'active' && trial.period === 'trial' && trial.plan === 'annual');
    assert.ok(paid.status === 'active' && paid.period === 'paid' && paid.plan === 'monthly');
    assert.equal(paid.status === 'active' && paid.verification.origin, 'store');
    assert.equal(paid.status === 'active' && paid.verification.verifiedAt, REQUEST_DATE, 'time comes from RevenueCat, not the device');
  });

  test('cancelled but still running subscriptions stay active until they end', () => {
    const state = map(customer([entry({ willRenew: false, unsubscribeDetectedAt: daysFromRequest(-1) })]));
    assert.ok(state.status === 'active' && state.willRenew === false);
  });

  test('billing problems: grace period keeps access, retry and expiry do not', () => {
    const grace = map(customer([entry({ willRenew: false, billingIssueDetectedAt: daysFromRequest(-2) })]));
    assert.equal(grace.status, 'gracePeriod');
    const retry = map(
      customer([entry({ isActive: false, willRenew: false, expirationDate: daysFromRequest(-3), billingIssueDetectedAt: daysFromRequest(-3) })]),
    );
    assert.ok(retry.status === 'billingRetry' && retry.plan === 'annual');
    const gaveUp = map(
      customer([entry({ isActive: false, willRenew: false, expirationDate: daysFromRequest(-90), billingIssueDetectedAt: daysFromRequest(-90) })]),
    );
    assert.ok(gaveUp.status === 'inactive' && gaveUp.reason === 'expired');
    const cancelled = map(
      customer([
        entry({
          isActive: false,
          willRenew: false,
          expirationDate: daysFromRequest(-3),
          billingIssueDetectedAt: daysFromRequest(-3),
          unsubscribeDetectedAt: daysFromRequest(-2),
        }),
      ]),
    );
    assert.equal(cancelled.status, 'inactive');
  });

  test('an ended subscription is "expired" and remembers its plan', () => {
    const state = map(customer([entry({ isActive: false, willRenew: false, expirationDate: daysFromRequest(-1), productIdentifier: PRODUCTS.monthly })]));
    assert.ok(state.status === 'inactive' && state.reason === 'expired' && state.lastPlan === 'monthly');
  });

  test('Android base plans are matched as subscriptionId:basePlanId, and unknown products report no plan', () => {
    const android = { annual: 'puphii_sub:annual', monthly: 'puphii_sub:monthly' };
    const state = map(customer([entry({ productIdentifier: 'puphii_sub', productPlanIdentifier: 'monthly' })]), android);
    assert.ok(state.status === 'active' && state.plan === 'monthly');
    const unknown = map(customer([entry({ productIdentifier: 'something.else' })]));
    assert.ok(unknown.status === 'active' && unknown.plan === null, 'access still follows the entitlement');
    const unset = map(customer([entry()]), { annual: null, monthly: null });
    assert.ok(unset.status === 'active' && unset.plan === null);
  });

  test('a failed signature check is an error, never "active" or "not subscribed"', () => {
    for (const info of [customer([entry()], VERIFICATION_FAILED), customer([entry({ verification: VERIFICATION_FAILED as Verified })])]) {
      const state = map(info);
      assert.ok(state.status === 'error' && state.error.kind === 'verificationFailed');
    }
    assert.equal(map(customer([entry({ verification: 'VERIFIED' as Verified })], 'VERIFIED')).status, 'active');
  });

  test('other entitlements do not count', () => {
    assert.ok(map(customer([entry({ identifier: 'other' })])).status === 'inactive');
  });

  test('trial eligibility follows RevenueCat’s answer and is unknown when unsure', () => {
    assert.equal(trialEligibilityFrom(INTRO_ELIGIBILITY.ELIGIBLE), 'eligible');
    assert.equal(trialEligibilityFrom(INTRO_ELIGIBILITY.INELIGIBLE), 'ineligible');
    assert.equal(trialEligibilityFrom(INTRO_ELIGIBILITY.NO_INTRO_OFFER_EXISTS), 'ineligible');
    assert.equal(trialEligibilityFrom(INTRO_ELIGIBILITY.UNKNOWN), 'unknown');
    assert.equal(trialEligibilityFrom(undefined), 'unknown');
  });
});

describe('RevenueCat errors', () => {
  test('store error codes are classified', () => {
    assert.equal(classifyError(storeError(ERROR_CODES.NETWORK_ERROR)).kind, 'network');
    assert.equal(classifyError(storeError(ERROR_CODES.OFFLINE_CONNECTION_ERROR)).kind, 'network');
    assert.equal(classifyError(storeError(ERROR_CODES.STORE_PROBLEM_ERROR)).kind, 'storeUnavailable');
    assert.equal(classifyError(storeError(ERROR_CODES.INVALID_CREDENTIALS_ERROR)).kind, 'notConfigured');
    assert.equal(classifyError(storeError(ERROR_CODES.CONFIGURATION_ERROR)).kind, 'notConfigured');
    assert.equal(classifyError(storeError(ERROR_CODES.INVALID_RECEIPT_ERROR)).kind, 'verificationFailed');
    assert.equal(classifyError(storeError(ERROR_CODES.RECEIPT_ALREADY_IN_USE_ERROR)).kind, 'receiptInUse');
    assert.equal(classifyError(storeError(ERROR_CODES.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR)).kind, 'receiptInUse');
    assert.equal(classifyError(storeError('999')).kind, 'unknown');
    assert.equal(classifyError(new Error('no code')).kind, 'unknown');
    assert.equal(classifyError(null).kind, 'unknown');
  });

  test('mirrored constants match the installed RevenueCat SDK', () => {
    for (const [name, code] of Object.entries(ERROR_CODES)) assert.equal(rc.PURCHASES_ERROR_CODE[name], code, name);
    assert.equal(rc.VERIFICATION_RESULT.FAILED, VERIFICATION_FAILED);
    assert.equal(rc.ENTITLEMENT_VERIFICATION_MODE.INFORMATIONAL, 'INFORMATIONAL');
    assert.deepEqual(INTRO_ELIGIBILITY, {
      UNKNOWN: rc.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_UNKNOWN,
      INELIGIBLE: rc.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_INELIGIBLE,
      ELIGIBLE: rc.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_ELIGIBLE,
      NO_INTRO_OFFER_EXISTS: rc.INTRO_ELIGIBILITY_STATUS.INTRO_ELIGIBILITY_STATUS_NO_INTRO_OFFER_EXISTS,
    });
  });
});

describe('RevenueCat entitlement service', () => {
  test('starts as unknown, configures once and reports the store’s answer', async () => {
    const { sdk, service, seen } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ periodType: 'TRIAL' })]));
    assert.equal(service.current().status, 'unknown');
    service.start();
    service.start();
    await settle();
    assert.deepEqual(sdk.calls.configure, [IOS_KEY.ok && IOS_KEY.apiKey]);
    assert.equal(sdk.calls.getCustomerInfo, 1);
    const state = service.current();
    assert.ok(state.status === 'active' && state.period === 'trial');
    assert.deepEqual(seen.map((s) => s.status), ['active']);
    assert.deepEqual(sdk.calls.eligibility, [], 'eligibility is only asked for when not subscribed');
  });

  test('when not subscribed, the annual trial eligibility comes from the store', async () => {
    const { sdk, service } = setup();
    service.start();
    await settle();
    const state = service.current();
    assert.ok(state.status === 'inactive' && state.annualTrial === 'eligible');
    assert.deepEqual(sdk.calls.eligibility, [[PRODUCTS.annual]]);
  });

  test('trial eligibility is unknown without an annual product or when the check fails', async () => {
    const noProduct = setup({ productIds: { annual: null, monthly: null } });
    noProduct.service.start();
    await settle();
    assert.ok(noProduct.service.current().status === 'inactive');
    assert.equal((noProduct.service.current() as { annualTrial: string }).annualTrial, 'unknown');
    assert.deepEqual(noProduct.sdk.calls.eligibility, []);

    const failing = setup();
    failing.sdk.nextEligibility = () => Promise.reject(storeError(ERROR_CODES.NETWORK_ERROR));
    failing.service.start();
    await settle();
    assert.equal((failing.service.current() as { annualTrial: string }).annualTrial, 'unknown');
  });

  test('refreshes when the app comes back to the foreground, not on every state change', async () => {
    const { sdk, service, appState } = setup();
    service.start();
    await settle();
    assert.equal(sdk.calls.getCustomerInfo, 1);
    appState.change('active');
    assert.equal(sdk.calls.getCustomerInfo, 1);
    appState.change('background');
    assert.equal(sdk.calls.getCustomerInfo, 1);
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry()]));
    appState.change('active');
    await settle();
    assert.equal(sdk.calls.getCustomerInfo, 2);
    assert.equal(service.current().status, 'active');
  });

  test('follows customer-info updates pushed by the SDK', async () => {
    const { sdk, service } = setup();
    service.start();
    await settle();
    assert.equal(service.current().status, 'inactive');
    sdk.emit(customer([entry()]));
    await settle();
    assert.equal(service.current().status, 'active');
    sdk.emit(customer([entry({ isActive: false, willRenew: false, expirationDate: daysFromRequest(-1) })]));
    await settle();
    const state = service.current();
    assert.ok(state.status === 'inactive' && state.reason === 'expired');
  });

  test('stop removes every listener and ignores late answers', async () => {
    const { sdk, service, appState } = setup();
    const pending = deferred<CustomerInfo>();
    sdk.nextCustomerInfo = () => pending.promise;
    service.start();
    assert.equal(sdk.listeners.size, 1);
    assert.equal(appState.listeners.size, 1);
    service.stop();
    assert.equal(sdk.listeners.size, 0);
    assert.equal(appState.listeners.size, 0);
    pending.resolve(customer([entry()]));
    await settle();
    assert.equal(service.current().status, 'unknown');
  });

  test('offline after a successful check keeps the store’s last answer', async () => {
    const { sdk, service, appState } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry()]));
    service.start();
    await settle();
    sdk.nextCustomerInfo = () => Promise.reject(storeError(ERROR_CODES.OFFLINE_CONNECTION_ERROR));
    appState.change('background');
    appState.change('active');
    await settle();
    assert.equal(service.current().status, 'active');
  });

  test('offline with no earlier answer is a network error, not "not subscribed"', async () => {
    const { sdk, service } = setup();
    sdk.nextCustomerInfo = () => Promise.reject(storeError(ERROR_CODES.NETWORK_ERROR));
    service.start();
    await settle();
    const state = service.current();
    assert.ok(state.status === 'error' && state.error.kind === 'network');
    assert.equal(accessFor(state, { gatingEnabled: true, allowMock: false }).core, 'checking');
  });

  test('non-network failures replace the earlier answer with an explicit error', async () => {
    const { sdk, service } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry()]));
    service.start();
    await settle();
    sdk.nextCustomerInfo = () => Promise.reject(storeError(ERROR_CODES.STORE_PROBLEM_ERROR));
    await service.refresh();
    const state = service.current();
    assert.ok(state.status === 'error' && state.error.kind === 'storeUnavailable');
  });

  test('a slow, older answer never overwrites a newer one', async () => {
    const { sdk, service } = setup();
    const slow = deferred<CustomerInfo>();
    sdk.nextCustomerInfo = () => slow.promise;
    service.start();
    sdk.emit(customer([entry()]));
    await settle();
    assert.equal(service.current().status, 'active');
    slow.resolve(customer());
    await settle();
    assert.equal(service.current().status, 'active');
  });

  test('restore reports restored, nothing to restore, or failure', async () => {
    const { sdk, service } = setup();
    service.start();
    await settle();

    sdk.nextRestore = () => Promise.resolve(customer([entry()]));
    const restored = await service.restorePurchases();
    assert.ok(restored.outcome === 'restored' && restored.entitlement.status === 'active');
    assert.equal(service.current().status, 'active');

    sdk.nextRestore = () => Promise.reject(storeError(ERROR_CODES.NETWORK_ERROR));
    const failed = await service.restorePurchases();
    assert.ok(failed.outcome === 'failed' && failed.error.kind === 'network');
    assert.equal(service.current().status, 'active', 'a failed restore keeps the last answer');

    sdk.nextRestore = () => Promise.resolve(customer());
    const nothing = await service.restorePurchases();
    assert.equal(nothing.outcome, 'nothingToRestore');

    sdk.nextRestore = () => Promise.resolve(customer([entry()], VERIFICATION_FAILED));
    const unverified = await service.restorePurchases();
    assert.ok(unverified.outcome === 'failed' && unverified.error.kind === 'verificationFailed');
  });

  test('a refresh started before a restore cannot undo it', async () => {
    const { sdk, service } = setup();
    service.start();
    await settle();
    const slow = deferred<CustomerInfo>();
    sdk.nextCustomerInfo = () => slow.promise;
    const refreshing = service.refresh();
    sdk.nextRestore = () => Promise.resolve(customer([entry()]));
    await service.restorePurchases();
    slow.resolve(customer());
    await refreshing;
    assert.equal(service.current().status, 'active');
  });
});

const HOUR = 60 * 60 * 1000;
const fromRequest = (ms: number) => new Date(Date.parse(REQUEST_DATE) + ms).toISOString();
const networkError = () => Promise.reject(storeError(ERROR_CODES.NETWORK_ERROR));

describe('Re-checking at expiry', () => {
  test('asks RevenueCat again, bypassing its cache, once the entitlement expires while the app is open', async () => {
    const { sdk, service, time } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ expirationDate: fromRequest(HOUR) })]));
    service.start();
    await settle();
    assert.equal(service.current().status, 'active');
    assert.deepEqual(time.pending(), [HOUR + EXPIRY_RECHECK_DELAY_MS]);

    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ isActive: false, expirationDate: fromRequest(HOUR) })]));
    await time.advance(HOUR);
    assert.equal(sdk.calls.getCustomerInfo, 1, 'not at the exact expiry, so a renewal has time to arrive');
    await time.advance(EXPIRY_RECHECK_DELAY_MS);
    assert.equal(sdk.calls.invalidateCache, 1);
    assert.equal(sdk.calls.getCustomerInfo, 2);
    const now = service.current();
    assert.ok(now.status === 'inactive' && now.reason === 'expired');
    assert.deepEqual(time.pending(), []);
  });

  test('a renewal moves the next check to the new expiry', async () => {
    const { sdk, service, time } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ expirationDate: fromRequest(HOUR) })]));
    service.start();
    await settle();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ expirationDate: fromRequest(2 * HOUR) })]));
    await time.advance(HOUR + EXPIRY_RECHECK_DELAY_MS);
    const now = service.current();
    assert.ok(now.status === 'active' && now.expiresAt === fromRequest(2 * HOUR));
    assert.deepEqual(time.pending(), [HOUR]);
  });

  test('a grace period is re-checked when it ends', async () => {
    const { sdk, service, time } = setup();
    sdk.nextCustomerInfo = () =>
      Promise.resolve(customer([entry({ billingIssueDetectedAt: REQUEST_DATE, willRenew: false, expirationDate: fromRequest(HOUR) })]));
    service.start();
    await settle();
    assert.equal(service.current().status, 'gracePeriod');
    assert.deepEqual(time.pending(), [HOUR + EXPIRY_RECHECK_DELAY_MS]);
  });

  test('lifetime access, no subscription and an ended subscription schedule no re-check', async () => {
    for (const info of [customer([entry({ expirationDate: null })]), customer(), customer([entry({ isActive: false })])]) {
      const { sdk, service, time } = setup();
      sdk.nextCustomerInfo = () => Promise.resolve(info);
      service.start();
      await settle();
      assert.deepEqual(time.pending(), []);
    }
  });

  test('access still reported after its expiry is re-checked now, then every minute, a limited number of times', async () => {
    const { sdk, service, time, logs } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ expirationDate: fromRequest(-HOUR) })]));
    service.start();
    await settle();
    assert.deepEqual(time.pending(), [0]);
    await time.advance(0);
    for (let check = 2; check <= OVERDUE_RECHECK_LIMIT; check += 1) {
      assert.deepEqual(time.pending(), [OVERDUE_RECHECK_INTERVAL_MS]);
      await time.advance(OVERDUE_RECHECK_INTERVAL_MS);
    }
    assert.deepEqual(time.pending(), []);
    assert.equal(sdk.calls.invalidateCache, OVERDUE_RECHECK_LIMIT);
    assert.equal(service.current().status, 'active', "RevenueCat's answer is reported as given; the clock only decides when to ask");
    assert.match(logs[logs.length - 1], /next check when the app returns to the foreground/);
  });

  test('returning to the foreground starts the overdue re-checks again', async () => {
    const { sdk, service, time, appState } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ expirationDate: fromRequest(-HOUR) })]));
    service.start();
    await settle();
    await time.advance(0);
    for (let check = 2; check <= OVERDUE_RECHECK_LIMIT; check += 1) await time.advance(OVERDUE_RECHECK_INTERVAL_MS);
    assert.deepEqual(time.pending(), []);
    appState.change('background');
    appState.change('active');
    await settle();
    assert.deepEqual(time.pending(), [0]);
  });

  test('a distant expiry is scheduled without overflowing the timer', async () => {
    const { sdk, service, time } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ expirationDate: daysFromRequest(400) })]));
    service.start();
    await settle();
    const [delay] = time.pending();
    assert.ok(delay > 0 && delay <= 2_147_483_647, String(delay));
  });

  test('stopping cancels a pending re-check', async () => {
    const { sdk, service, time } = setup();
    sdk.nextCustomerInfo = () => Promise.resolve(customer([entry({ expirationDate: fromRequest(HOUR) })]));
    service.start();
    await settle();
    service.stop();
    assert.deepEqual(time.pending(), []);
  });
});

describe('Offline retries', () => {
  test('a first check that fails offline is retried with growing delays until RevenueCat answers', async () => {
    const { sdk, service, time } = setup();
    sdk.nextCustomerInfo = networkError;
    service.start();
    await settle();
    assert.equal(service.current().status, 'error');
    const delays: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const [delay] = time.pending();
      delays.push(delay);
      await time.advance(delay);
    }
    const first = NETWORK_RETRY_FIRST_MS;
    assert.deepEqual(delays, [first, 2 * first, 4 * first, 8 * first, NETWORK_RETRY_MAX_MS, NETWORK_RETRY_MAX_MS]);
    assert.equal(sdk.calls.getCustomerInfo, 7);
    assert.equal(sdk.calls.invalidateCache, 0, 'retries ask normally; only expiry checks bypass the cache');

    sdk.nextCustomerInfo = () => Promise.resolve(customer());
    await time.advance(time.pending()[0]);
    assert.equal(service.current().status, 'inactive');
    assert.deepEqual(time.pending(), []);
  });

  test('offline during a later check keeps the last answer, retries, then goes back to the expiry check', async () => {
    const { sdk, service, time, appState } = setup();
    const subscribed = () => Promise.resolve(customer([entry({ expirationDate: fromRequest(HOUR) })]));
    sdk.nextCustomerInfo = subscribed;
    service.start();
    await settle();
    sdk.nextCustomerInfo = networkError;
    appState.change('background');
    appState.change('active');
    await settle();
    assert.equal(service.current().status, 'active');
    assert.deepEqual(time.pending(), [NETWORK_RETRY_FIRST_MS]);

    sdk.nextCustomerInfo = subscribed;
    await time.advance(NETWORK_RETRY_FIRST_MS);
    assert.deepEqual(time.pending(), [HOUR + EXPIRY_RECHECK_DELAY_MS - NETWORK_RETRY_FIRST_MS]);
  });

  test('an answer from RevenueCat resets the retry delay', async () => {
    const { sdk, service, time, appState } = setup();
    sdk.nextCustomerInfo = networkError;
    service.start();
    await settle();
    await time.advance(NETWORK_RETRY_FIRST_MS);
    assert.deepEqual(time.pending(), [2 * NETWORK_RETRY_FIRST_MS]);
    sdk.nextCustomerInfo = () => Promise.resolve(customer());
    await time.advance(2 * NETWORK_RETRY_FIRST_MS);
    sdk.nextCustomerInfo = networkError;
    appState.change('background');
    appState.change('active');
    await settle();
    assert.equal(service.current().status, 'inactive');
    assert.deepEqual(time.pending(), [NETWORK_RETRY_FIRST_MS]);
  });

  test('problems a retry cannot fix are not retried', async () => {
    for (const code of [ERROR_CODES.CONFIGURATION_ERROR, ERROR_CODES.INVALID_CREDENTIALS_ERROR, ERROR_CODES.INVALID_RECEIPT_ERROR]) {
      const { sdk, service, time } = setup();
      sdk.nextCustomerInfo = () => Promise.reject(storeError(code));
      service.start();
      await settle();
      assert.equal(service.current().status, 'error');
      assert.deepEqual(time.pending(), [], code);
    }
  });
});

describe('Restore outcomes', () => {
  test('restore tells an ended or failing subscription apart from none at all', async () => {
    const { sdk, service } = setup();
    service.start();
    await settle();
    const cases: [CustomerInfo, string, string][] = [
      [customer([entry({ isActive: false, expirationDate: daysFromRequest(-3) })]), 'foundInactive', 'inactive'],
      [
        customer([entry({ isActive: false, willRenew: false, billingIssueDetectedAt: daysFromRequest(-2), expirationDate: daysFromRequest(-1) })]),
        'foundInactive',
        'billingRetry',
      ],
      [customer(), 'nothingToRestore', 'inactive'],
      [customer([entry({ billingIssueDetectedAt: REQUEST_DATE, willRenew: false })]), 'restored', 'gracePeriod'],
      [customer([entry()]), 'restored', 'active'],
    ];
    for (const [info, outcome, status] of cases) {
      sdk.nextRestore = () => Promise.resolve(info);
      const result = await service.restorePurchases();
      assert.equal(result.outcome, outcome, status);
      assert.ok(result.outcome !== 'failed' && result.entitlement.status === status);
      assert.equal(service.current().status, status);
    }
  });

  test('a purchase linked to a different user is reported as such, not as a verification failure', async () => {
    const { sdk, service } = setup();
    service.start();
    await settle();
    for (const code of [ERROR_CODES.RECEIPT_ALREADY_IN_USE_ERROR, ERROR_CODES.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR]) {
      sdk.nextRestore = () => Promise.reject(storeError(code));
      const result = await service.restorePurchases();
      assert.ok(result.outcome === 'failed' && result.error.kind === 'receiptInUse', code);
      assert.match(result.error.message, /linked to a different user/);
    }
    assert.equal(service.current().status, 'inactive', 'a failed restore keeps the last answer');
  });

  test('only access counts as restored', () => {
    assert.equal(restoreOutcomeFor(mockEntitlements.active('annual')), 'restored');
    assert.equal(restoreOutcomeFor(mockEntitlements.gracePeriod('annual')), 'restored');
    assert.equal(restoreOutcomeFor(mockEntitlements.billingRetry('annual')), 'foundInactive');
    assert.equal(restoreOutcomeFor(mockEntitlements.expired('annual')), 'foundInactive');
    assert.equal(restoreOutcomeFor(mockEntitlements.trialEligible()), 'nothingToRestore');
  });
});

describe('Diagnostics', () => {
  test('failures are logged with RevenueCat’s codes, never with anything shaped like a key', async () => {
    const { sdk, service, logs } = setup();
    sdk.nextCustomerInfo = () =>
      Promise.reject(
        Object.assign(new Error('Invalid API key appl_TestOnlyKey123'), {
          code: ERROR_CODES.INVALID_CREDENTIALS_ERROR,
          readableErrorCode: 'INVALID_CREDENTIALS',
          underlyingErrorMessage: 'key test_AbCdEf123456 rejected',
        }),
      );
    service.start();
    await settle();
    assert.ok(logs.some((line) => /^Subscription check failed: code 11 · INVALID_CREDENTIALS · Invalid API key appl_… · key test_… rejected$/.test(line)));
    assert.doesNotMatch(logs.join('\n'), /TestOnlyKey123|AbCdEf123456/);
  });

  test('configuration, restore and trial eligibility failures are logged too', async () => {
    const configureFails = setup();
    configureFails.sdk.configureError = storeError(ERROR_CODES.CONFIGURATION_ERROR);
    configureFails.service.start();
    assert.match(configureFails.logs.join('\n'), /RevenueCat configuration failed: code 23/);

    const { sdk, service, logs } = setup();
    sdk.nextEligibility = () => Promise.reject(storeError(ERROR_CODES.NETWORK_ERROR));
    service.start();
    await settle();
    assert.match(logs.join('\n'), /Trial eligibility check failed, reported as unknown: code 10/);
    sdk.nextRestore = () => Promise.reject(storeError(ERROR_CODES.STORE_PROBLEM_ERROR));
    await service.restorePurchases();
    assert.match(logs.join('\n'), /Restore failed: code 2/);
  });

  test('key-shaped text is masked, product identifiers are not', () => {
    assert.equal(redactKeys('a appl_AbCdEf123 b goog_XyZ98765 c sk_ZZZZZZZZ d test_q1w2e3r4'), 'a appl_… b goog_… c sk_… d test_…');
    assert.equal(redactKeys('yearly_2999 monthly_499 test.annual'), 'yearly_2999 monthly_499 test.annual');
    assert.equal(errorDetail(null), classifyError(null).message);
  });

  test('the app logs diagnostics only in development builds', () => {
    const adapter = readFileSync(join(ROOT, 'src', 'subscription', 'revenueCatSdk.ts'), 'utf8');
    assert.match(adapter, /log: __DEV__ \? \(message\) => console\.log\(`\[Puphii\] \$\{message\}`\) : undefined,/);
  });
});

describe('access stays open in this phase', () => {
  test('every status the RevenueCat service can report keeps full access while gating is off', async () => {
    assert.equal(SUBSCRIPTION_GATING_ENABLED, false);
    const states: Entitlement[] = [{ status: 'unknown' }];
    for (const overrides of [{ sdk: null }, { key: { ok: false, reason: 'missing' } as SdkKeyCheck }, {}]) {
      const { service } = setup(overrides);
      service.start();
      await settle();
      states.push(service.current());
    }
    for (const info of [
      customer([entry({ periodType: 'TRIAL' })]),
      customer([entry({ billingIssueDetectedAt: daysFromRequest(-1) })]),
      customer([entry({ isActive: false, expirationDate: daysFromRequest(-1), billingIssueDetectedAt: daysFromRequest(-1) })]),
      customer([entry({ isActive: false, expirationDate: daysFromRequest(-100) })]),
      customer([entry()], VERIFICATION_FAILED),
    ]) {
      states.push(map(info));
    }
    assert.deepEqual(
      [...new Set(states.map((s) => s.status))].sort(),
      ['active', 'billingRetry', 'error', 'gracePeriod', 'inactive', 'unknown'],
    );
    for (const state of states) {
      for (const allowMock of [true, false]) {
        assert.equal(accessFor(state, { gatingEnabled: SUBSCRIPTION_GATING_ENABLED, allowMock }).core, 'granted');
      }
    }
  });

  test('the mock service still works alongside the real one', async () => {
    const mock = createMockEntitlementService(mockEntitlements.active('annual', 'trial'));
    assert.equal(mock.current().status, 'active');
    assert.equal((await mock.refresh()).status, 'active');
  });
});
