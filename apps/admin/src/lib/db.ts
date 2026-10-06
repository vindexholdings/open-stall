import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readEnvironmentMd } from './envmd';
import { assertExpectedProject } from './gate';

let cached: SupabaseClient | null = null;

/**
 * Service-role client, SERVER ONLY (never imported by client components). Created only after the
 * access gate passes, and only for the project recorded in ENVIRONMENT.md.
 */
export function adminDb(): SupabaseClient {
  if (cached) return cached;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  assertExpectedProject(url, readEnvironmentMd());
  cached = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return cached;
}
