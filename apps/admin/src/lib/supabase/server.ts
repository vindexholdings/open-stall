import 'server-only';
import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { readEnvironmentMd } from '../envmd';
import { assertSessionBackend } from '../gate';

/**
 * Admin session client: the PUBLIC anon key plus the signed-in admin's own session (cookies).
 * It never uses a service-role credential. All privileges come from the database, which requires
 * admin_users membership AND an MFA (aal2) session on every admin function.
 */
export async function sessionClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required (apps/admin/.env.local)');
  assertSessionBackend(url, readEnvironmentMd(), process.env);
  const store = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (all) => {
        try {
          for (const c of all) store.set(c.name, c.value, c.options);
        } catch {
          // Called from a Server Component: the proxy refreshes the session instead.
        }
      },
    },
  });
}
