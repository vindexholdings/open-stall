import { DEFAULT_DISPLAY_MODE } from '@open-stall/domain';
import { colors, typography } from '@open-stall/ui';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '../components/Screen';

export default function SettingsScreen() {
  return (
    <Screen title="Settings">
      <Text style={styles.body}>
        Display mode: {DEFAULT_DISPLAY_MODE === 'plain' ? 'Plain' : 'Risqué'}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.text },
});
