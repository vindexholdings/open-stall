import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { PrimaryButton } from '../components/PrimaryButton';
import { StatusBanner } from '../components/StatusBanner';
import { useAuth } from './AuthProvider';

/**
 * Gate for account features and contributions. Restroom discovery never uses this; it must stay
 * usable without signing in. `next` is an internal path to return to after sign-in.
 */
export function RequireAuth({ children, reason, next }: { children: ReactNode; reason: string; next: string }) {
  const { status } = useAuth();
  const router = useRouter();

  if (status === 'signed-in') return <>{children}</>;
  if (status === 'loading') return <StatusBanner tone="info" title="Checking your account…" />;
  if (status === 'unavailable') return <StatusBanner tone="info" title="Accounts aren’t available in this build." />;

  return (
    <StatusBanner tone="info" title="Sign in to continue" message={reason}>
      <PrimaryButton
        label="Sign in or create account"
        onPress={() => router.push({ pathname: '/auth/sign-in', params: { next } })}
        accessibilityHint="Opens the sign-in screen, then returns you here. Finding restrooms never needs an account."
      />
    </StatusBanner>
  );
}
