import { isRecord, withUnknownFields } from './preserve';

/**
 * How `firstLaunchAt` was recorded:
 * - `freshInstall`: on the first launch of an install with no saved data.
 * - `existingInstall`: the first time a version with lifecycle state ran on an install
 *   that already had data, so the real first launch was earlier.
 * - `recreated`: the saved state was unreadable and had to be started again.
 */
export type FirstLaunchSource = 'freshInstall' | 'existingInstall' | 'recreated';
const FIRST_LAUNCH_SOURCES: readonly FirstLaunchSource[] = ['freshInstall', 'existingInstall', 'recreated'];

export type ExperimentAssignment = { variant: string; assignedAt: string };

/** On-device app lifecycle details for future onboarding and offer timing. Not proof of any purchase. */
export type AppState = {
  version: 1;
  firstLaunchAt: string;
  firstLaunchSource: FirstLaunchSource;
  onboardingCompletedAt: string | null;
  /** Keyed by experiment name. Empty until an experiment is approved and running. */
  experiments: Record<string, ExperimentAssignment>;
};

export function createAppState(now: Date, firstLaunchSource: FirstLaunchSource): AppState {
  return { version: 1, firstLaunchAt: now.toISOString(), firstLaunchSource, onboardingCompletedAt: null, experiments: {} };
}

const isInstant = (value: unknown): value is string => typeof value === 'string' && !Number.isNaN(new Date(value).getTime());

function sanitizeExperiments(raw: unknown): Record<string, ExperimentAssignment> {
  const result: Record<string, ExperimentAssignment> = Object.create(null);
  if (!isRecord(raw)) return { ...result };
  for (const [name, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || typeof entry.variant !== 'string' || !entry.variant || !isInstant(entry.assignedAt)) continue;
    result[name] = withUnknownFields(entry, { variant: entry.variant, assignedAt: entry.assignedAt });
  }
  return { ...result };
}

/** Restores saved lifecycle state, or null when there is none or its first launch time is unusable. */
export function sanitizeAppState(raw: unknown): AppState | null {
  if (!isRecord(raw) || !isInstant(raw.firstLaunchAt)) return null;
  return withUnknownFields(raw, {
    version: 1 as const,
    firstLaunchAt: raw.firstLaunchAt,
    firstLaunchSource: (FIRST_LAUNCH_SOURCES as readonly unknown[]).includes(raw.firstLaunchSource)
      ? (raw.firstLaunchSource as FirstLaunchSource)
      : 'recreated',
    onboardingCompletedAt: isInstant(raw.onboardingCompletedAt) ? raw.onboardingCompletedAt : null,
    experiments: sanitizeExperiments(raw.experiments),
  });
}
