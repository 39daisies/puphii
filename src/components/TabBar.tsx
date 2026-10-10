import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radii, spacing } from '../theme';
import { AppText } from './AppText';
import { Icon, IconName } from './Icon';

export type TabKey = 'home' | 'insights' | 'you';

const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'home', label: 'Home', icon: 'home' },
  { key: 'insights', label: 'Insights', icon: 'history' },
  { key: 'you', label: 'You', icon: 'user' },
];

export function TabBar({ active, onChange }: { active: TabKey; onChange: (tab: TabKey) => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityRole="tablist" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
      {TABS.map((tab) => {
        const selected = tab.key === active;
        return (
          <Pressable
            key={tab.key}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            aria-selected={selected}
            onPress={() => onChange(tab.key)}
            style={({ pressed }) => [styles.item, pressed && { opacity: 0.7 }]}
          >
            <View style={[styles.iconPill, selected && styles.iconPillActive]}>
              <Icon
                name={tab.icon}
                size={24}
                color={selected ? colors.coralDeep : colors.textMuted}
                fill={selected ? colors.coralPink : 'none'}
                strokeWidth={selected ? 2.1 : 1.8}
              />
            </View>
            <AppText variant={selected ? 'tabActive' : 'tab'}>{tab.label}</AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.warmCream,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.borderStrong,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  item: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 52, gap: 2 },
  iconPill: { paddingHorizontal: spacing.lg, paddingVertical: 3, borderRadius: radii.pill },
  iconPillActive: { backgroundColor: colors.peach },
});
