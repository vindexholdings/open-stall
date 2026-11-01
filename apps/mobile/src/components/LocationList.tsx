import { colors, radii, shadows, spacing, tiles, touchTarget, typography } from '@open-stall/ui';
import type { VerificationBadge as Badge } from '@open-stall/domain';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { enterActivates, useFocusStyle } from './focus';
import { VerificationBadge } from './VerificationBadge';

export type LocationListItem = {
  id: string;
  name: string;
  subtitle?: string;
  /** Combined label, e.g. "0.35 mi straight-line". Used when `distance` is not provided (Favorites). */
  distanceLabel?: string;
  /** Prominent straight-line distance (e.g. "0.35 mi"). It is never shown as a walking or driving time. */
  distance?: string;
  badge: Badge;
  /** Known facts only (see quickFacts); unknown facts are never listed as negatives. */
  facts?: string[];
  /** "Community rating 4.2 / 5 (12 ratings)" or undefined when unrated. */
  ratingText?: string;
  /** Short emphasis label such as "Nearest". Text, not color alone. */
  tag?: string;
};

type Props = { items: LocationListItem[]; onSelect?: (id: string) => void; /** When given, each card shows a destination-only Directions button. */ onDirections?: (id: string) => void; emptyMessage: string };

/**
 * A scannable result: name and distance first, then verification and the community rating (or an honest "Not rated yet"),
 * then the known access facts, then Directions. The card body is ONE link to the details; Directions is a separate button
 * beside it (a control must not sit inside a link).
 */
function Card({ item, onSelect, onDirections }: { item: LocationListItem; onSelect?: (id: string) => void; onDirections?: (id: string) => void }) {
  const focus = useFocusStyle();
  const dirFocus = useFocusStyle();
  const spoken = [
    item.tag,
    item.name,
    item.badge.label,
    item.distance ? `${item.distance} straight-line` : item.distanceLabel,
    item.subtitle,
    item.facts?.join(', '),
    item.ratingText ?? 'Not rated yet',
  ].filter(Boolean).join('. ');
  const accent = item.badge.kind === 'verified' ? colors.status.verified.fg : colors.status.unverified.fg;
  return (
    <View style={[styles.card, { borderLeftColor: accent }, item.tag ? styles.top : null]}>
      <Pressable
        accessibilityRole="link"
        accessibilityLabel={spoken}
        accessibilityHint="Opens restroom details."
        onPress={() => onSelect?.(item.id)}
        {...enterActivates(() => onSelect?.(item.id))}
        {...focus.handlers}
        style={({ pressed }) => [styles.body, pressed && styles.pressed, focus.style]}
      >
        <View style={styles.head}>
          <View style={styles.titleBlock}>
            {item.tag ? <Text style={styles.tag}>{item.tag}</Text> : null}
            <Text accessibilityRole="header" aria-level={2} style={styles.name}>{item.name}</Text>
          </View>
          {item.distance ? (
            <View style={styles.distanceBlock}>
              <View style={styles.distancePill}>
                <Icon name="pin" size={14} color={tiles.blue.fg} inner={tiles.blue.bg} />
                <Text style={styles.distance}>{item.distance}</Text>
              </View>
            </View>
          ) : item.distanceLabel ? (
            <Text style={styles.distanceInline}>{item.distanceLabel}</Text>
          ) : null}
        </View>
        <View style={styles.meta}>
          <VerificationBadge badge={item.badge} />
          <View style={styles.ratingLine}>
            {item.ratingText ? <Icon name="star" size={14} color={colors.text} /> : null}
            <Text style={[styles.rating, !item.ratingText && styles.unrated]}>{item.ratingText ?? 'Not rated yet'}</Text>
          </View>
        </View>
        {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}
        {item.facts && item.facts.length > 0 ? (
          <View style={styles.facts}>
            {item.facts.map((f) => (
              <Text key={f} style={styles.fact}>{f}</Text>
            ))}
          </View>
        ) : null}
      </Pressable>
      {onDirections && item.distance ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Directions to ${item.name}`}
          accessibilityHint="Opens a maps app with directions to this restroom."
          onPress={() => onDirections(item.id)}
          {...dirFocus.handlers}
          style={({ pressed }) => [styles.directions, pressed && styles.pressed, dirFocus.style]}
        >
          <Icon name="navigate" size={16} color={colors.primaryStrong} />
          <Text style={styles.directionsText}>Directions</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function LocationList({ items, onSelect, onDirections, emptyMessage }: Props) {
  if (items.length === 0) {
    return <Text style={styles.empty}>{emptyMessage}</Text>;
  }
  return (
    <View role="list" style={styles.list}>
      {items.map((item) => (
        <View key={item.id} role="listitem">
          <Card item={item} onSelect={onSelect} onDirections={onDirections} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  card: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderLeftWidth: 6,
    borderColor: colors.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  top: { borderColor: colors.primaryStrong, borderWidth: 2, borderLeftWidth: 6 },
  body: { gap: spacing.xs + 2, padding: spacing.sm + 4, minHeight: touchTarget.primary },
  pressed: { backgroundColor: colors.surfaceMuted },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  titleBlock: { flex: 1, minWidth: 0, gap: 2 },
  tag: { ...typography.label, fontSize: 12, lineHeight: 16, color: colors.primaryStrong, textTransform: 'uppercase', letterSpacing: 0.5 },
  name: { ...typography.heading, fontSize: 18, lineHeight: 23, color: colors.text },
  distanceBlock: { alignItems: 'flex-end' },
  distancePill: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: tiles.blue.bg, borderRadius: radii.pill, paddingHorizontal: spacing.sm, paddingVertical: 2 },
  distance: { ...typography.heading, fontSize: 17, lineHeight: 22, color: colors.primaryStrong },
  ratingLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  distanceInline: { ...typography.label, color: colors.primaryStrong },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: spacing.sm, rowGap: spacing.xs },
  subtitle: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs + 2 },
  fact: {
    ...typography.label,
    fontWeight: '500',
    color: colors.text,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
  rating: { ...typography.label, fontWeight: '500', color: colors.text },
  unrated: { fontWeight: '400', color: colors.textMuted },
  directions: { minHeight: touchTarget.min, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs + 2, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border, backgroundColor: tiles.blue.bg },
  directionsText: { ...typography.label, fontSize: 15, color: colors.primaryStrong },
  empty: { ...typography.body, color: colors.textMuted },
});
