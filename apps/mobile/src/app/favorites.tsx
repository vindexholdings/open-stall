import { colors, typography } from '@open-stall/ui';
import { StyleSheet, Text } from 'react-native';
import { RequireAuth } from '../auth/RequireAuth';
import { Screen } from '../components/Screen';

export default function FavoritesScreen() {
  return (
    <Screen title="Favorites">
      <RequireAuth reason="Sign in to save favorite restrooms and see them on all your devices." next="/favorites">
        {/* Saving favorites arrives in OS-204; this gate is the pattern all account features use. */}
        <Text style={styles.body}>Saved restrooms will appear here.</Text>
      </RequireAuth>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
});
