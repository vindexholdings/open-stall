import { clearFilter, DEFAULT_FILTERS, describeActiveFilters, type LocationFilters } from '@open-stall/domain';
import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Chip } from './Chip';
import { Icon } from './Icon';
import { RadioGroup } from './RadioGroup';
import { useFocusStyle } from './focus';

const METERS_PER_MILE = 1609.344;
const RADIUS_MILES = [1, 2, 5, 10, 25];
const RATINGS: (number | null)[] = [null, 3, 4];

type Props = {
  filters: LocationFilters;
  onChange: (next: LocationFilters) => void;
  /** Optional control from the parent (the dashboard's Filters quick action). Uncontrolled when omitted. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
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

function Group<T>({ title, options, value, onChange }: { title: string; options: readonly { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      <RadioGroup label={title} options={options} value={value} onChange={onChange} />
    </View>
  );
}
const KEY_OPTIONS = [
  { value: 'any', label: 'Any' }, { value: 'not_required', label: 'No key needed' }, { value: 'required', label: 'Key required' },
] as const;
const PURCHASE_OPTIONS = [
  { value: 'any', label: 'Any' }, { value: 'free', label: 'No purchase needed' }, { value: 'required', label: 'Purchase required' },
] as const;
const RADIUS_OPTIONS = RADIUS_MILES.map((mi) => ({ value: mi * METERS_PER_MILE, label: `${mi} mi` }));
const RATING_OPTIONS = RATINGS.map((r) => ({ value: r, label: r === null ? 'Any rating' : `${r}+` }));

export function FilterPanel({ filters, onChange, open: controlledOpen, onOpenChange }: Props) {
  const [innerOpen, setInnerOpen] = useState(false);
  const open = controlledOpen ?? innerOpen;
  const setOpen = (next: boolean | ((v: boolean) => boolean)) => {
    const value = typeof next === 'function' ? next(open) : next;
    if (controlledOpen === undefined) setInnerOpen(value);
    onOpenChange?.(value);
  };
  const activeList = describeActiveFilters(filters);
  const active = activeList.length;
  const set = (patch: Partial<LocationFilters>) => onChange({ ...filters, ...patch });

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Chip
          label={open ? 'Hide filters' : active ? `Filters (${active})` : 'Filters'}
          accessibilityLabel={open ? 'Hide filters' : active ? `Show filters, ${active} active` : 'Show filters'}
          role="button"
          expanded={open}
          emphasized={open}
          onPress={() => setOpen((v) => !v)}
        />
        {active > 0 ? <Chip role="button" label="Clear all" accessibilityLabel="Clear all filters" onPress={() => onChange(DEFAULT_FILTERS)} /> : null}
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
          <Group
            title="Distance"
            options={RADIUS_OPTIONS}
            value={RADIUS_OPTIONS.find((o) => Math.round(o.value) === Math.round(filters.radiusMeters))?.value ?? -1}
            onChange={(v) => set({ radiusMeters: v })}
          />
          <Group title="Rating" options={RATING_OPTIONS} value={filters.minRating} onChange={(v) => set({ minRating: v })} />
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
          <Group title="Key" options={KEY_OPTIONS} value={filters.key} onChange={(v) => set({ key: v })} />
          <Group title="Purchase" options={PURCHASE_OPTIONS} value={filters.purchase} onChange={(v) => set({ purchase: v })} />
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
