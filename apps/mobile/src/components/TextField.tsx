import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import type { TextInputProps } from 'react-native';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusStyle } from './focus';

type Props = Pick<TextInputProps, 'value' | 'onChangeText' | 'keyboardType' | 'autoComplete' | 'textContentType' | 'secureTextEntry' | 'returnKeyType' | 'onSubmitEditing' | 'multiline' | 'maxLength' | 'autoCapitalize'> & {
  label: string;
  hint?: string;
  /** Field-level problem: shown under the field, announced, and marks the input invalid. */
  error?: string | null;
};

/** Labelled input: the label is also the accessibility label so screen readers announce it. */
export function TextField({ label, hint, error, autoCapitalize = 'none', multiline, ...input }: Props) {
  const focus = useFocusStyle();
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        accessibilityHint={error ? `${error}${hint ? ` ${hint}` : ''}` : hint}
        aria-invalid={error ? true : undefined}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        autoCorrect={false}
        placeholderTextColor={colors.textMuted}
        {...focus.handlers}
        style={[styles.input, multiline && styles.multiline, error ? styles.invalid : null, focus.style]}
      />
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  label: { ...typography.label, color: colors.text },
  input: {
    minHeight: touchTarget.min,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: typography.body.fontSize,
  },
  invalid: { borderColor: colors.status.danger.fg, borderWidth: 2 },
  error: { ...typography.label, color: colors.status.danger.fg },
  multiline: { minHeight: 96, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  hint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
});
