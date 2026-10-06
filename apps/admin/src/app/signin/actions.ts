'use server';

import { redirect } from 'next/navigation';
import { sessionClient } from '@/lib/supabase/server';

/** Password sign-in with a deliberately generic failure message (no account enumeration). */
export async function signIn(formData: FormData): Promise<void> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) redirect('/signin?error=Enter%20your%20email%20and%20password.');
  const supabase = await sessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) redirect('/signin?error=Email%20or%20password%20is%20incorrect.');
  redirect('/queue');
}
