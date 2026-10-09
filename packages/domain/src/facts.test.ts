import { describe, expect, it } from 'vitest';
import { communityRatingDetail, communityRatingText, describeFacts, factMark, provenanceNotes, hoursLabel, quickFacts, ratingLabel, UNVERIFIED_EXPLANATION, verificationBadge } from './facts';
import type { PublicLocation } from './publicLocation';

const loc = { keyRequired: true, purchaseRequired: false, wheelchairAccessible: null, feeRequired: true } as PublicLocation;

describe('describeFacts', () => {
  it('distinguishes yes, no and not reported', () => {
    const { access } = describeFacts(loc);
    const by = Object.fromEntries(access.map((f) => [f.key, f.text]));
    expect(by.key).toBe('Yes');
    expect(by.purchase).toBe('No');
    expect(by.wheelchair).toBe('Not reported');
    expect(by.fee).toBe('Yes');
  });
});

describe('labels', () => {
  it('badges verified (with UTC month) and unverified locations', () => {
    expect(verificationBadge({ verification: 'verified', lastVerifiedAt: '2026-03-15T12:00:00Z' })).toEqual({ kind: 'verified', label: 'Verified Mar 2026' });
    expect(verificationBadge({ verification: 'verified', lastVerifiedAt: null }).label).toBe('Verified');
    expect(verificationBadge({ verification: 'verified', lastVerifiedAt: 'garbage' }).label).toBe('Verified');
    expect(verificationBadge({ verification: 'unverified', lastVerifiedAt: '2026-03-15T12:00:00Z' })).toEqual({ kind: 'unverified', label: 'Unverified' });
  });
  it('formats ratings', () => {
    expect(ratingLabel(null, 0)).toBe('No ratings yet');
    expect(ratingLabel(4.25, 1)).toBe('4.3 / 5 (1 rating)');
    expect(ratingLabel(3, 12)).toBe('3.0 / 5 (12 ratings)');
  });
});

describe('hoursLabel', () => {
  it('flags source hours as possibly inaccurate and reports missing hours honestly', () => {
    expect(hoursLabel('Mo-Su 08:00-20:00')).toEqual({ text: 'Mo-Su 08:00-20:00 (from public sources, may be inaccurate)', reported: true });
    expect(hoursLabel(null)).toEqual({ text: 'Not reported', reported: false });
    expect(hoursLabel('  ').reported).toBe(false);
  });
});

describe('result card highlights (R1)', () => {
  it('shows only known facts and never turns unknown into a negative', () => {
    expect(quickFacts({ keyRequired: null, purchaseRequired: null, feeRequired: null, wheelchairAccessible: null })).toEqual([]);
    expect(quickFacts({ keyRequired: false, purchaseRequired: true, feeRequired: true, wheelchairAccessible: true })).toEqual([
      'No key needed', 'Purchase required', 'Fee to use', 'Wheelchair accessible',
    ]);
    expect(quickFacts({ keyRequired: true, purchaseRequired: false, feeRequired: false, wheelchairAccessible: false })).toEqual([
      'Key required', 'No purchase needed',
    ]);
  });
  it('labels ratings as community ratings and omits them when there are none', () => {
    expect(communityRatingText(null, 0)).toBeNull();
    expect(communityRatingText(4.25, 0)).toBeNull();
    expect(communityRatingText(4.2, 12)).toBe('Community rating 4.2 / 5 (12 ratings)');
    expect(communityRatingText(5, 1)).toBe('Community rating 5.0 / 5 (1 rating)');
  });
});

describe('detail presentation (R2)', () => {
  it('marks every fact value with a symbol and a word', () => {
    expect(factMark('yes')).toEqual({ symbol: '✓', text: 'Yes' });
    expect(factMark('no')).toEqual({ symbol: '✕', text: 'No' });
    expect(factMark('unknown')).toEqual({ symbol: '?', text: 'Not reported' });
  });
  it('labels ratings as community ratings and states when there are none', () => {
    expect(communityRatingDetail(4.25, 12).headline).toBe('Community rating 4.3 / 5 (12 ratings)');
    expect(communityRatingDetail(4.25, 12).hasRatings).toBe(true);
    for (const d of [communityRatingDetail(null, 0), communityRatingDetail(4, 0), communityRatingDetail(null, 3)]) {
      expect(d.hasRatings).toBe(false);
      expect(d.headline).toBe('No community ratings yet');
    }
    expect(communityRatingDetail(null, 0).note).toMatch(/separate from verification/);
  });
  it('describes provenance without overclaiming', () => {
    const verified = provenanceNotes({ verification: 'verified', lastVerifiedAt: '2026-09-01T00:00:00Z', attribution: null });
    expect(verified[0]).toMatch(/^Verified Sep 2026: Open Stall confirmed this restroom exists/);
    const unverified = provenanceNotes({ verification: 'unverified', lastVerifiedAt: null, attribution: '© Contributors' });
    expect(unverified[0]).toBe('Unverified: Open Stall has not confirmed this restroom yet.');
    expect(unverified.at(-1)).toBe('© Contributors');
    for (const n of [verified, unverified]) expect(n.join(' ')).toMatch(/“Not reported” are unknown/);
    expect(verified.join(' ')).not.toMatch(/community/i);
    // No blanket source claim: without attribution nothing says where the details came from.
    for (const l of [{ verification: 'verified' as const, lastVerifiedAt: null, attribution: null }, { verification: 'unverified' as const, lastVerifiedAt: null, attribution: null }]) {
      expect(provenanceNotes(l).join(' ')).not.toMatch(/public source|openstreetmap|from .* sources/i);
    }
    expect(UNVERIFIED_EXPLANATION).not.toMatch(/public source/i);
    expect(provenanceNotes({ verification: 'verified', lastVerifiedAt: null, attribution: null }).at(-1)).toBe('Details can change. If something here is out of date, tell us.');
  });
});
