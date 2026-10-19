import React, { useEffect } from 'react';
import { AccessibilityInfo, Image, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { IconButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { SkipMilestoneId, skipMilestoneDetail, skipMilestoneTitle } from '../../data/skipMilestones';
import { FACES } from '../../mascot/faces';
import { colors, spacing } from '../../theme';

/** Skip milestones already announced this session, so revisiting Home stays quiet. */
const announced = new Set<SkipMilestoneId>();

type Props = {
  ids: readonly SkipMilestoneId[];
  onDismiss: () => void;
};

/**
 * Quiet positive note for cumulative skip milestones. Dismissing marks them seen so they
 * never celebrate again after restart. Does not open the plan or change puff targets.
 */
export function SkipMilestoneNotice({ ids, onDismiss }: Props) {
  const latest = ids[ids.length - 1];
  const title = skipMilestoneTitle(latest);
  const detail = skipMilestoneDetail(latest);
  const spoken =
    ids.length === 1
      ? `${title}. ${detail}`
      : `${ids.length} skip milestones reached. ${title}. ${detail}`;

  const key = ids.join(',');
  useEffect(() => {
    const fresh = key.split(',').filter((id) => !announced.has(id as SkipMilestoneId));
    if (!fresh.length) return;
    fresh.forEach((id) => announced.add(id as SkipMilestoneId));
    AccessibilityInfo.announceForAccessibility(spoken);
  }, [key, spoken]);

  return (
    <Card style={styles.card}>
      <Image source={FACES.happy} style={styles.mascot} resizeMode="contain" accessible={false} />
      <View style={styles.text} accessible accessibilityLabel={spoken}>
        <AppText variant="label" color={colors.textMuted}>
          Skip milestone
        </AppText>
        <AppText variant="cardTitle">{title}</AppText>
        <AppText variant="caption">{detail}</AppText>
      </View>
      <IconButton icon="close" accessibilityLabel="Dismiss skip milestone" onPress={onDismiss} size={20} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    borderColor: colors.seafoam,
  },
  mascot: { width: 44, height: 44 },
  text: { flex: 1, gap: 2 },
});
