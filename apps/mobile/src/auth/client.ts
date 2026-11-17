import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { createChunkedStorage } from './chunkedStorage';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Account client: public anon key only, PKCE flow, session persisted (SecureStore on native,
 * the browser's storage on web). Deliberately SEPARATE from the discovery data client, which stays
 * anonymous so restroom searches (precise location) are never tied to a signed-in identity.
 * Null when the build has no Supabase configuration.
 */
export const authClient: SupabaseClient | null =
  url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          flowType: 'pkce',
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: Platform.OS === 'web',
          storage: Platform.OS === 'web' ? undefined : createChunkedStorage(SecureStore),
        },
      })
    : null;
