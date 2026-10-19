/**
 * Connects the Pep Rally controller to live subscription status. Access is worked out each time
 * the controller reads it, from the subscription service's current answer, never from a value a
 * screen captured during an earlier render.
 */

import { PepAccess, pepAccessFor } from '../pepRally/access';
import type { Access } from '../subscription/entitlement';
import type { PepRallyController } from './pepRallyController';

export type PepAccessOptions = {
  /** Recording is built for iOS only; anywhere else Pep Rallies are unavailable. */
  platform: string;
  /** False wherever Pro can't be bought: then Pep Rallies are unavailable, although every Pro feature is open. */
  gatingActive: boolean;
};

/** Reads current access on every call. */
export function pepAccessSource(currentAccess: () => Access, { platform, gatingActive }: PepAccessOptions): () => PepAccess {
  return () => (platform === 'ios' ? pepAccessFor(currentAccess().pro, gatingActive) : 'unavailable');
}

/** Connects live access to the controller. Returns the disconnect, after which access is `checking` again. */
export function connectPepAccess(
  controller: Pick<PepRallyController, 'connectAccess'>,
  currentAccess: () => Access,
  options: PepAccessOptions,
): () => void {
  controller.connectAccess(pepAccessSource(currentAccess, options));
  return () => controller.connectAccess(null);
}
