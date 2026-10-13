/**
 * Free and Pro rules for Pep Rallies, worked out from the existing entitlement state alone.
 * Only adding something is limited: playing, renaming and deleting existing recordings, and
 * removing their photos, tags or favorite mark, never depend on subscription status, so those
 * operations take no access at all or only check what is being added.
 */

import type { ProAccess } from '../subscription/entitlement';
import { DURATION_TOLERANCE_MS, PepLibrary } from './model';

export type PepTier = 'free' | 'pro';

export const PEP_TIER_LIMITS: Readonly<Record<PepTier, { maxSaved: number; maxDurationMs: number }>> = {
  free: { maxSaved: 1, maxDurationMs: 30_000 },
  pro: { maxSaved: 50, maxDurationMs: 60_000 },
};

/**
 * `pro` and `free` are verified answers. `checking` covers everything not yet verified, and is
 * never treated as either. `unavailable`: Pro can't be bought in this build, so nothing new can
 * be added, rather than everything being unlocked.
 */
export type PepAccess = PepTier | 'checking' | 'unavailable';
export const PEP_ACCESS: readonly PepAccess[] = ['pro', 'free', 'checking', 'unavailable'];
export const isPepAccess = (value: unknown): value is PepAccess => (PEP_ACCESS as readonly unknown[]).includes(value);

/** `gatingActive` is false wherever the paywall is hidden; then global access is granted to everyone, which must not mean Pro here. */
export function pepAccessFor(pro: ProAccess, gatingActive: boolean): PepAccess {
  if (!gatingActive) return 'unavailable';
  if (pro === 'granted') return 'pro';
  return pro === 'denied' ? 'free' : 'checking';
}

/** What someone refused for lack of Pro is offered. Never offered while access is undecided. */
export type PepUpsell = 'upgrade' | 'resubscribe';

export type AccessDenial = {
  ok: false;
  error: 'checking' | 'unavailable' | 'limitReached' | 'libraryFull' | 'proRequired';
  upsell?: PepUpsell;
};
export type CreateCheck = { ok: true; maxDurationMs: number } | AccessDenial;

/** Saved, or being saved. Rallies being deleted no longer count. */
export const savedCount = (library: PepLibrary): number => library.rallies.filter((rally) => rally.status !== 'deleting').length;

/** The library holds something only Pro could have added, so its owner had Pro before. */
export function showsEarlierPro(library: PepLibrary): boolean {
  const kept = library.rallies.filter((rally) => rally.status !== 'deleting');
  const freeLength = PEP_TIER_LIMITS.free.maxDurationMs + DURATION_TOLERANCE_MS;
  return (
    kept.length > PEP_TIER_LIMITS.free.maxSaved ||
    kept.some((rally) => rally.photo !== null || rally.tags.length > 0 || rally.favorite || (rally.audio.durationMs ?? 0) > freeLength)
  );
}

/** Only verified Free access is offered anything. */
export function upsellFor(library: PepLibrary, access: PepAccess): PepUpsell | undefined {
  if (access !== 'free') return undefined;
  return showsEarlierPro(library) ? 'resubscribe' : 'upgrade';
}

function denied(error: AccessDenial['error'], upsell?: PepUpsell): AccessDenial {
  return upsell ? { ok: false, error, upsell } : { ok: false, error };
}

export function canCreate(library: PepLibrary, access: PepAccess): CreateCheck {
  if (access === 'checking' || access === 'unavailable') return denied(access);
  const limits = PEP_TIER_LIMITS[access];
  if (savedCount(library) < limits.maxSaved) return { ok: true, maxDurationMs: limits.maxDurationMs };
  return access === 'pro' ? denied('libraryFull') : denied('limitReached', upsellFor(library, access));
}

/**
 * Re-recording an existing rally. Without Pro it is allowed only while the library is within the
 * Free allowance, so a library kept from an earlier subscription stays playable but not re-recordable.
 */
export function canReplaceAudio(library: PepLibrary, access: PepAccess): CreateCheck {
  if (access === 'checking' || access === 'unavailable') return denied(access);
  const limits = PEP_TIER_LIMITS[access];
  if (savedCount(library) <= limits.maxSaved) return { ok: true, maxDurationMs: limits.maxDurationMs };
  return access === 'pro' ? denied('libraryFull') : denied('limitReached', upsellFor(library, access));
}

/** The longest new audio allowed, or null while access is undecided. */
export const maxDurationFor = (access: PepAccess): number | null =>
  access === 'pro' || access === 'free' ? PEP_TIER_LIMITS[access].maxDurationMs : null;

export const fitsDuration = (durationMs: number, maxDurationMs: number): boolean =>
  Number.isInteger(durationMs) && durationMs > 0 && durationMs <= maxDurationMs + DURATION_TOLERANCE_MS;

/** Adding a photo, a tag or a favorite mark. Existing ones stay visible, and removable, after Pro ends. */
export function canUseProExtras(library: PepLibrary, access: PepAccess): { ok: true } | AccessDenial {
  if (access === 'checking' || access === 'unavailable') return denied(access);
  return access === 'pro' ? { ok: true } : denied('proRequired', upsellFor(library, access));
}
