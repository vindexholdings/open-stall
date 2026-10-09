import { colors, radii, spacing, typography } from '@open-stall/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

/** A titled card. The title is a level-2 heading so screens keep one h1 and a clear outline. */
export function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <Text accessibilityRole="header" aria-level={2} style={styles.title}>
        {title}
      </Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  title: { ...typography.heading, color: colors.text },
  hint: { ...typography.body, color: colors.textMuted },
});
