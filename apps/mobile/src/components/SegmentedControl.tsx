import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { spaceActivates, useFocusStyle } from './focus';

type Option<T extends string> = { value: T; label: string };
type Props<T extends string> = {
  /** Spoken name of the group, e.g. "Results view". */
  label: string;
  options: readonly Option<T>[];
  value: T;
  onChange: (next: T) => void;
};

function Segment({ label, selected, onPress, first, last }: { label: string; selected: boolean; onPress: () => void; first: boolean; last: boolean }) {
  const focus = useFocusStyle();
  return (
    <Pressable
      accessibilityRole="radio"
      aria-checked={selected}
      aria-selected={selected}
      accessibilityLabel={label}
      onPress={onPress}
      {...focus.handlers}
      {...spaceActivates(onPress)}
      style={[styles.segment, first && styles.first, last && styles.last, selected && styles.selected, focus.style]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

/** Two-or-three way switch (for example List | Map). Exposed as one radio group. */
export function SegmentedControl<T extends string>({ label, options, value, onChange }: Props<T>) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.row}>
      {options.map((o, i) => (
        <Segment key={o.value} label={o.label} selected={o.value === value} onPress={() => onChange(o.value)} first={i === 0} last={i === options.length - 1} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignSelf: 'stretch' },
  segment: {
    flex: 1,
    minHeight: touchTarget.min,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.primaryStrong,
    backgroundColor: colors.surface,
  },
  first: { borderTopLeftRadius: radii.pill, borderBottomLeftRadius: radii.pill },
  last: { borderTopRightRadius: radii.pill, borderBottomRightRadius: radii.pill, marginLeft: -1 },
  selected: { backgroundColor: colors.primaryStrong },
  label: { ...typography.label, color: colors.primaryStrong },
  selectedLabel: { color: colors.onPrimaryStrong },
});
