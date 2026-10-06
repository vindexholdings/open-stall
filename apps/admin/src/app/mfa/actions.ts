'use server';

import { redirect } from 'next/navigation';
import { sessionClient } from '@/lib/supabase/server';

export type EnrollState = { factorId: string; qr: string; secret: string } | { error: string } | null;

/** Starts TOTP enrollment (free Supabase MFA). The factor stays unverified until the first valid code. */
export async function startEnrollment(prev: EnrollState): Promise<EnrollState> {
  void prev; // useActionState passes the previous state first
  const supabase = await sessionClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) redirect('/signin');
  // Drop abandoned, never-verified factors so retries don't pile up.
  const { data: factors } = await supabase.auth.mfa.listFactors();
  for (const f of factors?.all ?? []) if (f.factor_type === 'totp' && f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'admin authenticator' });
  if (error || !data) return { error: 'Could not start enrollment. Try again.' };
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** Verifies a 6-digit code against a factor; success upgrades the session to aal2. */
export async function verifyCode(formData: FormData): Promise<void> {
  const factorId = String(formData.get('factor') ?? '');
  const code = String(formData.get('code') ?? '').replace(/\s/g, '');
  const fail = (m: string) => redirect(`/mfa?error=${encodeURIComponent(m)}`);
  if (!factorId || !/^\d{6}$/.test(code)) fail('Enter the 6-digit code from your authenticator app.');
  const supabase = await sessionClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) fail('That code did not work. Try again.');
  redirect('/queue');
}
