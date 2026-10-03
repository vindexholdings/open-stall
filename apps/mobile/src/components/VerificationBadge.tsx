import type { VerificationBadge as Badge } from '@open-stall/domain';
import { colors, radii, spacing, typography } from '@open-stall/ui';
import { StyleSheet, Text, View } from 'react-native';

/** Text + color + symbol, so status never depends on color alone. */
export function VerificationBadge({ badge }: { badge: Badge }) {
  const tone = badge.kind === 'verified' ? colors.status.verified : colors.status.unverified;
  const symbol = badge.kind === 'verified' ? '✓' : '?';
  return (
    <View
      accessible
      accessibilityLabel={badge.label}
      style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.fg }]}
    >
      <Text style={[styles.text, { color: tone.fg }]}>{`${symbol} ${badge.label}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  text: { ...typography.label },
});
