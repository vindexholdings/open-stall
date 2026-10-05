import { colors, radii, spacing, typography } from '@open-stall/ui';
import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from './AuthProvider';

/**
 * Gate for account features and contributions. Restroom discovery never uses this; it must stay
 * usable without signing in. `next` is an internal path to return to after sign-in.
 */
export function RequireAuth({ children, reason, next }: { children: ReactNode; reason: string; next: string }) {
  const { status } = useAuth();
  const router = useRouter();

  if (status === 'signed-in') return <>{children}</>;
  if (status === 'loading') return <Text style={styles.body} accessibilityLiveRegion="polite">Checking your account…</Text>;
  if (status === 'unavailable') return <Text style={styles.body}>Accounts aren’t available in this build.</Text>;

  return (
    <View style={styles.card}>
      <Text style={styles.body}>{reason}</Text>
      <PrimaryButton
        label="Sign in or create account"
        onPress={() => router.push({ pathname: '/auth/sign-in', params: { next } })}
        accessibilityHint="Opens the sign-in screen. Finding restrooms never needs an account."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  body: { ...typography.body, color: colors.text },
});
