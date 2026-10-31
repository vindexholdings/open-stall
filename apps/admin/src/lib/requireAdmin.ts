import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { adminAccess, type AdminStatus } from './moderation';
import { sessionClient } from './supabase/server';

/**
 * Call at the top of EVERY admin page and server action. Uses the signed-in admin's own session (public anon
 * key, never a service-role credential). This only routes the browser; the database re-checks admin_users
 * membership and an MFA (aal2) session inside every admin function.
 */
export async function requireAdminSession(): Promise<SupabaseClient> {
  const supabase = await sessionClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/signin');
  const status = await supabase.rpc('am_i_admin');
  const access = adminAccess(true, (status.data ?? null) as AdminStatus);
  if (access === 'needs_mfa') redirect('/mfa');
  if (access !== 'ok') redirect('/queue'); // the queue page shows the "Not authorized" screen with sign-out
  return supabase;
}
