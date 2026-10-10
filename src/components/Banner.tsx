import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radii, spacing } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './Buttons';
import { Icon } from './Icon';

export function Banner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <Icon name="info" size={20} color={colors.coralInk} />
      <AppText variant="bodySmall" color={colors.coralInk} style={styles.text}>
        {message}
      </AppText>
      {onDismiss ? <IconButton icon="check" accessibilityLabel="Dismiss message" onPress={onDismiss} color={colors.coralInk} size={20} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.peach,
    borderColor: colors.coralPink,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingLeft: spacing.md,
    paddingVertical: spacing.xs,
  },
  text: { flex: 1, paddingVertical: spacing.sm },
});
