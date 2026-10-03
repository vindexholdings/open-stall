import { describe, expect, it } from 'vitest';
import { describeFacts, ratingLabel, verificationLabel } from './facts';
import type { PublicLocation } from './publicLocation';

const loc = { keyRequired: true, purchaseRequired: false, wheelchairAccessible: null } as PublicLocation;

describe('describeFacts', () => {
  it('distinguishes yes, no and not reported', () => {
    const { access } = describeFacts(loc);
    const by = Object.fromEntries(access.map((f) => [f.key, f.text]));
    expect(by.key).toBe('Yes');
    expect(by.purchase).toBe('No');
    expect(by.wheelchair).toBe('Not reported');
  });
});

describe('labels', () => {
  it('formats verification date in UTC', () => {
    expect(verificationLabel('2026-03-15T12:00:00Z')).toBe('Verified Mar 2026');
    expect(verificationLabel(null)).toBe('Verified');
    expect(verificationLabel('garbage')).toBe('Verified');
  });
  it('formats ratings', () => {
    expect(ratingLabel(null, 0)).toBe('No ratings yet');
    expect(ratingLabel(4.25, 1)).toBe('4.3 / 5 (1 rating)');
    expect(ratingLabel(3, 12)).toBe('3.0 / 5 (12 ratings)');
  });
});
