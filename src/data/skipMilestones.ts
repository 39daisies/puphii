/** Cumulative skip counts that earn a quiet celebration. Later thresholds keep growing. */
export const SKIP_MILESTONE_THRESHOLDS = [10, 25, 50, 100, 250, 500, 1000] as const;

export type SkipMilestoneId = `skip-${(typeof SKIP_MILESTONE_THRESHOLDS)[number]}`;

export type SkipMilestoneState = {
  /** Milestone ids already acknowledged, so they never celebrate again after restart. */
  seen: SkipMilestoneId[];
};

export const defaultSkipMilestones = (): SkipMilestoneState => ({ seen: [] });

export function skipMilestoneId(threshold: number): SkipMilestoneId {
  return `skip-${threshold as (typeof SKIP_MILESTONE_THRESHOLDS)[number]}`;
}

/** Every threshold the person has already reached, based on persisted skip history. */
export function reachedSkipMilestones(totalSkips: number): SkipMilestoneId[] {
  return SKIP_MILESTONE_THRESHOLDS.filter((n) => totalSkips >= n).map(skipMilestoneId);
}

/** Reached but not yet acknowledged. */
export function unseenSkipMilestones(totalSkips: number, seen: readonly SkipMilestoneId[]): SkipMilestoneId[] {
  const acknowledged = new Set(seen);
  return reachedSkipMilestones(totalSkips).filter((id) => !acknowledged.has(id));
}

export function skipMilestoneLabel(id: SkipMilestoneId): string {
  const n = Number(id.slice('skip-'.length));
  return n === 1 ? '1 skip' : `${n} skips`;
}

export function skipMilestoneTitle(id: SkipMilestoneId): string {
  return `${skipMilestoneLabel(id)} logged`;
}

export function skipMilestoneDetail(id: SkipMilestoneId): string {
  const n = Number(id.slice('skip-'.length));
  return `You chose not to act on an urge ${n === 1 ? 'once' : `${n} times`}. Skips are not puffs and do not change your plan targets.`;
}

export function sanitizeSkipMilestones(raw: unknown): SkipMilestoneState {
  if (!raw || typeof raw !== 'object') return defaultSkipMilestones();
  const seenRaw = (raw as { seen?: unknown }).seen;
  if (!Array.isArray(seenRaw)) return defaultSkipMilestones();
  const allowed = new Set(SKIP_MILESTONE_THRESHOLDS.map(skipMilestoneId));
  const seen: SkipMilestoneId[] = [];
  for (const item of seenRaw) {
    if (typeof item === 'string' && allowed.has(item as SkipMilestoneId) && !seen.includes(item as SkipMilestoneId)) {
      seen.push(item as SkipMilestoneId);
    }
  }
  return { seen };
}
