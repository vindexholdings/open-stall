import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { NEXT_STATUS, eligibilityMessage, parsePublication, parseReportForm, parseCandidates, feedbackAdminError, parseApproveForm, parseCursor, parseDraftForm, parseId, parseIssueForm, parseLinkForm, parseStatusFilter, parseStatusForm } from './feedback';

const ID = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d5e';
const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });

describe('ids, filters and cursors are strictly shaped', () => {
  it('only a UUID is an id; only a known status is a filter; only a server-shaped cursor is a cursor', () => {
    expect(parseId(ID)).toBe(ID); expect(parseId('x')).toBeNull(); expect(parseId('../../etc')).toBeNull(); expect(parseId(`${ID}; drop`)).toBeNull();
    expect(parseStatusFilter('reviewing')).toBe('reviewing'); expect(parseStatusFilter('hacked')).toBeNull();
    expect(parseCursor(`2026-10-31T10:00:00.000000+00|${ID}`)).not.toBeNull(); expect(parseCursor('javascript:alert(1)')).toBeNull();
  });
});
describe('status form', () => {
  it('needs a valid id and a status other than duplicate', () => {
    expect(parseStatusForm(form({ id: 'x', to: 'reviewing' }))).toMatchObject({ ok: false });
    expect(parseStatusForm(form({ id: ID, to: 'duplicate' }))).toMatchObject({ ok: false });
    expect(parseStatusForm(form({ id: ID, to: 'nope' }))).toMatchObject({ ok: false });
    expect(parseStatusForm(form({ id: ID, to: 'reviewing', note: 'looking' }))).toMatchObject({ ok: true, args: { p_to: 'reviewing', p_note: 'looking' } });
    expect(parseStatusForm(form({ id: ID, to: 'reviewing', note: 'x'.repeat(501) }))).toMatchObject({ ok: false });
  });
  it('offers exactly the transitions the database allows', () => {
    expect(Object.values(NEXT_STATUS).flat()).toHaveLength(13);
    expect(NEXT_STATUS.duplicate).toEqual([]);
    expect(NEXT_STATUS.received).toEqual(['reviewing']);
  });
});
describe('issue, link, draft and approve forms', () => {
  it('issue: the reviewer writes both fields within bounds', () => {
    expect(parseIssueForm(form({ id: ID, title: 'abcd', summary: 'long enough summary text' }))).toMatchObject({ ok: false });
    expect(parseIssueForm(form({ id: ID, title: 'A good title', summary: 'short' }))).toMatchObject({ ok: false });
    expect(parseIssueForm(form({ id: ID, title: 'A good title', summary: 'A long enough summary text' }))).toMatchObject({ ok: true });
  });
  it('link needs two valid ids', () => {
    expect(parseLinkForm(form({ id: ID, issue: 'nope' }))).toMatchObject({ ok: false });
    expect(parseLinkForm(form({ id: ID, issue: ID }))).toMatchObject({ ok: true, args: { p_note: null } });
  });
  it('draft: allowlisted category/platform/version and bounded fields', () => {
    const base = { issue: ID, title: 'Pin jumps when zooming', category: 'bug', problem: 'The pin moves while the map is zoomed.' };
    expect(parseDraftForm(form(base))).toMatchObject({ ok: true });
    expect(parseDraftForm(form({ ...base, category: 'other' }))).toMatchObject({ ok: false });
    expect(parseDraftForm(form({ ...base, platform: 'windows' }))).toMatchObject({ ok: false });
    expect(parseDraftForm(form({ ...base, app_version: '1.2-beta' }))).toMatchObject({ ok: false });
    expect(parseDraftForm(form({ ...base, problem: 'short' }))).toMatchObject({ ok: false });
    expect(parseDraftForm(form({ ...base, hint: 'x'.repeat(301) }))).toMatchObject({ ok: false });
  });
  it('approve needs a version and a 64-character hash', () => {
    expect(parseApproveForm(form({ issue: ID, version: '1', hash: 'a'.repeat(64), reviewed: 'yes' }))).toMatchObject({ ok: true, args: { p_version: 1 } });
    expect(parseApproveForm(form({ issue: ID, version: '1', hash: 'a'.repeat(64) }))).toMatchObject({ ok: false });
    expect(parseApproveForm(form({ issue: ID, version: '1', hash: 'a'.repeat(64), reviewed: 'on' }))).toMatchObject({ ok: false });
    expect(parseApproveForm(form({ issue: ID, version: '0', hash: 'a'.repeat(64), reviewed: 'yes' }))).toMatchObject({ ok: false });
    expect(parseApproveForm(form({ issue: ID, version: '1', hash: 'zz', reviewed: 'yes' }))).toMatchObject({ ok: false });
  });
});
describe('error wording', () => {
  it('maps the database refusals to specific, kind messages', () => {
    expect(feedbackAdminError({ message: 'administrators cannot decide on their own feedback' })).toMatch(/own feedback/);
    expect(feedbackAdminError({ message: 'a different administrator must approve this draft' })).toMatch(/different administrator/);
    expect(feedbackAdminError({ message: 'the issue title and summary could not be verified as safe public text' })).toMatch(/safe/);
    expect(feedbackAdminError({ code: 'P0002', message: 'not found' })).toMatch(/not found/);
    expect(feedbackAdminError(null)).toMatch(/wrong/i);
  });

  it('reads the candidate answer defensively', () => {
    expect(parseCandidates(null)).toEqual({ candidates: [], searched: 0, complete: false });
    expect(parseCandidates([{ id: 'x' }])).toEqual({ candidates: [], searched: 0, complete: false });
    const r = parseCandidates({ candidates: [{ id: 'a', title: 'T', kind: 'bug', status: 'received', issue_id: null }, { id: 5 }], searched: 200, complete: false });
    expect(r.candidates).toHaveLength(1); expect(r.searched).toBe(200); expect(r.complete).toBe(false);
  });
  it('distinguishes approval history from current eligibility', () => {
    expect(eligibilityMessage(null)).toBeNull();
    expect(eligibilityMessage('unapproved')).toBeNull();
    expect(eligibilityMessage('links_changed')).toMatch(/linked to the issue after that approval/);
    expect(eligibilityMessage('links_changed')).toMatch(/Save a new version/);
    expect(eligibilityMessage('not_independent')).toMatch(/no longer independent/);
  });
  it('explains an approval revoked by a later link', () => {
    expect(feedbackAdminError({ message: 'feedback was linked after approval; a new independent approval is required' })).toMatch(/new version/);
  });

  describe('F2 publication bridge', () => {
    const sha = (t: string) => createHash('sha256').update(t, 'utf8').digest('hex');
    const MARK = 'OSFB-0123456789abcdef0123';
    const BODY = `Category: bug\nProblem: The pin jumps\n\nFeedback reference: ${MARK}`;
    const f = (o: Record<string, string>) => form({ issue: ID, ...o });
    it('computes the hash and marker from the pasted read-back (never typed)', () => {
      const r = parseReportForm(f({ outcome: 'created', repo: 'vindexholdings/open-stall', number: '41', rb_title: 'Pin jumps', rb_body: BODY }), sha);
      expect(r).toMatchObject({ ok: true, args: { p_issue: ID, p_outcome: 'created', p_repo: 'vindexholdings/open-stall', p_number: 41, p_url: 'https://github.com/vindexholdings/open-stall/issues/41', p_marker: MARK } });
      if (r.ok) expect(r.args.p_readback_hash).toBe(sha(`Pin jumps\u001e${BODY}`));
    });
    it('tolerates GitHub line endings and a trailing newline, nothing else', () => {
      const a = parseReportForm(f({ outcome: 'found', repo: 'vindexholdings/open-stall', number: '41', rb_title: 'Pin jumps', rb_body: BODY.replace(/\n/g, '\r\n') + '\r\n' }), sha);
      const b = parseReportForm(f({ outcome: 'found', repo: 'vindexholdings/open-stall', number: '41', rb_title: 'Pin jumps', rb_body: BODY }), sha);
      expect(a.ok && b.ok && a.args.p_readback_hash === b.args.p_readback_hash).toBe(true);
      const c = parseReportForm(f({ outcome: 'found', repo: 'vindexholdings/open-stall', number: '41', rb_title: 'Pin jumps', rb_body: BODY.replace('jumps', 'moves') }), sha);
      expect(c.ok && a.ok && c.args.p_readback_hash !== a.args.p_readback_hash).toBe(true);
    });
    it('a read-back without the reference line carries no marker (the server then fails closed)', () => {
      const r = parseReportForm(f({ outcome: 'created', repo: 'vindexholdings/open-stall', number: '41', rb_title: 'Pin jumps', rb_body: 'Problem: x' }), sha);
      expect(r.ok && r.args.p_marker).toBeNull();
    });
    it('outcomes without evidence need no read-back and send none', () => {
      for (const o of ['none_found', 'multiple', 'uncertain', 'failed']) {
        const r = parseReportForm(f({ outcome: o }), sha);
        expect(r).toEqual({ ok: true, args: { p_issue: ID, p_outcome: o } });
      }
    });
    it('refuses unknown outcomes, bad ids, bad repos, bad numbers and missing read-backs', () => {
      expect(parseReportForm(f({ outcome: 'bogus' }), sha).ok).toBe(false);
      expect(parseReportForm(form({ outcome: 'failed', issue: 'x' }), sha).ok).toBe(false);
      for (const bad of [{ repo: 'no-slash' }, { repo: 'a/b/c' }, { number: '0' }, { number: 'abc' }, { number: '1.5' }, { rb_title: '' }, { rb_body: '   ' }]) {
        expect(parseReportForm(f({ outcome: 'created', repo: 'vindexholdings/open-stall', number: '41', rb_title: 'T', rb_body: BODY, ...bad }), sha).ok).toBe(false);
      }
    });
    it('reads the server view defensively and re-validates the packet', () => {
      expect(parsePublication(null).status).toBe('none');
      expect(parsePublication({ status: 'hacked' }).status).toBe('none');
      const packet = { repo: 'vindexholdings/open-stall', operation: 'create', issue_number: null, marker: MARK, version: 1, title: 'T', body: BODY, expected_hash: 'a'.repeat(64) };
      expect(parsePublication({ status: 'awaiting_transfer', eligible: true, block: null, packet }).packet).toEqual(packet);
      expect(parsePublication({ status: 'awaiting_transfer', packet: { ...packet, issue_id: 'x' } }).packet).toBeNull();
      expect(parsePublication({ status: 'published', issue_number: 7, issue_url: 'https://evil.example/x/issues/7' }).issue_url).toBeNull();
      expect(parsePublication({ status: 'published', issue_number: 7, issue_url: 'https://github.com/vindexholdings/open-stall/issues/7' }).issue_url).toMatch(/issues\/7$/);
    });
    it('explains publication refusals kindly', () => {
      expect(feedbackAdminError({ message: 'administrators cannot publish a snapshot built from their own feedback' })).toMatch(/own feedback/);
      expect(feedbackAdminError({ message: 'a transfer is already in progress or unresolved; reconcile it first' })).toMatch(/reconcile/);
      expect(feedbackAdminError({ message: 'the approved snapshot or its eligibility changed; request the publication again' })).toMatch(/Request the publication again/);
    });
  });
});
