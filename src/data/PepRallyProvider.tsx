import React, { createContext, useContext, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import type { PepAccess } from '../pepRally/access';
import { PRO_GATING_ACTIVE, useEntitlement } from '../subscription/EntitlementProvider';
import { connectPepAccess, PepAccessOptions, pepAccessSource } from './pepRallyAccessBridge';
import type { PepRallyController } from './pepRallyController';
import { useStorePepRallyController } from './PuphiiStore';

type PepRallyContextValue = {
  controller: PepRallyController;
  /** For display only. Every save, take and import reads access itself when it runs. */
  access: PepAccess;
};

const PepRallyContext = createContext<PepRallyContextValue | null>(null);

const ACCESS_OPTIONS: PepAccessOptions = { platform: Platform.OS, gatingActive: PRO_GATING_ACTIVE };

/** Must sit inside both PuphiiProvider and EntitlementProvider. Renders no UI of its own. */
export function PepRallyProvider({ children }: { children: React.ReactNode }) {
  const controller = useStorePepRallyController();
  const { access, currentAccess } = useEntitlement();

  useEffect(() => connectPepAccess(controller, currentAccess, ACCESS_OPTIONS), [controller, currentAccess]);

  const displayAccess = pepAccessSource(() => access, ACCESS_OPTIONS)();
  const value = useMemo<PepRallyContextValue>(() => ({ controller, access: displayAccess }), [controller, displayAccess]);

  return <PepRallyContext.Provider value={value}>{children}</PepRallyContext.Provider>;
}

export function usePepRallies(): PepRallyContextValue {
  const context = useContext(PepRallyContext);
  if (!context) throw new Error('usePepRallies must be used inside <PepRallyProvider>');
  return context;
}
