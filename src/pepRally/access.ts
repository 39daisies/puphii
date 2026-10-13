/**
 * Free and Pro rules for Pep Rallies, worked out from the existing entitlement state alone.
 * Only adding something is limited: playing, exporting, renaming and deleting existing
 * recordings, and removing their photos, tags or favorite mark, never depend on subscription
 * status, so those operations take no access at all or only check what is being added.
 */

import type { ProAccess } from '../subscription/entitlement';
import { DURATION_TOLERANCE_MS, PepLibrary } from './model';

export type PepTier = 'free' | 'pro';

export const PEP_TIER_LIMITS: Readonly<Record<PepTier, { maxSaved: number; maxDurationMs: number }>> = {
  free: { maxSaved: 1, maxDurationMs: 30_000 },
  pro: { maxSaved: 50, maxDurationMs: 60_000 },
};

/** While access is still being checked, new recordings follow Free limits; nothing existing is affected. */
export const pepTierFor = (pro: ProAccess): PepTier => (pro === 'granted' ? 'pro' : 'free');

/** Saved, or being saved. Rallies being deleted no longer count. */
export const savedCount = (library: PepLibrary): number => library.rallies.filter((rally) => rally.status !== 'deleting').length;

export type CreateCheck = { ok: true; maxDurationMs: number } | { ok: false; reason: 'limitReached' };

export function canCreate(library: PepLibrary, pro: ProAccess): CreateCheck {
  const limits = PEP_TIER_LIMITS[pepTierFor(pro)];
  return savedCount(library) < limits.maxSaved ? { ok: true, maxDurationMs: limits.maxDurationMs } : { ok: false, reason: 'limitReached' };
}

/**
 * Re-recording an existing rally. Without Pro it is allowed only while the library is within the
 * Free allowance, so a library kept from an earlier subscription stays playable but not re-recordable.
 */
export function canReplaceAudio(library: PepLibrary, pro: ProAccess): CreateCheck {
  const limits = PEP_TIER_LIMITS[pepTierFor(pro)];
  return savedCount(library) <= limits.maxSaved ? { ok: true, maxDurationMs: limits.maxDurationMs } : { ok: false, reason: 'limitReached' };
}

export const maxDurationFor = (pro: ProAccess): number => PEP_TIER_LIMITS[pepTierFor(pro)].maxDurationMs;

export const fitsDuration = (durationMs: number, maxDurationMs: number): boolean =>
  Number.isInteger(durationMs) && durationMs > 0 && durationMs <= maxDurationMs + DURATION_TOLERANCE_MS;

/** Adding a photo, a tag or a favorite mark. Existing ones stay visible, and removable, after Pro ends. */
export const canUseProExtras = (pro: ProAccess): boolean => pepTierFor(pro) === 'pro';
