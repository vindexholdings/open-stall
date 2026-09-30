import { colors, typography } from '@open-stall/ui';
import { StyleSheet, Text } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';

// Shell only: location, map and nearby list arrive in Phase 1.
export default function NearbyScreen() {
  return (
    <Screen title="Open Stall">
      <Text style={styles.body}>Find the nearest usable restroom fast.</Text>
      <PrimaryButton
        label="Find Nearest Restroom"
        disabled
        accessibilityHint="Coming soon. Will find restrooms near your location."
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
});
