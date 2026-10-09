import { useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { SecondaryButton } from '../../components/SecondaryButton';
import { StatusBanner } from '../../components/StatusBanner';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../auth/AuthProvider';
import { setNewPassword } from '../../auth/authService';

/** Shown only after a password-recovery link created a recovery session. */
export default function ResetPassword() {
  const { client, status, recovery, clearRecovery } = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  if (!client || status !== 'signed-in' || !recovery) {
    return (
      <Screen moveFocus title="Reset password" form>
        <StatusBanner tone="info" title="Open the reset link from your email" message="The link lets you choose a new password. If it has expired, request a new one from the sign-in screen.">
          <SecondaryButton label="Back to sign in" onPress={() => router.replace('/auth/sign-in')} />
        </StatusBanner>
      </Screen>
    );
  }

  const save = async () => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await setNewPassword(client, password);
      if (!r.ok) return setError(r.message);
      clearRecovery();
      router.replace('/account');
    } catch {
      setError('We couldn’t confirm that your new password was saved. Try signing in with it; if that doesn’t work, request a new reset link.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };

  return (
    <Screen moveFocus title="Choose a new password" form>
      {error ? <StatusBanner tone="danger" urgent title={error} /> : null}
      <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters." onSubmitEditing={() => void save()} />
      <PrimaryButton label={busy ? 'Saving…' : 'Save new password'} onPress={() => void save()} disabled={busy} />
    </Screen>
  );
}

