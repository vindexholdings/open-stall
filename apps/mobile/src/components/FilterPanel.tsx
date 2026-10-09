import { clearFilter, DEFAULT_FILTERS, describeActiveFilters, type LocationFilters } from '@open-stall/domain';
import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from './Chip';
import { useFocusStyle } from './focus';

const METERS_PER_MILE = 1609.344;
const RADIUS_MILES = [1, 2, 5, 10, 25];
const RATINGS: (number | null)[] = [null, 3, 4];

type Props = { filters: LocationFilters; onChange: (next: LocationFilters) => void };

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
      <Text style={styles.removableText}>{`${label}  ✕`}</Text>
    </Pressable>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={title}>
      <Text style={styles.groupTitle}>{title}</Text>
      <View style={styles.row}>{children}</View>
    </View>
  );
}

export function FilterPanel({ filters, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const activeList = describeActiveFilters(filters);
  const active = activeList.length;
  const set = (patch: Partial<LocationFilters>) => onChange({ ...filters, ...patch });

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Chip
          label={open ? 'Hide filters' : active ? `Filters (${active})` : 'Filters'}
          accessibilityLabel={open ? 'Hide filters' : active ? `Show filters, ${active} active` : 'Show filters'}
          expanded={open}
          selected={open}
          onPress={() => setOpen((v) => !v)}
        />
        {active > 0 ? <Chip label="Clear all" accessibilityLabel="Clear all filters" selected={false} onPress={() => onChange(DEFAULT_FILTERS)} /> : null}
      </View>
      {active > 0 ? (
        <View role="list" aria-label="Active filters" style={styles.row}>
          {activeList.map((a) => (
            <View key={a.key} role="listitem">
              <RemovableChip label={a.label} onRemove={() => onChange(clearFilter(filters, a.key))} />
            </View>
          ))}
        </View>
      ) : null}
      {open ? (
        <>
          <Group title="Distance">
            {RADIUS_MILES.map((mi) => (
              <Chip
                key={mi}
                role="radio"
                label={`${mi} mi`}
                selected={Math.round(filters.radiusMeters) === Math.round(mi * METERS_PER_MILE)}
                onPress={() => set({ radiusMeters: mi * METERS_PER_MILE })}
              />
            ))}
          </Group>
          <Group title="Rating">
            {RATINGS.map((r) => (
              <Chip
                key={String(r)}
                role="radio"
                label={r === null ? 'Any rating' : `${r}+`}
                selected={filters.minRating === r}
                onPress={() => set({ minRating: r })}
              />
            ))}
          </Group>
          <View style={styles.group} role="group" aria-label="Features">
            <Text style={styles.groupTitle}>Features</Text>
            <View style={styles.row}>
              <Chip label="Verified only" selected={filters.verifiedOnly} onPress={() => set({ verifiedOnly: !filters.verifiedOnly })} />
              <Chip label="Wheelchair accessible" selected={filters.wheelchairAccessible} onPress={() => set({ wheelchairAccessible: !filters.wheelchairAccessible })} />
              <Chip label="Gender-neutral" selected={filters.genderNeutral} onPress={() => set({ genderNeutral: !filters.genderNeutral })} />
              <Chip label="Baby changing" selected={filters.babyChanging} onPress={() => set({ babyChanging: !filters.babyChanging })} />
              <Chip label="Hot water" selected={filters.hotWater} onPress={() => set({ hotWater: !filters.hotWater })} />
              <Chip label="Cold water only" selected={filters.coldWaterOnly} onPress={() => set({ coldWaterOnly: !filters.coldWaterOnly })} />
            </View>
          </View>
          <Group title="Key">
            <Chip role="radio" label="Any" selected={filters.key === 'any'} onPress={() => set({ key: 'any' })} />
            <Chip role="radio" label="No key needed" selected={filters.key === 'not_required'} onPress={() => set({ key: 'not_required' })} />
            <Chip role="radio" label="Key required" selected={filters.key === 'required'} onPress={() => set({ key: 'required' })} />
          </Group>
          <Group title="Purchase">
            <Chip role="radio" label="Any" selected={filters.purchase === 'any'} onPress={() => set({ purchase: 'any' })} />
            <Chip role="radio" label="Free" selected={filters.purchase === 'free'} onPress={() => set({ purchase: 'free' })} />
            <Chip role="radio" label="Purchase required" selected={filters.purchase === 'required'} onPress={() => set({ purchase: 'required' })} />
          </Group>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceMuted,
  },
  group: { gap: spacing.sm },
  groupTitle: { ...typography.label, color: colors.textMuted },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  removable: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.primaryStrong,
  },
  removableText: { ...typography.label, color: colors.onPrimaryStrong },
});
