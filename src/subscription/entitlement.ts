export type PlanId = 'annual' | 'monthly';

/**
 * Where an entitlement came from. There is deliberately no on-device source: a stored
 * flag, purchase date or timer is never evidence of a subscription.
 */
export type EntitlementOrigin = 'store' | 'mock';

export type Verification = { origin: EntitlementOrigin; verifiedAt: string };

export type TrialEligibility = 'eligible' | 'ineligible' | 'unknown';

export type VerificationErrorKind =
  | 'network'
  | 'storeUnavailable'
  | 'verificationFailed'
  /** The store purchase belongs to a different RevenueCat customer. */
  | 'receiptInUse'
  | 'notConfigured'
  | 'unknown';

/** Null when the store reports a product that isn't one of the configured plans. Access doesn't depend on it. */
export type ReportedPlan = PlanId | null;

export type Entitlement =
  /** Not checked yet, or a check is in progress. */
  | { status: 'unknown' }
  /** `period` separates the free trial (an introductory offer) from paid time. */
  | {
      status: 'active';
      plan: ReportedPlan;
      period: 'trial' | 'paid';
      expiresAt: string | null;
      willRenew: boolean;
      verification: Verification;
    }
  /** A renewal failed, but the store still grants access until `expiresAt` while billing is fixed. */
  | { status: 'gracePeriod'; plan: ReportedPlan; expiresAt: string | null; verification: Verification }
  /** A renewal failed and the store is retrying without granting access. */
  | { status: 'billingRetry'; plan: ReportedPlan; verification: Verification }
  | {
      status: 'inactive';
      reason: 'neverSubscribed' | 'expired' | 'refunded' | 'revoked';
      lastPlan: ReportedPlan;
      /** Whether the store would give this person the annual plan's free trial. */
      annualTrial: TrialEligibility;
      verification: Verification;
    }
  /** Subscription status couldn't be verified. Not the same as "not subscribed". */
  | { status: 'error'; error: { kind: VerificationErrorKind; message: string } };

export type EntitlementStatus = Entitlement['status'];

export const isAnnualTrialEligible = (entitlement: Entitlement): boolean =>
  entitlement.status === 'inactive' && entitlement.annualTrial === 'eligible';

/** `checking` means "can't tell yet": show progress or a retry, never a paywall and never unlocked content. */
export type CoreAccess = 'granted' | 'denied' | 'checking';

/** People can always see, delete and export their own data, whatever their subscription status. */
export type Access = { core: CoreAccess; viewData: true; deleteData: true; exportData: true };

export type AccessOptions = {
  gatingEnabled: boolean;
  /** Mock entitlements only count in development builds and tests. */
  allowMock: boolean;
};

export function accessFor(entitlement: Entitlement, { gatingEnabled, allowMock }: AccessOptions): Access {
  const access = (core: CoreAccess): Access => ({ core, viewData: true, deleteData: true, exportData: true });
  if (!gatingEnabled) return access('granted');
  switch (entitlement.status) {
    case 'unknown':
    case 'error':
      return access('checking');
    case 'active':
    case 'gracePeriod':
      return access(entitlement.verification.origin === 'store' || allowMock ? 'granted' : 'denied');
    case 'billingRetry':
    case 'inactive':
      return access('denied');
  }
}

export type RestoreResult =
  | { outcome: 'restored'; entitlement: Entitlement }
  /** A subscription was found, but it gives no access now: it ended, or a renewal is failing. */
  | { outcome: 'foundInactive'; entitlement: Entitlement }
  | { outcome: 'nothingToRestore'; entitlement: Entitlement }
  | { outcome: 'failed'; error: { kind: VerificationErrorKind; message: string } };

/** What the app will use to read subscription status. Purchasing is added with the paywall. */
export interface EntitlementService {
  current(): Entitlement;
  subscribe(listener: (entitlement: Entitlement) => void): () => void;
  /** Asks the store again, for example when the app returns to the foreground. */
  refresh(): Promise<Entitlement>;
  restorePurchases(): Promise<RestoreResult>;
}
