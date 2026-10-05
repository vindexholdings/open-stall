import type { Session } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState, Platform } from 'react-native';
import type { AuthClientLike } from './authService';
import { authClient } from './client';

export type AuthStatus = 'unavailable' | 'loading' | 'signed-out' | 'signed-in';

type AuthValue = {
  status: AuthStatus;
  /** Private: never display publicly. */
  email: string | null;
  /** True after the user opened a password-recovery link; they must set a new password. */
  recovery: boolean;
  clearRecovery: () => void;
  client: AuthClientLike | null;
  /** Where providers and emailed links return to (custom scheme natively, origin on web). */
  redirectUrl: string;
};

const Ctx = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>(authClient ? 'loading' : 'unavailable');
  const [email, setEmail] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    if (!authClient) return;
    const apply = (session: Session | null) => {
      setStatus(session ? 'signed-in' : 'signed-out');
      setEmail(session?.user.email ?? null);
    };
    void authClient.auth.getSession().then(({ data }) => apply(data.session));
    const { data } = authClient.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      if (event === 'SIGNED_OUT') setRecovery(false);
      apply(session);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // Native apps must pause token refresh in the background (Supabase guidance).
  useEffect(() => {
    if (!authClient || Platform.OS === 'web') return;
    void authClient.auth.startAutoRefresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void authClient?.auth.startAutoRefresh();
      else void authClient?.auth.stopAutoRefresh();
    });
    return () => {
      sub.remove();
      void authClient?.auth.stopAutoRefresh();
    };
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      email,
      recovery,
      clearRecovery: () => setRecovery(false),
      client: authClient as unknown as AuthClientLike | null,
      redirectUrl: Linking.createURL('auth/callback'),
    }),
    [status, email, recovery],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth must be used inside AuthProvider');
  return v;
}
