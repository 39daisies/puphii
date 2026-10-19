import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, test } from 'node:test';
import type { CustomerInfo, PurchasesEntitlementInfo } from 'react-native-purchases';
import { createLog, sanitizeLogs } from '../src/data/puffLogic';
import { APP_BENEFITS, LEGAL_URLS, SUBSCRIPTION_GATING_ENABLED } from '../src/subscription/config';
import { accessFor, Entitlement, ProAccess } from '../src/subscription/entitlement';
import { mockEntitlements } from '../src/subscription/mockEntitlements';
import { legalLinksReady, paywallConfigIssues, showPaywallEntry } from '../src/subscription/paywall';
import { canUse, overviewFeature, proGatingActive, subscriptionEnforced } from '../src/subscription/proFeatures';
import { createRevenueCatService, ERROR_CODES, PurchasesSdk } from '../src/subscription/revenueCat';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const ENTITLEMENT = 'test-entitlement';
const PRODUCTS = { annual: 'test.annual', monthly: 'test.monthly', weekly: 'test.weekly' };
const REQUEST_DATE = '2026-10-10T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const daysFromRequest = (days: number) => new Date(Date.parse(REQUEST_DATE) + days * DAY).toISOString();

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

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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

describe('subscription-only: logging still independent of ProGate widgets', () => {
  test('logs have no cap and Home does not import ProGate', () => {
    const logs = Array.from({ length: 5000 }, () => createLog(new Date(REQUEST_DATE)));
    assert.equal(sanitizeLogs(logs).length, 5000);
    for (const file of ['src/data/PuphiiStore.tsx', 'src/screens/HomeScreen.tsx', 'src/components/ReefScene.tsx']) {
      assert.ok(!/ProGate|useProFeature/.test(read(file)), `${file} must not use freemium ProGate`);
    }
  });

  test('Bubble Break does not import paywall; AccessRoot owns the lock', () => {
    const playFiles = [join(ROOT, 'src', 'screens', 'BubbleBreakScreen.tsx'), join(ROOT, 'src', 'screens', 'PlayScreen.tsx'), ...sourceFiles(join(ROOT, 'src', 'game'))];
    for (const file of playFiles) {
      assert.ok(!/\/subscription\/|useEntitlement|ProGate|Paywall|paywall/.test(readFileSync(file, 'utf8')), relative(ROOT, file));
    }
    const app = read('App.tsx');
    assert.match(app, /AccessRoot/);
    assert.match(app, /PaywallGate/);
  });

  test('feature keys are retired — overviewFeature always null; canUse allows null features', () => {
    assert.equal(overviewFeature('month', 0), null);
    assert.equal(overviewFeature('week', -1), null);
    assert.equal(canUse('denied', null), true);
    assert.equal(canUse('checking', null), true);
  });
});

describe('subscription-only entitlement access', () => {
  test('store-verified active grants; mock denied unless allowMock', () => {
    const storeActive: Entitlement = {
      status: 'active',
      plan: 'annual',
      period: 'paid',
      expiresAt: '2027-01-01T00:00:00.000Z',
      willRenew: true,
      verification: { origin: 'store', verifiedAt: REQUEST_DATE },
    };
    assert.equal(proOf(storeActive), 'granted');
    assert.equal(accessFor(mockEntitlements.active('annual'), { gatingEnabled: true, allowMock: false }).pro, 'denied');
    assert.equal(accessFor(mockEntitlements.active('annual'), { gatingEnabled: true, allowMock: true }).pro, 'granted');
  });

  test('unavailable / offline stay checking', async () => {
    const { fake, service } = setup();
    fake.nextCustomerInfo = () => Promise.reject(Object.assign(new Error('offline'), { code: ERROR_CODES.NETWORK_ERROR }));
    service.start();
    await settle();
    assert.equal(proOf(service.current()), 'checking');
    service.stop();
  });

  test('data rights remain when denied', () => {
    const access = accessFor(mockEntitlements.expired('annual'), GATED);
    assert.equal(access.pro, 'denied');
    assert.equal(access.viewData, true);
    assert.equal(access.deleteData, true);
    assert.equal(access.exportData, true);
  });

  test('legal missing never unlocks; enforcement ignores paywallAvailable', () => {
    assert.equal(LEGAL_URLS.termsOfUse, null);
    assert.equal(legalLinksReady(), false);
    assert.ok(paywallConfigIssues().length >= 2);
    assert.equal(subscriptionEnforced(SUBSCRIPTION_GATING_ENABLED), true);
    assert.equal(proGatingActive({ enabled: true, paywallAvailable: false, storeReady: false }), true);
    assert.equal(showPaywallEntry(false), true);
    assert.equal(accessFor(mockEntitlements.trialEligible(), GATED).pro, 'denied');
  });

  test('paywall benefits describe the whole app', () => {
    assert.ok(APP_BENEFITS.length >= 3);
    assert.match(read('src', 'screens', 'PaywallScreen.tsx'), /APP_BENEFITS/);
  });

  test('EntitlementProvider uses PRO_GATING_ACTIVE without legal coupling', () => {
    const provider = read('src', 'subscription', 'EntitlementProvider.tsx');
    assert.match(provider, /subscriptionEnforced\(SUBSCRIPTION_GATING_ENABLED\)/);
    assert.ok(!/showPaywallEntry/.test(provider));
    assert.ok(!/hasNativeStore/.test(provider));
  });
});
