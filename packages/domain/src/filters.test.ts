import { describe, expect, it } from 'vitest';
import { applyFilters, searchLocations, clearFilter, countActiveFilters, DEFAULT_FILTERS, describeActiveFilters, resultsSummary, type LocationFilters } from './filters';
import type { NearbyLocation } from './nearby';

// Synthetic, in-memory fixtures only.
const base = {
  addressLine: null, city: null, region: null, postalCode: null,
  coordinates: { latitude: 0, longitude: 0 }, lastVerifiedAt: null, openingHours: null, feeRequired: null, attribution: null,
  wheelchairAccessible: null, genderNeutral: null, babyChanging: null,
  hasHotWater: null, hasColdWater: null, keyRequired: null, purchaseRequired: null,
  accessLocation: null, averageRating: null, ratingCount: 0, distanceMeters: 100,
};
const mk = (name: string, over: Partial<NearbyLocation> = {}): NearbyLocation => ({
  ...base, verification: 'verified' as const, id: name, name, ...over,
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

  it('verifiedOnly hides unverified locations', () => {
    const mixed = [mk('v'), mk('u', { verification: 'unverified' })];
    expect(names(applyFilters(mixed, DEFAULT_FILTERS))).toEqual(['v', 'u']);
    expect(names(applyFilters(mixed, { ...DEFAULT_FILTERS, verifiedOnly: true }))).toEqual(['v']);
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

describe('active filter summary (R1)', () => {
  const all: LocationFilters = {
    radiusMeters: 5 * 1609.344, verifiedOnly: true, minRating: 4, wheelchairAccessible: true, genderNeutral: true,
    babyChanging: true, hotWater: true, coldWaterOnly: true, key: 'not_required', purchase: 'free',
  };
  it('lists nothing for the defaults and agrees with countActiveFilters', () => {
    expect(describeActiveFilters(DEFAULT_FILTERS)).toEqual([]);
    expect(describeActiveFilters(all)).toHaveLength(countActiveFilters(all));
  });
  it('describes each active filter in plain language', () => {
    expect(describeActiveFilters(all).map((a) => a.label)).toEqual([
      'Within 5 mi', 'Verified only', 'Rating 4+', 'Wheelchair accessible', 'Gender-neutral', 'Baby changing',
      'Hot water', 'Cold water only', 'No key needed', 'No purchase required',
    ]);
    expect(describeActiveFilters({ ...DEFAULT_FILTERS, key: 'required', purchase: 'required' }).map((a) => a.label)).toEqual(['Key required', 'Purchase required']);
  });
  it('never implies a restroom is free of charge from a purchase filter', () => {
    const labels = describeActiveFilters({ ...DEFAULT_FILTERS, purchase: 'free' }).map((a) => a.label.toLowerCase());
    expect(labels).toEqual(['no purchase required']);
    expect(labels.join(' ')).not.toMatch(/free/);
  });
  it('a no-purchase filter keeps fee-required and fee-unknown restrooms (fee is a separate fact)', () => {
    const data = [
      mk('no-purchase-fee', { purchaseRequired: false, feeRequired: true }),
      mk('no-purchase-fee-unknown', { purchaseRequired: false, feeRequired: null }),
      mk('no-purchase-no-fee', { purchaseRequired: false, feeRequired: false }),
      mk('purchase-unknown', { purchaseRequired: null }),
    ];
    expect(names(applyFilters(data, { ...DEFAULT_FILTERS, purchase: 'free' }))).toEqual(['no-purchase-fee', 'no-purchase-fee-unknown', 'no-purchase-no-fee']);
  });
  it('clearing every listed filter one by one returns to the defaults', () => {
    let f = all;
    for (const a of describeActiveFilters(all)) f = clearFilter(f, a.key);
    expect(f).toEqual(DEFAULT_FILTERS);
    expect(clearFilter(all, 'nope')).toBe(all);
  });
  it('summarizes results without implying more than is shown', () => {
    expect(resultsSummary(0, 0)).toBe('No restrooms found nearby');
    expect(resultsSummary(0, 2)).toBe('No restrooms match your filters');
    expect(resultsSummary(1, 0)).toBe('1 restroom nearby, nearest first');
    expect(resultsSummary(3, 1)).toBe('3 restrooms nearby, filtered');
  });
});

describe('searchLocations', () => {
  const rows = [
    { name: 'Cody Library Restroom', addressLine: '1 Library Way', city: 'Cody', region: 'WY' },
    { name: 'Corner Gas Station', addressLine: '9 Main St', city: 'Powell', region: 'WY' },
    { name: 'Café Niño', addressLine: null, city: null, region: null },
  ];
  it('returns everything, in order, for an empty or blank query', () => {
    expect(searchLocations(rows, '').map((r) => r.name)).toEqual(rows.map((r) => r.name));
    expect(searchLocations(rows, '   ').length).toBe(3);
  });
  it('matches name, street, city and region, ignoring case', () => {
    expect(searchLocations(rows, 'LIBRARY').map((r) => r.name)).toEqual(['Cody Library Restroom']);
    expect(searchLocations(rows, 'main st').map((r) => r.name)).toEqual(['Corner Gas Station']);
    expect(searchLocations(rows, 'powell').map((r) => r.name)).toEqual(['Corner Gas Station']);
    expect(searchLocations(rows, 'wy').length).toBe(2);
  });
  it('needs every word, and ignores accents', () => {
    expect(searchLocations(rows, 'cody station').length).toBe(0);
    expect(searchLocations(rows, 'cafe nino').map((r) => r.name)).toEqual(['Café Niño']);
  });
  it('finds nothing it was not given (no lookup, no invented places)', () => {
    expect(searchLocations(rows, 'seattle')).toEqual([]);
  });
});
