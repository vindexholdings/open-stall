import type { VerificationBadge as Badge } from '@open-stall/domain';
import { colors, radii, spacing, typography } from '@open-stall/ui';
import { StyleSheet, Text, View } from 'react-native';
import { Icon } from './Icon';

/** Text + color + symbol, so status never depends on color alone. */
export function VerificationBadge({ badge }: { badge: Badge }) {
  const tone = badge.kind === 'verified' ? colors.status.verified : colors.status.unverified;
  return (
    <View
      accessible
      accessibilityLabel={badge.label}
      style={[styles.badge, { backgroundColor: tone.bg, borderColor: tone.fg }]}
    >
      <Icon name={badge.kind === 'verified' ? 'check' : 'help'} size={16} color={tone.fg} inner={tone.bg} />
      <Text style={[styles.text, { color: tone.fg }]}>{badge.label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  text: { ...typography.label },
});
