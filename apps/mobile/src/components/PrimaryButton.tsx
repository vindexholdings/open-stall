import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useFocusStyle } from './focus';

type Props = {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  accessibilityHint?: string;
};

export function PrimaryButton({ label, onPress, disabled = false, accessibilityHint }: Props) {
  const focus = useFocusStyle();
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={disabled}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      {...focus.handlers}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dimmed, focus.style]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget.primary,
    borderRadius: radii.lg,
    backgroundColor: colors.primaryStrong,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  dimmed: { opacity: 0.6 },
  label: { ...typography.heading, color: colors.onPrimaryStrong },
});
