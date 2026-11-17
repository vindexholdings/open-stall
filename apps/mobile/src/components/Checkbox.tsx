import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';
import { spaceActivates, useFocusStyle } from './focus';

type Props = {
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Overrides the spoken name when the visible label alone is not enough. */
  accessibilityLabel?: string;
};

/**
 * A labeled checkbox: a real `checkbox` role with its checked state, a 48 px touch target and a visible focus ring.
 * The state is a drawn check mark, never color alone. Space and Enter toggle it.
 */
export function Checkbox({ label, checked, onChange, accessibilityLabel }: Props) {
  const focus = useFocusStyle();
  const toggle = () => onChange(!checked);
  const space = spaceActivates(toggle);
  return (
    <Pressable
      accessibilityRole="checkbox"
      aria-checked={checked}
      accessibilityState={{ checked }}
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={toggle}
      {...focus.handlers}
      {...space}
      style={({ pressed }) => [styles.row, pressed && styles.pressed, focus.style]}
    >
      <View style={[styles.box, checked && styles.boxOn]}>{checked ? <Icon name="check" size={18} color={colors.onPrimaryStrong} /> : null}</View>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: touchTarget.min, flexDirection: 'row', alignItems: 'center', gap: spacing.sm + 2, paddingVertical: spacing.xs },
  pressed: { opacity: 0.85 },
  box: { width: 26, height: 26, borderRadius: radii.sm - 2, borderWidth: 2, borderColor: colors.primaryStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.primaryStrong },
  label: { ...typography.body, color: colors.text, flex: 1 },
});
