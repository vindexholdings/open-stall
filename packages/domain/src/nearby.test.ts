import { describe, expect, it } from 'vitest';
import { distanceMeters } from './geo';
import { boundingBox, estimateTravelMinutes, formatDistance, nearestVerifiedContext, rankNearby } from './nearby';
import { toPublicLocation, type PublicLocation } from './publicLocation';

// Synthetic fixtures: exist only in memory inside tests.
const origin = { latitude: 40, longitude: -100 };
const loc = (name: string, dLat: number): PublicLocation => ({
  id: name,
  verification: 'verified',
  name,
  addressLine: null,
  city: null,
  region: null,
  postalCode: null,
  coordinates: { latitude: origin.latitude + dLat, longitude: origin.longitude },
  lastVerifiedAt: null,
  openingHours: null,
  feeRequired: null,
  attribution: null,
  wheelchairAccessible: null,
  genderNeutral: null,
  babyChanging: null,
  hasHotWater: null,
  hasColdWater: null,
  keyRequired: null,
  purchaseRequired: null,
  accessLocation: null,
  averageRating: null,
  ratingCount: 0,
});

describe('rankNearby', () => {
  it('sorts nearest first and drops locations beyond the radius', () => {
    const ranked = rankNearby([loc('far', 0.2), loc('near', 0.01), loc('mid', 0.03)], origin, 5000);
    expect(ranked.map((l) => l.name)).toEqual(['near', 'mid']);
    expect(ranked[0]?.distanceMeters).toBeCloseTo(distanceMeters(origin, loc('near', 0.01).coordinates), 3);
  });

  it('breaks distance ties by name', () => {
    expect(rankNearby([loc('b', 0.01), loc('a', 0.01)], origin).map((l) => l.name)).toEqual(['a', 'b']);
  });
});

describe('boundingBox', () => {
  it('contains every point within the radius', () => {
    const box = boundingBox(origin, 5000);
    const edgeNorth = { latitude: origin.latitude + 5000 / 111_320, longitude: origin.longitude };
    expect(edgeNorth.latitude).toBeLessThanOrEqual(box.maxLat + 1e-9);
    expect(box.minLng).toBeLessThan(origin.longitude);
    expect(box.maxLng).toBeGreaterThan(origin.longitude);
  });
  it('clamps at the poles', () => {
    expect(boundingBox({ latitude: 89.99, longitude: 0 }, 50_000).maxLat).toBe(90);
  });
});

describe('formatting and ETA', () => {
  it('formats US distances', () => {
    expect(formatDistance(50)).toBe('160 ft'); // 164 ft rounded to 10
    expect(formatDistance(800)).toBe('0.5 mi');
    expect(formatDistance(20_000)).toBe('12 mi');
  });
  it('estimates at least one minute', () => {
    expect(estimateTravelMinutes(10, 'walk')).toBe(1);
    expect(estimateTravelMinutes(1400, 'walk')).toBe(17);
  });
});

describe('toPublicLocation (public RPC rows)', () => {
  const row = {
    id: '3f2b8c1e-8a4d-4a8b-9a53-0d6f3c5f1a11',
    name: 'TEST row',
    address_line: null, city: null, region: null, postal_code: null,
    latitude: 1, longitude: 2,
    verification: 'verified', last_verified_at: '2026-01-01T00:00:00Z',
    opening_hours: 'Mo-Su 08:00-20:00', fee_required: null, key_required: null, purchase_required: false,
    wheelchair_accessible: null, gender_neutral: true, baby_changing: false,
    has_hot_water: null, has_cold_water: null,
    access_location: null, average_rating: null, rating_count: 0, attribution: '(c) TEST', distance_m: 12.5,
  };

  it('maps rows, keeping unknown amenities as null and carrying hours/fee/attribution', () => {
    const l = toPublicLocation(row);
    expect(l?.verification).toBe('verified');
    expect(l?.wheelchairAccessible).toBeNull();
    expect(l?.genderNeutral).toBe(true);
    expect(l?.babyChanging).toBe(false);
    expect(l?.openingHours).toBe('Mo-Su 08:00-20:00');
    expect(l?.feeRequired).toBeNull();
    expect(l?.attribution).toBe('(c) TEST');
  });

  it('accepts unverified rows and rejects every other verification value', () => {
    expect(toPublicLocation({ ...row, verification: 'unverified' })?.verification).toBe('unverified');
    for (const v of ['candidate', 'pending', 'closed', 'hidden', '', null]) {
      expect(toPublicLocation({ ...row, verification: v })).toBeNull();
    }
  });

  it('rejects malformed rows', () => {
    expect(toPublicLocation({ ...row, latitude: 'x' })).toBeNull();
    expect(toPublicLocation({ ...row, latitude: 200 })).toBeNull();
    expect(toPublicLocation({ ...row, id: 'not-a-uuid' })).toBeNull();
    expect(toPublicLocation({ ...row, average_rating: 9 })).toBeNull();
    expect(toPublicLocation(null)).toBeNull();
  });
});

describe('nearestVerifiedContext', () => {
  const l = (name: string, verification: 'verified' | 'unverified', dLat: number) => ({ ...loc(name, dLat), verification, distanceMeters: dLat * 111_000 });
  it('is not needed when the nearest result is verified', () => {
    expect(nearestVerifiedContext([l('a', 'verified', 0.01), l('b', 'unverified', 0.02)])).toEqual({ kind: 'not-needed' });
  });
  it('points to the nearest verified in the list when the top result is unverified', () => {
    const ctx = nearestVerifiedContext([l('u', 'unverified', 0.01), l('v1', 'verified', 0.02), l('v2', 'verified', 0.03)]);
    expect(ctx.kind === 'in-list' && ctx.location.name).toBe('v1');
  });
  it('asks for a lookup when only unverified results (or none) are present', () => {
    expect(nearestVerifiedContext([l('u', 'unverified', 0.01)])).toEqual({ kind: 'lookup' });
    expect(nearestVerifiedContext([])).toEqual({ kind: 'lookup' });
  });
});
