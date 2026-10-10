import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { PLANS, SUBSCRIPTION_GATING_ENABLED } from '../src/subscription/config';
import { accessFor, Entitlement, isAnnualTrialEligible } from '../src/subscription/entitlement';
import { createMockEntitlementService, mockEntitlements } from '../src/subscription/mockEntitlements';

const storeVerified = (entitlement: Entitlement): Entitlement =>
  'verification' in entitlement ? { ...entitlement, verification: { ...entitlement.verification, origin: 'store' } } : entitlement;

const EVERY_STATE: Entitlement[] = [
  mockEntitlements.unknown(),
  mockEntitlements.active('annual', 'trial'),
  mockEntitlements.active('annual', 'paid'),
  mockEntitlements.active('monthly', 'paid'),
  mockEntitlements.gracePeriod('monthly'),
  mockEntitlements.billingRetry('annual'),
  mockEntitlements.trialEligible(),
  mockEntitlements.expired('monthly'),
  mockEntitlements.error(),
];

const ROOT = join(__dirname, '..', '..');
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe('subscription access', () => {
  test('gating is off, so every status keeps today’s full access', () => {
    assert.equal(SUBSCRIPTION_GATING_ENABLED, false);
    for (const entitlement of EVERY_STATE) {
      assert.equal(accessFor(entitlement, { gatingEnabled: SUBSCRIPTION_GATING_ENABLED, allowMock: false }).core, 'granted');
    }
  });

  test('with gating on, only store-verified active or grace-period access unlocks core features', () => {
    const on = { gatingEnabled: true, allowMock: false };
    const core = (entitlement: Entitlement) => accessFor(storeVerified(entitlement), on).core;
    assert.equal(core(mockEntitlements.active('annual', 'trial')), 'granted');
    assert.equal(core(mockEntitlements.active('annual', 'paid')), 'granted');
    assert.equal(core(mockEntitlements.active('monthly', 'paid')), 'granted');
    assert.equal(core(mockEntitlements.gracePeriod('annual')), 'granted');
    assert.equal(core(mockEntitlements.billingRetry('annual')), 'denied');
    assert.equal(core(mockEntitlements.trialEligible()), 'denied');
    assert.equal(core(mockEntitlements.expired('annual')), 'denied');
    assert.equal(core(mockEntitlements.unknown()), 'checking');
    assert.equal(core(mockEntitlements.error()), 'checking', 'an unverifiable status is not treated as "not subscribed"');
  });

  test('mock entitlements never unlock anything outside development', () => {
    const active = mockEntitlements.active('annual');
    assert.equal(accessFor(active, { gatingEnabled: true, allowMock: false }).core, 'denied');
    assert.equal(accessFor(active, { gatingEnabled: true, allowMock: true }).core, 'granted');
  });

  test('viewing, deleting and exporting your own data never depends on subscription status', () => {
    for (const entitlement of EVERY_STATE) {
      for (const gatingEnabled of [true, false]) {
        const access = accessFor(entitlement, { gatingEnabled, allowMock: false });
        assert.deepEqual([access.viewData, access.deleteData, access.exportData], [true, true, true]);
      }
    }
  });

  test('a free trial is distinguishable from paid time, and trial eligibility from access', () => {
    const trial = mockEntitlements.active('annual', 'trial');
    const paid = mockEntitlements.active('annual', 'paid');
    assert.ok(trial.status === 'active' && trial.period === 'trial');
    assert.ok(paid.status === 'active' && paid.period === 'paid');
    assert.equal(isAnnualTrialEligible(mockEntitlements.trialEligible()), true);
    assert.equal(isAnnualTrialEligible(mockEntitlements.expired('annual')), false);
    assert.equal(isAnnualTrialEligible(trial), false);
  });
});

describe('subscription configuration', () => {
  test('only the annual plan has a free trial, and no price or trial length is hardcoded', () => {
    assert.equal(PLANS.annual.hasFreeTrial, true);
    assert.equal(PLANS.monthly.hasFreeTrial, false);
    assert.equal(PLANS.annual.billingPeriod, 'P1Y');
    assert.equal(PLANS.monthly.billingPeriod, 'P1M');
    for (const plan of Object.values(PLANS)) {
      assert.deepEqual(Object.keys(plan).sort(), ['billingPeriod', 'hasFreeTrial', 'packageId', 'productIds']);
    }
  });

  test('app code never uses the mock, and subscription code never reads local storage', () => {
    const files = sourceFiles(join(ROOT, 'src')).concat(join(ROOT, 'App.tsx'));
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (!file.endsWith('mockEntitlements.ts')) assert.ok(!/mockEntitlements/.test(text), `${file} imports the mock`);
      if (file.includes(`${join('src', 'subscription')}`)) {
        assert.ok(!/async-storage|\.\.\/data\/storage|persistence/.test(text), `${file} reads stored data`);
      }
    }
  });
});

describe('mock entitlement service', () => {
  test('reports status changes and restores', async () => {
    const service = createMockEntitlementService();
    const seen: string[] = [];
    const unsubscribe = service.subscribe((entitlement) => seen.push(entitlement.status));
    assert.equal(service.current().status, 'unknown');

    service.set(mockEntitlements.trialEligible());
    service.setRestoreResult({ outcome: 'restored', entitlement: mockEntitlements.active('monthly') });
    const restored = await service.restorePurchases();
    assert.equal(restored.outcome, 'restored');
    assert.equal(service.current().status, 'active');

    service.setRestoreResult({ outcome: 'failed', error: { kind: 'network', message: 'offline' } });
    await service.restorePurchases();
    assert.equal(service.current().status, 'active', 'a failed restore leaves the last verified status alone');

    unsubscribe();
    service.set(mockEntitlements.expired('monthly'));
    assert.deepEqual(seen, ['inactive', 'active']);
    assert.equal((await service.refresh()).status, 'inactive');
  });
});
