import { describe, expect, it } from 'vitest';
import { describeFacts, hoursLabel, ratingLabel, verificationBadge } from './facts';
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
    expect(hoursLabel('Mo-Su 08:00-20:00')).toEqual({ text: 'Mo-Su 08:00-20:00 (from map data, may be inaccurate)', reported: true });
    expect(hoursLabel(null)).toEqual({ text: 'Not reported', reported: false });
    expect(hoursLabel('  ').reported).toBe(false);
  });
});
