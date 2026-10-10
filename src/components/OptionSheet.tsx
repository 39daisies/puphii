import React from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme';
import { AppText } from './AppText';
import { DialogButton } from './Buttons';
import { Icon } from './Icon';

type Option = { value: string; label: string; detail?: string };

type Props = {
  visible: boolean;
  title: string;
  options: readonly Option[];
  value: string;
  onSelect: (value: string) => void;
  onClose: () => void;
};

/** A cross-platform single-choice list in a dialog. */
export function OptionSheet({ visible, title, options, value, onSelect, onClose }: Props) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Dismiss" accessibilityRole="button">
        <Pressable style={[styles.card, shadows.card]} onPress={() => undefined} accessibilityViewIsModal>
          <AppText variant="headline" accessibilityRole="header">
            {title}
          </AppText>
          <ScrollView style={styles.list} accessibilityRole="radiogroup">
            {options.map((option) => {
              const selected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  accessibilityRole="radio"
                  aria-checked={selected}
                  accessibilityLabel={option.detail ? `${option.label}, ${option.detail}` : option.label}
                  onPress={() => onSelect(option.value)}
                  style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && { opacity: 0.7 }]}
                >
                  <AppText variant="label" style={styles.code}>
                    {option.label}
                  </AppText>
                  <AppText variant="bodySmall" style={styles.flex} numberOfLines={1}>
                    {option.detail}
                  </AppText>
                  {selected ? <Icon name="check" size={20} color={colors.coralInk} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.actions}>
            <DialogButton label="Done" onPress={onClose} />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.scrim, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  card: {
    width: '100%',
    maxWidth: 380,
    maxHeight: '80%',
    backgroundColor: colors.warmCream,
    borderRadius: radii.xl,
    padding: spacing.xl,
  },
  list: { marginTop: spacing.md, flexGrow: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 48,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  rowSelected: { backgroundColor: colors.peach, borderColor: colors.coralPink },
  code: { width: 44 },
  flex: { flex: 1 },
  actions: { flexDirection: 'row', marginTop: spacing.lg },
});
