import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors } from '../theme';
import { AppText } from './AppText';
import { Icon } from './Icon';

export function Wordmark({ size = 36 }: { size?: number }) {
  return (
    <View accessible accessibilityRole="header" accessibilityLabel="Puphii" style={styles.row}>
      <AppText variant="wordmark" style={{ fontSize: size, lineHeight: size * 1.18 }}>
        Puphii
      </AppText>
      <View style={[styles.heart, { top: -size * 0.12, right: -size * 0.3 }]}>
        <Icon name="heart" size={size * 0.36} color={colors.coralDeep} fill={colors.coralPink} strokeWidth={1.8} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  heart: { position: 'absolute', transform: [{ rotate: '14deg' }] },
});
