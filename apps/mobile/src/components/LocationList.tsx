import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import type { VerificationBadge as Badge } from '@open-stall/domain';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { enterActivates, useFocusStyle } from './focus';
import { VerificationBadge } from './VerificationBadge';

export type LocationListItem = {
  id: string;
  name: string;
  subtitle?: string;
  /** Combined label, e.g. "0.3 mi · ~4 min walk". Used when `distance` is not provided (Favorites). */
  distanceLabel?: string;
  /** Prominent distance (e.g. "0.3 mi") and secondary travel estimate (e.g. "~4 min walk"). */
  distance?: string;
  travel?: string;
  badge: Badge;
  /** Known facts only (see quickFacts); unknown facts are never listed as negatives. */
  facts?: string[];
  /** "Community rating 4.2 / 5 (12 ratings)" or undefined when unrated. */
  ratingText?: string;
  /** Short emphasis label such as "Nearest". Text, not color alone. */
  tag?: string;
};

type Props = { items: LocationListItem[]; onSelect?: (id: string) => void; emptyMessage: string };

function Card({ item, onSelect }: { item: LocationListItem; onSelect?: (id: string) => void }) {
  const focus = useFocusStyle();
  const spoken = [
    item.tag,
    item.name,
    item.badge.label,
    item.distance ? `${item.distance}, ${item.travel ?? ''}`.replace(/, $/, '') : item.distanceLabel,
    item.subtitle,
    item.facts?.join(', '),
    item.ratingText,
  ].filter(Boolean).join('. ');
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={spoken}
      accessibilityHint="Opens restroom details."
      onPress={() => onSelect?.(item.id)}
      {...enterActivates(() => onSelect?.(item.id))}
      {...focus.handlers}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, item.tag ? styles.top : null, focus.style]}
    >
      <View style={styles.head}>
        <View style={styles.titleBlock}>
          {item.tag ? <Text style={styles.tag}>{item.tag}</Text> : null}
          <Text accessibilityRole="header" aria-level={2} style={styles.name}>{item.name}</Text>
        </View>
        {item.distance ? (
          <View style={styles.distanceBlock}>
            <Text style={styles.distance}>{item.distance}</Text>
            {item.travel ? <Text style={styles.travel}>{item.travel}</Text> : null}
          </View>
        ) : item.distanceLabel ? (
          <Text style={styles.distanceInline}>{item.distanceLabel}</Text>
        ) : null}
      </View>
      <VerificationBadge badge={item.badge} />
      {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}
      {item.facts && item.facts.length > 0 ? (
        <View style={styles.facts}>
          {item.facts.map((f) => (
            <Text key={f} style={styles.fact}>{f}</Text>
          ))}
        </View>
      ) : null}
      {item.ratingText ? <Text style={styles.rating}>{item.ratingText}</Text> : null}
    </Pressable>
  );
}

export function LocationList({ items, onSelect, emptyMessage }: Props) {
  if (items.length === 0) {
    return <Text style={styles.empty}>{emptyMessage}</Text>;
  }
  return (
    <View role="list" style={styles.list}>
      {items.map((item) => (
        <View key={item.id} role="listitem">
          <Card item={item} onSelect={onSelect} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: {
    minHeight: touchTarget.primary,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  top: { borderColor: colors.primaryStrong, borderWidth: 2 },
  pressed: { backgroundColor: colors.surfaceMuted },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  titleBlock: { flex: 1, gap: spacing.xs },
  tag: { ...typography.label, color: colors.primaryStrong, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { ...typography.heading, color: colors.text },
  distanceBlock: { alignItems: 'flex-end' },
  distance: { ...typography.heading, color: colors.primaryStrong },
  travel: { ...typography.label, color: colors.textMuted },
  distanceInline: { ...typography.label, color: colors.primaryStrong },
  subtitle: { ...typography.body, color: colors.textMuted },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  fact: {
    ...typography.label,
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  rating: { ...typography.label, color: colors.textMuted },
  empty: { ...typography.body, color: colors.textMuted },
});
