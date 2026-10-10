import React, { useState } from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppText } from '../components/AppText';
import { Card } from '../components/Card';
import { Icon } from '../components/Icon';
import { ScreenHeader } from '../components/ScreenHeader';
import { LEARN_TOPICS, LearnTopic } from '../content/learn';
import { FACES } from '../mascot/faces';
import { colors, MAX_CONTENT_WIDTH, radii, spacing } from '../theme';

export function LearnScreen({ header }: { header?: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const [openId, setOpenId] = useState<string | null>(LEARN_TOPICS[0].id);

  return (
    <View style={styles.root}>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: insets.top }]} showsVerticalScrollIndicator={false}>
        {header ?? <ScreenHeader title="Learn" />}

        <View style={styles.intro}>
          <Image source={FACES.curious} style={styles.introMascot} resizeMode="contain" accessible={false} />
          <View style={styles.introText}>
            <AppText variant="headline">Small reads, real sources.</AppText>
            <AppText variant="bodySmall">General information about smoking and vaping from public-health organizations.</AppText>
          </View>
        </View>

        <View style={styles.list}>
          {LEARN_TOPICS.map((topic, index) => (
            <TopicCard
              key={topic.id}
              topic={topic}
              index={index}
              open={openId === topic.id}
              onToggle={() => setOpenId((current) => (current === topic.id ? null : topic.id))}
            />
          ))}
        </View>

        <View style={styles.note}>
          <Icon name="info" size={20} color={colors.deepOcean} />
          <AppText variant="bodySmall" style={styles.noteText}>
            This is general information, not medical advice. Puphii doesn't diagnose anything or predict health outcomes, and
            its faces are playful feedback, not a health measurement. For personal advice, talk to a healthcare professional.
          </AppText>
        </View>
      </ScrollView>
    </View>
  );
}

function TopicCard({ topic, index, open, onToggle }: { topic: LearnTopic; index: number; open: boolean; onToggle: () => void }) {
  return (
    <Card style={[styles.card, open && styles.cardOpen]}>
      <Pressable
        accessibilityRole="button"
        aria-expanded={open}
        accessibilityHint={open ? 'Collapses this topic' : 'Expands this topic'}
        onPress={onToggle}
        style={styles.cardHeader}
      >
        <View style={styles.badge}>
          <AppText variant="headline" color={colors.coralInk} style={styles.badgeText}>
            {index + 1}
          </AppText>
        </View>
        <View style={styles.headerText}>
          <AppText variant="cardTitle">{topic.title}</AppText>
          <AppText variant="bodySmall">{topic.summary}</AppText>
        </View>
        <View style={{ transform: [{ rotate: open ? '180deg' : '0deg' }] }}>
          <Icon name="chevronDown" size={22} color={colors.textMuted} />
        </View>
      </Pressable>

      {open ? (
        <View style={styles.body}>
          {topic.points.map((point) => (
            <View key={point} style={styles.point}>
              <View style={styles.bullet} />
              <AppText variant="body" style={styles.pointText}>
                {point}
              </AppText>
            </View>
          ))}
          <AppText variant="overline" style={styles.sourcesLabel}>
            SOURCES
          </AppText>
          {topic.sources.map((source) => (
            <Pressable
              key={source.url}
              accessibilityRole="link"
              accessibilityLabel={`${source.label}, opens in browser`}
              onPress={() => Linking.openURL(source.url).catch(() => undefined)}
              style={({ pressed }) => [styles.source, pressed && { opacity: 0.6 }]}
            >
              <AppText variant="label" color={colors.deepOcean} style={styles.sourceText}>
                {source.label}
              </AppText>
              <Icon name="external" size={18} color={colors.deepOcean} />
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.skyBlue },
  content: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  intro: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  introMascot: { width: 84, height: 84 },
  introText: { flex: 1, gap: spacing.xs },
  list: { marginTop: spacing.lg, gap: spacing.md },
  card: { padding: spacing.md },
  cardOpen: { borderColor: colors.coralPink },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: 48 },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 20, lineHeight: 24 },
  headerText: { flex: 1, gap: 2 },
  body: { marginTop: spacing.md, paddingTop: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong, gap: spacing.sm },
  point: { flexDirection: 'row', gap: spacing.sm },
  bullet: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.coralDeep, marginTop: 8 },
  pointText: { flex: 1, color: colors.textPrimary },
  sourcesLabel: { marginTop: spacing.sm },
  source: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.skyBlue,
    borderRadius: radii.md,
  },
  sourceText: { flex: 1, textDecorationLine: 'underline' },
  note: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xxl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
  },
  noteText: { flex: 1 },
});
