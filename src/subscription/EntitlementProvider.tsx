import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { SUBSCRIPTION_GATING_ENABLED } from './config';
import { Access, accessFor, Entitlement, RestoreResult } from './entitlement';
import { showPaywallEntry } from './paywall';
import { proGatingActive } from './proFeatures';
import { appSdkKey, createAppEntitlementService, hasNativeStore } from './revenueCatSdk';

export const PRO_GATING_ACTIVE = proGatingActive({
  enabled: SUBSCRIPTION_GATING_ENABLED,
  paywallAvailable: showPaywallEntry(__DEV__),
  storeReady: hasNativeStore && appSdkKey.ok,
});

type EntitlementContextValue = {
  entitlement: Entitlement;
  access: Access;
  refresh: () => Promise<Entitlement>;
  restorePurchases: () => Promise<RestoreResult>;
};

const EntitlementContext = createContext<EntitlementContextValue | null>(null);

/** Keeps subscription status current, and is the only place Puphii Pro access is worked out. */
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

  const value = useMemo<EntitlementContextValue>(
    () => ({
      entitlement,
      access: accessFor(entitlement, { gatingEnabled: PRO_GATING_ACTIVE, allowMock: __DEV__ }),
      refresh: service.refresh,
      restorePurchases: service.restorePurchases,
    }),
    [entitlement, service],
  );

  return <EntitlementContext.Provider value={value}>{children}</EntitlementContext.Provider>;
}

export function useEntitlement(): EntitlementContextValue {
  const value = useContext(EntitlementContext);
  if (!value) throw new Error('useEntitlement must be used inside <EntitlementProvider>');
  return value;
}
