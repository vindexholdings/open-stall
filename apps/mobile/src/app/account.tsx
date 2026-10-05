import { colors, spacing, typography } from '@open-stall/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { DELETE_CONFIRMATION } from '@open-stall/domain';
import { deleteAccount } from '../account/api';
import { TextField } from '../components/TextField';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { SecondaryButton } from '../components/SecondaryButton';
import { useAuth } from '../auth/AuthProvider';
import { signOut } from '../auth/authService';

export default function AccountScreen() {
  const { status, email, client, rpc } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);

  const doDelete = async () => {
    if (!rpc || !client) return;
    setDeleting(true);
    setError(null);
    const r = await deleteAccount(rpc);
    if (!r.ok) {
      setDeleting(false);
      return setError(r.message);
    }
    await signOut(client); // the session is already invalid server-side; this clears it locally
    setDeleting(false);
    setConfirmingDelete(false);
    setTyped('');
  };

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
          <PrimaryButton label="Add a restroom" onPress={() => router.push('/contribute')} accessibilityHint="Suggest a public restroom that is missing from the map." />
          <SecondaryButton
            label="Sign out"
            onPress={() => {
              if (!client) return;
              setError(null);
              void signOut(client).then((r) => { if (!r.ok) setError(r.message); });
            }}
          />
          <View style={styles.danger}>
            <Text style={styles.dangerTitle} accessibilityRole="header">Delete account</Text>
            <Text style={styles.hint}>
              Permanently deletes your account, favorites, ratings, check-ins, pending submissions and reports. Restrooms stay on the map. This can’t be undone.
            </Text>
            {confirmingDelete ? (
              <View style={styles.stack}>
                <TextField label={`Type ${DELETE_CONFIRMATION} to confirm`} value={typed} onChangeText={setTyped} autoCapitalize="characters" />
                <SecondaryButton
                  label={deleting ? 'Deleting…' : 'Permanently delete my account'}
                  disabled={deleting || typed.trim() !== DELETE_CONFIRMATION}
                  onPress={() => void doDelete()}
                />
                <SecondaryButton label="Cancel" disabled={deleting} onPress={() => { setConfirmingDelete(false); setTyped(''); }} />
              </View>
            ) : (
              <SecondaryButton label="Delete my account…" onPress={() => setConfirmingDelete(true)} />
            )}
          </View>
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  body: { ...typography.body, color: colors.text },
  hint: { ...typography.label, fontWeight: '400', color: colors.textMuted },
  danger: { gap: spacing.sm, marginTop: spacing.lg },
  dangerTitle: { ...typography.heading, color: colors.status.danger.fg },
  error: { ...typography.body, color: colors.status.danger.fg },
});
