import React from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme';
import { AppText } from './AppText';
import { DialogButton } from './Buttons';

type Props = {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** `primary` for consequential changes that delete nothing. */
  confirmTone?: 'destructive' | 'primary';
};

/** Cross-platform confirmation (Alert.alert buttons are not supported on web). */
export function ConfirmDialog({ visible, title, message, confirmLabel, onConfirm, onCancel, confirmTone = 'destructive' }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onCancel} accessibilityLabel="Dismiss" accessibilityRole="button">
        <Pressable style={[styles.card, shadows.card]} onPress={() => undefined} accessibilityViewIsModal>
          <AppText variant="headline" accessibilityRole="header">
            {title}
          </AppText>
          <AppText variant="body" style={styles.message}>
            {message}
          </AppText>
          <View style={styles.actions}>
            <DialogButton label="Cancel" onPress={onCancel} />
            <DialogButton label={confirmLabel} tone={confirmTone} onPress={onConfirm} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: colors.warmCream,
    borderRadius: radii.xl,
    padding: spacing.xxl,
  },
  message: { marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl },
});
