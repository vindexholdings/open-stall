import { safeNextPath } from '@open-stall/domain';
import { colors, radii, spacing, typography } from '@open-stall/ui';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { PrimaryButton } from '../../components/PrimaryButton';
import { Screen } from '../../components/Screen';
import { SecondaryButton } from '../../components/SecondaryButton';
import { TextField } from '../../components/TextField';
import { useAuth } from '../../auth/AuthProvider';
import {
  requestPasswordReset, signInWithApple, signInWithEmail, signInWithGoogleNative, signInWithGoogleWeb, signUpWithEmail, type Result,
} from '../../auth/authService';

WebBrowser.maybeCompleteAuthSession();

type Mode = 'sign-in' | 'sign-up';
type Notice = { kind: 'error' | 'info'; text: string } | null;

export default function SignInScreen() {
  const { client, status, redirectUrl } = useAuth();
  const router = useRouter();
  const { next } = useLocalSearchParams<{ next?: string }>();
  const target = safeNextPath(next);

  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [appleAvailable, setAppleAvailable] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    void AppleAuthentication.isAvailableAsync().then(setAppleAvailable).catch(() => setAppleAvailable(false));
  }, []);

  // Already signed in (or just became signed in): leave this screen.
  useEffect(() => {
    if (status === 'signed-in') router.replace(target as never);
  }, [status, target, router]);

  if (status === 'unavailable' || !client) {
    return (
      <Screen title="Sign in">
        <Text style={styles.body}>Accounts aren’t available in this build. You can still find restrooms without signing in.</Text>
        <SecondaryButton label="Back to restrooms" onPress={() => router.replace('/')} />
      </Screen>
    );
  }

  async function run(action: () => Promise<Result<object>>, onOk?: (r: Result<object>) => void) {
    setBusy(true);
    setNotice(null);
    const r = await action();
    setBusy(false);
    if (r.ok) onOk?.(r);
    else if (!r.cancelled) setNotice({ kind: 'error', text: r.message });
  }

  const submit = () =>
    run(
      () => (mode === 'sign-in' ? signInWithEmail(client, email, password) : signUpWithEmail(client, email, password, redirectUrl)),
      (r) => {
        if ('needsEmailConfirmation' in r && r.needsEmailConfirmation) {
          setNotice({ kind: 'info', text: 'Almost done: we sent a confirmation link. Open it on this device, then sign in.' });
          setMode('sign-in');
          setPassword('');
        }
      },
    );

  const forgot = () =>
    run(() => requestPasswordReset(client, email, redirectUrl), () =>
      setNotice({ kind: 'info', text: 'If that email has an account, we sent a reset link. Check your inbox.' }),
    );

  const google = () =>
    run(() =>
      Platform.OS === 'web'
        ? signInWithGoogleWeb(client, redirectUrl)
        : signInWithGoogleNative(client, redirectUrl, (url, redirect) => WebBrowser.openAuthSessionAsync(url, redirect)),
    );

  const apple = () =>
    run(() =>
      signInWithApple(client, {
        randomHex: async () => Array.from(await Crypto.getRandomBytesAsync(32), (b) => b.toString(16).padStart(2, '0')).join(''),
        sha256Hex: (v) => Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, v),
        requestCredential: (hashedNonce) =>
          AppleAuthentication.signInAsync({
            requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
            nonce: hashedNonce,
          }),
      }),
    );

  return (
    <Screen title={mode === 'sign-in' ? 'Sign in' : 'Create account'}>
      <Text style={styles.body}>
        An account lets you save favorites and contribute. You never need one to find a restroom.
      </Text>

      {notice ? (
        <View style={[styles.notice, notice.kind === 'error' ? styles.error : styles.info]} accessibilityRole="alert" accessibilityLiveRegion="polite">
          <Text style={notice.kind === 'error' ? styles.errorText : styles.infoText}>{notice.text}</Text>
        </View>
      ) : null}

      <TextField label="Email" value={email} onChangeText={setEmail} keyboardType="email-address" autoComplete="email" textContentType="emailAddress" returnKeyType="next" />
      <TextField
        label="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
        textContentType={mode === 'sign-in' ? 'password' : 'newPassword'}
        hint={mode === 'sign-up' ? 'At least 8 characters. A short phrase works well.' : undefined}
        returnKeyType="go"
        onSubmitEditing={() => void submit()}
      />

      <PrimaryButton label={busy ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'} onPress={() => void submit()} disabled={busy} />
      {mode === 'sign-in' ? <SecondaryButton label="Forgot password?" onPress={() => void forgot()} disabled={busy} accessibilityHint="Enter your email above first. We email a reset link." /> : null}
      <SecondaryButton
        label={mode === 'sign-in' ? 'New here? Create an account' : 'Have an account? Sign in'}
        onPress={() => { setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in'); setNotice(null); }}
        disabled={busy}
      />

      <Text style={styles.divider}>or</Text>
      <SecondaryButton label="Continue with Google" onPress={() => void google()} disabled={busy} />
      {appleAvailable ? (
        <AppleAuthentication.AppleAuthenticationButton
          buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
          buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
          cornerRadius={radii.lg}
          style={styles.apple}
          onPress={() => void apple()}
        />
      ) : null}
      <SecondaryButton label="Not now, back to restrooms" onPress={() => router.replace('/')} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
  divider: { ...typography.label, color: colors.textMuted, textAlign: 'center' },
  notice: { padding: spacing.md, borderRadius: radii.md, borderWidth: 1 },
  error: { backgroundColor: colors.status.danger.bg, borderColor: colors.status.danger.fg },
  info: { backgroundColor: colors.status.verified.bg, borderColor: colors.status.verified.fg },
  errorText: { ...typography.body, color: colors.status.danger.fg },
  infoText: { ...typography.body, color: colors.status.verified.fg },
  apple: { height: 56, width: '100%' },
});
