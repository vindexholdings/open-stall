import { describe, expect, it } from 'vitest';
import { CACHE_MAX_AGE_MS, CACHE_MAX_ENTRIES, findCached, parseCache, readCache, updateCache, upsertCached } from './locationCache';
import type { PublicLocation } from './publicLocation';

// Synthetic, in-memory fixtures only.
const mk = (n: number, lat = 10, lng = 10): PublicLocation => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  verification: 'verified',
  name: `TEST ${n}`,
  addressLine: null, city: null, region: null, postalCode: null,
  coordinates: { latitude: lat, longitude: lng }, lastVerifiedAt: null, openingHours: null, feeRequired: null, attribution: null,
  wheelchairAccessible: null, genderNeutral: null, babyChanging: null, hasHotWater: null,
  hasColdWater: null, keyRequired: null, purchaseRequired: null, accessLocation: null,
  averageRating: null, ratingCount: 0,
});
const area = { minLat: 9, maxLat: 11, minLng: 9, maxLng: 11 };
const elsewhere = { minLat: 50, maxLat: 51, minLng: 50, maxLng: 51 };

describe('updateCache', () => {
  it('replaces entries inside the fetched bounds so removed locations disappear', () => {
    const first = updateCache([], [mk(1), mk(2)], area, 1000);
    const second = updateCache(first, [mk(2)], area, 2000);
    expect(readCache(second, area, 2000).map((l) => l.name)).toEqual(['TEST 2']);
  });

  it('keeps entries outside the fetched bounds', () => {
    const far = updateCache([], [mk(9, 50.5, 50.5)], elsewhere, 1000);
    const next = updateCache(far, [mk(1)], area, 2000);
    expect(readCache(next, elsewhere, 2000)).toHaveLength(1);
  });

  it('expires old entries and caps size', () => {
    const old = updateCache([], [mk(1)], area, 0);
    expect(readCache(old, area, CACHE_MAX_AGE_MS + 1)).toHaveLength(0);
    const many = updateCache([], Array.from({ length: CACHE_MAX_ENTRIES + 20 }, (_, i) => mk(i)), area, 5);
    expect(many).toHaveLength(CACHE_MAX_ENTRIES);
  });
});

describe('lookup and parsing', () => {
  it('finds by id and upserts', () => {
    const c = upsertCached([], mk(3), 10);
    expect(findCached(c, mk(3).id, 11)?.name).toBe('TEST 3');
    expect(findCached(c, mk(4).id, 11)).toBeNull();
  });

  it('parseCache round-trips valid entries and drops garbage', () => {
    const stored = JSON.parse(JSON.stringify(upsertCached([], mk(5), 10)));
    expect(parseCache(stored)).toHaveLength(1);
    expect(parseCache([...stored, { cachedAt: 'x', location: {} }, null, 'bad'])).toHaveLength(1);
    expect(parseCache('nope')).toEqual([]);
  });
});
