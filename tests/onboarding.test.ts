import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  createOnboardingDraft,
  needsFirstLaunchOnboarding,
  sanitizeOnboardingDraft,
} from '../src/onboarding/model';
import { NO_INTRO_OFFER_PLANS } from '../src/subscription/paywall';
import { PLANS } from '../src/subscription/config';

describe('first-launch onboarding policy', () => {
  test('fresh installs without data need onboarding', () => {
    assert.equal(
      needsFirstLaunchOnboarding({
        ready: true,
        onboardingCompletedAt: null,
        firstLaunchSource: 'freshInstall',
        hasPlanSegments: false,
        hasLogs: false,
        hasSkips: false,
      }),
      true,
    );
  });

  test('existing data or completed onboarding never repeats', () => {
    assert.equal(
      needsFirstLaunchOnboarding({
        ready: true,
        onboardingCompletedAt: '2026-10-19T00:00:00.000Z',
        firstLaunchSource: 'freshInstall',
        hasPlanSegments: false,
        hasLogs: false,
        hasSkips: false,
      }),
      false,
    );
    assert.equal(
      needsFirstLaunchOnboarding({
        ready: true,
        onboardingCompletedAt: null,
        firstLaunchSource: 'existingInstall',
        hasPlanSegments: false,
        hasLogs: false,
        hasSkips: false,
      }),
      false,
    );
    assert.equal(
      needsFirstLaunchOnboarding({
        ready: true,
        onboardingCompletedAt: null,
        firstLaunchSource: 'freshInstall',
        hasPlanSegments: false,
        hasLogs: true,
        hasSkips: false,
      }),
      false,
    );
  });

  test('draft sanitize keeps pending plan shape', () => {
    const draft = createOnboardingDraft();
    draft.pendingPlan = {
      goal: 'reduce',
      baseline: { perDay: 10, source: 'estimate' },
      pace: { preset: 'steady', percent: 10 },
      settleAt: 5,
    };
    const restored = sanitizeOnboardingDraft(JSON.parse(JSON.stringify(draft)));
    assert.ok(restored);
    assert.equal(restored!.pendingPlan?.baseline.perDay, 10);
  });
});

describe('approved subscription TARGET', () => {
  test('annual 7-day intent, monthly 3-day intent, weekly no trial', () => {
    assert.equal(PLANS.annual.hasFreeTrial, true);
    assert.equal(PLANS.monthly.hasFreeTrial, true);
    assert.equal(PLANS.weekly.hasFreeTrial, false);
    assert.deepEqual(NO_INTRO_OFFER_PLANS, ['weekly']);
  });
});
