import { describe, expect, it } from 'vitest';
import { applyFilters, countActiveFilters, DEFAULT_FILTERS } from './filters';
import type { NearbyLocation } from './nearby';

// Synthetic, in-memory fixtures only.
const base = {
  addressLine: null, city: null, region: null, postalCode: null,
  coordinates: { latitude: 0, longitude: 0 }, lastVerifiedAt: null, attribution: null,
  wheelchairAccessible: null, genderNeutral: null, babyChanging: null,
  hasHotWater: null, hasColdWater: null, keyRequired: null, purchaseRequired: null,
  accessLocation: null, averageRating: null, ratingCount: 0, distanceMeters: 100,
};
const mk = (name: string, over: Partial<NearbyLocation> = {}): NearbyLocation => ({
  ...base, id: name, name, ...over,
});

const names = (l: NearbyLocation[]) => l.map((x) => x.name);

describe('applyFilters', () => {
  const data = [
    mk('unknown'),
    mk('accessible', { wheelchairAccessible: true }),
    mk('not-accessible', { wheelchairAccessible: false }),
    mk('cold-only', { hasColdWater: true, hasHotWater: false }),
    mk('hot', { hasColdWater: true, hasHotWater: true }),
    mk('key', { keyRequired: true }),
    mk('no-key', { keyRequired: false }),
    mk('free', { purchaseRequired: false }),
    mk('buy', { purchaseRequired: true }),
    mk('good', { averageRating: 4.5 }),
    mk('far', { distanceMeters: 99_999 }),
  ];

  it('default filters keep everything within the default radius', () => {
    expect(names(applyFilters(data, DEFAULT_FILTERS))).not.toContain('far');
    expect(applyFilters(data, DEFAULT_FILTERS)).toHaveLength(data.length - 1);
  });

  it('positive amenity filters require known-true (unknown never matches)', () => {
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, wheelchairAccessible: true }))).toEqual(['accessible']);
  });

  it('cold-water-only needs cold=true and hot=false', () => {
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, coldWaterOnly: true }))).toEqual(['cold-only']);
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, hotWater: true }))).toEqual(['hot']);
  });

  it('key and purchase filters distinguish unknown from false', () => {
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, key: 'required' }))).toEqual(['key']);
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, key: 'not_required' }))).toEqual(['no-key']);
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, purchase: 'free' }))).toEqual(['free']);
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, purchase: 'required' }))).toEqual(['buy']);
  });

  it('min rating excludes unrated', () => {
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, minRating: 4 }))).toEqual(['good']);
  });

  it('radius filter narrows by distance', () => {
    expect(applyFilters(data, { ...DEFAULT_FILTERS, radiusMeters: 50 })).toHaveLength(0);
  });
});

describe('countActiveFilters', () => {
  it('counts non-default filters', () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, minRating: 3, key: 'required', hotWater: true })).toBe(3);
  });
});
