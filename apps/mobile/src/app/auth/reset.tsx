import { colors, typography } from '@open-stall/ui';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { SecondaryButton } from '../../components/SecondaryButton';
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

  if (!client || status !== 'signed-in' || !recovery) {
    return (
      <Screen title="Reset password">
        <Text style={styles.body}>Open the reset link from your email to choose a new password.</Text>
        <SecondaryButton label="Back to sign in" onPress={() => router.replace('/auth/sign-in')} />
      </Screen>
    );
  }

  const save = async () => {
    setBusy(true);
    setError(null);
    const r = await setNewPassword(client, password);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    clearRecovery();
    router.replace('/account');
  };

  return (
    <Screen title="Choose a new password">
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      <TextField label="New password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="new-password" textContentType="newPassword" hint="At least 8 characters." onSubmitEditing={() => void save()} />
      <PrimaryButton label={busy ? 'Saving…' : 'Save new password'} onPress={() => void save()} disabled={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
  error: { ...typography.body, color: colors.status.danger.fg },
});
