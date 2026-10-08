import { describe, expect, it } from 'vitest';
import { adminAccess, adminErrorMessage, parseDecision, parseReportResolution, REJECTION_REASONS } from './moderation';

const ID = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d5e';
const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe('parseDecision', () => {
  it('requires a valid id and a known decision', () => {
    expect(parseDecision(form({ id: 'x', decision: 'approve' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'delete' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'approve' }))).toMatchObject({ ok: true, args: { p_id: ID, p_decision: 'approve', p_reason: null, p_note: null } });
  });
  it('rejection needs one of the six codes; duplicate is not a code; other needs a note', () => {
    expect(REJECTION_REASONS.map((r) => r.code)).toEqual(['private_or_residential', 'not_public_or_not_a_restroom', 'insufficient_or_unverifiable', 'invalid_or_inaccurate', 'spam_or_abuse', 'other']);
    expect(parseDecision(form({ id: ID, decision: 'reject' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'reject', reason: 'duplicate' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'reject', reason: 'other' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'reject', reason: 'other', note: 'ab' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'reject', reason: 'other', note: 'unclear what this is' }))).toMatchObject({ ok: true });
    expect(parseDecision(form({ id: ID, decision: 'reject', reason: 'spam_or_abuse' }))).toMatchObject({ ok: true, args: { p_reason: 'spam_or_abuse' } });
  });
  it('a reason is only sent with reject', () => {
    expect(parseDecision(form({ id: ID, decision: 'approve', reason: 'spam_or_abuse' }))).toMatchObject({ ok: true, args: { p_reason: null } });
  });
  it('duplicate must link a valid existing restroom id', () => {
    expect(parseDecision(form({ id: ID, decision: 'duplicate' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'duplicate', duplicate_of: 'nope' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'duplicate', duplicate_of: ID }))).toMatchObject({ ok: true, args: { p_duplicate_of: ID } });
  });
  it('edit_approve needs at least one edited field and sends only filled ones', () => {
    expect(parseDecision(form({ id: ID, decision: 'edit_approve' }))).toMatchObject({ ok: false });
    expect(parseDecision(form({ id: ID, decision: 'edit_approve', edit_name: ' Park Restroom ', edit_city: '' }))).toMatchObject({ ok: true, args: { p_edits: { name: 'Park Restroom' } } });
  });
  it('limits note length', () => {
    expect(parseDecision(form({ id: ID, decision: 'hold', note: 'x'.repeat(1001) }))).toMatchObject({ ok: false });
  });
});

describe('report resolution and access', () => {
  it('parses report resolutions', () => {
    expect(parseReportResolution(form({ id: ID, resolution: 'resolved', note: 'ok' }))).toEqual({ ok: true, id: ID, resolution: 'resolved', note: 'ok' });
    expect(parseReportResolution(form({ id: ID, resolution: 'deleted' }))).toMatchObject({ ok: false });
  });
  it('maps admin status to access (MFA required)', () => {
    expect(adminAccess(false, null)).toBe('signed_out');
    expect(adminAccess(true, null)).toBe('not_admin');
    expect(adminAccess(true, { admin: false, mfa: true })).toBe('not_admin');
    expect(adminAccess(true, { admin: true, mfa: false })).toBe('needs_mfa');
    expect(adminAccess(true, { admin: true, mfa: true })).toBe('ok');
  });
  it('explains errors without leaking backend text', () => {
    expect(adminErrorMessage({ code: '42501', message: 'multi-factor authentication required' })).toMatch(/Multi-factor/);
    expect(adminErrorMessage({ code: '42501', message: 'administrators cannot adjudicate their own submissions' })).toMatch(/Another administrator/);
    expect(adminErrorMessage({ code: '42501', message: 'cannot review a restroom you contributed' })).toMatch(/Another administrator/);
    expect(adminErrorMessage({ code: '22023', message: 'submission already decided' })).toMatch(/already handled/);
    expect(adminErrorMessage({ message: 'relation "public.secret" does not exist' })).toBe('Something went wrong. Please try again.');
  });
});
