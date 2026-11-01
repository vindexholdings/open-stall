'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createHash } from 'node:crypto';
import { feedbackAdminError, parseApproveForm, parseDraftForm, parseId, parseIssueForm, parseAttemptForm, parseIssueOnlyForm, parseLinkForm, parseReportForm, parseStatusForm } from '@/lib/feedback';
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

// ---------------------------------------------------------------- F2 publication bridge. No GitHub credential exists here: a person transfers the exact packet through the existing authorized connector.
const sha256Hex = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');

export async function requestPublication(formData: FormData): Promise<void> {
  const back = issuePath(formData.get('issue'));
  const p = parseIssueOnlyForm(formData);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { data, error } = await db.rpc('admin_feedback_publication_request', p.args);
  if (error) return go(back, feedbackAdminError(error));
  const replayed = (data as { replayed?: boolean } | null)?.replayed === true;
  return go(back, replayed ? 'This exact snapshot is already published; the verified mapping is shown below.' : 'Publication requested. Prepare the transfer packet when you are ready.', true);
}

export async function beginPublication(formData: FormData): Promise<void> {
  const back = issuePath(formData.get('issue'));
  const p = parseIssueOnlyForm(formData);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { error } = await db.rpc('admin_feedback_publication_begin', p.args);
  if (error) return go(back, feedbackAdminError(error));
  return go(back, 'A new attempt was prepared. Nothing has been released yet: check the exact text below, then release it (once) or cancel.', true);
}

/** Releases the executable packet for exactly the named attempt, ONCE. Afterwards a reload only ever shows reconciliation guidance. */
export async function dispatchPublication(formData: FormData): Promise<void> {
  const back = issuePath(formData.get('issue'));
  const p = parseAttemptForm(formData);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { error } = await db.rpc('admin_feedback_publication_dispatch', p.args);
  if (error) return go(back, feedbackAdminError(error));
  return go(back, 'The packet was released for this attempt. Transfer it ONCE, then record the result. If you are unsure whether it was sent, do not send it again: record that and reconcile.', true);
}

export async function reportPublication(formData: FormData): Promise<void> {
  const back = issuePath(formData.get('issue'));
  const p = parseReportForm(formData, sha256Hex);
  if (!p.ok) return go(back, p.error);
  const db = await requireAdminSession();
  const { error } = await db.rpc('admin_feedback_publication_report', p.args);
  if (error) return go(back, feedbackAdminError(error));
  return go(back, 'Result recorded. The state below is the verified one.', true);
}
