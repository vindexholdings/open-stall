import { DELETE_CONFIRMATION } from '@open-stall/domain';
import { colors, spacing, typography } from '@open-stall/ui';
import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { deleteAccount } from '../account/api';
import { useAuth } from '../auth/AuthProvider';
import { signOut } from '../auth/authService';
import { PrimaryButton } from '../components/PrimaryButton';
import { Screen } from '../components/Screen';
import { Section } from '../components/Section';
import { SecondaryButton } from '../components/SecondaryButton';
import { StatusBanner } from '../components/StatusBanner';
import { TextField } from '../components/TextField';

export default function AccountScreen() {
  const { status, email, client, rpc } = useAuth();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [deletedNotice, setDeletedNotice] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const inFlight = useRef(false); // synchronous lock: one deletion request at a time

  const doDelete = async () => {
    if (!rpc || !client || inFlight.current) return;
    inFlight.current = true;
    setDeleting(true);
    setError(null);
    try {
      const r = await deleteAccount(rpc);
      if (!r.ok) return setError(r.message);
      setDeletedNotice(true);
      await signOut(client); // the session is already invalid server-side; this clears it locally
      setConfirmingDelete(false);
      setTyped('');
    } catch {
      setError('Something went wrong. Nothing was deleted. Please try again.');
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  };

  return (
    <Screen title="Account" form>
      {status === 'loading' ? <StatusBanner tone="info" title="Checking your account…" /> : null}
      {status === 'unavailable' ? (
        <StatusBanner tone="info" title="Accounts aren’t available in this build." message="Finding restrooms works without one." />
      ) : null}

      {deletedNotice && status !== 'signed-in' ? (
        <StatusBanner tone="success" title="Your account was deleted." message="Restrooms stay on the map. You can still find restrooms without an account." />
      ) : null}

      {status === 'signed-out' ? (
        <StatusBanner tone="info" title="You’re not signed in" message="Sign in to save favorites and help improve restroom information. You never need an account to find a restroom.">
          <PrimaryButton label="Sign in or create account" onPress={() => router.push({ pathname: '/auth/sign-in', params: { next: '/account' } })} />
        </StatusBanner>
      ) : null}

      {status === 'signed-in' ? (
        <>
          {error ? <StatusBanner tone="danger" urgent title={error} /> : null}
          <Section title="Your account">
            <Text style={styles.body} accessibilityLabel={`Signed in as ${email ?? 'your account'}`}>Signed in as {email ?? 'your account'}</Text>
            <Text style={styles.hint}>Your email is private. It is never shown to other people.</Text>
            <SecondaryButton
              label="Sign out"
              onPress={() => {
                if (!client) return;
                setError(null);
                void signOut(client).then((r) => { if (!r.ok) setError(r.message); });
              }}
            />
          </Section>

          <Section title="Add a missing restroom" hint="Stand at a public restroom that isn’t on the map. Every submission is reviewed by a person before anyone else sees it.">
            <PrimaryButton label="Add restroom at my current location" onPress={() => router.push('/contribute')} accessibilityHint="Stand at a public restroom that is missing from the map to add it." />
          </Section>

          <View style={styles.danger}>
            <Section title="Delete account">
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
            </Section>
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  body: { ...typography.body, color: colors.text },
  hint: { ...typography.body, color: colors.textMuted },
  danger: { marginTop: spacing.md },
});
