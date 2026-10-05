import { safeNextPath } from '@open-stall/domain';
import { colors, typography } from '@open-stall/ui';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { Screen } from '../../components/Screen';
import { SecondaryButton } from '../../components/SecondaryButton';
import { useAuth } from '../../auth/AuthProvider';
import { completeAuthCallback } from '../../auth/authService';

/**
 * Return point for Google sign-in, confirmation emails and password-reset links.
 * Web: the auth client picks the PKCE code out of the URL by itself. Native: we exchange it here.
 */
export default function AuthCallback() {
  const { client, status, recovery } = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ code?: string; error?: string; error_description?: string; next?: string }>();
  const [message, setMessage] = useState<string | null>(null);
  const started = useRef(false);
  const paramError = params.error || params.error_description ? 'Sign-in was cancelled or failed. Please try again.' : null;
  const shown = paramError ?? message;

  useEffect(() => {
    if (started.current || !client) return;
    started.current = true;
    if (params.error || params.error_description) return;
    if (Platform.OS !== 'web' && typeof params.code === 'string') {
      void completeAuthCallback(client, `app://auth/callback?code=${encodeURIComponent(params.code)}`).then((r) => {
        if (!r.ok) setMessage(r.message);
      });
    }
  }, [client, params.code, params.error, params.error_description]);

  useEffect(() => {
    if (status !== 'signed-in') return;
    router.replace(recovery ? '/auth/reset' : (safeNextPath(params.next) as never));
  }, [status, recovery, params.next, router]);

  // Give the web client a moment to finish the exchange before declaring failure.
  useEffect(() => {
    const t = setTimeout(() => setMessage((m) => m ?? (status === 'signed-in' ? null : 'We could not complete sign-in. The link may have expired.')), 10_000);
    return () => clearTimeout(t);
  }, [status]);

  return (
    <Screen title="Signing you in">
      {shown ? (
        <>
          <Text style={styles.error} accessibilityRole="alert">{shown}</Text>
          <SecondaryButton label="Back to sign in" onPress={() => router.replace('/auth/sign-in')} />
        </>
      ) : (
        <Text style={styles.body} accessibilityLiveRegion="polite">One moment…</Text>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { ...typography.body, color: colors.textMuted },
  error: { ...typography.body, color: colors.status.danger.fg },
});
