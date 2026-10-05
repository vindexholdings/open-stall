import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import type { TextInputProps } from 'react-native';
import { StyleSheet, Text, TextInput, View } from 'react-native';

type Props = Pick<TextInputProps, 'value' | 'onChangeText' | 'keyboardType' | 'autoComplete' | 'textContentType' | 'secureTextEntry' | 'returnKeyType' | 'onSubmitEditing' | 'multiline' | 'maxLength' | 'autoCapitalize'> & {
  label: string;
  hint?: string;
};

/** Labelled input: the label is also the accessibility label so screen readers announce it. */
export function TextField({ label, hint, autoCapitalize = 'none', multiline, ...input }: Props) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        accessibilityLabel={label}
        accessibilityHint={hint}
        autoCapitalize={autoCapitalize}
        multiline={multiline}
        autoCorrect={false}
        placeholderTextColor={colors.textMuted}
        style={[styles.input, multiline && styles.multiline]}
      />
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
  multiline: { minHeight: 96, paddingVertical: spacing.sm, textAlignVertical: 'top' },
  hint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
});
