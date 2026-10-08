import { parseLocationId } from '@open-stall/domain';

/** Internal rejection codes (owner decision 7). `duplicate` is deliberately NOT one of them. */
export const REJECTION_REASONS = [
  { code: 'private_or_residential', label: 'Private or residential' },
  { code: 'not_public_or_not_a_restroom', label: 'Not public / not a restroom' },
  { code: 'insufficient_or_unverifiable', label: 'Insufficient or unverifiable' },
  { code: 'invalid_or_inaccurate', label: 'Invalid or inaccurate' },
  { code: 'spam_or_abuse', label: 'Spam or abuse' },
  { code: 'other', label: 'Other (note required)' },
] as const;
export type RejectionCode = (typeof REJECTION_REASONS)[number]['code'];

export const SUBMISSION_DECISIONS = ['approve', 'edit_approve', 'reject', 'duplicate', 'hold', 'release'] as const;
export type SubmissionDecision = (typeof SUBMISSION_DECISIONS)[number];

type FormLike = { get(name: string): unknown };
const str = (f: FormLike, k: string): string => (typeof f.get(k) === 'string' ? (f.get(k) as string).trim() : '');

export type DecisionArgs = {
  p_id: string;
  p_decision: SubmissionDecision;
  p_reason: RejectionCode | null;
  p_note: string | null;
  p_edits: Record<string, string> | null;
  p_duplicate_of: string | null;
};
export type ParsedDecision = { ok: true; args: DecisionArgs } | { ok: false; error: string };

const EDITABLE_TEXT = ['name', 'address_line', 'city', 'region', 'postal_code', 'access_location', 'opening_hours'] as const;

/** Validates the decision form. The database re-validates everything; this gives instant, specific feedback. */
export function parseDecision(f: FormLike): ParsedDecision {
  const id = parseLocationId(str(f, 'id'));
  if (!id) return { ok: false, error: 'Invalid submission id.' };
  const decision = str(f, 'decision') as SubmissionDecision;
  if (!SUBMISSION_DECISIONS.includes(decision)) return { ok: false, error: 'Choose a decision.' };
  const note = str(f, 'note');
  if (note.length > 1000) return { ok: false, error: 'The note is too long (1000 characters max).' };

  let reason: RejectionCode | null = null;
  if (decision === 'reject') {
    const r = str(f, 'reason');
    const found = REJECTION_REASONS.find((x) => x.code === r);
    if (!found) return { ok: false, error: 'Choose a rejection reason.' };
    if (found.code === 'other' && note.length < 3) return { ok: false, error: 'A note is required when the reason is Other.' };
    reason = found.code;
  }

  let dup: string | null = null;
  if (decision === 'duplicate') {
    dup = parseLocationId(str(f, 'duplicate_of'));
    if (!dup) return { ok: false, error: 'Enter the id of the existing restroom this duplicates.' };
  }

  let edits: Record<string, string> | null = null;
  if (decision === 'edit_approve') {
    const e: Record<string, string> = {};
    for (const k of EDITABLE_TEXT) {
      const v = str(f, `edit_${k}`);
      if (v) e[k] = v;
    }
    if (Object.keys(e).length === 0) return { ok: false, error: 'Fill in at least one field to edit before approving.' };
    edits = e;
  }
  return { ok: true, args: { p_id: id, p_decision: decision, p_reason: reason, p_note: note || null, p_edits: edits, p_duplicate_of: dup } };
}

export type ReportParse = { ok: true; id: string; resolution: 'resolved' | 'dismissed'; note: string | null } | { ok: false; error: string };
export function parseReportResolution(f: FormLike): ReportParse {
  const id = parseLocationId(str(f, 'id'));
  if (!id) return { ok: false, error: 'Invalid report id.' };
  const resolution = str(f, 'resolution');
  if (resolution !== 'resolved' && resolution !== 'dismissed') return { ok: false, error: 'Choose resolved or dismissed.' };
  const note = str(f, 'note');
  if (note.length > 1000) return { ok: false, error: 'The note is too long (1000 characters max).' };
  return { ok: true, id, resolution, note: note || null };
}

export type AdminStatus = { admin: boolean; mfa: boolean } | null;
export type AdminAccess = 'signed_out' | 'not_admin' | 'needs_mfa' | 'ok';

/** UI routing only. The database enforces the same rule on every admin call (listed + not disabled + aal2). */
export function adminAccess(signedIn: boolean, status: AdminStatus): AdminAccess {
  if (!signedIn) return 'signed_out';
  if (!status || !status.admin) return 'not_admin';
  return status.mfa ? 'ok' : 'needs_mfa';
}

/** Friendly message for a failed admin call. Never echoes raw backend text. */
export function adminErrorMessage(err: { code?: string; message?: string } | null | undefined): string {
  const m = (err?.message ?? '').toLowerCase();
  if (m.includes('multi-factor')) return 'Multi-factor verification is required. Verify your code and try again.';
  if (m.includes('their own')) return 'You cannot decide your own submissions or reports. Another administrator must.';
  if (m.includes('you contributed')) return 'You cannot review a restroom you contributed. Another administrator must.';
  if (m.includes('not an administrator') || err?.code === '42501') return 'You are not authorized to do that.';
  if (m.includes('already decided') || m.includes('already handled')) return 'That item was already handled by someone else. Refresh the queue.';
  if (m.includes('already on hold') || m.includes('not on hold')) return 'The hold state changed. Refresh the queue.';
  if (m.includes('reason')) return 'A valid rejection reason (and a note for Other) is required.';
  if (m.includes('duplicate')) return 'Link the existing restroom this duplicates.';
  if (m.includes('location not available')) return 'The restroom this correction targets is no longer available.';
  if (err?.code === '22023') return 'Some details were not accepted. Check them and try again.';
  return 'Something went wrong. Please try again.';
}
