import type { CustomerInfo, PurchasesEntitlementInfo } from 'react-native-purchases';
import {
  Entitlement,
  EntitlementService,
  PlanId,
  ReportedPlan,
  RestoreResult,
  TrialEligibility,
  VerificationErrorKind,
} from './entitlement';
import { SdkKeyCheck, SdkKeyProblem } from './sdkKeys';

/** The RevenueCat calls Puphii makes. The app passes the real SDK; tests pass a fake. */
export interface PurchasesSdk {
  /** Configures the SDK once for this app session. */
  configure(apiKey: string): void;
  getCustomerInfo(): Promise<CustomerInfo>;
  /** Makes the next `getCustomerInfo` ask RevenueCat instead of answering from its cache. */
  invalidateCustomerInfoCache(): Promise<void>;
  restorePurchases(): Promise<CustomerInfo>;
  addCustomerInfoUpdateListener(listener: (info: CustomerInfo) => void): void;
  removeCustomerInfoUpdateListener(listener: (info: CustomerInfo) => void): void;
  /** `status` values are RevenueCat's `INTRO_ELIGIBILITY_STATUS`, keyed by product ID. */
  checkTrialEligibility(productIds: string[]): Promise<Record<string, { status: number }>>;
}

export type AppStateSource = {
  current(): string;
  subscribe(listener: (state: string) => void): () => void;
};

/** Decides when to ask RevenueCat again. Never evidence of a subscription by itself. */
export type Clock = {
  now(): number;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type RevenueCatOptions = {
  /** Null when this build has no native store module (Expo Go, web). */
  sdk: PurchasesSdk | null;
  key: SdkKeyCheck;
  entitlementId: string | null;
  /** This platform's product ID for each plan, or null until configured. */
  productIds: Record<PlanId, string | null>;
  appState: AppStateSource;
  clock?: Clock;
  /** Development builds only: diagnostic lines, already free of API keys. */
  log?: (message: string) => void;
};

export type RevenueCatService = EntitlementService & {
  start(): void;
  stop(): void;
};

/** RevenueCat `PURCHASES_ERROR_CODE` values Puphii treats specially. */
export const ERROR_CODES = {
  STORE_PROBLEM_ERROR: '2',
  PURCHASE_NOT_ALLOWED_ERROR: '3',
  RECEIPT_ALREADY_IN_USE_ERROR: '7',
  INVALID_RECEIPT_ERROR: '8',
  MISSING_RECEIPT_FILE_ERROR: '9',
  NETWORK_ERROR: '10',
  INVALID_CREDENTIALS_ERROR: '11',
  RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR: '13',
  INVALID_APPLE_SUBSCRIPTION_KEY_ERROR: '17',
  CONFIGURATION_ERROR: '23',
  UNSUPPORTED_ERROR: '24',
  PRODUCT_REQUEST_TIMED_OUT_ERROR: '32',
  API_ENDPOINT_BLOCKED: '33',
  OFFLINE_CONNECTION_ERROR: '35',
} as const;

const KIND_BY_CODE: Record<string, VerificationErrorKind> = {
  [ERROR_CODES.NETWORK_ERROR]: 'network',
  [ERROR_CODES.OFFLINE_CONNECTION_ERROR]: 'network',
  [ERROR_CODES.PRODUCT_REQUEST_TIMED_OUT_ERROR]: 'network',
  [ERROR_CODES.API_ENDPOINT_BLOCKED]: 'network',
  [ERROR_CODES.STORE_PROBLEM_ERROR]: 'storeUnavailable',
  [ERROR_CODES.PURCHASE_NOT_ALLOWED_ERROR]: 'storeUnavailable',
  [ERROR_CODES.UNSUPPORTED_ERROR]: 'storeUnavailable',
  [ERROR_CODES.INVALID_CREDENTIALS_ERROR]: 'notConfigured',
  [ERROR_CODES.INVALID_APPLE_SUBSCRIPTION_KEY_ERROR]: 'notConfigured',
  [ERROR_CODES.CONFIGURATION_ERROR]: 'notConfigured',
  [ERROR_CODES.RECEIPT_ALREADY_IN_USE_ERROR]: 'receiptInUse',
  [ERROR_CODES.INVALID_RECEIPT_ERROR]: 'verificationFailed',
  [ERROR_CODES.MISSING_RECEIPT_FILE_ERROR]: 'verificationFailed',
  [ERROR_CODES.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR]: 'receiptInUse',
};

const MESSAGES: Record<VerificationErrorKind, string> = {
  network: "Couldn't reach the store to check the subscription.",
  storeUnavailable: 'The App Store or Google Play is unavailable right now.',
  verificationFailed: "The purchase couldn't be verified.",
  receiptInUse: 'This store purchase is already linked to a different user, so it can’t be restored here.',
  notConfigured: "Subscriptions aren't set up in this build.",
  unknown: "The subscription status couldn't be checked.",
};

export const KEY_MESSAGES: Record<SdkKeyProblem, string> = {
  missing: 'No RevenueCat public SDK key is set for this platform.',
  secretKey: 'A RevenueCat secret key was supplied. Only public SDK keys may be used in the app.',
  wrongPlatform: "The RevenueCat SDK key belongs to the other platform's store.",
  testStoreKey:
    'A RevenueCat Test Store key was supplied as a store key. Test Store keys go in EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY and only work in development builds.',
  notTestStoreKey: "EXPO_PUBLIC_REVENUECAT_TEST_STORE_API_KEY doesn't hold a Test Store key (test_…).",
  malformed: "The RevenueCat SDK key isn't in a recognised format.",
  unsupportedPlatform: 'Subscriptions are only available on iOS and Android.',
};

export function classifyError(error: unknown): { kind: VerificationErrorKind; message: string } {
  const code = (error as { code?: unknown } | null)?.code;
  const kind = (typeof code === 'string' && KIND_BY_CODE[code]) || 'unknown';
  return { kind, message: MESSAGES[kind] };
}

const KEY_LIKE = /\b(appl|goog|amzn|strp|rcb|test|sk)_[A-Za-z0-9]{6,}/g;

/** Masks anything shaped like a RevenueCat API key, so it can't reach a log line. */
export const redactKeys = (text: string): string => text.replace(KEY_LIKE, (_, prefix: string) => `${prefix}_…`);

/** RevenueCat's code, readable code and messages for diagnostics, with key-like text masked. */
export function errorDetail(error: unknown): string {
  const e = (error ?? {}) as { code?: unknown; readableErrorCode?: unknown; message?: unknown; underlyingErrorMessage?: unknown };
  const parts = [
    typeof e.code === 'string' ? `code ${e.code}` : null,
    typeof e.readableErrorCode === 'string' ? e.readableErrorCode : null,
    typeof e.message === 'string' ? e.message : null,
    typeof e.underlyingErrorMessage === 'string' && e.underlyingErrorMessage ? e.underlyingErrorMessage : null,
  ].filter(Boolean);
  return redactKeys(parts.length ? parts.join(' · ') : classifyError(error).message);
}

/** RevenueCat `VERIFICATION_RESULT.FAILED` and `INTRO_ELIGIBILITY_STATUS` values. */
export const VERIFICATION_FAILED = 'FAILED';
export const INTRO_ELIGIBILITY = { UNKNOWN: 0, INELIGIBLE: 1, ELIGIBLE: 2, NO_INTRO_OFFER_EXISTS: 3 } as const;

export function trialEligibilityFrom(status: number | undefined): TrialEligibility {
  if (status === INTRO_ELIGIBILITY.ELIGIBLE) return 'eligible';
  if (status === INTRO_ELIGIBILITY.INELIGIBLE || status === INTRO_ELIGIBILITY.NO_INTRO_OFFER_EXISTS) return 'ineligible';
  return 'unknown';
}

function planFor(info: PurchasesEntitlementInfo, productIds: Record<PlanId, string | null>): ReportedPlan {
  const candidates = [info.productIdentifier];
  if (info.productPlanIdentifier) candidates.push(`${info.productIdentifier}:${info.productPlanIdentifier}`);
  for (const plan of Object.keys(productIds) as PlanId[]) {
    const id = productIds[plan];
    if (id && candidates.includes(id)) return plan;
  }
  return null;
}

/**
 * Turns RevenueCat's customer info into Puphii's entitlement. Refunds and revocations end
 * the entitlement in RevenueCat without a separate reason, so they are reported as `expired`.
 */
export function entitlementFromCustomerInfo(
  info: CustomerInfo,
  entitlementId: string,
  productIds: Record<PlanId, string | null>,
): Entitlement {
  const verification = { origin: 'store' as const, verifiedAt: info.requestDate };
  const entry = info.entitlements.all[entitlementId];
  if (info.entitlements.verification === VERIFICATION_FAILED || entry?.verification === VERIFICATION_FAILED) {
    return { status: 'error', error: { kind: 'verificationFailed', message: MESSAGES.verificationFailed } };
  }
  if (!entry) return { status: 'inactive', reason: 'neverSubscribed', lastPlan: null, annualTrial: 'unknown', verification };
  const plan = planFor(entry, productIds);
  if (entry.isActive) {
    if (entry.billingIssueDetectedAt) return { status: 'gracePeriod', plan, expiresAt: entry.expirationDate, verification };
    return {
      status: 'active',
      plan,
      period: entry.periodType === 'TRIAL' ? 'trial' : 'paid',
      expiresAt: entry.expirationDate,
      willRenew: entry.willRenew,
      verification,
    };
  }
  if (isInBillingRetry(entry, info.requestDate)) return { status: 'billingRetry', plan, verification };
  return { status: 'inactive', reason: 'expired', lastPlan: plan, annualTrial: 'unknown', verification };
}

/** Apple retries failed renewals for up to 60 days; Google Play's account hold is at most 60 days. */
const BILLING_RETRY_WINDOW_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * RevenueCat reports `willRenew: false` whenever a billing issue is detected, and keeps the
 * issue date after the store gives up, so the retry window is judged from the expiry date
 * against RevenueCat's own request time. Only the label depends on this: both outcomes deny access.
 */
function isInBillingRetry(entry: PurchasesEntitlementInfo, requestDate: string): boolean {
  if (!entry.billingIssueDetectedAt || entry.unsubscribeDetectedAt || !entry.expirationDate) return false;
  const lapsedFor = Date.parse(requestDate) - Date.parse(entry.expirationDate);
  return Number.isFinite(lapsedFor) && lapsedFor <= BILLING_RETRY_WINDOW_MS;
}

const isStoreVerified = (entitlement: Entitlement) => 'verification' in entitlement && entitlement.verification.origin === 'store';

/** Asked this long after an expiry, so RevenueCat has had time to record a renewal. */
export const EXPIRY_RECHECK_DELAY_MS = 5_000;
/** If RevenueCat still reports expired access as active: ask again once now, then every minute, a few times. */
export const OVERDUE_RECHECK_INTERVAL_MS = 60_000;
export const OVERDUE_RECHECK_LIMIT = 5;
/** After an offline check: retry in 30 s, doubling up to 5 minutes, while the app stays open. */
export const NETWORK_RETRY_FIRST_MS = 30_000;
export const NETWORK_RETRY_MAX_MS = 5 * 60_000;
/** Longer setTimeout delays overflow and fire immediately. */
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/** What a restore found, separate from whether it gives access now. */
export function restoreOutcomeFor(entitlement: Entitlement): 'restored' | 'foundInactive' | 'nothingToRestore' {
  if (entitlement.status === 'active' || entitlement.status === 'gracePeriod') return 'restored';
  if (entitlement.status === 'billingRetry' || (entitlement.status === 'inactive' && entitlement.reason !== 'neverSubscribed')) {
    return 'foundInactive';
  }
  return 'nothingToRestore';
}

export function createRevenueCatService({
  sdk,
  key,
  entitlementId,
  productIds,
  appState,
  clock = systemClock,
  log,
}: RevenueCatOptions): RevenueCatService {
  let state: Entitlement = { status: 'unknown' };
  const listeners = new Set<(entitlement: Entitlement) => void>();
  let running = false;
  let connected = false;
  // Each request takes a number; only the newest one may change the status.
  let generation = 0;
  let lastAppState = appState.current();
  let removeAppStateListener: (() => void) | null = null;
  // One pending re-check at a time: at the entitlement's expiry, or after an offline check.
  let recheckTimer: unknown = null;
  let networkFailures = 0;
  let overdue: { expiresAt: string | null; count: number } = { expiresAt: null, count: 0 };

  const set = (next: Entitlement) => {
    state = next;
    scheduleExpiryCheck(next);
    for (const listener of listeners) listener(next);
  };
  /** An answer from RevenueCat, which ends any run of offline retries. */
  const fromStore = (next: Entitlement) => {
    networkFailures = 0;
    set(next);
  };
  const fail = (kind: VerificationErrorKind, message = MESSAGES[kind]) => set({ status: 'error', error: { kind, message } });

  function clearRecheck() {
    if (recheckTimer === null) return;
    clock.clearTimeout(recheckTimer);
    recheckTimer = null;
  }

  function scheduleRecheck(delay: number, fresh: boolean) {
    clearRecheck();
    if (!running) return;
    recheckTimer = clock.setTimeout(() => {
      recheckTimer = null;
      void recheck(fresh);
    }, Math.min(Math.max(delay, 0), MAX_TIMER_DELAY_MS));
  }

  async function recheck(fresh: boolean) {
    if (!running || !connected || !sdk) return;
    if (fresh) {
      try {
        await sdk.invalidateCustomerInfoCache();
      } catch (error) {
        log?.(`Couldn't clear RevenueCat's cached customer info: ${errorDetail(error)}`);
      }
    }
    await refresh();
  }

  /**
   * RevenueCat decides `isActive` when it fetches customer info, so an app left open past the
   * expiry would keep showing access. The clock only decides when to ask again.
   */
  function scheduleExpiryCheck(next: Entitlement) {
    clearRecheck();
    const expiresAt = next.status === 'active' || next.status === 'gracePeriod' ? next.expiresAt : null;
    const expiry = expiresAt ? Date.parse(expiresAt) : NaN;
    if (!expiresAt || !Number.isFinite(expiry)) return;
    const due = expiry + EXPIRY_RECHECK_DELAY_MS - clock.now();
    if (due > 0) return scheduleRecheck(due, true);
    overdue = overdue.expiresAt === expiresAt ? { expiresAt, count: overdue.count + 1 } : { expiresAt, count: 1 };
    if (overdue.count > OVERDUE_RECHECK_LIMIT) {
      if (overdue.count === OVERDUE_RECHECK_LIMIT + 1) {
        log?.(`RevenueCat still reports access that expired at ${expiresAt}; next check when the app returns to the foreground.`);
      }
      return;
    }
    log?.(`Access expired at ${expiresAt} but is still reported active; asking RevenueCat again (${overdue.count}/${OVERDUE_RECHECK_LIMIT}).`);
    scheduleRecheck(overdue.count === 1 ? 0 : OVERDUE_RECHECK_INTERVAL_MS, true);
  }

  function scheduleNetworkRetry() {
    const delay = Math.min(NETWORK_RETRY_FIRST_MS * 2 ** networkFailures, NETWORK_RETRY_MAX_MS);
    networkFailures += 1;
    log?.(`Couldn't reach RevenueCat; checking again in ${Math.round(delay / 1000)} s.`);
    scheduleRecheck(delay, false);
  }

  async function annualTrial(): Promise<TrialEligibility> {
    const id = productIds.annual;
    if (!sdk || !id) return 'unknown';
    try {
      return trialEligibilityFrom((await sdk.checkTrialEligibility([id]))[id]?.status);
    } catch (error) {
      log?.(`Trial eligibility check failed, reported as unknown: ${errorDetail(error)}`);
      return 'unknown';
    }
  }

  async function toEntitlement(info: CustomerInfo): Promise<Entitlement> {
    const mapped = entitlementFromCustomerInfo(info, entitlementId!, productIds);
    if (mapped.status === 'error') log?.(`RevenueCat customer info failed its signature check (${mapped.error.kind}).`);
    return mapped.status === 'inactive' ? { ...mapped, annualTrial: await annualTrial() } : mapped;
  }

  const onCustomerInfo = (info: CustomerInfo) => {
    const request = ++generation;
    void toEntitlement(info).then((next) => {
      if (running && request === generation) fromStore(next);
    });
  };

  function onRefreshError(error: unknown) {
    const problem = classifyError(error);
    log?.(`Subscription check failed: ${errorDetail(error)}`);
    if (problem.kind === 'network') {
      // Offline after a store check this session: keep that status rather than lose it.
      if (!isStoreVerified(state)) fail(problem.kind, problem.message);
      scheduleNetworkRetry();
      return;
    }
    fail(problem.kind, problem.message);
  }

  async function refresh(): Promise<Entitlement> {
    if (!connected || !sdk) return state;
    const request = ++generation;
    try {
      const next = await toEntitlement(await sdk.getCustomerInfo());
      if (running && request === generation) fromStore(next);
    } catch (error) {
      if (running && request === generation) onRefreshError(error);
    }
    return state;
  }

  async function restorePurchases(): Promise<RestoreResult> {
    if (!connected || !sdk) {
      return { outcome: 'failed', error: state.status === 'error' ? state.error : { kind: 'notConfigured', message: MESSAGES.notConfigured } };
    }
    try {
      const next = await toEntitlement(await sdk.restorePurchases());
      generation += 1;
      if (running) fromStore(next);
      if (next.status === 'error') return { outcome: 'failed', error: next.error };
      return { outcome: restoreOutcomeFor(next), entitlement: next };
    } catch (error) {
      log?.(`Restore failed: ${errorDetail(error)}`);
      return { outcome: 'failed', error: classifyError(error) };
    }
  }

  function start() {
    if (running) return;
    running = true;
    if (!sdk) return fail('storeUnavailable', 'This build has no store connection (Expo Go or web). Use a development build.');
    if (!key.ok) return fail('notConfigured', KEY_MESSAGES[key.reason]);
    if (!entitlementId) return fail('notConfigured', "The RevenueCat entitlement identifier isn't set yet.");
    try {
      sdk.configure(key.apiKey);
    } catch (error) {
      log?.(`RevenueCat configuration failed: ${errorDetail(error)}`);
      const problem = classifyError(error);
      return fail(problem.kind, problem.message);
    }
    connected = true;
    sdk.addCustomerInfoUpdateListener(onCustomerInfo);
    lastAppState = appState.current();
    removeAppStateListener = appState.subscribe((next) => {
      if (next === 'active' && lastAppState !== 'active') {
        overdue = { expiresAt: null, count: 0 };
        void refresh();
      }
      lastAppState = next;
    });
    void refresh();
  }

  function stop() {
    if (!running) return;
    running = false;
    generation += 1;
    clearRecheck();
    if (connected && sdk) sdk.removeCustomerInfoUpdateListener(onCustomerInfo);
    connected = false;
    removeAppStateListener?.();
    removeAppStateListener = null;
  }

  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh,
    restorePurchases,
    start,
    stop,
  };
}
