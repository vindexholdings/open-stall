import type { LocationSource } from './LocationSource';
import { createSupabaseSource } from './supabaseSource';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** Null when the build has no Supabase configuration; the UI then says data is not connected. */
export const locationSource: LocationSource | null =
  url && anonKey ? createSupabaseSource(url, anonKey) : null;

export type { LocationSource };
