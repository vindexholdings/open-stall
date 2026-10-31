import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useFocusStyle } from './focus';

type Props = { label: string; onPress: () => void; disabled?: boolean; accessibilityHint?: string; /** Same height as a primary button, for rows where the two sit side by side. */ tall?: boolean };

export function SecondaryButton({ label, onPress, disabled = false, accessibilityHint, tall = false }: Props) {
  const focus = useFocusStyle();
  return (
    <Pressable
      accessibilityRole="button"
      aria-disabled={disabled}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      {...focus.handlers}
      style={({ pressed }) => [styles.button, tall && styles.tall, (pressed || disabled) && styles.dimmed, focus.style]}
    >
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: touchTarget.min,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.primaryStrong,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  tall: { minHeight: touchTarget.primary },
  dimmed: { opacity: 0.6 },
  label: { ...typography.heading, fontSize: 17, color: colors.primaryStrong },
});
