import type { LocationAccessState } from '@open-stall/domain';
import { colors, radii, spacing, typography } from '@open-stall/ui';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';

type Props = { state: LocationAccessState; onRetry: () => void };

/** Plain-language explanation for non-ready location states, with a clear next step. */
export function LocationNotice({ state, onRetry }: Props) {
  if (state.kind === 'ready') return null;

  if (state.kind === 'locating') {
    return (
      <Text accessibilityLiveRegion="polite" style={styles.body}>
        Finding your location…
      </Text>
    );
  }

  const denied = state.kind === 'denied';
  const message =
    state.kind === 'needs-prompt'
      ? 'Open Stall uses your location once, on your device, to find restrooms near you. It is not stored.'
      : denied
        ? 'Location is off for Open Stall, so we can’t sort restrooms by distance. You can turn it on in Settings.'
        : 'We couldn’t get your location right now. Check that location services are on, then try again.';

  return (
    <View style={styles.card} accessibilityRole="alert">
      <Text style={styles.body}>{message}</Text>
      {denied && !state.canAskAgain ? (
        <PrimaryButton label="Open Settings" onPress={() => void Linking.openSettings()} />
      ) : (
        <PrimaryButton label={denied ? 'Allow location' : 'Try again'} onPress={onRetry} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: { ...typography.body, color: colors.text },
});
