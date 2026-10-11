import type { CustomerInfo, MakePurchaseResult, PurchasesOffering, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import { Entitlement, PlanId, RestoreResult } from '../subscription/entitlement';
import { errorDetail } from '../subscription/revenueCat';
import type { SdkKeyCheck } from '../subscription/sdkKeys';

/**
 * Development-only harness for RevenueCat Test Store purchases and, with the iOS key, App Store
 * sandbox purchases. Nothing here is stored: the subscription status always comes back from
 * RevenueCat through the entitlement service.
 */

/**
 * Where the harness buys. `appStore` is Apple's sandbox: the harness only exists in development
 * builds, which are development- or ad hoc-signed, and those always buy in the sandbox.
 * `none`: products can be inspected, nothing can be bought.
 */
export type HarnessStore = 'testStore' | 'appStore' | 'none';

/** Chosen from the SDK key that already passed `selectSdkKey`, never from anything else. */
export function harnessStoreFor(key: SdkKeyCheck, platform: string): HarnessStore {
  if (!key.ok) return 'none';
  if (key.source === 'testStore') return 'testStore';
  return platform === 'ios' && key.apiKey.startsWith('appl_') ? 'appStore' : 'none';
}

export const STORE_LABEL: Record<HarnessStore, string> = {
  testStore: 'Test Store',
  appStore: 'App Store sandbox',
  none: 'no purchases',
};

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

/** The offering with this identifier, current or not, or null if RevenueCat didn't return it. */
export function findOffering(offerings: PurchasesOfferings, identifier: string): PurchasesOffering | null {
  return Object.prototype.hasOwnProperty.call(offerings.all, identifier) ? offerings.all[identifier] : null;
}

function offeringNames(offerings: PurchasesOfferings): string {
  const currentId = offerings.current?.identifier;
  const names = Object.keys(offerings.all).sort().map((id) => (id === currentId ? `${id} (current)` : id));
  return names.length ? names.join(', ') : 'none';
}

/** Why the expected offering can't be used, or null when it can. */
export function missingOfferingMessage(offerings: PurchasesOfferings, identifier: string): string | null {
  const offering = findOffering(offerings, identifier);
  if (!offering) return `RevenueCat didn't return the offering "${identifier}". Offerings returned: ${offeringNames(offerings)}.`;
  if (!offering.availablePackages.length) return `The offering "${identifier}" has no packages.`;
  return null;
}

/** The packages of one offering, loaded by identifier rather than as the current offering. */
export function productRows(offering: PurchasesOffering, currentId: string | null): ProductRow[] {
  return offering.availablePackages.map((pkg) => ({
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
  }));
}

export type ExpectedPlan = {
  packageId: string;
  productId: string;
  billingPeriod: string;
  /** Null when the price depends on the tester's storefront, as in App Store sandbox: shown but not judged. */
  price: { amount: number; currencyCode: string } | null;
  /** Length of the free trial, or null when the product must have no introductory offer at all. */
  freeTrialDays: number | null;
};
export type ExpectedOffering = { offeringId: string; plans: Record<PlanId, ExpectedPlan> };
export type OfferingCheck = { ok: boolean; lines: string[] };

const DAYS_PER_UNIT: Record<string, number> = { DAY: 1, WEEK: 7 };

/** The introductory offer's length in days, or null when it is measured in months or years. */
function introDays(pkg: PurchasesPackage): number | null {
  const intro = pkg.product.introPrice;
  const perUnit = intro ? DAYS_PER_UNIT[intro.periodUnit] : undefined;
  return intro && perUnit ? perUnit * intro.periodNumberOfUnits * (intro.cycles >= 1 ? intro.cycles : 1) : null;
}

const sameAmount = (a: number, b: number) => Math.round(a * 100) === Math.round(b * 100);

function checkPlan(plan: PlanId, want: ExpectedPlan, pkg: PurchasesPackage | undefined, offeringId: string): { ok: boolean; line: string } {
  if (!pkg) return { ok: false, line: `Mismatch ${plan}: package ${want.packageId} is not in the offering "${offeringId}".` };
  const { product } = pkg;
  const problems: string[] = [];
  if (product.identifier !== want.productId) problems.push(`product is ${product.identifier}, expected ${want.productId}`);
  if (product.subscriptionPeriod !== want.billingPeriod) {
    problems.push(`period is ${product.subscriptionPeriod ?? 'none'}, expected ${want.billingPeriod}`);
  }
  if (want.price && (product.currencyCode !== want.price.currencyCode || !sameAmount(product.price, want.price.amount))) {
    problems.push(`price is ${product.price} ${product.currencyCode}, expected ${want.price.amount} ${want.price.currencyCode}`);
  }
  const intro = describeIntro(pkg);
  if (want.freeTrialDays === null) {
    if (intro) problems.push(`expected no introductory offer, found "${intro}"`);
  } else if (product.introPrice?.price !== 0) {
    problems.push(intro ? `expected a ${want.freeTrialDays}-day free trial, found "${intro}"` : `expected a ${want.freeTrialDays}-day free trial, found none`);
  } else if (introDays(pkg) !== want.freeTrialDays) {
    problems.push(`expected a ${want.freeTrialDays}-day free trial, found "${intro}"`);
  }
  const summary = `${pkg.identifier} → ${product.identifier}, ${product.subscriptionPeriod ?? 'no period'}, ${product.priceString} (${product.price} ${product.currencyCode}), ${intro ?? 'no trial'}`;
  return problems.length
    ? { ok: false, line: `Mismatch ${plan}: ${problems.join('; ')} (${summary})` }
    : { ok: true, line: `OK ${plan}: ${summary}` };
}

/**
 * Compares one offering, looked up by identifier, with what it is set up to contain: packages,
 * product IDs, billing periods, prices (where fixed) and the free trial, all as the SDK reports them. Whether
 * a given customer is still eligible for the trial is a separate question RevenueCat answers.
 */
export function checkOffering(offerings: PurchasesOfferings, expected: ExpectedOffering): OfferingCheck {
  const offering = findOffering(offerings, expected.offeringId);
  if (!offering) return { ok: false, lines: [`Mismatch: ${missingOfferingMessage(offerings, expected.offeringId)}`] };
  const lines = [`OK offering: ${offering.identifier}${offering.identifier === offerings.current?.identifier ? ' (current)' : ' (loaded by identifier; not current)'}`];
  let ok = true;
  for (const plan of ['annual', 'monthly'] as const) {
    const want = expected.plans[plan];
    const pkg = offering.availablePackages.find((candidate) => candidate.identifier === want.packageId);
    const result = checkPlan(plan, want, pkg, offering.identifier);
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

/**
 * Whether a purchase that didn't complete left the customer's entitlement as it was. This is
 * separate from the purchase result: a failed purchase by a subscribed customer must leave them
 * subscribed, and one by an unsubscribed customer must not grant anything.
 */
export type EntitlementCheck = { tone: 'unchanged' | 'changed' | 'unverified'; message: string };

type EntitlementState = CustomerSummary['entitlement'];

function describeEntitlementState(id: string, entry: EntitlementState): string {
  if (!entry) return `${id} has never been granted`;
  if (!entry.isActive) return `${id} is inactive (last product ${entry.productIdentifier})`;
  return `${id} is active (${entry.productIdentifier}, ${entry.periodType.toLowerCase()}, expires ${entry.expirationDate ?? 'never'})`;
}

export function checkEntitlementUnchanged(
  entitlementId: string | null,
  before: CustomerSummary | null,
  after: CustomerSummary | null,
): EntitlementCheck {
  if (!entitlementId) return { tone: 'unverified', message: "Can't check the subscription: no entitlement identifier is configured." };
  if (!before || !after) {
    return { tone: 'unverified', message: `Couldn't read customer info ${before ? 'after' : 'before'} the purchase attempt, so ${entitlementId} wasn't checked.` };
  }
  const was = before.entitlement;
  const now = after.entitlement;
  const changed = Boolean(was?.isActive) !== Boolean(now?.isActive) || (now?.isActive === true && was?.productIdentifier !== now.productIdentifier);
  if (changed) {
    return {
      tone: 'changed',
      message: `Subscription changed during a purchase that didn't complete: before, ${describeEntitlementState(entitlementId, was)}; now, ${describeEntitlementState(entitlementId, now)}. A scheduled sandbox renewal or expiry can also cause this.`,
    };
  }
  return {
    tone: 'unchanged',
    message: now?.isActive
      ? `Existing subscription kept: ${describeEntitlementState(entitlementId, now)}.`
      : `Nothing granted: ${describeEntitlementState(entitlementId, now)}.`,
  };
}

/** RevenueCat's SDK answers "eligible" for any Test Store product with a trial, whatever the customer has used. */
export const TEST_STORE_TRIAL_NOTE =
  'Test Store: RevenueCat reports every product with a trial as eligible, even after this customer used it, so ineligibility can’t be tested here.';

/** Plain-text lines describing the app's current entitlement, for the harness screen. */
export function describeEntitlement(entitlement: Entitlement, { testStore = false }: { testStore?: boolean } = {}): string[] {
  if (testStore && entitlement.status === 'inactive') return [...describeEntitlement(entitlement), TEST_STORE_TRIAL_NOTE];
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

export function describeRestore(result: RestoreResult): string {
  switch (result.outcome) {
    case 'failed':
      return `Restore failed (${result.error.kind}): ${result.error.message}`;
    case 'restored':
      return 'Restore found an active subscription.';
    case 'nothingToRestore':
      return 'Restore completed: no subscription found.';
    case 'foundInactive':
      return result.entitlement.status === 'billingRetry'
        ? 'Restore found a subscription whose renewal is failing: no access until payment is fixed in the App Store or Google Play.'
        : `Restore found a subscription that has ended (${describeEntitlement(result.entitlement)[0]}). Nothing to unlock.`;
  }
}

/** Lets a development-only button open the Test Store screen, which the development menu also opens. */
export function createOpenRequests() {
  const listeners = new Set<() => void>();
  return {
    request() {
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

export type HarnessAction = 'loadingProducts' | 'purchasing' | 'restoring' | 'refreshing';

/** The latest purchase attempt, shown next to the Buy buttons. */
export type PurchaseStatus = { tone: 'progress' | 'success' | 'info' | 'error'; message: string };

const OUTCOME_TONE: Record<PurchaseOutcome['kind'], PurchaseStatus['tone']> = {
  purchased: 'success',
  cancelled: 'info',
  pending: 'info',
  simulatedFailure: 'error',
  failed: 'error',
};

/** A purchase result without a product or customer info is reported, not trusted. */
export function purchasedOutcome(result: unknown): PurchaseOutcome {
  const r = (result ?? null) as Partial<MakePurchaseResult> | null;
  if (!r || typeof r.productIdentifier !== 'string' || !r.customerInfo) {
    return { kind: 'failed', detail: 'RevenueCat returned an unexpected purchase result (no product or customer info).' };
  }
  return { kind: 'purchased', productId: r.productIdentifier };
}

export type HarnessState = {
  busy: HarnessAction | null;
  /** Null until a purchase is attempted. */
  purchaseStatus: PurchaseStatus | null;
  /** Set after a purchase that didn't complete; null otherwise. */
  entitlementCheck: EntitlementCheck | null;
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
export const NO_PURCHASES =
  'Purchases here only run with the RevenueCat Test Store key (EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY) or, on iOS, the App Store key (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY) for sandbox purchases.';

const PURCHASE_PROMPT: Record<Exclude<HarnessStore, 'none'>, string> = {
  testStore: 'Choose an option in RevenueCat\'s "Test Store Purchase" alert.',
  appStore: "Confirm in Apple's purchase sheet, signed in with a sandbox Apple Account. It should be marked [Sandbox].",
};

/** Flags an App Store purchase RevenueCat didn't record as sandbox. Diagnostic only: it can't undo a purchase. */
export function sandboxWarning(store: HarnessStore, customer: CustomerSummary): string | null {
  if (store !== 'appStore' || !customer.entitlement || customer.entitlement.isSandbox) return null;
  return 'Warning: RevenueCat did not mark this App Store purchase as sandbox. Development builds should only ever buy in the sandbox; check how this build was signed.';
}

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
  store,
  expected,
}: {
  sdk: TestStoreSdk;
  entitlementId: string | null;
  entitlements: EntitlementActions;
  /** Purchases run through the Test Store or the App Store sandbox only, never Google Play. */
  store: HarnessStore;
  /** The setup check for `store`'s products: each store is judged by its own expectations. */
  expected: ExpectedOffering;
}): TestStoreHarness {
  let state: HarnessState = { busy: null, purchaseStatus: null, entitlementCheck: null, products: [], productsMessage: null, offeringCheck: null, customer: null, log: [] };
  let nextLogId = 1;
  const listeners = new Set<(state: HarnessState) => void>();

  const update = (patch: Partial<HarnessState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const log = (message: string) => update({ log: [{ id: nextLogId++, message }, ...state.log].slice(0, LOG_LIMIT) });
  /** Logs a refused or failed purchase and shows it next to the Buy buttons. */
  const purchaseProblem = (message: string) => {
    log(message);
    update({ purchaseStatus: { tone: 'error', message } });
  };

  /** Runs one action at a time, so a second tap can't start a second purchase. */
  async function run<T>(action: HarnessAction, body: () => Promise<T>): Promise<T | null> {
    if (state.busy) return null;
    update({ busy: action });
    try {
      if (!(await sdk.isConfigured())) {
        if (action === 'purchasing') purchaseProblem(NOT_CONFIGURED);
        else log(NOT_CONFIGURED);
        if (action === 'loadingProducts') update({ products: [], productsMessage: NOT_CONFIGURED, offeringCheck: null });
        return null;
      }
      return await body();
    } catch (error) {
      const message = `Unexpected error: ${errorDetail(error)}`;
      if (action === 'purchasing') purchaseProblem(message);
      else log(message);
      return null;
    } finally {
      update({ busy: null });
    }
  }

  async function readCustomer(): Promise<CustomerSummary | null> {
    try {
      return summarizeCustomer(await sdk.getCustomerInfo(), entitlementId);
    } catch (error) {
      log(`Couldn't read customer info: ${errorDetail(error)}`);
      return null;
    }
  }

  async function updateCustomer() {
    const customer = await readCustomer();
    if (customer) update({ customer });
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
          const offering = findOffering(offerings, expected.offeringId);
          const products = offering ? productRows(offering, offerings.current?.identifier ?? null) : [];
          const offeringCheck = checkOffering(offerings, expected);
          update({ products, productsMessage: missingOfferingMessage(offerings, expected.offeringId), offeringCheck });
          log(`Loaded ${products.length} product${products.length === 1 ? '' : 's'} from "${expected.offeringId}".`);
          log(offeringCheck.ok ? `"${expected.offeringId}" matches its expected setup.` : `"${expected.offeringId}" doesn't match its expected setup. See Setup check.`);
        } catch (error) {
          const message = `Couldn't load products: ${errorDetail(error)}`;
          update({ products: [], productsMessage: message, offeringCheck: null });
          log(message);
        }
      });
    },

    purchase: (rowKey) =>
      run('purchasing', async () => {
        if (store === 'none') {
          purchaseProblem(NO_PURCHASES);
          return null;
        }
        const row = state.products.find((candidate) => candidate.key === rowKey);
        if (!row) {
          purchaseProblem('That product is no longer listed. Reload products.');
          return null;
        }
        update({
          purchaseStatus: { tone: 'progress', message: `Purchasing ${row.productId}. ${PURCHASE_PROMPT[store]}` },
          entitlementCheck: null,
        });
        const before = await readCustomer();
        let result: MakePurchaseResult | undefined;
        let outcome: PurchaseOutcome;
        try {
          result = await sdk.purchasePackage(row.pkg);
          outcome = purchasedOutcome(result);
        } catch (error) {
          outcome = purchaseErrorOutcome(error);
        }
        log(describeOutcome(outcome));
        update({ purchaseStatus: { tone: OUTCOME_TONE[outcome.kind], message: describeOutcome(outcome) } });
        if (outcome.kind !== 'purchased') {
          const after = await readCustomer();
          const entitlementCheck = checkEntitlementUnchanged(entitlementId, before, after);
          update({ entitlementCheck, ...(after ? { customer: after } : {}) });
          log(entitlementCheck.message);
        } else if (result) {
          // The purchase already succeeded: problems after this point are reported, never turned into a failed purchase.
          try {
            const customer = summarizeCustomer(result.customerInfo, entitlementId);
            update({ customer });
            const warning = sandboxWarning(store, customer);
            if (warning) log(warning);
          } catch (error) {
            log(`Purchase completed, but its customer info couldn't be read: ${errorDetail(error)}`);
          }
          try {
            await entitlements.refresh();
          } catch (error) {
            log(`Purchase completed, but refreshing the subscription status failed: ${errorDetail(error)}`);
          }
        }
        return outcome;
      }),

    restore: async () => {
      await run('restoring', async () => {
        log(describeRestore(await entitlements.restorePurchases()));
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
