import {
  feedbackErrorMessage, isUncertainOutcome, parseFeedbackDetail, parseFeedbackList, parseSubmitResult,
  type FeedbackDetail, type FeedbackDiagnostics, type FeedbackDraft, type FeedbackListItem,
} from '@open-stall/domain';
import type { RpcClientLike } from '../account/api';

type ErrLike = { message?: string; code?: string; status?: number } | null;
/** `uncertain`: a transport failure, so the send may have succeeded. A retry with the SAME key can never create a second item. */
export type FeedbackOutcome<T> = ({ ok: true } & T) | { ok: false; message: string; uncertain: boolean };

async function call(c: RpcClientLike, fn: string, args: Record<string, unknown>): Promise<{ data: unknown; error: ErrLike }> {
  try { return await c.rpc(fn, args); } catch (e) { return { data: null, error: { message: e instanceof Error ? e.message : String(e), status: 0 } }; }
}
const fail = (e: ErrLike): { ok: false; message: string; uncertain: boolean } => ({ ok: false, message: feedbackErrorMessage(e), uncertain: isUncertainOutcome(e ?? {}) });

const opt = (v: string): string | null => (v.trim() === '' ? null : v.trim());

/** The submitter is the signed-in caller (the server reads it from the session); there is no user or contact parameter. */
export async function submitFeedback(c: RpcClientLike, d: FeedbackDraft, diag: FeedbackDiagnostics, key: string): Promise<FeedbackOutcome<{ id: string; replayed: boolean }>> {
  const r = await call(c, 'submit_feedback', {
    p_key: key, p_kind: d.kind, p_screen: d.screen, p_title: d.title.trim(), p_description: d.description.trim(),
    p_expected: opt(d.expected), p_actual: opt(d.actual), p_steps: opt(d.steps), p_frequency: d.frequency, p_impact: d.impact,
    p_app_version: diag.appVersion, p_platform: diag.platform,
  });
  if (r.error) return fail(r.error);
  const parsed = parseSubmitResult(r.data);
  return parsed ? { ok: true, ...parsed } : { ok: false, message: feedbackErrorMessage(null), uncertain: true };
}

export async function listMyFeedback(c: RpcClientLike, cursor: string | null): Promise<FeedbackOutcome<{ items: FeedbackListItem[]; nextCursor: string | null }>> {
  const r = await call(c, 'list_my_feedback', { p_cursor: cursor, p_limit: 20 });
  if (r.error) return fail(r.error);
  const p = parseFeedbackList(r.data);
  return p ? { ok: true, ...p } : { ok: false, message: feedbackErrorMessage(null), uncertain: false };
}

export async function getMyFeedback(c: RpcClientLike, id: string): Promise<FeedbackOutcome<{ item: FeedbackDetail }>> {
  const r = await call(c, 'get_my_feedback', { p_id: id });
  if (r.error) return r.error.code === 'P0002' ? { ok: false, message: 'We couldn’t find that feedback.', uncertain: false } : fail(r.error);
  const item = parseFeedbackDetail(r.data);
  return item ? { ok: true, item } : { ok: false, message: feedbackErrorMessage(null), uncertain: false };
}
