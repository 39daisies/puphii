import type { MakePurchaseResult, PurchasesOffering, PurchasesOfferings, PurchasesPackage } from 'react-native-purchases';
import { LEGAL_URLS, PAYWALL_OFFERING_ID, PLANS, PRO_BENEFITS } from './config';
import { Entitlement, PlanId, RestoreResult, TrialEligibility } from './entitlement';
import { classifyError, entitlementFromCustomerInfo, ERROR_CODES, trialEligibilityFrom } from './revenueCat';

/**
 * The subscription paywall's logic: which packages may be offered, how their store details are
 * described, and what purchase and restore attempts report. Access itself always comes from the
 * entitlement service, never from anything decided here.
 */

/** The RevenueCat calls the paywall makes. `revenueCatSdk.ts` passes the real SDK; tests pass a fake. */
export interface PaywallSdk {
  isConfigured(): Promise<boolean>;
  getOfferings(): Promise<PurchasesOfferings>;
  purchasePackage(pkg: PurchasesPackage): Promise<MakePurchaseResult>;
  /** `status` values are RevenueCat's `INTRO_ELIGIBILITY_STATUS`, keyed by product ID. */
  checkTrialEligibility(productIds: string[]): Promise<Record<string, { status: number }>>;
}

/** The parts of the entitlement service the paywall drives. */
export type PaywallEntitlements = {
  refresh(): Promise<Entitlement>;
  restorePurchases(): Promise<RestoreResult>;
};

/** Display order. Annual is preferred as the default selection when present. */
export const PLAN_ORDER: readonly PlanId[] = ['annual', 'monthly', 'weekly'];

/**
 * Plans that must never advertise a free trial in the UI, even if the store product carries an
 * intro. Empty: all three TARGET plans may offer trials; eligibility still comes from Apple/RC.
 */
export const NO_INTRO_OFFER_PLANS: readonly PlanId[] = [];

/** A package whose product was checked against the configuration and may be offered. */
export type VerifiedPlan = { plan: PlanId; pkg: PurchasesPackage };

export type OfferingResolution =
  | { ok: true; offeringId: string; plans: VerifiedPlan[] }
  | { ok: false; detail: string };

/**
 * The offering's packages whose product is this store's configured product with the plan's
 * billing period. Anything else, including the other store's products, is never offered.
 */
export function verifiedPlans(offering: PurchasesOffering, productIds: Record<PlanId, string | null>): VerifiedPlan[] {
  return PLAN_ORDER.flatMap((plan) => {
    const productId = productIds[plan];
    const pkg = offering.availablePackages.find((candidate) => candidate.identifier === PLANS[plan].packageId);
    if (!productId || !pkg) return [];
    if (pkg.product.identifier !== productId || pkg.product.subscriptionPeriod !== PLANS[plan].billingPeriod) return [];
    return [{ plan, pkg }];
  });
}

/** Prefer annual when available; otherwise the first verified plan. */
export function defaultSelectedPlan(plans: readonly VerifiedPlan[]): PlanId | null {
  if (!plans.length) return null;
  return plans.find((p) => p.plan === 'annual')?.plan ?? plans[0].plan;
}

const ownOffering = (offerings: PurchasesOfferings, id: string) =>
  Object.prototype.hasOwnProperty.call(offerings.all, id) ? offerings.all[id] : null;

/**
 * RevenueCat's current offering when its packages hold the configured products, otherwise
 * `PAYWALL_OFFERING_ID`. The offering with the most verified plans wins; on a tie, the current one.
 */
export function resolvePaywallOffering(
  offerings: PurchasesOfferings,
  productIds: Record<PlanId, string | null>,
  fallbackId: string = PAYWALL_OFFERING_ID,
): OfferingResolution {
  const candidates = [offerings.current, ownOffering(offerings, fallbackId)].filter(
    (offering, index, all): offering is PurchasesOffering => !!offering && all.findIndex((other) => other?.identifier === offering.identifier) === index,
  );
  let best: { offeringId: string; plans: VerifiedPlan[] } | null = null;
  for (const offering of candidates) {
    const plans = verifiedPlans(offering, productIds);
    if (plans.length > (best?.plans.length ?? 0)) best = { offeringId: offering.identifier, plans };
  }
  if (best) return { ok: true, ...best };
  const expected = PLAN_ORDER.map((plan) => `${PLANS[plan].packageId} → ${productIds[plan] ?? 'none configured'}`).join(', ');
  const checked = candidates.map((offering) => offering.identifier).join(', ') || 'none returned';
  return { ok: false, detail: `No offering holds the configured products (${expected}). Offerings checked: ${checked}.` };
}

const DAYS_PER_UNIT: Record<string, number> = { DAY: 1, WEEK: 7 };

/** The free introductory offer's length as the store reports it, or null when there is no free trial. */
export function freeTrialLength(pkg: PurchasesPackage): { amount: number; unit: 'day' | 'month' | 'year' } | null {
  const intro = pkg.product.introPrice;
  if (!intro || intro.price !== 0 || intro.periodNumberOfUnits < 1) return null;
  const count = intro.periodNumberOfUnits * (intro.cycles >= 1 ? intro.cycles : 1);
  const perUnit = DAYS_PER_UNIT[intro.periodUnit];
  if (perUnit) return { amount: count * perUnit, unit: 'day' };
  if (intro.periodUnit === 'MONTH') return { amount: count, unit: 'month' };
  if (intro.periodUnit === 'YEAR') return { amount: count, unit: 'year' };
  return null;
}

const plural = (amount: number, unit: string) => `${amount} ${unit}${amount === 1 ? '' : 's'}`;

export type PlanDisplay = {
  plan: PlanId;
  title: string;
  /** The store's localized price, such as "$29.99" or "¥4,500". */
  price: string;
  priceLine: string;
  /**
   * Annual only: the SDK's localized monthly equivalent. Never shown for shorter plans, whose
   * per-month figures the SDK only approximates.
   */
  monthlyEquivalent: string | null;
  /** That the plan keeps renewing every period. Shown under `priceLine`, so it doesn't repeat the price. */
  billingLine: string;
  /** Shown only when the store offers a free trial and RevenueCat reports this customer eligible. */
  trialBadge: string | null;
  /** The full terms for the selected plan. The only place besides `priceLine` that states the price. */
  disclosure: string;
  cta: string;
  /** The plan card's screen-reader label: plan, trial if claimed, price per period and renewal, each once. */
  accessibilityLabel: string;
  ctaAccessibilityLabel: string;
};

const PERIOD = {
  P1Y: { noun: 'year', title: 'Yearly' },
  P1M: { noun: 'month', title: 'Monthly' },
  P1W: { noun: 'week', title: 'Weekly' },
} as const;

/** Store account wording for renewal disclosures. */
export const storeAccountFor = (platform: string) =>
  platform === 'ios' ? 'Apple Account' : platform === 'android' ? 'Google Account' : 'app store account';

/** Who takes the payment and shows the final purchase confirmation. */
export const storeNameFor = (platform: string) => (platform === 'ios' ? 'Apple' : platform === 'android' ? 'Google Play' : 'your app store');

/**
 * Everything shown for one plan, from the store's product details. The trial is only claimed when
 * the product has a free introductory offer and RevenueCat confirms the customer can still use it.
 * Never claim a trial from config alone, and never for `NO_INTRO_OFFER_PLANS`.
 */
export function describePlan({ plan, pkg }: VerifiedPlan, trialEligibility: TrialEligibility, platform: string): PlanDisplay {
  const period = PERIOD[PLANS[plan].billingPeriod];
  const price = pkg.product.priceString;
  const offered = NO_INTRO_OFFER_PLANS.includes(plan) ? null : freeTrialLength(pkg);
  const trial = trialEligibility === 'eligible' ? offered : null;
  const account = storeAccountFor(platform);
  const perPeriod = `${price} per ${period.noun}`;
  const perMonth = plan === 'annual' ? pkg.product.pricePerMonthString : null;
  const trialBadge = trial ? `${trial.amount}-${trial.unit} free trial` : null;
  const renews = `Renews every ${period.noun} until you cancel.`;
  const renewal = `Renews automatically every ${period.noun} unless cancelled at least 24 hours before the ${trial ? 'trial or current period' : 'current period'} ends. Cancel anytime in your ${account} settings.`;
  const disclosure = trial
    ? `Free for ${plural(trial.amount, trial.unit)}, then ${perPeriod}, charged to your ${account} when the trial ends. ${renewal}`
    : offered && trialEligibility === 'unknown'
      ? `${perPeriod}, charged to your ${account}. If you qualify for an introductory offer, ${storeNameFor(platform)} shows it before you confirm. ${renewal}`
      : `${perPeriod}, charged to your ${account} when you confirm. ${renewal}`;
  const cta = trial ? 'Start free trial' : 'Subscribe';
  const spokenPrice = `${trialBadge ? `${trialBadge}, then ` : ''}${perPeriod}${perMonth ? `, about ${perMonth} per month` : ''}`;
  return {
    plan,
    title: period.title,
    price,
    priceLine: `${price} / ${period.noun}`,
    monthlyEquivalent: perMonth ? `About ${perMonth} per month` : null,
    billingLine: trial ? `After the free trial, renews every ${period.noun} until you cancel.` : renews,
    trialBadge,
    disclosure,
    cta,
    accessibilityLabel: `${period.title} plan. ${spokenPrice}. ${renews}`,
    ctaAccessibilityLabel: `${cta}, ${period.title} plan, ${trial ? 'then ' : ''}${perPeriod}`,
  };
}

/** Pro status for the You screen. Only store-reported access counts. */
export function proStatusLabel(entitlement: Entitlement): string | undefined {
  if (entitlement.status === 'active') return entitlement.period === 'trial' ? 'Free trial' : 'Active';
  if (entitlement.status === 'gracePeriod') return 'Active';
  return undefined;
}

export const hasProAccess = (entitlement: Entitlement): boolean => entitlement.status === 'active' || entitlement.status === 'gracePeriod';

/**
 * What must be configured before a purchase may proceed. Missing legal links never unlock the app;
 * they only block the purchase CTA until set.
 */
export function paywallConfigIssues(
  links: { termsOfUse: string | null; privacyPolicy: string | null } = LEGAL_URLS,
  benefits: readonly string[] | null = PRO_BENEFITS,
): string[] {
  const issues: string[] = [];
  const isLink = (url: string | null) => !!url && /^https:\/\/[^\s/]+\.[^\s/]+/.test(url);
  if (!isLink(links.termsOfUse)) issues.push('Terms of Use URL (LEGAL_URLS.termsOfUse in src/subscription/config.ts)');
  if (!isLink(links.privacyPolicy)) issues.push('Privacy Policy URL (LEGAL_URLS.privacyPolicy in src/subscription/config.ts)');
  if (!benefits || !benefits.length || benefits.some((line) => !line.trim())) issues.push('Subscription benefits (APP_BENEFITS in src/subscription/config.ts)');
  return issues;
}

/** True when Terms and Privacy are configured so a purchase may be offered. */
export const legalLinksReady = (issues: string[] = paywallConfigIssues()) =>
  !issues.some((issue) => issue.includes('LEGAL_URLS'));

/**
 * Whether Settings may open the manage-subscription paywall while the user is already entitled.
 * Always available when enforcement is on so Restore / legal stay reachable from inside the app.
 */
export const showPaywallEntry = (_isDevelopmentBuild?: boolean, _issues: string[] = paywallConfigIssues()) => true;

export type PaywallNotice = { tone: 'success' | 'info' | 'error'; message: string };

export type PaywallState = {
  phase: 'idle' | 'loading' | 'ready' | 'unavailable';
  /** Set while a purchase or restore runs; every other action waits. */
  busy: 'purchasing' | 'restoring' | null;
  offeringId: string | null;
  plans: VerifiedPlan[];
  /** RevenueCat's answer per plan; only checked for plans whose product has a free introductory offer. */
  trial: Partial<Record<PlanId, TrialEligibility>>;
  selected: PlanId | null;
  unavailable: { message: string; detail: string | null } | null;
  notice: PaywallNotice | null;
};

export type PaywallPurchaseOutcome = 'purchased' | 'notActive' | 'cancelled' | 'pending' | 'failed' | 'busy' | 'notReady';
export type PaywallRestoreOutcome = RestoreResult['outcome'] | 'busy';

export type PaywallController = {
  current(): PaywallState;
  subscribe(listener: (state: PaywallState) => void): () => void;
  load(): Promise<void>;
  select(plan: PlanId): void;
  purchase(): Promise<PaywallPurchaseOutcome>;
  restore(): Promise<PaywallRestoreOutcome>;
  dismissNotice(): void;
};

const UNAVAILABLE = "Subscription options aren't available right now. Please try again later.";

/** RevenueCat `PURCHASES_ERROR_CODE` values for purchase outcomes. */
export const PURCHASE_CODES = {
  PURCHASE_CANCELLED_ERROR: '1',
  PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR: '5',
  PRODUCT_ALREADY_PURCHASED_ERROR: '6',
  PAYMENT_PENDING_ERROR: '20',
} as const;

/** What a failed purchase tells the customer. Nothing here grants or removes access. */
export function purchaseErrorNotice(error: unknown, platform: string): { outcome: 'cancelled' | 'pending' | 'failed'; notice: PaywallNotice } {
  const e = (error ?? {}) as { code?: unknown; userCancelled?: unknown };
  const store = platform === 'ios' ? 'the App Store' : 'the store';
  if (e.userCancelled === true || e.code === PURCHASE_CODES.PURCHASE_CANCELLED_ERROR) {
    return { outcome: 'cancelled', notice: { tone: 'info', message: 'Purchase cancelled. Nothing was charged.' } };
  }
  if (e.code === PURCHASE_CODES.PAYMENT_PENDING_ERROR) {
    return {
      outcome: 'pending',
      notice: { tone: 'info', message: `Your purchase is waiting for approval. Puphii Pro turns on once ${store} confirms it.` },
    };
  }
  const message = (() => {
    switch (e.code) {
      case PURCHASE_CODES.PRODUCT_ALREADY_PURCHASED_ERROR:
        return `Your ${storeAccountFor(platform)} already has this subscription. Tap Restore Purchases to turn on Puphii Pro.`;
      case ERROR_CODES.NETWORK_ERROR:
      case ERROR_CODES.OFFLINE_CONNECTION_ERROR:
        return `Couldn't reach ${store}. Check your connection and try again.`;
      case ERROR_CODES.PURCHASE_NOT_ALLOWED_ERROR:
        return 'This device isn’t allowed to make purchases, for example because of Screen Time restrictions.';
      case PURCHASE_CODES.PRODUCT_NOT_AVAILABLE_FOR_PURCHASE_ERROR:
        return "This plan isn't available right now. Please try again later.";
      case ERROR_CODES.STORE_PROBLEM_ERROR:
        return `${store === 'the App Store' ? 'The App Store' : 'The store'} couldn't complete the purchase. Please try again.`;
      case ERROR_CODES.RECEIPT_ALREADY_IN_USE_ERROR:
      case ERROR_CODES.RECEIPT_IN_USE_BY_OTHER_SUBSCRIBER_ERROR:
        return classifyError(error).message;
      default:
        return "The purchase couldn't be completed. Please try again.";
    }
  })();
  return { outcome: 'failed', notice: { tone: 'error', message } };
}

export function restoreNotice(result: RestoreResult, platform: string): PaywallNotice {
  const account = storeAccountFor(platform);
  switch (result.outcome) {
    case 'restored':
      return { tone: 'success', message: 'Your Puphii Pro subscription has been restored.' };
    case 'foundInactive':
      return result.entitlement.status === 'billingRetry'
        ? { tone: 'info', message: `We found your subscription, but its renewal payment is failing. Update your payment method in your ${account} settings to turn Puphii Pro back on.` }
        : { tone: 'info', message: 'We found a past Puphii Pro subscription, but it has ended. Choose a plan to subscribe again.' };
    case 'nothingToRestore':
      return { tone: 'info', message: `No Puphii Pro subscription was found for this ${account}.` };
    case 'failed':
      return { tone: 'error', message: `Couldn't restore purchases. ${result.error.message}` };
  }
}

export function createPaywallController({
  sdk,
  productIds,
  entitlementId,
  entitlements,
  platform,
  legalLinks = LEGAL_URLS,
}: {
  /** Null when this build has no native store module (Expo Go, web). */
  sdk: PaywallSdk | null;
  /** This store's product for each plan, from `productIdsFor`. */
  productIds: Record<PlanId, string | null>;
  entitlementId: string | null;
  entitlements: PaywallEntitlements;
  platform: string;
  /** Override for tests; production uses `LEGAL_URLS`. Missing links block purchase, never unlock. */
  legalLinks?: { termsOfUse: string | null; privacyPolicy: string | null };
}): PaywallController {
  let state: PaywallState = { phase: 'idle', busy: null, offeringId: null, plans: [], trial: {}, selected: null, unavailable: null, notice: null };
  const listeners = new Set<(state: PaywallState) => void>();
  const update = (patch: Partial<PaywallState>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener(state);
  };
  const unavailable = (message: string, detail: string | null = null) =>
    update({ phase: 'unavailable', plans: [], trial: {}, selected: null, offeringId: null, unavailable: { message, detail } });

  async function trialEligibility(plans: VerifiedPlan[]): Promise<Partial<Record<PlanId, TrialEligibility>>> {
    const withTrial = plans.filter(({ plan, pkg }) => !NO_INTRO_OFFER_PLANS.includes(plan) && freeTrialLength(pkg));
    if (!sdk || !withTrial.length) return {};
    try {
      const statuses = await sdk.checkTrialEligibility(withTrial.map(({ pkg }) => pkg.product.identifier));
      return Object.fromEntries(withTrial.map(({ plan, pkg }) => [plan, trialEligibilityFrom(statuses[pkg.product.identifier]?.status)]));
    } catch {
      // Eligibility unknown ≠ ineligible: UI must not claim a trial until confirmed.
      return Object.fromEntries(withTrial.map(({ plan }) => [plan, 'unknown' as const]));
    }
  }

  async function refreshQuietly() {
    try {
      await entitlements.refresh();
    } catch {
      // The entitlement service reports its own errors; the purchase result stands.
    }
  }

  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async load() {
      if (state.busy || state.phase === 'loading') return;
      update({ phase: 'loading', unavailable: null });
      if (!sdk || !entitlementId) return unavailable("Subscriptions aren't available in this version of Puphii.");
      try {
        if (!(await sdk.isConfigured())) return unavailable("Subscriptions aren't set up in this build.");
        const resolution = resolvePaywallOffering(await sdk.getOfferings(), productIds);
        if (!resolution.ok) return unavailable(UNAVAILABLE, resolution.detail);
        const trial = await trialEligibility(resolution.plans);
        const keep = state.selected && resolution.plans.some((p) => p.plan === state.selected) ? state.selected : defaultSelectedPlan(resolution.plans);
        update({ phase: 'ready', offeringId: resolution.offeringId, plans: resolution.plans, trial, selected: keep, unavailable: null });
      } catch (error) {
        const problem = classifyError(error);
        unavailable(problem.kind === 'network' ? "Couldn't load subscription options. Check your connection and try again." : UNAVAILABLE, problem.message);
      }
    },

    select(plan) {
      if (state.busy || state.phase !== 'ready' || !state.plans.some((p) => p.plan === plan)) return;
      update({ selected: plan, notice: null });
    },

    async purchase() {
      if (state.busy) return 'busy';
      const chosen = state.phase === 'ready' ? state.plans.find((p) => p.plan === state.selected) : undefined;
      if (!sdk || !entitlementId || !chosen) return 'notReady';
      if (!legalLinksReady(paywallConfigIssues(legalLinks))) {
        update({
          notice: {
            tone: 'error',
            message: 'Subscriptions aren’t available until Privacy Policy and Terms of Use links are configured. You can still Restore Purchases.',
          },
        });
        return 'notReady';
      }
      update({ busy: 'purchasing', notice: null });
      try {
        let result: MakePurchaseResult | null = null;
        try {
          result = await sdk.purchasePackage(chosen.pkg);
        } catch (error) {
          const { outcome, notice } = purchaseErrorNotice(error, platform);
          update({ notice });
          return outcome;
        }
        if (!result || typeof result.productIdentifier !== 'string' || !result.customerInfo) {
          update({ notice: { tone: 'error', message: 'The store returned an unexpected result. If you were charged, tap Restore Purchases.' } });
          await refreshQuietly();
          return 'failed';
        }
        const granted = hasProAccess(entitlementFromCustomerInfo(result.customerInfo, entitlementId, productIds));
        update({
          notice: granted
            ? { tone: 'success', message: 'Welcome to Puphii Pro. Thank you for your support.' }
            : { tone: 'info', message: "The store completed the purchase, but Puphii Pro isn't active yet. Try Restore Purchases in a moment." },
        });
        await refreshQuietly();
        return granted ? 'purchased' : 'notActive';
      } finally {
        update({ busy: null });
      }
    },

    async restore() {
      if (state.busy) return 'busy';
      update({ busy: 'restoring', notice: null });
      try {
        const result = await entitlements.restorePurchases();
        update({ notice: restoreNotice(result, platform) });
        return result.outcome;
      } catch (error) {
        update({ notice: { tone: 'error', message: `Couldn't restore purchases. ${classifyError(error).message}` } });
        return 'failed';
      } finally {
        update({ busy: null });
      }
    },

    dismissNotice() {
      update({ notice: null });
    },
  };
}
