import { colors, radii, spacing, touchTarget, typography } from '@open-stall/ui';
import { useState } from 'react';
import type { TextInputProps } from 'react-native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusStyle } from './focus';

type Props = Pick<TextInputProps, 'value' | 'onChangeText' | 'keyboardType' | 'autoComplete' | 'textContentType' | 'secureTextEntry' | 'returnKeyType' | 'onSubmitEditing' | 'multiline' | 'maxLength' | 'autoCapitalize'> & {
  label: string;
  hint?: string;
  /** Field-level problem: shown under the field, announced, and marks the input invalid. */
  error?: string | null;
};

/**
 * Show/Hide control for a password field. Its own component so each field owns its own state and focus ring. It is a
 * plain button: pressing it only flips visibility (no submit, no network, no validation) and the input stays mounted, so
 * the typed text, caret and password-manager state are untouched. The visible text IS the accessible name and always
 * names the action the button will perform ("Show password" while masked, "Hide password" while shown).
 */
function PasswordToggle({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
  const focus = useFocusStyle();
  const name = revealed ? 'Hide password' : 'Show password';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={name}
      onPress={onToggle}
      {...focus.handlers}
      style={({ pressed }) => [styles.toggle, pressed && styles.toggleDim, focus.style]}
    >
      <Text style={styles.toggleText}>{name}</Text>
    </Pressable>
  );
}

/** Labelled input: the label is also the accessibility label so screen readers announce it. */
export function TextField({ label, hint, error, autoCapitalize = 'none', multiline, secureTextEntry, ...input }: Props) {
  const focus = useFocusStyle();
  // Masked by default, per field, never persisted: leaving the screen unmounts this state.
  const [revealed, setRevealed] = useState(false);
  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        {...input}
        secureTextEntry={secureTextEntry ? !revealed : undefined}
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
      {secureTextEntry ? <PasswordToggle revealed={revealed} onToggle={() => setRevealed((v) => !v)} /> : null}
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
  toggle: { minHeight: touchTarget.min, alignSelf: 'flex-start', justifyContent: 'center', paddingHorizontal: spacing.sm, marginLeft: -spacing.sm, borderRadius: radii.md },
  toggleDim: { opacity: 0.6 },
  toggleText: { ...typography.label, color: colors.primaryStrong, textDecorationLine: 'underline' },
});
