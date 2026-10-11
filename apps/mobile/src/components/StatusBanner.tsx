import { radii, spacing, tones, typography, type Tone } from '@open-stall/ui';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Icon, type IconName } from './Icon';

type Props = {
  tone: Tone;
  /** Short heading; also the first thing a screen reader hears. */
  title: string;
  message?: string;
  /** Recovery actions (buttons). */
  children?: ReactNode;
  /** Errors and blocking states interrupt (alert); progress and info are polite status updates. */
  urgent?: boolean;
};

/**
 * One shared notice for loading, offline, error, empty and permission states. A symbol and a
 * title carry the meaning so it never depends on color alone; text meets AA contrast (tones).
 */
export function StatusBanner({ tone, title, message, children, urgent = false }: Props) {
  const t = tones[tone];
  return (
    <View
      accessible={false}
      accessibilityRole={urgent ? 'alert' : undefined}
      accessibilityLiveRegion={urgent ? 'assertive' : 'polite'}
      style={[styles.box, { backgroundColor: t.bg, borderColor: t.fg }]}
    >
      <View style={styles.head}>
        <Icon name={t.icon as IconName} size={24} color={t.fg} inner={t.bg} />
        <Text style={[styles.title, { color: t.fg }]}>{title}</Text>
      </View>
      {message ? <Text style={[styles.message, { color: t.fg }]}>{message}</Text> : null}
      {children ? <View style={styles.actions}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1 },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.heading, flexShrink: 1 },
  message: { ...typography.body },
  actions: { gap: spacing.sm },
});
