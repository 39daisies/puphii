import { SUBSCRIPTION_GATING_ENABLED } from './config';
import type { ProAccess } from './entitlement';

/**
 * Subscription-only access: there is no permanent free tier and no feature-by-feature Pro gate.
 * When the kill switch is on, normal app use requires an active entitlement (or trial).
 * Legal URL readiness never unlocks the app.
 */
export const subscriptionEnforced = (enabled: boolean = SUBSCRIPTION_GATING_ENABLED): boolean => enabled;

/**
 * @deprecated Alias of `subscriptionEnforced` kept for existing call sites and tests.
 * Previously also required paywall legal URLs + store readiness — that incorrectly unlocked release builds.
 */
export const proGatingActive = ({
  enabled,
}: {
  enabled: boolean;
  /** Ignored: missing legal URLs must not unlock. */
  paywallAvailable?: boolean;
  /** Ignored: store unreadiness is `checking`, not free access. */
  storeReady?: boolean;
}): boolean => subscriptionEnforced(enabled);

/**
 * @deprecated Freemium feature keys removed. Always null — screens no longer gate sections.
 */
export type ProFeature = string;

export function overviewFeature(_period: 'week' | 'month' | 'year', _offset: number): ProFeature | null {
  return null;
}

export const historyFeature = (_range: 'week' | 'month' | 'all'): ProFeature | null => null;

export const SPENDING_PROJECTIONS: ProFeature | null = null;

/** With subscription-only access, any null feature is unrestricted once the user is in the app. */
export const canUse = (pro: ProAccess, feature: ProFeature | null): boolean =>
  feature === null || pro === 'granted';
