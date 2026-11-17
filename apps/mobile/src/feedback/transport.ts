import { newFeedbackKey } from '@open-stall/domain';
import { createClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import type { RpcClientLike } from '../account/api';
import { authClient } from '../auth/client';
import { submitFeedback } from './api';
import type { SenderDeps } from './sender';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * A one-request client whose credential is FIXED to the verified session's access token: in memory only (nothing persisted, no refresh, no URL
 * detection), never logged, and no service role. It is created per send, so it can never pick up a later account's session.
 */
export function bindToken(accessToken: string): RpcClientLike | null {
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'os-feedback-send' },
  });
}

/** The real adapters for one account's form. */
export function liveSenderDeps(owner: string): SenderDeps {
  return {
    owner,
    getSession: async () => {
      if (!authClient) return { userId: null, accessToken: null };
      const { data } = await authClient.auth.getSession();
      return { userId: data.session?.user.id ?? null, accessToken: data.session?.access_token ?? null };
    },
    bind: bindToken,
    newKey: async () => newFeedbackKey(Array.from(await Crypto.getRandomBytesAsync(20), (b) => b.toString(16).padStart(2, '0')).join('')),
    submit: submitFeedback,
  };
}
