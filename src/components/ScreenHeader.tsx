import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing, TOUCH_TARGET } from '../theme';
import { AppText } from './AppText';
import { IconButton } from './Buttons';

export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <View style={styles.row}>
      <View style={styles.side}>
        {onBack ? <IconButton icon="chevronLeft" accessibilityLabel="Back" onPress={onBack} color={colors.textPrimary} /> : null}
      </View>
      <AppText variant="screenTitle" align="center" accessibilityRole="header" style={styles.title} numberOfLines={1}>
        {title}
      </AppText>
      <View style={styles.side} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.lg },
  side: { width: TOUCH_TARGET },
  title: { flex: 1 },
});
