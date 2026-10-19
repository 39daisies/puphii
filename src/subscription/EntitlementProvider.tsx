import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SUBSCRIPTION_GATING_ENABLED } from './config';
import { Access, accessFor, Entitlement, RestoreResult } from './entitlement';
import { subscriptionEnforced } from './proFeatures';
import { createAppEntitlementService } from './revenueCatSdk';

/** True when the app requires an active subscription/trial for normal use. */
export const PRO_GATING_ACTIVE = subscriptionEnforced(SUBSCRIPTION_GATING_ENABLED);

type EntitlementContextValue = {
  entitlement: Entitlement;
  access: Access;
  /**
   * Access worked out from the subscription service at the moment it is called, never from a
   * render, so code acting later can't use an older answer. Stable for the provider's lifetime.
   */
  currentAccess: () => Access;
  refresh: () => Promise<Entitlement>;
  restorePurchases: () => Promise<RestoreResult>;
};

const EntitlementContext = createContext<EntitlementContextValue | null>(null);

/** Keeps subscription status current, and is the only place app unlock is worked out. */
export function EntitlementProvider({ children }: { children: React.ReactNode }) {
  const [service] = useState(createAppEntitlementService);
  const [entitlement, setEntitlement] = useState<Entitlement>(() => service.current());

  useEffect(() => {
    const unsubscribe = service.subscribe(setEntitlement);
    service.start();
    setEntitlement(service.current());
    return () => {
      unsubscribe();
      service.stop();
    };
  }, [service]);

  const statusDetail = entitlement.status === 'error' ? `${entitlement.error.kind}: ${entitlement.error.message}` : entitlement.status;
  useEffect(() => {
    if (__DEV__) console.log(`[Puphii] Subscription status: ${statusDetail}`);
  }, [statusDetail]);

  const currentAccess = useCallback(() => accessFor(service.current(), { gatingEnabled: PRO_GATING_ACTIVE, allowMock: __DEV__ }), [service]);

  const value = useMemo<EntitlementContextValue>(
    () => ({
      entitlement,
      access: accessFor(entitlement, { gatingEnabled: PRO_GATING_ACTIVE, allowMock: __DEV__ }),
      currentAccess,
      refresh: service.refresh,
      restorePurchases: service.restorePurchases,
    }),
    [entitlement, service, currentAccess],
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementContextValue {
  const value = useContext(EntitlementContext);
  if (!value) throw new Error('useEntitlement must be used inside <EntitlementProvider>');
  return value;
}
