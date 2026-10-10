import { Entitlement, EntitlementService, PlanId, RestoreResult, Verification } from './entitlement';

/** Development and test stand-in for the store. Its entitlements are marked `mock` and never grant access in a release build. */

const mockVerification = (at = new Date()): Verification => ({ origin: 'mock', verifiedAt: at.toISOString() });

export const mockEntitlements = {
  unknown: (): Entitlement => ({ status: 'unknown' }),
  active: (plan: PlanId, period: 'trial' | 'paid' = 'paid', expiresAt: string | null = null): Entitlement => ({
    status: 'active',
    plan,
    period,
    expiresAt,
    willRenew: true,
    verification: mockVerification(),
  }),
  gracePeriod: (plan: PlanId, expiresAt: string | null = null): Entitlement => ({
    status: 'gracePeriod',
    plan,
    expiresAt,
    verification: mockVerification(),
  }),
  billingRetry: (plan: PlanId): Entitlement => ({ status: 'billingRetry', plan, verification: mockVerification() }),
  trialEligible: (): Entitlement => ({
    status: 'inactive',
    reason: 'neverSubscribed',
    lastPlan: null,
    annualTrial: 'eligible',
    verification: mockVerification(),
  }),
  expired: (lastPlan: PlanId): Entitlement => ({
    status: 'inactive',
    reason: 'expired',
    lastPlan,
    annualTrial: 'ineligible',
    verification: mockVerification(),
  }),
  error: (message = 'The store could not be reached.'): Entitlement => ({ status: 'error', error: { kind: 'network', message } }),
};

export type MockEntitlementService = EntitlementService & {
  /** Simulates the store reporting a new status. */
  set(next: Entitlement): void;
  /** What the next restore reports. */
  setRestoreResult(next: RestoreResult): void;
};

export function createMockEntitlementService(initial: Entitlement = mockEntitlements.unknown()): MockEntitlementService {
  let state = initial;
  let restoreResult: RestoreResult = { outcome: 'nothingToRestore', entitlement: initial };
  const listeners = new Set<(entitlement: Entitlement) => void>();
  const set = (next: Entitlement) => {
    state = next;
    for (const listener of listeners) listener(next);
  };
  return {
    current: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    refresh: async () => state,
    async restorePurchases() {
      if (restoreResult.outcome !== 'failed') set(restoreResult.entitlement);
      return restoreResult;
    },
    set,
    setRestoreResult: (next) => {
      restoreResult = next;
    },
  };
}
