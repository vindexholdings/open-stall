import { describe, expect, it } from 'vitest';
import { NEXT_STATUS, parseCandidates, feedbackAdminError, parseApproveForm, parseCursor, parseDraftForm, parseId, parseIssueForm, parseLinkForm, parseStatusFilter, parseStatusForm } from './feedback';

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
  it('explains an approval revoked by a later link', () => {
    expect(feedbackAdminError({ message: 'feedback was linked after approval; a new independent approval is required' })).toMatch(/new version/);
  });
});
