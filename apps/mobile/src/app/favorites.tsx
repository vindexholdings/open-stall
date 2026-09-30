import { colors, typography } from '@open-stall/ui';
import { StyleSheet, Text } from 'react-native';
import { Screen } from '../components/Screen';

export default function FavoritesScreen() {
  return (
    <Screen title="Favorites">
      <Text style={styles.body}>Saved restrooms will appear here.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
});
