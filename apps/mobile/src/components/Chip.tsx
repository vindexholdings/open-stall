import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text } from 'react-native';
import { spaceActivates, useFocusStyle } from './focus';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: 'checkbox' | 'radio';
  /** Overrides the spoken name when the visible label alone is not enough. */
  accessibilityLabel?: string;
  /** Adds a state hint such as "expanded" for disclosure toggles. */
  expanded?: boolean;
};

export function Chip({ label, selected, onPress, role = 'checkbox', accessibilityLabel, expanded }: Props) {
  const focus = useFocusStyle();
  return (
    <Pressable
      accessibilityRole={role}
      aria-checked={selected}
      aria-selected={role === 'radio' ? selected : undefined}
      aria-expanded={expanded}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={onPress}
      {...focus.handlers}
      {...spaceActivates(onPress)}
      style={[styles.chip, selected && styles.selected, focus.style]}
    >
      <Text style={[styles.label, selected && styles.selectedLabel]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: touchTarget.min,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: colors.primaryStrong, borderColor: colors.primaryStrong },
  label: { ...typography.label, color: colors.text },
  selectedLabel: { color: colors.onPrimaryStrong },
});
