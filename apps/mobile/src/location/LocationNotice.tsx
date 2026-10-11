import type { LocationAccessState } from '@open-stall/domain';
import { colors, radii, shadows, spacing, tiles, typography } from '@open-stall/ui';
import { Icon } from '../components/Icon';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBanner } from '../components/StatusBanner';

type Props = { state: LocationAccessState; onRetry: () => void };

/**
 * Plain-language explanation for every non-ready location state, each with ONE clear next step.
 * needs-prompt is the friendly first screen: why we ask, that nothing is stored, and the single button.
 */
export function LocationNotice({ state, onRetry }: Props) {
  if (state.kind === 'ready') return null;

  if (state.kind === 'needs-prompt') {
    return (
      <View style={styles.hero}>
        <View style={styles.heroIcon}><Icon name="pin" size={28} color={tiles.blue.fg} inner={tiles.blue.bg} /></View>
        <Text accessibilityRole="header" aria-level={2} style={styles.heroTitle}>Find the nearest restroom</Text>
        <Text style={styles.body}>
          Open Stall uses your location once, on your device, to find restrooms near you. It is not stored.
        </Text>
        <PrimaryButton
          label="Find Nearest Restroom"
          onPress={onRetry}
          accessibilityHint="Asks to use your location to find restrooms near you."
        />
      </View>
    );
  }

  if (state.kind === 'locating') {
    return <StatusBanner tone="info" title="Finding your location…" message="This usually takes a few seconds." />;
  }

  const denied = state.kind === 'denied';
  const web = Platform.OS === 'web';
  const message = denied
    ? web
      ? 'Location is blocked for this site, so we can’t sort restrooms by distance. Allow it from the lock icon in your browser’s address bar (site settings), then tap Try again.'
      : 'Location is off for Open Stall, so we can’t sort restrooms by distance. You can turn it on in Settings, then come back and tap Try again.'
    : 'We couldn’t get your location right now. Check that location services are on, then try again.';

  return (
    <StatusBanner tone="warning" urgent title={denied ? 'Location is turned off' : 'We couldn’t find your location'} message={message}>
      {denied && !web && !state.canAskAgain ? (
        <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
      ) : null}
      <PrimaryButton label={denied && !web && state.canAskAgain ? 'Allow location' : 'Try again'} onPress={onRetry} />
    </StatusBanner>
  );
}

const styles = StyleSheet.create({
  hero: {
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    ...shadows.card,
  },
  heroIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: tiles.blue.bg, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { ...typography.heading, fontSize: 22, lineHeight: 28, color: colors.text },
  body: { ...typography.body, color: colors.text },
});
