import React, { createContext } from 'react';
import { ViewStyle } from 'react-native';
import { useEntitlement } from '../subscription/EntitlementProvider';
import { canUse, ProFeature } from '../subscription/proFeatures';

/** @deprecated Freemium Pro entry; subscription-only uses the lock shell / manage paywall. */
const ProEntryContext = createContext<(() => void) | undefined>(undefined);
export const ProEntryProvider = ProEntryContext.Provider;

/** Always true for null features (subscription-only: no section gates once unlocked). */
export function useProFeature(feature: ProFeature | null): boolean {
  return canUse(useEntitlement().access.pro, feature);
}

type Props = {
  feature: ProFeature | null;
  children: React.ReactNode;
  onNotNow?: () => void;
  style?: ViewStyle;
};

/**
 * Passthrough. Feature-by-feature Pro gating is retired; the app shell blocks unsubscribed users.
 * Kept so any residual call sites render children without a freemium upsell card.
 */
export function ProGate({ children }: Props) {
  return <>{children}</>;
}
