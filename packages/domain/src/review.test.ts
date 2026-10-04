import { describe, expect, it } from 'vitest';
import { accessFacts, deriveAccess, deriveWater, parseReviewForm, reviewOutcome, waterFacts, type ReviewInput } from './review';

const now = new Date('2026-10-06T00:00:00Z');
const form = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
const base = { reviewer: 'Test Person', existence: 'exists', access: 'unknown', wheelchair_accessible: 'unknown', gender_neutral: 'unknown', baby_changing: 'unknown', hot_water: 'unknown', cold_water_only: 'unknown' };
const parse = (o: Record<string, string> = {}) => parseReviewForm(form({ ...base, ...o }), now);
const errs = (o: Record<string, string>) => {
  const r = parse(o);
  return r.ok ? '' : r.errors.join(' | ');
};

describe('parseReviewForm', () => {
  it('preserves simultaneous purchase and key requirements with unknown fees', () => {
    const r = parse({ access_mode: 'independent', key_required: 'yes', purchase_required: 'yes', fee_required: 'unknown' });
    expect(r.ok && r.input).toMatchObject({ key_required: true, purchase_required: true, fee_required: null });
    expect(errs({ access_mode: 'independent', key_required: 'maybe' })).toContain('Yes, No or Unknown');
  });

  it('keeps everything unknown (null) unless explicitly answered, and never verifies by default', () => {
    const r = parse();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.input).toMatchObject({ wheelchair_accessible: null, gender_neutral: null, baby_changing: null, hot_water: null, cold_water_only: null, personally_verified: false, verified_on: null, notes: null });
    }
  });

  it('maps yes/no/unknown to true/false/null', () => {
    const r = parse({ wheelchair_accessible: 'yes', baby_changing: 'no', gender_neutral: 'unknown' });
    expect(r.ok && [r.input.wheelchair_accessible, r.input.baby_changing, r.input.gender_neutral]).toEqual([true, false, null]);
  });

  it('personal verification needs an explicit tick, a real past date, and an existing restroom', () => {
    expect(errs({ personally_verified: 'on' })).toContain('verification date is required');
    expect(errs({ personally_verified: 'on', verified_on: '2026-12-31' })).toContain('future');
    expect(errs({ personally_verified: 'on', verified_on: 'soon' })).toContain('real date');
    expect(errs({ personally_verified: 'on', verified_on: '2026-10-05', existence: 'not_exists' })).toContain('Only a restroom that exists');
    expect(errs({ personally_verified: 'on', verified_on: '2026-10-05', existence: 'unsure' })).toContain('Only a restroom that exists');
    const ok = parse({ personally_verified: 'on', verified_on: '2026-10-05' });
    expect(ok.ok && ok.input.personally_verified && ok.input.verified_on).toBe('2026-10-05');
  });

  it('ignores a stray date when not personally verified', () => {
    const r = parse({ verified_on: '2026-10-05' });
    expect(r.ok && r.input.verified_on).toBeNull();
  });

  it('rejects invalid choices, missing reviewer, long/control notes, and contradictory water facts', () => {
    expect(errs({ existence: 'maybe' })).toContain('Choose whether');
    expect(errs({ access: 'free' })).toContain('access option');
    expect(errs({ reviewer: '  ' })).toContain('Reviewer name');
    expect(errs({ notes: 'x'.repeat(1001) })).toContain('1000');
    expect(errs({ notes: 'bad\u0000note' })).toContain('control');
    expect(errs({ wheelchair_accessible: 'maybe' })).toContain('Yes, No or Unknown');
    expect(errs({ hot_water: 'yes', cold_water_only: 'yes' })).toContain('cannot both');
  });
});

describe('facts mapping', () => {
  it('access choices set only what they state', () => {
    expect(accessFacts('public_free')).toEqual({ key_required: false, purchase_required: false, fee_required: false });
    expect(accessFacts('customers_only')).toEqual({ key_required: null, purchase_required: true, fee_required: null });
    expect(accessFacts('key_required')).toEqual({ key_required: true, purchase_required: null, fee_required: null });
    expect(accessFacts('unknown')).toEqual({ key_required: null, purchase_required: null, fee_required: null });
  });
  it('cold-water-only implies hot=false; hot yes does not assume cold', () => {
    expect(waterFacts(null, true)).toEqual({ has_hot_water: false, has_cold_water: true });
    expect(waterFacts(true, null)).toEqual({ has_hot_water: true, has_cold_water: null });
    expect(waterFacts(false, false)).toEqual({ has_hot_water: false, has_cold_water: null });
    expect(waterFacts(null, null)).toEqual({ has_hot_water: null, has_cold_water: null });
  });
});

describe('reviewOutcome', () => {
  const input = (o: Partial<ReviewInput>): ReviewInput => ({
    reviewer: 'x', existence: 'exists', access: 'unknown', wheelchair_accessible: null, gender_neutral: null, baby_changing: null,
    hot_water: null, cold_water_only: null, notes: null, personally_verified: false, verified_on: null, ...o,
  });
  it('does not exist -> closed and hidden', () => {
    expect(reviewOutcome('unverified', input({ existence: 'not_exists' }))).toMatchObject({ status: 'closed', publicAfter: false, applyFacts: false });
  });
  it('Verified only with explicit personal confirmation', () => {
    expect(reviewOutcome('candidate', input({ personally_verified: true, verified_on: '2026-10-05' }))).toMatchObject({ status: 'verified', publicAfter: true });
    expect(reviewOutcome('candidate', input({}))).toMatchObject({ status: 'unverified', publicAfter: true });
    expect(reviewOutcome('unverified', input({}))).toMatchObject({ status: 'unverified' });
    expect(reviewOutcome('closed', input({}))).toMatchObject({ status: 'unverified' });
  });
  it('an already verified record is never downgraded by a non-verifying review', () => {
    expect(reviewOutcome('verified', input({}))).toMatchObject({ status: 'verified' });
  });
  it('unsure changes nothing', () => {
    for (const s of ['candidate', 'unverified', 'verified', 'closed'] as const) {
      expect(reviewOutcome(s, input({ existence: 'unsure' }))).toMatchObject({ status: s, applyFacts: false });
    }
    expect(reviewOutcome('candidate', input({ existence: 'unsure' })).publicAfter).toBe(false);
  });
});

describe('pre-selection from stored facts', () => {
  it('derives the access choice and water answers (round-trips with the mapping)', () => {
    for (const a of ['public_free', 'customers_only', 'key_required', 'unknown'] as const) {
      expect(deriveAccess(accessFacts(a))).toBe(a);
    }
    expect(deriveWater({ has_hot_water: false, has_cold_water: true })).toEqual({ hot_water: false, cold_water_only: true });
    expect(deriveWater({ has_hot_water: true, has_cold_water: null })).toEqual({ hot_water: true, cold_water_only: false });
    expect(deriveWater({ has_hot_water: null, has_cold_water: null })).toEqual({ hot_water: null, cold_water_only: null });
  });
});
