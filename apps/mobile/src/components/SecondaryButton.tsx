import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { Pressable, StyleSheet, Text } from 'react-native';

type Props = { label: string; onPress: () => void; disabled?: boolean; accessibilityHint?: string };

export function SecondaryButton({ label, onPress, disabled = false, accessibilityHint }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      accessibilityHint={accessibilityHint}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, (pressed || disabled) && styles.dimmed]}
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
  dimmed: { opacity: 0.6 },
  label: { ...typography.heading, fontSize: 17, color: colors.primaryStrong },
});
