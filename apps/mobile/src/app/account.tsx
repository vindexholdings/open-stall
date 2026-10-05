import { colors, spacing, typography } from '@open-stall/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { SecondaryButton } from '../components/SecondaryButton';
import { useAuth } from '../auth/AuthProvider';
import { signOut } from '../auth/authService';

export default function AccountScreen() {
  const { status, email, client } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  return (
    <Screen title="Account">
      {status === 'loading' ? <Text style={styles.body} accessibilityLiveRegion="polite">Checking your account…</Text> : null}
      {status === 'unavailable' ? <Text style={styles.body}>Accounts aren’t available in this build. Finding restrooms works without one.</Text> : null}

      {status === 'signed-out' ? (
        <View style={styles.stack}>
          <Text style={styles.body}>Sign in to save favorites and help improve restroom information. You never need an account to find a restroom.</Text>
          <PrimaryButton label="Sign in or create account" onPress={() => router.push({ pathname: '/auth/sign-in', params: { next: '/account' } })} />
        </View>
      ) : null}

      {status === 'signed-in' ? (
        <View style={styles.stack}>
          <Text style={styles.body} accessibilityLabel={`Signed in as ${email ?? 'your account'}`}>Signed in as {email ?? 'your account'}</Text>
          <Text style={styles.hint}>Your email is private. It is never shown to other people.</Text>
          {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
          <SecondaryButton
            label="Sign out"
            onPress={() => {
              if (!client) return;
              setError(null);
              void signOut(client).then((r) => { if (!r.ok) setError(r.message); });
            }}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  body: { ...typography.body, color: colors.text },
  hint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  error: { ...typography.body, color: colors.status.danger.fg },
});
