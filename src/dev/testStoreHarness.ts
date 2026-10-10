import type { CustomerInfo, MakePurchaseResult, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import { Entitlement, PlanId, RestoreResult } from '../subscription/entitlement';
import { classifyError } from '../subscription/revenueCat';

/**
 * Development-only harness for RevenueCat Test Store purchases. Nothing here is stored: the
 * subscription status always comes back from RevenueCat through the entitlement service.
 */
export interface TestStoreSdk {
  isConfigured(): Promise<boolean>;
  getOfferings(): Promise<PurchasesOfferings>;
  purchasePackage(pkg: PurchasesPackage): Promise<MakePurchaseResult>;
  getCustomerInfo(): Promise<CustomerInfo>;
}

/** The parts of the entitlement service the harness drives. */
export type EntitlementActions = {
  refresh(): Promise<Entitlement>;
  restorePurchases(): Promise<RestoreResult>;
};

/** RevenueCat `PURCHASES_ERROR_CODE` values for purchase outcomes. */
export const PURCHASE_ERROR_CODES = {
  PURCHASE_CANCELLED_ERROR: '1',
  PAYMENT_PENDING_ERROR: '20',
  TEST_STORE_SIMULATED_PURCHASE_ERROR: '42',
} as const;

export type ProductRow = {
  key: string;
  offering: string;
  isCurrentOffering: boolean;
  packageId: string;
  productId: string;
  title: string;
  price: string;
  /** ISO 8601 period such as `P1Y`, or null for one-time products. */
  period: string | null;
  introOffer: string | null;
  pkg: PurchasesPackage;
};

function describeIntro(pkg: PurchasesPackage): string | null {
  const intro = pkg.product.introPrice;
  if (!intro) return null;
  const unit = intro.periodUnit.toLowerCase();
  const length = `${intro.periodNumberOfUnits} ${unit}${intro.periodNumberOfUnits === 1 ? '' : 's'}`;
  return intro.price === 0 ? `Free trial: ${length}` : `Introductory price ${intro.priceString} for ${length}`;
}

/** Every package RevenueCat returned, current offering first. */
export function productRows(offerings: PurchasesOfferings): ProductRow[] {
  const currentId = offerings.current?.identifier ?? null;
  const ordered = Object.values(offerings.all).sort(
    (a, b) => Number(b.identifier === currentId) - Number(a.identifier === currentId) || a.identifier.localeCompare(b.identifier),
  );
  return ordered.flatMap((offering) =>
    offering.availablePackages.map((pkg) => ({
      key: `${offering.identifier}/${pkg.identifier}`,
      offering: offering.identifier,
      isCurrentOffering: offering.identifier === currentId,
      packageId: pkg.identifier,
      productId: pkg.product.identifier,
      title: pkg.product.title,
      price: pkg.product.priceString,
      period: pkg.product.subscriptionPeriod,
      introOffer: describeIntro(pkg),
      pkg,
    })),
  );
}

export type ExpectedPlan = { packageId: string; productId: string | null; billingPeriod: string; hasFreeTrial: boolean };
export type ExpectedOffering = { offeringId: string; plans: Record<PlanId, ExpectedPlan> };
export type OfferingCheck = { ok: boolean; lines: string[] };

function checkPlan(plan: PlanId, want: ExpectedPlan, pkg: PurchasesPackage | undefined): { ok: boolean; line: string } {
  if (!pkg) return { ok: false, line: `Mismatch ${plan}: package ${want.packageId} is not in the current offering.` };
  const { product } = pkg;
  const problems: string[] = [];
  if (want.productId === null) problems.push('no product ID is configured for this store');
  else if (product.identifier !== want.productId) problems.push(`product is ${product.identifier}, expected ${want.productId}`);
  if (product.subscriptionPeriod !== want.billingPeriod) {
    problems.push(`period is ${product.subscriptionPeriod ?? 'none'}, expected ${want.billingPeriod}`);
  }
  const intro = describeIntro(pkg);
  const hasFreeTrial = product.introPrice?.price === 0;
  if (want.hasFreeTrial && !hasFreeTrial) problems.push(intro ? `expected a free trial, found "${intro}"` : 'expected a free trial, found none');
  if (!want.hasFreeTrial && intro) problems.push(`expected no introductory offer, found "${intro}"`);
  const summary = `${pkg.identifier} → ${product.identifier}, ${product.subscriptionPeriod ?? 'no period'}, ${product.priceString}, ${intro ?? 'no trial'}`;
  return problems.length
    ? { ok: false, line: `Mismatch ${plan}: ${problems.join('; ')} (${summary})` }
    : { ok: true, line: `OK ${plan}: ${summary}` };
}

/**
 * Compares the current offering with the app's configuration: offering, packages, product IDs,
 * billing periods and whether there is a free trial. Prices and trial lengths are shown but not
 * judged, since they live in the store, not in the app.
 */
export function checkOffering(offerings: PurchasesOfferings, expected: ExpectedOffering): OfferingCheck {
  const current = offerings.current;
  if (!current) return { ok: false, lines: [`Mismatch: RevenueCat has no current offering; expected "${expected.offeringId}".`] };
  const offeringOk = current.identifier === expected.offeringId;
  const lines = [
    offeringOk
      ? `OK current offering: ${current.identifier}`
      : `Mismatch: current offering is "${current.identifier}", expected "${expected.offeringId}".`,
  ];
  let ok = offeringOk;
  for (const plan of ['annual', 'monthly'] as const) {
    const want = expected.plans[plan];
    const result = checkPlan(plan, want, current.availablePackages.find((pkg) => pkg.identifier === want.packageId));
    ok &&= result.ok;
    lines.push(result.line);
  }
  return { ok, lines };
}

export type PurchaseOutcome =
  | { kind: 'purchased'; productId: string }
  | { kind: 'cancelled' }
  | { kind: 'simulatedFailure'; detail: string }
  | { kind: 'pending' }
  | { kind: 'failed'; detail: string };

function errorDetail(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; readableErrorCode?: unknown; message?: unknown; underlyingErrorMessage?: unknown };
  const parts = [
    typeof e.code === 'string' ? `code ${e.code}` : null,
    typeof e.readableErrorCode === 'string' ? e.readableErrorCode : null,
    typeof e.message === 'string' ? e.message : null,
    typeof e.underlyingErrorMessage === 'string' && e.underlyingErrorMessage ? e.underlyingErrorMessage : null,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : classifyError(error).message;
}

export function purchaseErrorOutcome(error: unknown): PurchaseOutcome {
  const e = (error ?? {}) as { code?: unknown; userCancelled?: unknown };
  if (e.userCancelled === true || e.code === PURCHASE_ERROR_CODES.PURCHASE_CANCELLED_ERROR) return { kind: 'cancelled' };
  if (e.code === PURCHASE_ERROR_CODES.TEST_STORE_SIMULATED_PURCHASE_ERROR) return { kind: 'simulatedFailure', detail: errorDetail(error) };
  if (e.code === PURCHASE_ERROR_CODES.PAYMENT_PENDING_ERROR) return { kind: 'pending' };
  return { kind: 'failed', detail: errorDetail(error) };
}

export function describeOutcome(outcome: PurchaseOutcome): string {
  switch (outcome.kind) {
    case 'purchased':
      return `Purchase completed: ${outcome.productId}`;
    case 'cancelled':
      return 'Purchase cancelled. Nothing changed.';
    case 'simulatedFailure':
      return `Simulated purchase failure handled: ${outcome.detail}`;
    case 'pending':
      return 'Payment pending. Status will update when the store confirms it.';
    case 'failed':
      return `Purchase failed: ${outcome.detail}`;
  }
}

export type CustomerSummary = {
  requestDate: string;
  activeEntitlements: string[];
  entitlement: null | {
    id: string;
    isActive: boolean;
    productIdentifier: string;
    store: string;
    periodType: string;
    expirationDate: string | null;
    willRenew: boolean;
    isSandbox: boolean;
  };
};

export function summarizeCustomer(info: CustomerInfo, entitlementId: string | null): CustomerSummary {
  const entry = entitlementId ? info.entitlements.all[entitlementId] : undefined;
  return {
    requestDate: info.requestDate,
    activeEntitlements: Object.keys(info.entitlements.active).sort(),
    entitlement: entry
      ? {
          id: entry.identifier,
          isActive: entry.isActive,
          productIdentifier: entry.productIdentifier,
          store: entry.store,
          periodType: entry.periodType,
          expirationDate: entry.expirationDate,
          willRenew: entry.willRenew,
          isSandbox: entry.isSandbox,
        }
      : null,
  };
}

/** Plain-text lines describing the app's current entitlement, for the harness screen. */
export function describeEntitlement(entitlement: Entitlement): string[] {
  switch (entitlement.status) {
    case 'unknown':
      return ['Status: checking'];
    case 'error':
      return [`Status: error (${entitlement.error.kind})`, entitlement.error.message];
    case 'active':
      return [
        `Status: active (${entitlement.period === 'trial' ? 'free trial' : 'paid'})`,
        `Plan: ${entitlement.plan ?? 'not one of the configured store products'}`,
        `Expires: ${entitlement.expiresAt ?? 'never'}${entitlement.willRenew ? ', renews' : ', will not renew'}`,
      ];
    case 'gracePeriod':
      return ['Status: grace period (billing issue, access kept)', `Plan: ${entitlement.plan ?? 'unconfigured product'}`];
    case 'billingRetry':
      return ['Status: billing retry (no access)', `Plan: ${entitlement.plan ?? 'unconfigured product'}`];
    case 'inactive':
      return [`Status: not subscribed (${entitlement.reason})`, `Annual free trial: ${entitlement.annualTrial}`];
  }
}

export type HarnessAction = 'loadingProducts' | 'purchasing' | 'restoring' | 'refreshing';

export type HarnessState = {
  busy: HarnessAction | null;
  products: ProductRow[];
  /** Null until products have been requested. */
  productsMessage: string | null;
  /** Null until products have loaded. */
  offeringCheck: OfferingCheck | null;
  customer: CustomerSummary | null;
  /** Newest first. */
  log: { id: number; message: string }[];
};

const LOG_LIMIT = 12;
const NOT_CONFIGURED = 'RevenueCat is not configured in this build. See the status above and the README.';

export type TestStoreHarness = {
  current(): HarnessState;
  subscribe(listener: (state: HarnessState) => void): () => void;
  loadProducts(): Promise<void>;
  purchase(rowKey: string): Promise<PurchaseOutcome | null>;
  restore(): Promise<void>;
  refresh(): Promise<void>;
};

export function createTestStoreHarness({
  sdk,
  entitlementId,
  entitlements,
  usingTestStore,
  expected,
}: {
  sdk: TestStoreSdk;
  entitlementId: string | null;
  entitlements: EntitlementActions;
  /** Purchases are only offered with the Test Store key, never through the App Store or Google Play. */
  usingTestStore: boolean;
  expected: ExpectedOffering;
}): TestStoreHarness {
  let state: HarnessState = { busy: null, products: [], productsMessage: null, offeringCheck: null, customer: null, log: [] };
  let nextLogId = 1;
  const listeners = new Set<(state: HarnessState) => void>();

  const update = (patch: Partial<HarnessState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const log = (message: string) => update({ log: [{ id: nextLogId++, message }, ...state.log].slice(0, LOG_LIMIT) });

  /** Runs one action at a time, so a second tap can't start a second purchase. */
  async function run<T>(action: HarnessAction, body: () => Promise<T>): Promise<T | null> {
    if (state.busy) return null;
    update({ busy: action });
    try {
      if (!(await sdk.isConfigured())) {
        log(NOT_CONFIGURED);
        if (action === 'loadingProducts') update({ products: [], productsMessage: NOT_CONFIGURED, offeringCheck: null });
        return null;
      }
      return await body();
    } catch (error) {
      log(`Unexpected error: ${errorDetail(error)}`);
      return null;
    } finally {
      update({ busy: null });
    }
  }

  async function updateCustomer() {
    try {
      update({ customer: summarizeCustomer(await sdk.getCustomerInfo(), entitlementId) });
    } catch (error) {
      log(`Couldn't read customer info: ${errorDetail(error)}`);
    }
  }

  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    loadProducts: async () => {
      await run('loadingProducts', async () => {
        try {
          const offerings = await sdk.getOfferings();
          const products = productRows(offerings);
          const offeringCheck = checkOffering(offerings, expected);
          update({
            products,
            productsMessage: products.length ? null : 'RevenueCat returned no offerings with packages. Check the offering setup.',
            offeringCheck,
          });
          log(`Loaded ${products.length} product${products.length === 1 ? '' : 's'}.`);
          log(offeringCheck.ok ? 'Offering matches the app configuration.' : "Offering doesn't match the app configuration. See Setup check.");
        } catch (error) {
          const message = `Couldn't load products: ${errorDetail(error)}`;
          update({ products: [], productsMessage: message, offeringCheck: null });
          log(message);
        }
      });
    },

    purchase: (rowKey) =>
      run('purchasing', async () => {
        if (!usingTestStore) {
          log('Purchases here only run with the RevenueCat Test Store key (EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY).');
          return null;
        }
        const row = state.products.find((candidate) => candidate.key === rowKey);
        if (!row) {
          log('That product is no longer listed. Reload products.');
          return null;
        }
        let outcome: PurchaseOutcome;
        try {
          const result = await sdk.purchasePackage(row.pkg);
          outcome = { kind: 'purchased', productId: result.productIdentifier };
          update({ customer: summarizeCustomer(result.customerInfo, entitlementId) });
          await entitlements.refresh();
        } catch (error) {
          outcome = purchaseErrorOutcome(error);
        }
        log(describeOutcome(outcome));
        return outcome;
      }),

    restore: async () => {
      await run('restoring', async () => {
        const result = await entitlements.restorePurchases();
        if (result.outcome === 'failed') log(`Restore failed (${result.error.kind}): ${result.error.message}`);
        else log(result.outcome === 'restored' ? 'Restore found an active subscription.' : 'Restore completed: nothing to restore.');
        await updateCustomer();
      });
    },

    refresh: async () => {
      await run('refreshing', async () => {
        const entitlement = await entitlements.refresh();
        log(`Refreshed: ${describeEntitlement(entitlement)[0]}`);
        await updateCustomer();
      });
    },
  };
}
