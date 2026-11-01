import { PUBLICATION_REPO, evidenceFrom, parsePacket, type ReportArgs, type Sha256Hex, type TransferPacket } from '@open-stall/domain';
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
export type IssueView = { id: string; title: string; summary: string; created_at: string; items: number; latest_draft: { version: number; hash: string; approved: boolean; author_is_me: boolean; title: string; body: string; eligible: boolean; block: EligibilityBlock | null } | null };
/** Why an approved version is NOT currently eligible for export (approval itself stays immutable history). */
export type EligibilityBlock = 'unapproved' | 'links_changed' | 'not_independent';
export function eligibilityMessage(block: string | null | undefined): string | null {
  if (block === 'links_changed') return 'This version was approved, but feedback was linked to the issue after that approval, so the approval no longer covers what would be published. Nothing can be exported from it. Save a new version with your own words; a different administrator, who is not the submitter of any covered feedback, must approve it.';
  if (block === 'not_independent') return 'This version was approved, but the approval is no longer independent of the feedback it covers. Nothing can be exported from it. Save a new version; a different administrator must approve it.';
  return null;
}
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
  if (m.includes('linked after approval')) return eligibilityMessage('links_changed') ?? '';
  if (m.includes('no longer independent')) return eligibilityMessage('not_independent') ?? '';
  if (m.includes('not approved')) return 'The latest draft version is not approved yet.';
  if (m.includes('only the latest')) return 'Only the latest draft version can be approved.';
  if (m.includes('administrators cannot publish')) return 'You cannot publish a snapshot built from your own feedback. Another administrator must.';
  if (m.includes('already in progress or unresolved')) return 'A transfer is already in progress or unresolved. Record its result or reconcile it first.';
  if (m.includes('not ready to transfer')) return 'This publication is not ready to transfer. Check its state below.';
  if (m.includes('stale attempt')) return 'That result belongs to an older attempt and was ignored. Reload the page and use the current attempt.';
  if (m.includes('is not prepared')) return 'This attempt was already released or is no longer current. A released packet is never released twice: reconcile instead.';
  if (m.includes('absence is not verified')) return 'Nothing can be recorded as missing without a COMPLETE listing that started before the transfer was released. Keep it as unknown, or finish the listing.';
  if (m.includes('does not apply to the current state')) return 'That result does not apply to the current state. Reload the page.';
  if (m.includes('snapshot or its eligibility changed')) return 'The approved snapshot or its eligibility changed. Request the publication again.';
  if (m.includes('no transfer is awaiting')) return 'No transfer is awaiting a result.';
  if (m.includes('only an uncertain transfer')) return 'None-found only applies to reconciling an uncertain transfer.';
  if (m.includes('already approved')) return 'That version is already approved.';
  if (m.includes('does not match')) return 'The draft changed after this page loaded. Refresh and review the current version.';
  if (err?.code === 'P0002') return 'That item was not found.';
  return adminErrorMessage(err);
}


// ---------------------------------------------------------------- F2: reviewer-approved publication bridge (private state; no GitHub credential exists in this app)
export const PUBLICATION_STATES = ['none', 'ready', 'prepared', 'dispatched', 'uncertain', 'published', 'failed', 'conflict'] as const;
export type PublicationState = (typeof PUBLICATION_STATES)[number];
export const PUBLICATION_LABEL: Record<PublicationState, string> = {
  none: 'No publication requested', ready: 'Ready: no attempt in progress', prepared: 'Attempt prepared: nothing has been released', dispatched: 'Packet RELEASED: the outcome is not recorded yet',
  uncertain: 'Outcome UNCERTAIN: reconcile before anything else', published: 'Published and verified', failed: 'Failed attempt: reconcile before any retry', conflict: 'CONFLICT: needs verified evidence or manual resolution',
};
export type PublicationView = {
  status: PublicationState; operation?: 'create' | 'update'; version?: number; attempt?: number; marker?: string; expected_hash?: string; issue_number?: number | null; issue_url?: string | null;
  published_hash?: string | null; dispatched_at?: string | null; since?: string | null; current?: boolean; eligible: boolean; block: string | null; repo: string; packet?: TransferPacket | null;
};
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}(:\d{2})?)$/;
/** Defensive read of the server's publication view: anything unexpected reads as "none", never as invented state. The packet is re-validated field by field. */
export function parsePublication(v: unknown): PublicationView {
  const none: PublicationView = { status: 'none', eligible: false, block: null, repo: PUBLICATION_REPO };
  if (!v || typeof v !== 'object') return none;
  const o = v as Record<string, unknown>;
  if (!PUBLICATION_STATES.includes(o.status as PublicationState)) return none;
  const packet = o.packet ? parsePacket(o.packet) : null;
  return {
    status: o.status as PublicationState, operation: o.operation === 'update' ? 'update' : o.operation === 'create' ? 'create' : undefined,
    version: typeof o.version === 'number' ? o.version : undefined, attempt: typeof o.attempt === 'number' ? o.attempt : undefined, marker: typeof o.marker === 'string' ? o.marker : undefined,
    expected_hash: typeof o.expected_hash === 'string' ? o.expected_hash : undefined, issue_number: typeof o.issue_number === 'number' ? o.issue_number : null,
    issue_url: typeof o.issue_url === 'string' && /^https:\/\/github\.com\/vindexholdings\/open-stall\/issues\/[0-9]+$/.test(o.issue_url) ? o.issue_url : null,
    published_hash: typeof o.published_hash === 'string' ? o.published_hash : null,
    dispatched_at: typeof o.dispatched_at === 'string' && ISO.test(o.dispatched_at) ? o.dispatched_at : null, since: typeof o.since === 'string' && ISO.test(o.since) ? o.since : null,
    current: o.current === true, eligible: o.eligible === true, block: typeof o.block === 'string' ? o.block : null, repo: PUBLICATION_REPO, packet,
  };
}
export const REPORT_OUTCOMES = [
  { value: 'created', label: 'I created the issue (read-back below)' }, { value: 'updated', label: 'I updated the issue (read-back below)' },
  { value: 'found', label: 'Reconciliation found exactly one issue (read-back below)' },
  { value: 'none_found', label: 'Reconciliation found NO issue after a COMPLETE listing (evidence below)' },
  { value: 'multiple', label: 'Reconciliation found several issues' }, { value: 'uncertain', label: 'The outcome is unknown (timeout or no answer)' },
  { value: 'failed', label: 'The connector refused and nothing was created' }, { value: 'cancelled', label: 'Cancel this attempt (the packet was never released)' },
] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number]['value'];
/** Which results make sense in which state (the DATABASE decides; this only offers sensible choices and never offers a create after a released attempt). */
export const OUTCOMES_FOR: Record<PublicationState, readonly ReportOutcome[]> = {
  none: [], ready: [], published: [], prepared: ['cancelled'],
  dispatched: ['created', 'updated', 'uncertain', 'failed'],
  uncertain: ['found', 'none_found', 'multiple', 'uncertain'], failed: ['found', 'none_found', 'multiple'], conflict: ['found', 'multiple'],
};
const EVIDENCE_OUTCOMES = ['created', 'updated', 'found'];
/** Builds the report arguments from what the person read BACK from GitHub (repo, number, title, body); the hash and marker are computed here from that text, never typed. */
export function parseReportForm(f: FormLike, sha: Sha256Hex): Parsed<ReportArgs & { p_issue: string }> {
  const issue = parseId(s(f, 'issue')); const outcome = s(f, 'outcome'); const attempt = Number(s(f, 'attempt'));
  if (!issue) return { ok: false, error: 'Invalid issue id.' };
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 1_000_000) return { ok: false, error: 'Invalid attempt.' };
  if (!REPORT_OUTCOMES.some((o) => o.value === outcome)) return { ok: false, error: 'Choose what happened.' };
  if (outcome === 'none_found') {
    const pages = Number(s(f, 'pages')); const scanned = Number(s(f, 'scanned')); const since = s(f, 'since');
    if (s(f, 'complete') !== 'yes') return { ok: false, error: 'No issue can be recorded as missing unless you listed ALL pages of issues created since the time shown, and confirm that.' };
    if (!Number.isInteger(pages) || pages < 1 || pages > 50) return { ok: false, error: 'Enter how many pages of the listing you read (1 to 50).' };
    if (s(f, 'scanned') === '' || !Number.isInteger(scanned) || scanned < 0 || scanned > 100000) return { ok: false, error: 'Enter how many issues you looked at (0 to 100000).' };
    if (!ISO.test(since) || Number.isNaN(Date.parse(since))) return { ok: false, error: 'The listing start time is missing. Reload the page.' };
    return { ok: true, args: { p_issue: issue, p_attempt: attempt, p_outcome: 'none_found', p_since: since, p_pages: pages, p_scanned: scanned, p_complete: true } };
  }
  if (!EVIDENCE_OUTCOMES.includes(outcome)) return { ok: true, args: { p_issue: issue, p_attempt: attempt, p_outcome: outcome as ReportArgs['p_outcome'] } };
  const repo = s(f, 'repo'); const number = Number(s(f, 'number')); const title = s(f, 'rb_title'); const body = typeof f.get('rb_body') === 'string' ? (f.get('rb_body') as string) : '';
  if (!/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) return { ok: false, error: 'Enter the repository the issue is in (owner/name).' };
  if (!Number.isInteger(number) || number < 1 || number > 100000000) return { ok: false, error: 'Enter the GitHub issue number.' };
  if (title.length < 1 || title.length > 300 || body.trim().length < 1 || body.length > 20000) return { ok: false, error: 'Paste the issue title and body exactly as GitHub shows them now (the read-back).' };
  const ev = evidenceFrom(attempt, outcome as 'created' | 'found' | 'updated', { repo, number, url: `https://github.com/${repo}/issues/${number}`, title, body }, sha);
  return { ok: true, args: { p_issue: issue, ...ev } };
}
export function parseIssueOnlyForm(f: FormLike): Parsed<{ p_issue: string }> {
  const issue = parseId(s(f, 'issue'));
  return issue ? { ok: true, args: { p_issue: issue } } : { ok: false, error: 'Invalid issue id.' };
}
export function parseAttemptForm(f: FormLike): Parsed<{ p_issue: string; p_attempt: number }> {
  const issue = parseId(s(f, 'issue')); const attempt = Number(s(f, 'attempt'));
  if (!issue) return { ok: false, error: 'Invalid issue id.' };
  if (!Number.isInteger(attempt) || attempt < 1 || attempt > 1_000_000) return { ok: false, error: 'Invalid attempt.' };
  return { ok: true, args: { p_issue: issue, p_attempt: attempt } };
}
