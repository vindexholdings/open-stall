import { clearFilter, DEFAULT_FILTERS, describeActiveFilters, type LocationFilters } from '@open-stall/domain';
import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from './Chip';
import { FilterSheet } from './FilterSheet';
import { Icon } from './Icon';
import { useFocusStyle } from './focus';

type Props = {
  /** The APPLIED filters. */
  filters: LocationFilters;
  onChange: (next: LocationFilters) => void;
  /** Whether the filter sheet is open. The opener (the Filters button beside the search field) lives in the parent. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function RemovableChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  const focus = useFocusStyle();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Remove filter: ${label}`}
      onPress={onRemove}
      {...focus.handlers}
      style={[styles.removable, focus.style]}
    >
      <Text style={styles.removableText}>{label}</Text>
      <Icon name="close" size={14} color={colors.primaryStrong} />
    </Pressable>
  );
}

/**
 * What is narrowing the list, always visible: one removable chip per applied filter plus "Clear all". Choosing filters
 * happens in the {@link FilterSheet} (a dialog); applying it replaces the applied filters in one step.
 */
export function FilterPanel({ filters, onChange, open, onOpenChange }: Props) {
  const activeList = describeActiveFilters(filters);
  return (
    <>
      {activeList.length > 0 ? (
        <View style={styles.card}>
          <View style={styles.row}>
            <View role="list" aria-label="Active filters" style={styles.chips}>
              {activeList.map((a) => (
                <View key={a.key} role="listitem">
                  <RemovableChip label={a.label} onRemove={() => onChange(clearFilter(filters, a.key))} />
                </View>
              ))}
            </View>
            <Chip role="button" label="Clear all" accessibilityLabel="Clear all filters" onPress={() => onChange(DEFAULT_FILTERS)} />
          </View>
        </View>
      ) : null}
      <FilterSheet
        visible={open}
        applied={filters}
        onApply={(next) => {
          onChange(next);
          onOpenChange(false);
        }}
        onDismiss={() => onOpenChange(false)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surfaceMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  // flexShrink lets the chips wrap inside the row (without it a long second chip runs off the screen)
  chips: { flexShrink: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  removable: {
    minHeight: touchTarget.min,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryStrong,
  },
  removableText: { ...typography.label, color: colors.onPrimaryStrong },
});
