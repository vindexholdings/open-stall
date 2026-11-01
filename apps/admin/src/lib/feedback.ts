import { adminErrorMessage } from './moderation';

/** Admin side of App Feedback. Everything shown here is untrusted DATA from users: React renders it as escaped text; it is never HTML, a link or a command. */
export const FEEDBACK_STATUSES = ['received', 'reviewing', 'planned', 'in_progress', 'resolved', 'closed', 'duplicate'] as const;
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export const STATUS_LABEL: Record<FeedbackStatus, string> = {
  received: 'Received', reviewing: 'Reviewing', planned: 'Planned', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed', duplicate: 'Duplicate',
};
/** The transitions the DATABASE allows (the same table); used only to offer sensible choices. The server decides. */
export const NEXT_STATUS: Record<FeedbackStatus, readonly FeedbackStatus[]> = {
  received: ['reviewing'], reviewing: ['planned', 'in_progress', 'resolved', 'closed'], planned: ['in_progress', 'resolved', 'closed'],
  in_progress: ['resolved', 'closed'], resolved: ['closed', 'reviewing'], closed: ['reviewing'], duplicate: [],
};
export const CATEGORIES = [{ value: 'bug', label: 'Bug' }, { value: 'usability', label: 'Usability' }, { value: 'suggestion', label: 'Suggestion' }] as const;
export const PLATFORMS = ['ios', 'android', 'web'] as const;

export type ListItem = { id: string; kind: string; screen: string; title: string; status: FeedbackStatus; created_at: string; linked: boolean; own: boolean };
export type Detail = {
  id: string; kind: string; screen: string; title: string; description: string; expected: string | null; actual: string | null; steps: string | null;
  frequency: string | null; impact: string | null; app_version: string | null; platform: string | null; status: FeedbackStatus; created_at: string; updated_at: string;
  own: boolean; issue_id: string | null; link_role: string | null; history: { from: string | null; to: string; by: string; note: string | null; at: string }[];
};
export type Candidate = { id: string; kind: string; title: string; status: string; issue_id: string | null };
export type IssueView = { id: string; title: string; summary: string; created_at: string; items: number; latest_draft: { version: number; hash: string; approved: boolean; author_is_me: boolean; title: string; body: string } | null };
export type CandidateResult = { candidates: Candidate[]; searched: number; complete: boolean };
/** The server answer for duplicate candidates; anything unexpected reads as 'none found, incomplete' (never a crash, never invented rows). */
export function parseCandidates(v: unknown): CandidateResult {
  const o = (v && typeof v === 'object' ? v : {}) as { candidates?: unknown; searched?: unknown; complete?: unknown };
  const list = Array.isArray(o.candidates) ? (o.candidates as Candidate[]).filter((c) => c && typeof c.id === 'string' && typeof c.title === 'string').slice(0, 10) : [];
  return { candidates: list, searched: typeof o.searched === 'number' ? o.searched : 0, complete: o.complete === true };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const parseId = (v: unknown): string | null => (typeof v === 'string' && UUID.test(v.trim()) ? v.trim().toLowerCase() : null);
export const parseStatusFilter = (v: unknown): FeedbackStatus | null => (FEEDBACK_STATUSES.includes(v as FeedbackStatus) ? (v as FeedbackStatus) : null);
const CURSOR = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+[+-][0-9]{2}(:[0-9]{2})?[|][0-9a-f-]{36}$/;
export const parseCursor = (v: unknown): string | null => (typeof v === 'string' && CURSOR.test(v) ? v : null);

type FormLike = { get(name: string): unknown };
const s = (f: FormLike, k: string): string => (typeof f.get(k) === 'string' ? (f.get(k) as string).trim() : '');
const opt = (f: FormLike, k: string): string | null => { const v = s(f, k); return v === '' ? null : v; };

export type Parsed<T> = { ok: true; args: T } | { ok: false; error: string };

export function parseStatusForm(f: FormLike): Parsed<{ p_id: string; p_to: FeedbackStatus; p_note: string | null }> {
  const id = parseId(s(f, 'id')); const to = s(f, 'to');
  if (!id) return { ok: false, error: 'Invalid feedback id.' };
  if (!FEEDBACK_STATUSES.includes(to as FeedbackStatus) || to === 'duplicate') return { ok: false, error: 'Choose a status.' };
  const note = opt(f, 'note');
  if (note && note.length > 500) return { ok: false, error: 'The note is too long (500 characters max).' };
  return { ok: true, args: { p_id: id, p_to: to as FeedbackStatus, p_note: note } };
}
export function parseIssueForm(f: FormLike): Parsed<{ p_item: string; p_title: string; p_summary: string }> {
  const id = parseId(s(f, 'id')); const title = s(f, 'title'); const summary = s(f, 'summary');
  if (!id) return { ok: false, error: 'Invalid feedback id.' };
  if (title.length < 5 || title.length > 120) return { ok: false, error: 'The issue title must be 5 to 120 characters, in your own words.' };
  if (summary.length < 10 || summary.length > 1000) return { ok: false, error: 'The summary must be 10 to 1000 characters, in your own words.' };
  return { ok: true, args: { p_item: id, p_title: title, p_summary: summary } };
}
export function parseLinkForm(f: FormLike): Parsed<{ p_item: string; p_issue: string; p_note: string | null }> {
  const id = parseId(s(f, 'id')); const issue = parseId(s(f, 'issue'));
  if (!id || !issue) return { ok: false, error: 'Invalid id.' };
  const note = opt(f, 'note');
  if (note && note.length > 500) return { ok: false, error: 'The note is too long (500 characters max).' };
  return { ok: true, args: { p_item: id, p_issue: issue, p_note: note } };
}
export function parseDraftForm(f: FormLike): Parsed<{ p_issue: string; p_title: string; p_category: string; p_problem: string; p_repro: string | null; p_expected_actual: string | null; p_platform: string | null; p_app_version: string | null; p_hint: string | null }> {
  const issue = parseId(s(f, 'issue')); const title = s(f, 'title'); const category = s(f, 'category'); const problem = s(f, 'problem'); const platform = opt(f, 'platform'); const version = opt(f, 'app_version');
  if (!issue) return { ok: false, error: 'Invalid issue id.' };
  if (title.length < 5 || title.length > 100) return { ok: false, error: 'The title must be 5 to 100 characters.' };
  if (!CATEGORIES.some((c) => c.value === category)) return { ok: false, error: 'Choose a category.' };
  if (problem.length < 10 || problem.length > 300) return { ok: false, error: 'The problem statement must be 10 to 300 characters, in your own words.' };
  if (platform && !PLATFORMS.includes(platform as (typeof PLATFORMS)[number])) return { ok: false, error: 'Choose a platform from the list.' };
  if (version && !/^[0-9]{1,3}([.][0-9]{1,3}){0,3}$/.test(version)) return { ok: false, error: 'The app version must look like 1.2.3.' };
  const repro = opt(f, 'repro'); const ea = opt(f, 'expected_actual'); const hint = opt(f, 'hint');
  if ((repro && repro.length > 500) || (ea && ea.length > 300) || (hint && hint.length > 300)) return { ok: false, error: 'One of the optional fields is too long.' };
  return { ok: true, args: { p_issue: issue, p_title: title, p_category: category, p_problem: problem, p_repro: repro, p_expected_actual: ea, p_platform: platform, p_app_version: version, p_hint: hint } };
}
export function parseApproveForm(f: FormLike): Parsed<{ p_issue: string; p_version: number; p_hash: string }> {
  const issue = parseId(s(f, 'issue')); const version = Number(s(f, 'version')); const hash = s(f, 'hash');
  if (s(f, 'reviewed') !== 'yes') return { ok: false, error: 'Confirm that you read the exact text above and found nothing personal in it before approving.' };
  if (!issue || !Number.isInteger(version) || version < 1 || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, error: 'Invalid approval request.' };
  return { ok: true, args: { p_issue: issue, p_version: version, p_hash: hash } };
}

/** Specific, kind messages for the feedback functions (falls back to the shared admin messages). */
export function feedbackAdminError(err: { code?: string; message?: string } | null | undefined): string {
  const m = (err?.message ?? '').toLowerCase();
  if (m.includes('own feedback')) return 'You cannot decide on your own feedback. Another administrator must.';
  if (m.includes('different administrator') || m.includes('from their own feedback')) return 'A different administrator must approve this draft (not its author, and not someone whose feedback it covers).';
  if (m.includes('already linked')) return 'That feedback is already linked to an issue.';
  if (m.includes('invalid status transition')) return 'That status change is not allowed from the current status. Refresh and check.';
  if (m.includes('safe public text') || m.includes('verified as safe')) return 'That text could not be verified as safe for public use. Use plain words only: no links, e-mail addresses, numbers runs, names or places.';
  if (m.includes('linked after approval') || m.includes('no longer independent')) return 'Feedback was linked after approval, so the earlier approval no longer covers this publication. Save a new version; a different administrator must approve it.';
  if (m.includes('not approved')) return 'The latest draft version is not approved yet.';
  if (m.includes('only the latest')) return 'Only the latest draft version can be approved.';
  if (m.includes('already approved')) return 'That version is already approved.';
  if (m.includes('does not match')) return 'The draft changed after this page loaded. Refresh and review the current version.';
  if (err?.code === 'P0002') return 'That item was not found.';
  return adminErrorMessage(err);
}
