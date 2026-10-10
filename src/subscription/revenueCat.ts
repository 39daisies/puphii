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

export type RevenueCatOptions = {
  /** Null when this build has no native store module (Expo Go, web). */
  sdk: PurchasesSdk | null;
  key: SdkKeyCheck;
  entitlementId: string | null;
  /** This platform's product ID for each plan, or null until configured. */
  productIds: Record<PlanId, string | null>;
  appState: AppStateSource;
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
  [ERROR_CODES.RECEIPT_ALREADY_IN_USE_ERROR]: 'verificationFailed',
  [ERROR_CODES.INVALID_RECEIPT_ERROR]: 'verificationFailed',
  [ERROR_CODES.MISSING_RECEIPT_FILE_ERROR]: 'verificationFailed',
  [ERROR_CODES.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR]: 'verificationFailed',
};

const MESSAGES: Record<VerificationErrorKind, string> = {
  network: "Couldn't reach the store to check the subscription.",
  storeUnavailable: 'The App Store or Google Play is unavailable right now.',
  verificationFailed: "The purchase couldn't be verified.",
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
  for (const plan of ['annual', 'monthly'] as const) {
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

export function createRevenueCatService({ sdk, key, entitlementId, productIds, appState }: RevenueCatOptions): RevenueCatService {
  let state: Entitlement = { status: 'unknown' };
  const listeners = new Set<(entitlement: Entitlement) => void>();
  let running = false;
  let connected = false;
  // Each request takes a number; only the newest one may change the status.
  let generation = 0;
  let lastAppState = appState.current();
  let removeAppStateListener: (() => void) | null = null;

  const set = (next: Entitlement) => {
    state = next;
    for (const listener of listeners) listener(next);
  };
  const fail = (kind: VerificationErrorKind, message = MESSAGES[kind]) => set({ status: 'error', error: { kind, message } });

  async function annualTrial(): Promise<TrialEligibility> {
    const id = productIds.annual;
    if (!sdk || !id) return 'unknown';
    try {
      return trialEligibilityFrom((await sdk.checkTrialEligibility([id]))[id]?.status);
    } catch {
      return 'unknown';
    }
  }

  async function toEntitlement(info: CustomerInfo): Promise<Entitlement> {
    const mapped = entitlementFromCustomerInfo(info, entitlementId!, productIds);
    return mapped.status === 'inactive' ? { ...mapped, annualTrial: await annualTrial() } : mapped;
  }

  const onCustomerInfo = (info: CustomerInfo) => {
    const request = ++generation;
    void toEntitlement(info).then((next) => {
      if (running && request === generation) set(next);
    });
  };

  function onError(error: unknown) {
    const problem = classifyError(error);
    // Offline after a store check this session: keep that status rather than lose it.
    if (problem.kind === 'network' && isStoreVerified(state)) return;
    fail(problem.kind, problem.message);
  }

  async function refresh(): Promise<Entitlement> {
    if (!connected || !sdk) return state;
    const request = ++generation;
    try {
      const next = await toEntitlement(await sdk.getCustomerInfo());
      if (running && request === generation) set(next);
    } catch (error) {
      if (running && request === generation) onError(error);
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
      if (running) set(next);
      if (next.status === 'error') return { outcome: 'failed', error: next.error };
      const restored = next.status === 'active' || next.status === 'gracePeriod';
      return { outcome: restored ? 'restored' : 'nothingToRestore', entitlement: next };
    } catch (error) {
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
      return onError(error);
    }
    connected = true;
    sdk.addCustomerInfoUpdateListener(onCustomerInfo);
    lastAppState = appState.current();
    removeAppStateListener = appState.subscribe((next) => {
      if (next === 'active' && lastAppState !== 'active') void refresh();
      lastAppState = next;
    });
    void refresh();
  }

  function stop() {
    if (!running) return;
    running = false;
    generation += 1;
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
