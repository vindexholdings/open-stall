import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { assertExpectedProject } from './gate';

function readEnvironmentMd(): string {
  for (const rel of ['../../ENVIRONMENT.md', 'ENVIRONMENT.md']) {
    try {
      return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    } catch {
      // try next
    }
  }
  throw new Error('ENVIRONMENT.md not found; refusing to connect without the recorded project ref');
}

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
