'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { feedbackAdminError, parseApproveForm, parseDraftForm, parseId, parseIssueForm, parseLinkForm, parseStatusForm } from '@/lib/feedback';
import { requireAdminSession } from '@/lib/requireAdmin';

const go = (path: string, m: string, ok = false): never => redirect(`${path}${path.includes('?') ? '&' : '?'}${ok ? 'notice' : 'error'}=${encodeURIComponent(m)}`);
const itemPath = (id: unknown) => { const i = parseId(id); return i ? `/feedback/${i}` : '/feedback'; };
const issuePath = (id: unknown) => { const i = parseId(id); return i ? `/feedback/issue/${i}` : '/feedback'; };

/** Every call uses the signed-in administrator's own session; the database re-checks admin, MFA and self-review inside each function. */
export async function setStatus(formData: FormData): Promise<void> {
  const back = itemPath(formData.get('id'));
  const p = parseStatusForm(formData);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { error } = await db.rpc('admin_feedback_set_status', p.args);
  if (error) return go(back, feedbackAdminError(error));
  revalidatePath('/feedback');
  return go(back, `Status set to ${p.args.p_to.replace('_', ' ')}.`, true);
}

export async function createIssue(formData: FormData): Promise<void> {
  const back = itemPath(formData.get('id'));
  const p = parseIssueForm(formData);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { data, error } = await db.rpc('admin_feedback_create_issue', p.args);
  if (error) return go(back, feedbackAdminError(error));
  const issue = parseId((data as { issue_id?: string } | null)?.issue_id);
  return issue ? go(`/feedback/issue/${issue}`, 'Issue created. Now write the sanitized draft.', true) : go(back, 'Issue created.', true);
}

export async function linkDuplicate(formData: FormData): Promise<void> {
  const back = itemPath(formData.get('id'));
  const p = parseLinkForm(formData);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { error } = await db.rpc('admin_feedback_link_duplicate', p.args);
  if (error) return go(back, feedbackAdminError(error));
  revalidatePath('/feedback');
  return go(back, 'Linked as a duplicate. The original report was not changed.', true);
}

export async function saveDraft(formData: FormData): Promise<void> {
  const back = issuePath(formData.get('issue'));
  const p = parseDraftForm(formData);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { error } = await db.rpc('admin_feedback_draft_save', p.args);
  if (error) return go(back, feedbackAdminError(error));
  return go(back, 'Draft saved as a new version. It needs approval by a different administrator.', true);
}

export async function approveDraft(formData: FormData): Promise<void> {
  const back = issuePath(formData.get('issue'));
  const p = parseApproveForm(formData);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { error } = await db.rpc('admin_feedback_draft_approve', p.args);
  if (error) return go(back, feedbackAdminError(error));
  return go(back, 'Approved. The preview below is exactly what was approved.', true);
}
