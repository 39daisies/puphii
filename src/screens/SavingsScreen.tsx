import React, { useMemo, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, TextStyle, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { Card } from '../components/Card';
import { NumberField, TextField } from '../components/Fields';
import { Icon } from '../components/Icon';
import { OptionSheet } from '../components/OptionSheet';
import { ProGate, useProFeature } from '../components/ProGate';
import { SegmentedControl } from '../components/SegmentedControl';
import { periodRange, summarizePeriod } from '../data/insights';
import { usePuphii } from '../data/PuphiiStore';
import {
  assumptionText,
  clampReduction,
  CURRENCIES,
  effectiveBasis,
  estimateSpending,
  fieldError,
  fieldLabel,
  formatDuration,
  formatMoney,
  InputField,
  MAX_GOAL_NAME,
  PRODUCT_TYPES,
  PRODUCTS,
  ProductInputs,
  projectGoal,
  REDUCTION_SCENARIOS,
  REDUCTION_STEP,
  savingsScenario,
  UsageBasis,
} from '../data/savings';
import { useToday } from '../hooks/useToday';
import { FACES } from '../mascot/faces';
import { SPENDING_PROJECTIONS } from '../subscription/proFeatures';
import { colors, fontFamilies, MAX_CONTENT_WIDTH, radii, spacing, TOUCH_TARGET } from '../theme';
import { pluralize } from '../utils/format';

const validator = (field: InputField) => (value: number) => fieldError(field, value);

export function SavingsScreen({ header }: { header: React.ReactNode }) {
  const { savings, updateSavings, logs } = usePuphii();
  const insets = useSafeAreaInsets();
  const today = useToday();
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const projections = useProFeature(SPENDING_PROJECTIONS);

  const type = savings.productType;
  const product = PRODUCTS[type];
  const inputs = savings.products[type];
  const basis = effectiveBasis(type, inputs.basis);
  const currency = savings.currency;
  const money = (amount: number) => formatMoney(amount, currency);

  const estimate = useMemo(() => estimateSpending(type, inputs), [type, inputs]);
  const percent = savings.reductionPercent;
  const hasEstimate = estimate.status === 'ok';
  const selected = savingsScenario(estimate, percent);
  const goal = projectGoal(estimate, percent, savings.goalAmount);
  const weekLogs = useMemo(() => summarizePeriod(logs, periodRange('week', today)).total, [logs, today]);

  const setProductInput = (patch: Partial<ProductInputs>) =>
    updateSavings((current) => ({
      ...current,
      products: { ...current.products, [current.productType]: { ...current.products[current.productType], ...patch } },
    }));

  const scenarioPercents = Array.from(new Set<number>([...REDUCTION_SCENARIOS, percent])).sort((a, b) => a - b);
  // Very long amounts get the row's full width instead of sharing it with the percentage.
  const stackScenarios = scenarioPercents.some((value) => money(savingsScenario(estimate, value)?.annual ?? 0).length > 14);
  const currencyName = CURRENCIES.find((entry) => entry.code === currency)?.name ?? currency;

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: insets.top }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        automaticallyAdjustKeyboardInsets
      >
        {header}

        <View style={styles.intro}>
          <Image source={FACES.curious} style={styles.introMascot} resizeMode="contain" accessible={false} />
          <View style={styles.flex}>
            <AppText variant="headline">What you spend, estimated</AppText>
            <AppText variant="bodySmall">
              Enter what you usually buy and how quickly you use it. Estimates are only as accurate as the numbers you enter.
            </AppText>
          </View>
        </View>

        <Card style={styles.card}>
          <View style={styles.cardHeader}>
            <AppText variant="cardTitle" accessibilityRole="header" style={styles.cardHeaderTitle}>
              What you use
            </AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Currency: ${currencyName}. Change currency`}
              onPress={() => setCurrencyOpen(true)}
              hitSlop={4}
              style={({ pressed }) => [styles.currencyButton, pressed && { opacity: 0.7 }]}
            >
              <AppText variant="caption">Currency</AppText>
              <AppText variant="label">{currency}</AppText>
              <Icon name="chevronRight" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          <View style={styles.products} accessibilityRole="radiogroup" accessibilityLabel="Product type">
            {PRODUCT_TYPES.map((option) => {
              const active = option === type;
              return (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  aria-checked={active}
                  onPress={() => updateSavings((current) => ({ ...current, productType: option }))}
                  style={({ pressed }) => [styles.productChip, active && styles.chipSelected, pressed && { opacity: 0.8 }]}
                >
                  <AppText variant="label" align="center" color={active ? colors.coralInk : colors.textPrimary} style={active && styles.bold}>
                    {PRODUCTS[option].label}
                  </AppText>
                </Pressable>
              );
            })}
          </View>

          {/* Keyed by product so each product's own saved values fill the fields. */}
          <View key={type} style={styles.fields}>
            <NumberField
              label={fieldLabel(type, 'price')}
              value={inputs.price}
              onChange={(price) => setProductInput({ price })}
              validate={validator('price')}
              suffix={currency}
            />
            {product.bases.length > 1 ? (
              <View style={styles.basis}>
                <AppText variant="label">Describe your use by</AppText>
                <SegmentedControl<UsageBasis>
                  options={[
                    { value: 'rate', label: `Amount per ${product.ratePeriod}` },
                    { value: 'lasts', label: 'Days it lasts' },
                  ]}
                  value={basis}
                  onChange={(next) => setProductInput({ basis: next })}
                />
              </View>
            ) : null}
            {basis === 'rate' ? (
              <>
                {product.packSize ? (
                  <NumberField
                    label={fieldLabel(type, 'unitsPerPurchase')}
                    value={inputs.unitsPerPurchase}
                    onChange={(unitsPerPurchase) => setProductInput({ unitsPerPurchase })}
                    validate={validator('unitsPerPurchase')}
                    integer
                  />
                ) : null}
                <NumberField
                  label={fieldLabel(type, 'rate')}
                  value={inputs.rate}
                  onChange={(rate) => setProductInput({ rate })}
                  validate={validator('rate')}
                />
              </>
            ) : (
              <NumberField
                label={fieldLabel(type, 'lastsDays')}
                value={inputs.lastsDays}
                onChange={(lastsDays) => setProductInput({ lastsDays })}
                validate={validator('lastsDays')}
                suffix="days"
              />
            )}
          </View>
        </Card>

        <Card style={[styles.card, styles.resultCard, !hasEstimate && styles.messageCard]}>
          <AppText variant="cardTitle" accessibilityRole="header">
            Estimated spending
          </AppText>
          {estimate.status === 'ok' ? (
            <>
              <AmountGrid
                amounts={[
                  ['Per day', money(estimate.daily)],
                  ['Per week', money(estimate.weekly)],
                  ...(projections
                    ? ([
                        ['Per month', money(estimate.monthly)],
                        ['Per year', money(estimate.annual)],
                      ] as [string, string][])
                    : []),
                ]}
              />
              <AppText variant="caption" style={styles.note}>
                {assumptionText(type, basis)}
              </AppText>
            </>
          ) : (
            <AppText variant="bodySmall">
              {estimate.status === 'zero'
                ? "With these numbers, estimated spending is zero, so there's nothing to project."
                : 'Enter your purchase price and typical usage to see your estimated costs.'}
            </AppText>
          )}
        </Card>

        <ProGate feature={SPENDING_PROJECTIONS}>
          <Card style={[styles.card, styles.resultCard, !hasEstimate && styles.messageCard]}>
            <AppText variant="cardTitle" accessibilityRole="header">
              If you used less
            </AppText>
            {estimate.status === 'ok' ? (
              <>
                <AppText variant="caption">Illustrative scenarios: estimated spending × the reduction. Tap one to use it below.</AppText>
                <View style={styles.scenarios} accessibilityRole="radiogroup">
                  {scenarioPercents.map((value) => {
                    const scenario = savingsScenario(estimate, value)!;
                    const active = value === percent;
                    return (
                      <Pressable
                        key={value}
                        accessibilityRole="radio"
                        aria-checked={active}
                        accessibilityLabel={`${value}% less: about ${money(scenario.monthly)} a month, ${money(scenario.annual)} a year`}
                        onPress={() => updateSavings((current) => ({ ...current, reductionPercent: value }))}
                        style={({ pressed }) => [
                          styles.scenario,
                          stackScenarios && styles.scenarioStacked,
                          active && styles.chipSelected,
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <AppText variant="label" color={active ? colors.coralInk : colors.textPrimary} style={[styles.scenarioPercent, active && styles.bold]}>
                          {value}% less
                        </AppText>
                        <View style={[styles.scenarioValues, stackScenarios && styles.scenarioValuesStacked]}>
                          {/* The no-break space keeps "/ month" together, so a line only ever breaks before it. */}
                          <AppText variant="bodyStrong" align={stackScenarios ? 'left' : 'right'} style={styles.breakAnywhere}>
                            {money(scenario.monthly)} /{'\u00A0'}month
                          </AppText>
                          <AppText variant="caption" align={stackScenarios ? 'left' : 'right'} style={styles.breakAnywhere}>
                            {money(scenario.annual)} /{'\u00A0'}year
                          </AppText>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={styles.stepper}>
                  <StepButton
                    icon="minus"
                    label={`Lower the reduction by ${REDUCTION_STEP} percent`}
                    disabled={percent <= REDUCTION_STEP}
                    onPress={() => updateSavings((current) => ({ ...current, reductionPercent: clampReduction(current.reductionPercent - REDUCTION_STEP) }))}
                  />
                  <View style={styles.stepperValue} accessible accessibilityLiveRegion="polite" accessibilityLabel={`Your scenario: ${percent} percent less`}>
                    <AppText variant="caption" align="center">
                      Your scenario
                    </AppText>
                    <AppText variant="sectionTitle" align="center">
                      {percent}% less
                    </AppText>
                  </View>
                  <StepButton
                    icon="plus"
                    label={`Raise the reduction by ${REDUCTION_STEP} percent`}
                    disabled={percent >= 100}
                    onPress={() => updateSavings((current) => ({ ...current, reductionPercent: clampReduction(current.reductionPercent + REDUCTION_STEP) }))}
                  />
                </View>
                <AppText variant="caption" style={styles.note}>
                  This assumes you'd buy less in the same proportion. Logging fewer puffs doesn't necessarily mean buying less, so treat
                  these as rough projections, not guarantees.
                </AppText>
              </>
            ) : (
              <AppText variant="bodySmall">
                {estimate.status === 'zero'
                  ? 'With zero estimated spending, there are no savings to show.'
                  : 'Your potential savings will appear here once your spending estimate is ready.'}
              </AppText>
            )}
          </Card>

          <Card style={[styles.card, styles.compactCard]}>
            <AppText variant="cardTitle" accessibilityRole="header">
              Savings goal
            </AppText>
            <View style={styles.fields}>
              <TextField
                label="Goal (optional)"
                value={savings.goalName}
                onChange={(goalName) => updateSavings((current) => ({ ...current, goalName }))}
                placeholder="A trip, a gift, anything"
                maxLength={MAX_GOAL_NAME}
              />
              <NumberField
                label={fieldLabel(type, 'goalAmount')}
                value={savings.goalAmount}
                onChange={(goalAmount) => updateSavings((current) => ({ ...current, goalAmount }))}
                validate={validator('goalAmount')}
                suffix={currency}
              />
            </View>
            <View style={goal.status === 'ok' && selected ? styles.goalResult : null} accessibilityLiveRegion="polite">
              {goal.status === 'ok' && selected ? (
                <>
                  <AppText variant="headline" color={colors.textPrimary}>
                    {capitalize(formatDuration(goal.days))}
                  </AppText>
                  <AppText variant="bodySmall" color={colors.textPrimary}>
                    If you used {percent}% less, estimated savings of about {money(selected.monthly)} a month could reach{' '}
                    {savings.goalName.trim() ? `“${savings.goalName.trim()}” (${money(savings.goalAmount!)})` : money(savings.goalAmount!)} in{' '}
                    {formatDuration(goal.days)}.
                  </AppText>
                  <AppText variant="caption">This is a projection, not money you've already saved.</AppText>
                </>
              ) : (
                <AppText variant="bodySmall">
                  {goal.status === 'needsEstimate'
                    ? estimate.status === 'zero'
                      ? 'With zero estimated spending, there are no projected savings toward a goal.'
                      : 'Complete your spending details above to see how long your goal could take.'
                    : goal.status === 'needsAmount'
                      ? 'Add a target amount to see a timeline.'
                      : `At ${percent}% less, this goal would take more than 50 years to reach.`}
                </AppText>
              )}
            </View>
          </Card>
        </ProGate>

        <Card style={[styles.card, styles.compactCard]}>
          <AppText variant="cardTitle" accessibilityRole="header">
            Your logs, for context
          </AppText>
          <AppText variant="bodySmall" color={colors.textPrimary} style={styles.contextLine}>
            This week you've logged {pluralize(weekLogs, 'puff')}.
          </AppText>
          <AppText variant="caption" style={styles.note}>
            Puff counts aren't turned into money here. A puff isn't a fixed amount of product, so these estimates use only what you
            entered above.
          </AppText>
        </Card>

        <AppText variant="caption" align="center" style={styles.footnote}>
          Calculated and stored only on this device. Puphii never asks for bank or card details.
        </AppText>
      </ScrollView>

      <OptionSheet
        visible={currencyOpen}
        title="Currency"
        options={CURRENCIES.map((entry) => ({ value: entry.code, label: entry.code, detail: entry.name }))}
        value={currency}
        onSelect={(code) => {
          updateSavings((current) => ({ ...current, currency: code }));
          setCurrencyOpen(false);
        }}
        onClose={() => setCurrencyOpen(false)}
      />
    </View>
  );
}

/** Long amounts switch the grid to one column, and still wrap rather than truncate a figure. */
function AmountGrid({ amounts }: { amounts: [label: string, value: string][] }) {
  const long = amounts.some(([, value]) => value.length > 11);
  return (
    <View style={styles.grid}>
      {amounts.map(([label, value]) => (
        <View key={label} style={[styles.amount, long && styles.amountWide]} accessible accessibilityLabel={`${label}: about ${value}`}>
          <AppText variant="caption">{label}</AppText>
          <AppText variant="headline" style={[long && styles.amountSmall, styles.breakAnywhere]}>
            {value}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function StepButton({ icon, label, disabled, onPress }: { icon: 'minus' | 'plus'; label: string; disabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.step, disabled && styles.stepDisabled, pressed && { opacity: 0.6 }]}
    >
      <AppText variant="sectionTitle" align="center" style={styles.stepText}>
        {icon === 'minus' ? '−' : '+'}
      </AppText>
    </Pressable>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.skyBlue },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  flex: { flex: 1 },
  bold: { fontFamily: fontFamilies.bold },
  intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  introMascot: { width: 52, height: 52 },
  card: { marginTop: spacing.md, gap: spacing.md },
  resultCard: { marginTop: spacing.sm },
  messageCard: { paddingVertical: spacing.md, gap: spacing.xs },
  compactCard: { paddingVertical: spacing.md },
  // The currency button drops below the title rather than squeezing it onto two lines.
  cardHeader: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs },
  cardHeaderTitle: { flexGrow: 1, flexShrink: 0 },
  products: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  productChip: {
    flexGrow: 1,
    flexBasis: '45%',
    minHeight: TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  chipSelected: { backgroundColor: colors.peach, borderColor: colors.coralPink },
  currencyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 36,
    paddingLeft: spacing.sm + spacing.xxs,
    paddingRight: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  fields: { gap: spacing.md },
  basis: { gap: spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.md },
  amount: { width: '50%', paddingRight: spacing.sm },
  amountWide: { width: '100%' },
  amountSmall: { fontSize: 17, lineHeight: 24 },
  // iOS already breaks an over-long word mid-word; the web needs this to do the same.
  breakAnywhere: Platform.OS === 'web' ? ({ overflowWrap: 'anywhere' } as TextStyle) : {},
  note: { marginTop: spacing.xs },
  scenarios: { gap: spacing.sm },
  scenario: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 56,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  scenarioPercent: { width: 76 },
  scenarioValues: { flex: 1, minWidth: 0 },
  scenarioStacked: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.xxs },
  scenarioValuesStacked: { flex: 0 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  stepperValue: { flex: 1 },
  step: {
    width: TOUCH_TARGET,
    height: TOUCH_TARGET,
    borderRadius: TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
    borderWidth: 1.5,
    borderColor: colors.oceanBlue,
  },
  stepDisabled: { opacity: 0.35 },
  stepText: { lineHeight: 26 },
  goalResult: { gap: spacing.xs, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.skyBlue },
  contextLine: { marginTop: -spacing.xs },
  footnote: { marginTop: spacing.xl, paddingHorizontal: spacing.lg },
});
