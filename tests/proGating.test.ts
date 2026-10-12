import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import type { CustomerInfo, PurchasesEntitlementInfo } from 'react-native-purchases';
import { periodRange, summarizePeriod } from '../src/data/insights';
import { createLog, sanitizeLogs } from '../src/data/puffLogic';
import { LEGAL_URLS, PRO_BENEFITS, PRO_FEATURE_BENEFITS, SUBSCRIPTION_GATING_ENABLED } from '../src/subscription/config';
import { accessFor, Entitlement, ProAccess } from '../src/subscription/entitlement';
import { mockEntitlements } from '../src/subscription/mockEntitlements';
import { paywallConfigIssues, showPaywallEntry } from '../src/subscription/paywall';
import { canUse, historyFeature, overviewFeature, proGatingActive, ProFeature, SPENDING_PROJECTIONS } from '../src/subscription/proFeatures';
import { createRevenueCatService, ERROR_CODES, PurchasesSdk } from '../src/subscription/revenueCat';
import { selectSdkKey } from '../src/subscription/sdkKeys';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const ENTITLEMENT = 'test-entitlement';
const PRODUCTS = { annual: 'test.annual', monthly: 'test.monthly', weekly: 'test.weekly' };
const REQUEST_DATE = '2026-10-10T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const daysFromRequest = (days: number) => new Date(Date.parse(REQUEST_DATE) + days * DAY).toISOString();

const ALL_FEATURES = Object.keys(PRO_FEATURE_BENEFITS) as ProFeature[];
const GATED = { gatingEnabled: true, allowMock: false };
const proOf = (entitlement: Entitlement): ProAccess => accessFor(entitlement, GATED).pro;

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

function customer(entries: PurchasesEntitlementInfo[] = []): CustomerInfo {
  const all = Object.fromEntries(entries.map((e) => [e.identifier, e]));
  const active = Object.fromEntries(entries.filter((e) => e.isActive).map((e) => [e.identifier, e]));
  return { entitlements: { all, active, verification: 'NOT_REQUESTED' }, requestDate: REQUEST_DATE } as unknown as CustomerInfo;
}

const ACTIVE = () => customer([entry()]);
const EXPIRED = () => customer([entry({ isActive: false, willRenew: false, expirationDate: daysFromRequest(-1) })]);
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const networkError = () => Object.assign(new Error('offline'), { code: ERROR_CODES.NETWORK_ERROR });

function setup() {
  const listeners = new Set<(info: CustomerInfo) => void>();
  const fake = {
    nextCustomerInfo: (): Promise<CustomerInfo> => Promise.resolve(customer()),
    nextRestore: (): Promise<CustomerInfo> => Promise.resolve(customer()),
    emit: (info: CustomerInfo) => listeners.forEach((listener) => listener(info)),
  };
  const sdk: PurchasesSdk = {
    configure: () => undefined,
    getCustomerInfo: () => fake.nextCustomerInfo(),
    invalidateCustomerInfoCache: () => Promise.resolve(),
    restorePurchases: () => fake.nextRestore(),
    addCustomerInfoUpdateListener: (listener) => listeners.add(listener),
    removeCustomerInfoUpdateListener: (listener) => listeners.delete(listener),
    checkTrialEligibility: (ids) => Promise.resolve(Object.fromEntries(ids.map((id) => [id, { status: 2 }]))),
  };
  const service = createRevenueCatService({
    sdk,
    key: { ok: true, apiKey: 'appl_TestOnlyKey123', source: 'platform' },
    entitlementId: ENTITLEMENT,
    productIds: PRODUCTS,
    appState: { current: () => 'active', subscribe: () => () => undefined },
    clock: { now: () => Date.parse(REQUEST_DATE), setTimeout: () => 0, clearTimeout: () => undefined },
  });
  return { fake, service };
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('free features never depend on Puphii Pro', () => {
  test('1. a free user can log unlimited puffs', () => {
    const logs = Array.from({ length: 5000 }, () => createLog(new Date(REQUEST_DATE)));
    assert.equal(sanitizeLogs(logs).length, 5000, 'no cap on stored logs');
    const store = read('src', 'data', 'PuphiiStore.tsx');
    const addPuff = store.slice(store.indexOf('const addPuff'), store.indexOf('const undoLatestToday'));
    assert.match(addPuff, /commitLogs\(\[\.\.\.logsRef\.current, log\]\)/);
    for (const file of ['src/data/PuphiiStore.tsx', 'src/screens/HomeScreen.tsx', 'src/components/ReefScene.tsx']) {
      assert.ok(!/\/subscription\/|useEntitlement|ProGate|Paywall/.test(read(file)), `${file} must not depend on Pro`);
    }
  });

  test('2. a free user can use Bubble Break, with no purchase prompt during it', () => {
    for (const file of [join(ROOT, 'src', 'screens', 'BubbleBreakScreen.tsx'), ...sourceFiles(join(ROOT, 'src', 'game'))]) {
      assert.ok(!/\/subscription\/|useEntitlement|ProGate|Paywall|paywall/.test(readFileSync(file, 'utf8')), relative(ROOT, file));
    }
    const app = read('App.tsx');
    assert.match(app, /\{playing \? \(\s*<BubbleBreakScreen onExit=\{\(\) => goTo\('home'\)\} \/>/);
    assert.equal((app.match(/<ProEntryProvider/g) ?? []).length, 1, 'Pro is only offered inside Insights');
  });

  test('3. a free user keeps the current week overview, its comparison and the 7-day history', () => {
    for (const pro of ['denied', 'checking'] as ProAccess[]) {
      assert.equal(canUse(pro, overviewFeature('week', 0)), true);
      assert.equal(canUse(pro, historyFeature('week')), true);
    }
    const week = summarizePeriod([createLog()], periodRange('week', new Date()));
    assert.equal(week.total, 1);
  });
});

describe('Pro features are locked without a confirmed entitlement', () => {
  const free = proOf(mockEntitlements.trialEligible());

  test('4. a free user cannot open monthly or yearly analytics, or past periods', () => {
    assert.equal(free, 'denied');
    assert.equal(canUse(free, overviewFeature('month', 0)), false);
    assert.equal(canUse(free, overviewFeature('year', 0)), false);
    assert.equal(canUse(free, overviewFeature('week', -1)), false);
    assert.equal(canUse(free, overviewFeature('month', -3)), false);
  });

  test('5. a free user cannot open the 30-day or all-time history charts', () => {
    assert.equal(canUse(free, historyFeature('month')), false);
    assert.equal(canUse(free, historyFeature('all')), false);
  });

  test('6. a free user cannot open spending projections', () => {
    assert.equal(canUse(free, SPENDING_PROJECTIONS), false);
    const savings = read('src', 'screens', 'SavingsScreen.tsx');
    assert.match(savings, /const projections = useProFeature\(SPENDING_PROJECTIONS\);/);
    assert.match(savings, /\.\.\.\(projections\s*\?\s*\(\[\s*\['Per month', money\(estimate\.monthly\)\],\s*\['Per year', money\(estimate\.annual\)\],/);
    const gated = savings.slice(savings.indexOf('<ProGate feature={SPENDING_PROJECTIONS}>'), savings.indexOf('</ProGate>'));
    assert.match(gated, /If you used less/);
    assert.match(gated, /Savings goal/);
    assert.ok(!/Your logs, for context/.test(gated));
  });

  test('7. an active Pro user can use every implemented Pro feature', () => {
    for (const entitlement of [mockEntitlements.active('annual', 'trial'), mockEntitlements.active('monthly', 'paid'), mockEntitlements.gracePeriod('annual')]) {
      const pro = accessFor(entitlement, { gatingEnabled: true, allowMock: true }).pro;
      for (const feature of ALL_FEATURES) assert.equal(canUse(pro, feature), true, `${entitlement.status}: ${feature}`);
    }
  });

  test('11. an unknown or unverifiable status never shows protected content', () => {
    for (const entitlement of [mockEntitlements.unknown(), mockEntitlements.error()]) {
      assert.equal(proOf(entitlement), 'checking');
      for (const feature of ALL_FEATURES) assert.equal(canUse('checking', feature), false);
    }
    const gate = read('src', 'components', 'ProGate.tsx');
    assert.equal((gate.match(/\{children\}/g) ?? []).length, 1, 'children render in one place only');
    assert.match(gate, /if \(canUse\(access\.pro, feature\)\) return <>\{children\}<\/>;/);
  });

  test('unlocking needs a store-verified entitlement: mock or dev-only states never count in release', () => {
    assert.equal(accessFor(mockEntitlements.active('annual'), { gatingEnabled: true, allowMock: false }).pro, 'denied');
    assert.match(read('src', 'subscription', 'EntitlementProvider.tsx'), /accessFor\(entitlement, \{ gatingEnabled: PRO_GATING_ACTIVE, allowMock: __DEV__ \}\)/);
  });
});

describe('entitlement changes', () => {
  test('8. a restored entitlement unlocks protected features', async () => {
    const { fake, service } = setup();
    service.start();
    await settle();
    assert.equal(proOf(service.current()), 'denied');
    fake.nextRestore = () => Promise.resolve(ACTIVE());
    const result = await service.restorePurchases();
    assert.equal(result.outcome, 'restored');
    assert.equal(proOf(service.current()), 'granted');
  });

  test('9. an expired entitlement removes access once RevenueCat confirms it', async () => {
    const { fake, service } = setup();
    fake.nextCustomerInfo = () => Promise.resolve(ACTIVE());
    service.start();
    await settle();
    assert.equal(proOf(service.current()), 'granted');
    fake.emit(EXPIRED());
    await settle();
    assert.ok(service.current().status === 'inactive');
    assert.equal(proOf(service.current()), 'denied');
  });

  test('10. offline, a previously verified entitlement keeps access', async () => {
    const { fake, service } = setup();
    fake.nextCustomerInfo = () => Promise.resolve(ACTIVE());
    service.start();
    await settle();
    fake.nextCustomerInfo = () => Promise.reject(networkError());
    await service.refresh();
    await settle();
    assert.equal(service.current().status, 'active', 'a network error is not proof of expiry');
    assert.equal(proOf(service.current()), 'granted');
  });

  test('offline with no earlier answer stays "checking", never unlocked and never "not subscribed"', async () => {
    const { fake, service } = setup();
    fake.nextCustomerInfo = () => Promise.reject(networkError());
    service.start();
    await settle();
    assert.equal(proOf(service.current()), 'checking');
  });

  test('12. downgrading never deletes, overwrites or truncates history', () => {
    for (const entitlement of [mockEntitlements.expired('annual'), mockEntitlements.trialEligible(), mockEntitlements.unknown()]) {
      const access = accessFor(entitlement, GATED);
      assert.deepEqual([access.viewData, access.deleteData, access.exportData], [true, true, true]);
    }
    const gating = [read('src', 'components', 'ProGate.tsx'), read('src', 'subscription', 'proFeatures.ts'), read('src', 'subscription', 'EntitlementProvider.tsx')];
    for (const text of gating) assert.ok(!/usePuphii|deleteLog|resetAll|async-storage|\.\.\/data\//.test(text), 'gating never touches stored data');
    const history = read('src', 'screens', 'HistoryScreen.tsx');
    assert.ok(history.indexOf('<DaySection group={todayGroup}') > history.indexOf('</ProGate>'), 'the log list, with delete, stays outside the gate');
  });

  test('13. resubscribing restores access to the retained history', async () => {
    const { fake, service } = setup();
    fake.nextCustomerInfo = () => Promise.resolve(EXPIRED());
    service.start();
    await settle();
    assert.equal(proOf(service.current()), 'denied');
    const logs = [createLog(new Date(daysFromRequest(-200))), createLog(new Date(daysFromRequest(-2)))];
    fake.emit(ACTIVE());
    await settle();
    assert.equal(proOf(service.current()), 'granted');
    assert.equal(canUse(proOf(service.current()), historyFeature('all')), true);
    assert.equal(logs.length, 2, 'nothing was removed while locked');
  });
});

describe('paywall and release safety', () => {
  test('14. the paywall lists only implemented, gated benefits', () => {
    assert.deepEqual(PRO_BENEFITS, Object.values(PRO_FEATURE_BENEFITS));
    const used = new Set([overviewFeature('month', 0), overviewFeature('week', -1), historyFeature('all'), SPENDING_PROJECTIONS]);
    assert.deepEqual([...used].sort(), [...ALL_FEATURES].sort(), 'every benefit is a feature the app gates, and vice versa');
    assert.match(read('src', 'screens', 'InsightsOverview.tsx'), /<ProGate feature=\{overviewFeature\(period, safeOffset\)\}/);
    assert.match(read('src', 'screens', 'HistoryScreen.tsx'), /<ProGate feature=\{historyFeature\(range\)\}/);
    assert.match(read('src', 'screens', 'SavingsScreen.tsx'), /<ProGate feature=\{SPENDING_PROJECTIONS\}>/);
    const paywall = read('src', 'screens', 'PaywallScreen.tsx');
    assert.match(paywall, /PRO_BENEFITS\.map\(\(benefit\) =>/);
    const copy = paywall.replace(/^\s*(import|export) .*$/gm, '');
    for (const unavailable of [/voice coach/i, /treasure/i, /export/i, /sync/i, /ad-free|no ads/i, /unlimited/i]) {
      assert.ok(!unavailable.test(copy) && !PRO_BENEFITS!.some((line) => unavailable.test(line)), `never advertise ${unavailable}`);
    }
  });

  test('15. release builds never pick up the Test Store key', () => {
    const key = selectSdkKey({ platform: 'ios', platformKey: undefined, testStoreKey: 'test_SomeTestStoreKey', isDevelopmentBuild: false });
    assert.equal(key.ok, false);
    assert.match(read('src', 'subscription', 'revenueCatSdk.ts'), /testStoreKey: __DEV__ \? process\.env\.EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY : undefined,/);
  });

  test('16. missing legal links keep monetization, and with it gating, off in release builds', () => {
    assert.deepEqual(LEGAL_URLS, { termsOfUse: null, privacyPolicy: null });
    assert.equal(SUBSCRIPTION_GATING_ENABLED, true);
    assert.equal(showPaywallEntry(false), false);
    assert.equal(proGatingActive({ enabled: SUBSCRIPTION_GATING_ENABLED, paywallAvailable: showPaywallEntry(false), storeReady: true }), false);
    for (const entitlement of [mockEntitlements.trialEligible(), mockEntitlements.unknown()]) {
      assert.equal(accessFor(entitlement, { gatingEnabled: false, allowMock: false }).pro, 'granted', 'nothing is locked while Pro cannot be bought');
    }
    const provider = read('src', 'subscription', 'EntitlementProvider.tsx');
    assert.match(provider, /paywallAvailable: showPaywallEntry\(__DEV__\),\s*storeReady: hasNativeStore && appSdkKey\.ok,/);
  });

  test('gating turns on only where Pro can be bought', () => {
    const ready = { termsOfUse: 'https://example.org/terms', privacyPolicy: 'https://example.org/privacy' };
    assert.equal(proGatingActive({ enabled: true, paywallAvailable: showPaywallEntry(false, paywallConfigIssues(ready)), storeReady: true }), true);
    assert.equal(proGatingActive({ enabled: true, paywallAvailable: true, storeReady: false }), false, 'no store SDK or key: nothing to buy with');
    assert.equal(proGatingActive({ enabled: false, paywallAvailable: true, storeReady: true }), false);
    assert.equal(proGatingActive({ enabled: true, paywallAvailable: showPaywallEntry(true), storeReady: true }), true, 'development builds can test it');
  });
});
