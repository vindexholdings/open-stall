import { describe, expect, it } from 'vitest';
import {
  EMPTY_FEEDBACK, diagnosticsLines, feedbackDiagnostics, feedbackErrorMessage, feedbackTextProblem, newFeedbackKey, parseFeedbackDetail, parseFeedbackList, parseSubmitResult, validateFeedbackDraft,
  type FeedbackDraft,
} from './feedback';

const ok: FeedbackDraft = { ...EMPTY_FEEDBACK, kind: 'bug', screen: 'map', title: 'The pin does not move', description: 'When I drag the map the pin stays in place for a while.' };
const ID = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d21';
const item = { id: ID, kind: 'bug', screen: 'map', title: 'The pin does not move', status: 'received', outcome: 'We received this.', created_at: '2026-10-31T10:00:00+00', updated_at: '2026-10-31T10:00:00+00' };

describe('text rules mirror the server', () => {
  it.each([
    ['plain text', 'The pin jumps when I zoom in on 2026-10-31 in version 1.2.', null],
    ['markup', 'see <b>this</b>', 'symbols'], ['a link', 'go to https://example.org now', 'links'], ['a bare domain', 'happens on example.com a lot', 'links'],
    ['an e-mail address', 'mail me at person@example.org', 'e-mail'], ['a phone number', 'call 307-555-0100', 'phone'], ['a long digit run', 'number 3075550100', 'phone'],
    ['coordinates', 'it was at 44.52631 exactly', 'coordinates'], ['a token', 'key abcdefghijklmnopqrstuvwxyz0123456789ABCDEF', 'codes'], ['a control character', 'bell \u0007 here', 'control'],
  ])('%s', (_n, text, expected) => {
    const p = feedbackTextProblem(text);
    if (expected === null) expect(p).toBeNull(); else expect(p).toMatch(new RegExp(expected, 'i'));
  });
});

describe('validateFeedbackDraft', () => {
  it('accepts a good draft', () => expect(validateFeedbackDraft(ok)).toEqual([]));
  it('asks for every missing piece, field by field', () => {
    const f = validateFeedbackDraft(EMPTY_FEEDBACK).map((e) => e.field);
    expect(f).toEqual(['kind', 'screen', 'title', 'description']);
  });
  it('enforces lengths and optional fields', () => {
    expect(validateFeedbackDraft({ ...ok, title: 'abcd' }).map((e) => e.field)).toEqual(['title']);
    expect(validateFeedbackDraft({ ...ok, description: 'x'.repeat(2001) }).map((e) => e.field)).toEqual(['description']);
    expect(validateFeedbackDraft({ ...ok, expected: 'x'.repeat(501), steps: 'y'.repeat(1001) }).map((e) => e.field)).toEqual(['expected', 'steps']);
    expect(validateFeedbackDraft({ ...ok, actual: 'see https://example.org' }).map((e) => e.field)).toEqual(['actual']);
  });
});

describe('diagnostics are an allowlist of two values', () => {
  it('passes only a known platform and a numeric version', () => {
    expect(feedbackDiagnostics('ios', '1.2.3')).toEqual({ platform: 'ios', appVersion: '1.2.3' });
    expect(feedbackDiagnostics('windows', '1.2.3-beta; x')).toEqual({ platform: null, appVersion: null });
    expect(feedbackDiagnostics('web', undefined)).toEqual({ platform: 'web', appVersion: null });
  });
  it('lists exactly what is sent', () => {
    expect(diagnosticsLines({ platform: 'android', appVersion: '2.0' })).toEqual(['App version: 2.0', 'Device type: Android']);
    expect(diagnosticsLines({ platform: null, appVersion: null })).toEqual(['App version: not shared', 'Device type: not shared']);
  });
});

describe('retry key', () => {
  it('is 16 to 64 safe characters', () => {
    expect(newFeedbackKey('A1B2C3D4E5F60718293A4B5C6D7E8F90ffff')).toMatch(/^fb-[a-f0-9]{16,40}$/);
    expect(newFeedbackKey('')).toMatch(/^fb-0{16}$/);
    expect(newFeedbackKey('zz!!')).toMatch(/^[A-Za-z0-9_-]{16,64}$/);
  });
});

describe('parsing untrusted responses', () => {
  it('accepts a list and a detail', () => {
    expect(parseFeedbackList({ items: [item], next_cursor: null })).toEqual({ items: [expect.objectContaining({ id: ID, status: 'received' })], nextCursor: null });
    expect(parseFeedbackDetail({ ...item, description: 'A longer description here.', timeline: [{ status: 'received', at: '2026-10-31T10:00:00+00' }] })).toMatchObject({ id: ID, timeline: [{ status: 'received' }] });
    expect(parseSubmitResult({ id: ID, status: 'received', replayed: true })).toEqual({ id: ID, replayed: true });
  });
  it.each([null, 'x', { items: 'x' }, { items: [{ ...item, status: 'weird' }] }, { items: [{ ...item, id: 'nope' }] }, { items: [item], next_cursor: 'bad' }, { items: new Array(21).fill(item) }])('rejects malformed %#', (bad) =>
    expect(parseFeedbackList(bad)).toBeNull());
  it('rejects a detail without a description or with a bad timeline', () => {
    expect(parseFeedbackDetail({ ...item, timeline: [] })).toBeNull();
    expect(parseFeedbackDetail({ ...item, description: 'A longer description here.', timeline: [{ status: 'nope', at: 'x' }] })).toBeNull();
    expect(parseSubmitResult({ id: 'x' })).toBeNull();
  });
});

describe('error wording', () => {
  it('is kind and never repeats server internals', () => {
    expect(feedbackErrorMessage({ code: '53400' })).toMatch(/later/);
    expect(feedbackErrorMessage({ code: '28000' })).toMatch(/sign in/i);
    expect(feedbackErrorMessage({ code: '22023', message: 'feedback text may not contain person@example.org' })).not.toMatch(/person@/);
    expect(feedbackErrorMessage(null)).toMatch(/try again/i);
  });
});
