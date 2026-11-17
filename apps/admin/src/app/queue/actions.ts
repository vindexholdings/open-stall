'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { adminErrorMessage, parseDecision, parseReportResolution } from '@/lib/moderation';
import { sessionClient } from '@/lib/supabase/server';

const back = (m: string, ok = false): never => redirect(`/queue?${ok ? 'notice' : 'error'}=${encodeURIComponent(m)}`);

/** Every call goes through the signed-in admin's own session; the database re-checks admin + MFA + self-adjudication. */
export async function decideSubmission(formData: FormData): Promise<void> {
  const parsed = parseDecision(formData);
  if (!parsed.ok) back(parsed.error);
  else {
    const supabase = await sessionClient();
    const { error } = await supabase.rpc('admin_decide_submission', parsed.args);
    if (error) back(adminErrorMessage(error));
    revalidatePath('/queue');
    back(`Decision recorded: ${parsed.args.p_decision.replace('_', ' ')}.`, true);
  }
}

export async function resolveReport(formData: FormData): Promise<void> {
  const parsed = parseReportResolution(formData);
  if (!parsed.ok) back(parsed.error);
  else {
    const supabase = await sessionClient();
    const { error } = await supabase.rpc('admin_resolve_report', { p_id: parsed.id, p_resolution: parsed.resolution, p_note: parsed.note });
    if (error) back(adminErrorMessage(error));
    revalidatePath('/queue');
    back(`Report ${parsed.resolution}.`, true);
  }
}

export async function signOutAdmin(): Promise<void> {
  const supabase = await sessionClient();
  await supabase.auth.signOut();
  redirect('/signin');
}
