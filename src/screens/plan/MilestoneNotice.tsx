import React, { useEffect } from 'react';
import { AccessibilityInfo, Image, Pressable, StyleSheet, View } from 'react-native';
import { AppText } from '../../components/AppText';
import { IconButton } from '../../components/Buttons';
import { Card } from '../../components/Card';
import { Icon } from '../../components/Icon';
import { FACES } from '../../mascot/faces';
import { MILESTONE_NOTICE_DISMISS, MILESTONE_NOTICE_HINT, milestoneNotice } from '../../plan/copy';
import { MilestoneId } from '../../plan/model';
import { colors, spacing } from '../../theme';

/** Milestones already announced to a screen reader this session, so revisiting Home stays quiet. */
const announced = new Set<MilestoneId>();

type Props = {
  ids: readonly MilestoneId[];
  onOpen: () => void;
  onDismiss: () => void;
};

/**
 * A quiet note for milestones earned since they were last acknowledged. It stays until it is
 * dismissed here or the milestones are seen in Your Plan, and then never appears for them again.
 * Static, like the rest of the plan screens, so there is no motion for Reduce Motion to remove.
 */
export function MilestoneNotice({ ids, onOpen, onDismiss }: Props) {
  const notice = milestoneNotice(ids);

  const key = ids.join(',');
  useEffect(() => {
    const fresh = key.split(',').filter((id) => !announced.has(id as MilestoneId));
    if (!fresh.length) return;
    fresh.forEach((id) => announced.add(id as MilestoneId));
    AccessibilityInfo.announceForAccessibility(notice.spoken);
  }, [key, notice.spoken]);

  return (
    <Card style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={notice.spoken}
        accessibilityHint={MILESTONE_NOTICE_HINT}
        onPress={onOpen}
        style={({ pressed }) => [styles.main, pressed && { opacity: 0.6 }]}
      >
        <Image source={FACES.happy} style={styles.mascot} resizeMode="contain" accessible={false} />
        <View style={styles.text}>
          <AppText variant="label" color={colors.textMuted}>
            {notice.label}
          </AppText>
          <AppText variant="cardTitle">{notice.title}</AppText>
          <AppText variant="caption">{notice.detail}</AppText>
        </View>
        <Icon name="chevronRight" size={18} color={colors.textPrimary} />
      </Pressable>
      <IconButton icon="close" accessibilityLabel={MILESTONE_NOTICE_DISMISS} onPress={onDismiss} size={20} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.sm, paddingLeft: spacing.md, paddingRight: spacing.xs },
  main: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 44, paddingVertical: spacing.xs },
  mascot: { width: 44, height: 44 },
  text: { flex: 1, gap: 2 },
});
