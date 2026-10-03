import { colors, typography } from '@open-stall/ui';
import { StyleSheet, Text } from 'react-native';
import { LocationNotice } from '../location/LocationNotice';
import { useUserLocation } from '../location/useUserLocation';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';

export default function NearbyScreen() {
  const { state, request } = useUserLocation();

  return (
    <Screen title="Open Stall">
      <Text style={styles.body}>Find the nearest usable restroom fast.</Text>
      {state.kind === 'needs-prompt' ? (
        <PrimaryButton
          label="Find Nearest Restroom"
          onPress={() => void request()}
          accessibilityHint="Asks to use your location to find restrooms near you."
        />
      ) : null}
      <LocationNotice state={state} onRetry={() => void request()} />
      {state.kind === 'ready' ? (
        <Text style={styles.body}>Location ready. Nearby results arrive in the next steps.</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
});
