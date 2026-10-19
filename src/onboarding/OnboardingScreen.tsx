import React, { useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { PrimaryButton } from '../components/Buttons';
import { NumberField } from '../components/Fields';
import { OceanBackground } from '../components/OceanBackground';
import { Wordmark } from '../components/Wordmark';
import { FACES } from '../mascot/faces';
import { PlanSettings } from '../plan/actions';
import { baselineFromEstimate } from '../plan/baseline';
import { PLAN_ERROR_COPY } from '../plan/copy';
import { defaultSettleAt, setupPreview } from '../plan/view';
import { ChoiceCard, PaceChooser, PreviewRows } from '../screens/plan/controls';
import { colors, spacing } from '../theme';
import {
  ONBOARDING_BACK,
  ONBOARDING_ESTIMATE_HINT,
  ONBOARDING_ESTIMATE_TITLE,
  ONBOARDING_GOAL_TITLE,
  ONBOARDING_PACE_TITLE,
  ONBOARDING_PREVIEW_CAVEAT,
  ONBOARDING_PREVIEW_CTA,
  ONBOARDING_PREVIEW_TITLE,
  ONBOARDING_PRODUCT_HINT,
  ONBOARDING_PRODUCT_TITLE,
  ONBOARDING_QUIT_DESC,
  ONBOARDING_QUIT_LABEL,
  ONBOARDING_REDUCE_DESC,
  ONBOARDING_REDUCE_LABEL,
  PRODUCT_LABEL,
} from './copy';
import { OnboardingDemo } from './OnboardingDemo';
import { CONSUMPTION_PRODUCTS, createOnboardingDraft, defaultPace, OnboardingDraft } from './model';

type Props = {
  draft: OnboardingDraft;
  onChange: (next: OnboardingDraft) => void;
  onFinished: (pendingPlan: PlanSettings) => void;
};

export function OnboardingScreen({ draft, onChange, onFinished }: Props) {
  const insets = useSafeAreaInsets();
  const baselinePerDay = baselineFromEstimate(draft.estimatePerDay);
  const pace = draft.pace ?? defaultPace();
  const goal = draft.goal;
  const settleAt =
    baselinePerDay === null || !goal
      ? null
      : goal === 'quit'
        ? 0
        : draft.settleAt ?? defaultSettleAt(Math.ceil(baselinePerDay));
  const preview =
    goal && baselinePerDay !== null && settleAt !== null
      ? setupPreview({ goal, baselinePerDay, pace, settleAt })
      : null;

  const pendingPlan: PlanSettings | null = useMemo(() => {
    if (!goal || baselinePerDay === null || settleAt === null) return null;
    return {
      goal,
      baseline: { perDay: baselinePerDay, source: 'estimate' },
      pace,
      settleAt,
    };
  }, [goal, baselinePerDay, pace, settleAt]);

  const go = (step: OnboardingDraft['step']) => onChange({ ...draft, step });

  return (
    <View style={styles.root}>
      <OceanBackground variant="calm" />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl }]}
        keyboardShouldPersistTaps="handled"
      >
        <Wordmark />
        {draft.step !== 'product' ? (
          <Pressable
            onPress={() => {
              const order = ['product', 'estimate', 'goal', 'demo', 'preview'] as const;
              const i = order.indexOf(draft.step);
              if (i > 0) go(order[i - 1]);
            }}
            accessibilityRole="button"
            accessibilityLabel={ONBOARDING_BACK}
            style={styles.back}
          >
            <AppText variant="bodySmall" color={colors.coralInk}>
              {ONBOARDING_BACK}
            </AppText>
          </Pressable>
        ) : null}

        {draft.step === 'product' ? (
          <View style={styles.block}>
            <Image source={FACES.curious} style={styles.mascot} resizeMode="contain" accessible={false} />
            <AppText variant="headline">{ONBOARDING_PRODUCT_TITLE}</AppText>
            <AppText variant="bodySmall">{ONBOARDING_PRODUCT_HINT}</AppText>
            <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={ONBOARDING_PRODUCT_TITLE}>
              {CONSUMPTION_PRODUCTS.map((product) => (
                <ChoiceCard
                  key={product}
                  title={PRODUCT_LABEL[product]}
                  selected={draft.product === product}
                  onPress={() => onChange({ ...draft, product, step: 'estimate' })}
                />
              ))}
            </View>
          </View>
        ) : null}

        {draft.step === 'estimate' ? (
          <View style={styles.block}>
            <AppText variant="headline">{ONBOARDING_ESTIMATE_TITLE}</AppText>
            <AppText variant="bodySmall">{ONBOARDING_ESTIMATE_HINT}</AppText>
            <NumberField
              label="Per day"
              value={draft.estimatePerDay}
              onChange={(estimatePerDay) => onChange({ ...draft, estimatePerDay })}
              validate={(value) => (baselineFromEstimate(value) === null ? PLAN_ERROR_COPY.invalidBaseline : null)}
              suffix="a day"
            />
            <PrimaryButton
              label="Continue"
              disabled={baselinePerDay === null}
              onPress={() => go('goal')}
            />
          </View>
        ) : null}

        {draft.step === 'goal' ? (
          <View style={styles.block}>
            <AppText variant="headline">{ONBOARDING_GOAL_TITLE}</AppText>
            <View style={styles.choices} accessibilityRole="radiogroup" accessibilityLabel={ONBOARDING_GOAL_TITLE}>
              <ChoiceCard
                title={ONBOARDING_REDUCE_LABEL}
                description={ONBOARDING_REDUCE_DESC}
                selected={draft.goal === 'reduce'}
                onPress={() =>
                  onChange({
                    ...draft,
                    goal: 'reduce',
                    pace: draft.pace ?? defaultPace(),
                    settleAt: baselinePerDay !== null ? defaultSettleAt(Math.ceil(baselinePerDay)) : null,
                  })
                }
              />
              <ChoiceCard
                title={ONBOARDING_QUIT_LABEL}
                description={ONBOARDING_QUIT_DESC}
                selected={draft.goal === 'quit'}
                onPress={() => onChange({ ...draft, goal: 'quit', pace: draft.pace ?? defaultPace(), settleAt: 0 })}
              />
            </View>
            {draft.goal ? (
              <>
                <AppText variant="label">{ONBOARDING_PACE_TITLE}</AppText>
                <PaceChooser pace={pace} onChange={(next) => onChange({ ...draft, pace: next })} baselinePerDay={baselinePerDay} />
                <PrimaryButton label="Continue" onPress={() => go('demo')} />
              </>
            ) : null}
          </View>
        ) : null}

        {draft.step === 'demo' ? <OnboardingDemo onDone={() => go('preview')} /> : null}

        {draft.step === 'preview' && preview && pendingPlan ? (
          <View style={styles.block}>
            <Image source={FACES.happy} style={styles.mascot} resizeMode="contain" accessible={false} />
            <AppText variant="headline">{ONBOARDING_PREVIEW_TITLE}</AppText>
            <AppText variant="bodySmall">{ONBOARDING_PREVIEW_CAVEAT}</AppText>
            <PreviewRows rows={preview.rows} />
            <PrimaryButton
              label={ONBOARDING_PREVIEW_CTA}
              onPress={() => onFinished(pendingPlan)}
            />
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

/** Fresh draft helper for callers that have not loaded storage yet. */
export const emptyOnboardingDraft = createOnboardingDraft;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.warmCream },
  scroll: { paddingHorizontal: spacing.lg, gap: spacing.md, flexGrow: 1 },
  back: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  block: { gap: spacing.md, flex: 1 },
  choices: { gap: spacing.sm },
  mascot: { width: 96, height: 96, alignSelf: 'center' },
});
