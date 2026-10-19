import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { APP_BENEFITS, LEGAL_URLS, PLANS, SUBSCRIPTION_GATING_ENABLED } from '../src/subscription/config';
import { accessFor, Entitlement } from '../src/subscription/entitlement';
import {
  defaultSelectedPlan,
  describePlan,
  freeTrialLength,
  legalLinksReady,
  NO_INTRO_OFFER_PLANS,
  paywallConfigIssues,
  showPaywallEntry,
  VerifiedPlan,
} from '../src/subscription/paywall';
import { proGatingActive, subscriptionEnforced } from '../src/subscription/proFeatures';

const ROOT = join(__dirname, '..', '..');
const read = (...parts: string[]) => readFileSync(join(ROOT, ...parts), 'utf8');

const STORE = { origin: 'store' as const, verifiedAt: '2026-10-17T00:00:00.000Z' };
const ENFORCED = { gatingEnabled: true, allowMock: false };

const active: Entitlement = {
  status: 'active',
  plan: 'annual',
  period: 'paid',
  expiresAt: '2027-01-01T00:00:00.000Z',
  willRenew: true,
  verification: STORE,
};
const trial: Entitlement = { ...active, period: 'trial' };
const expired: Entitlement = {
  status: 'inactive',
  reason: 'expired',
  lastPlan: 'monthly',
  annualTrial: 'ineligible',
  verification: STORE,
};
const neverSubscribed: Entitlement = {
  status: 'inactive',
  reason: 'neverSubscribed',
  lastPlan: null,
  annualTrial: 'eligible',
  verification: STORE,
};
const offline: Entitlement = { status: 'error', error: { kind: 'network', message: 'offline' } };
const unknown: Entitlement = { status: 'unknown' };

describe('subscription-only access policy', () => {
  test('enforcement does not depend on legal URLs or store readiness', () => {
    assert.equal(SUBSCRIPTION_GATING_ENABLED, true);
    assert.equal(subscriptionEnforced(true), true);
    assert.equal(proGatingActive({ enabled: true, paywallAvailable: false, storeReady: false }), true);
    assert.equal(LEGAL_URLS.termsOfUse, null);
    assert.equal(LEGAL_URLS.privacyPolicy, null);
    assert.equal(legalLinksReady(), false);
    assert.ok(paywallConfigIssues().length >= 2);
  });

  test('missing legal URLs never unlock the app', () => {
    assert.equal(accessFor(neverSubscribed, ENFORCED).pro, 'denied');
    assert.equal(accessFor(expired, ENFORCED).pro, 'denied');
    assert.equal(showPaywallEntry(false), true, 'paywall entry stays available for restore/legal');
  });

  test('first launch without entitlement is denied (paywall), not free', () => {
    assert.equal(accessFor(neverSubscribed, ENFORCED).pro, 'denied');
    assert.equal(accessFor(neverSubscribed, ENFORCED).viewData, true);
    assert.equal(accessFor(neverSubscribed, ENFORCED).deleteData, true);
  });

  test('active subscriber and active trial are granted full access', () => {
    assert.equal(accessFor(active, ENFORCED).pro, 'granted');
    assert.equal(accessFor(trial, ENFORCED).pro, 'granted');
  });

  test('expired subscription is denied with data rights preserved', () => {
    const access = accessFor(expired, ENFORCED);
    assert.equal(access.pro, 'denied');
    assert.equal(access.viewData, true);
    assert.equal(access.deleteData, true);
    assert.equal(access.exportData, true);
  });

  test('offline / unknown are checking — not treated as expired and not unlocked', () => {
    assert.equal(accessFor(offline, ENFORCED).pro, 'checking');
    assert.equal(accessFor(unknown, ENFORCED).pro, 'checking');
  });

  test('kill switch unlocks; App shell gates on AccessRoot', () => {
    assert.equal(accessFor(neverSubscribed, { gatingEnabled: false, allowMock: false }).pro, 'granted');
    const app = read('App.tsx');
    assert.match(app, /function AccessRoot/);
    assert.match(app, /PaywallGate/);
    assert.match(app, /SubscriptionCheckingScreen/);
    assert.match(app, /access\.pro === 'denied'/);
    assert.match(app, /access\.pro === 'checking'/);
  });

  test('all three plans intend free trials; UI never uses NO_INTRO blocklist', () => {
    assert.equal(PLANS.annual.hasFreeTrial, true);
    assert.equal(PLANS.monthly.hasFreeTrial, true);
    assert.equal(PLANS.weekly.hasFreeTrial, false);
    assert.deepEqual(NO_INTRO_OFFER_PLANS, ['weekly']);
  });

  test('default selection prefers annual', () => {
    const plans = [
      { plan: 'weekly' as const, pkg: {} as VerifiedPlan['pkg'] },
      { plan: 'annual' as const, pkg: {} as VerifiedPlan['pkg'] },
      { plan: 'monthly' as const, pkg: {} as VerifiedPlan['pkg'] },
    ];
    assert.equal(defaultSelectedPlan(plans), 'annual');
  });

  test('trial-ineligible customer sees immediate-charge terms, not a free-trial CTA', () => {
    const pkg = {
      identifier: '$rc_annual',
      product: {
        identifier: 'puphii_annual_2999',
        priceString: '$29.99',
        pricePerMonthString: '$2.50',
        subscriptionPeriod: 'P1Y',
        introPrice: {
          price: 0,
          priceString: '$0.00',
          periodNumberOfUnits: 2,
          periodUnit: 'WEEK',
          cycles: 1,
        },
      },
    } as VerifiedPlan['pkg'];
    const verified: VerifiedPlan = { plan: 'annual', pkg };
    assert.ok(freeTrialLength(pkg));
    const eligible = describePlan(verified, 'eligible', 'ios');
    assert.match(eligible.cta, /trial/i);
    assert.ok(eligible.trialBadge);
    const ineligible = describePlan(verified, 'ineligible', 'ios');
    assert.equal(ineligible.trialBadge, null);
    assert.equal(ineligible.cta, 'Subscribe');
    assert.ok(!/Free for/i.test(ineligible.disclosure));
    const unknownElig = describePlan(verified, 'unknown', 'ios');
    assert.equal(unknownElig.trialBadge, null);
    assert.match(unknownElig.disclosure, /If you qualify/i);
  });

  test('purchase is blocked in controller when legal URLs are missing', () => {
    const paywall = read('src', 'subscription', 'paywall.ts');
    assert.match(paywall, /legalLinksReady\(paywallConfigIssues\(legalLinks\)\)/);
    assert.match(paywall, /Privacy Policy and Terms of Use/);
  });

  test('Insights and Savings no longer feature-gate sections', () => {
    assert.ok(!/ProGate|useProFeature|overviewFeature|historyFeature|SPENDING_PROJECTIONS/.test(read('src', 'screens', 'InsightsOverview.tsx')));
    assert.ok(!/ProGate|historyFeature/.test(read('src', 'screens', 'HistoryScreen.tsx')));
    assert.ok(!/ProGate|useProFeature|SPENDING_PROJECTIONS/.test(read('src', 'screens', 'SavingsScreen.tsx')));
    assert.ok(APP_BENEFITS.length >= 3);
  });
});
