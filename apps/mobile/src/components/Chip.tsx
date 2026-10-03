import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text } from 'react-native';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  role?: 'checkbox' | 'radio';
};

export function Chip({ label, selected, onPress, role = 'checkbox' }: Props) {
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityState={role === 'checkbox' ? { checked: selected } : { selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected]}
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
