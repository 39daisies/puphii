import { isRecord, withUnknownFields } from '../data/preserve';
import { PlanSettings } from '../plan/actions';
import { CUSTOM_PACE_LIMITS, PACE_PRESETS, Pace, PacePreset } from '../plan/model';

/** Consumption type chosen during first-launch onboarding. Informational only — not a medical claim. */
export type ConsumptionProduct = 'cigarettes' | 'vape' | 'disposable' | 'other';

export const CONSUMPTION_PRODUCTS: readonly ConsumptionProduct[] = ['cigarettes', 'vape', 'disposable', 'other'];

export type OnboardingStep = 'product' | 'estimate' | 'goal' | 'demo' | 'preview';

export const ONBOARDING_STEPS: readonly OnboardingStep[] = ['product', 'estimate', 'goal', 'demo', 'preview'];

/**
 * In-progress first-launch answers and the plan waiting to start after a confirmed subscription.
 * Never writes puff/skip logs. Cleared after the pending plan activates once.
 */
export type OnboardingDraft = {
  version: 1;
  step: OnboardingStep;
  product: ConsumptionProduct | null;
  estimatePerDay: number | null;
  goal: 'reduce' | 'quit' | null;
  pace: Pace | null;
  settleAt: number | null;
  /** Set when the person confirms the personalized preview; applied once after entitlement. */
  pendingPlan: PlanSettings | null;
  /** ISO time when pendingPlan was started; null until then. */
  planActivatedAt: string | null;
};

export function createOnboardingDraft(): OnboardingDraft {
  return {
    version: 1,
    step: 'product',
    product: null,
    estimatePerDay: null,
    goal: null,
    pace: null,
    settleAt: null,
    pendingPlan: null,
    planActivatedAt: null,
  };
}

const isPace = (value: unknown): value is Pace => {
  if (!isRecord(value) || typeof value.percent !== 'number' || !Number.isFinite(value.percent)) return false;
  if (!(PACE_PRESETS as Record<string, number>)[value.preset as string] && value.preset !== 'custom') return false;
  if (value.percent < CUSTOM_PACE_LIMITS.min || value.percent > CUSTOM_PACE_LIMITS.max) return false;
  return true;
};

const isPlanSettings = (value: unknown): value is PlanSettings => {
  if (!isRecord(value)) return false;
  if (value.goal !== 'reduce' && value.goal !== 'quit') return false;
  if (!isRecord(value.baseline) || typeof value.baseline.perDay !== 'number') return false;
  if (value.baseline.source !== 'history' && value.baseline.source !== 'estimate') return false;
  if (!isPace(value.pace) || typeof value.settleAt !== 'number') return false;
  return true;
};

export function sanitizeOnboardingDraft(raw: unknown): OnboardingDraft | null {
  if (!isRecord(raw)) return null;
  const step = (ONBOARDING_STEPS as readonly unknown[]).includes(raw.step) ? (raw.step as OnboardingStep) : 'product';
  const product = (CONSUMPTION_PRODUCTS as readonly unknown[]).includes(raw.product) ? (raw.product as ConsumptionProduct) : null;
  const estimate =
    typeof raw.estimatePerDay === 'number' && Number.isFinite(raw.estimatePerDay) && raw.estimatePerDay >= 1 && raw.estimatePerDay <= 1000
      ? raw.estimatePerDay
      : null;
  const goal: 'reduce' | 'quit' | null = raw.goal === 'reduce' || raw.goal === 'quit' ? raw.goal : null;
  const pace = isPace(raw.pace) ? raw.pace : null;
  const settleAt = typeof raw.settleAt === 'number' && Number.isFinite(raw.settleAt) && raw.settleAt >= 0 ? Math.floor(raw.settleAt) : null;
  const pendingPlan = isPlanSettings(raw.pendingPlan) ? raw.pendingPlan : null;
  const planActivatedAt =
    typeof raw.planActivatedAt === 'string' && !Number.isNaN(new Date(raw.planActivatedAt).getTime()) ? raw.planActivatedAt : null;
  return withUnknownFields(raw, {
    version: 1 as const,
    step,
    product,
    estimatePerDay: estimate,
    goal,
    pace,
    settleAt,
    pendingPlan,
    planActivatedAt,
  });
}

export function defaultPace(): Pace {
  return { preset: 'steady' as PacePreset, percent: PACE_PRESETS.steady };
}

/**
 * Whether first-launch onboarding should run. Existing installs with data, completed onboarding,
 * or an already-active plan never repeat the flow.
 */
export function needsFirstLaunchOnboarding(input: {
  ready: boolean;
  onboardingCompletedAt: string | null;
  firstLaunchSource: string | null;
  hasPlanSegments: boolean;
  hasLogs: boolean;
  hasSkips: boolean;
}): boolean {
  if (!input.ready) return false;
  if (input.onboardingCompletedAt) return false;
  if (input.firstLaunchSource === 'existingInstall') return false;
  if (input.hasPlanSegments || input.hasLogs || input.hasSkips) return false;
  return true;
}
