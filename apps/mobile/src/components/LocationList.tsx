import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';

export type LocationListItem = {
  id: string;
  name: string;
  subtitle?: string;
  distanceLabel?: string;
};

type Props = { items: LocationListItem[]; onSelect?: (id: string) => void; emptyMessage: string };

export function LocationList({ items, onSelect, emptyMessage }: Props) {
  if (items.length === 0) {
    return <Text style={styles.empty}>{emptyMessage}</Text>;
  }
  return (
    <View accessibilityRole="list" style={styles.list}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityLabel={[item.name, item.distanceLabel, item.subtitle].filter(Boolean).join(', ')}
          onPress={() => onSelect?.(item.id)}
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}
        >
          <View style={styles.text}>
            <Text style={styles.name}>{item.name}</Text>
            {item.subtitle ? <Text style={styles.subtitle}>{item.subtitle}</Text> : null}
          </View>
          {item.distanceLabel ? <Text style={styles.distance}>{item.distanceLabel}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  row: {
    minHeight: touchTarget.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: { backgroundColor: colors.surfaceMuted },
  text: { flex: 1, gap: spacing.xs },
  name: { ...typography.heading, color: colors.text },
  subtitle: { ...typography.body, color: colors.textMuted },
  distance: { ...typography.label, color: colors.primaryStrong },
  empty: { ...typography.body, color: colors.textMuted },
});
