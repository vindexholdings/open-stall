import { describe, expect, it } from 'vitest';
import { distanceMeters } from './geo';
import { boundingBox, estimateTravelMinutes, formatDistance, rankNearby } from './nearby';
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

describe('toPublicLocation', () => {
  const row = {
    id: '3f2b8c1e-8a4d-4a8b-9a53-0d6f3c5f1a11',
    name: 'TEST row',
    address_line: null, city: null, region: null, postal_code: null,
    latitude: 1, longitude: 2,
    status: 'verified', restroom_evidence: 'explicit', restroom_verified: true, last_verified_at: '2026-01-01T00:00:00Z',
    source: 'admin', source_attribution: null,
    wheelchair_accessible: null, gender_neutral: true, baby_changing: false,
    has_hot_water: null, has_cold_water: null, key_required: null, purchase_required: null,
    access_location: null, average_rating: null, rating_count: 0,
  };

  it('maps verified rows and keeps unknown amenities as null', () => {
    const l = toPublicLocation(row);
    expect(l?.wheelchairAccessible).toBeNull();
    expect(l?.genderNeutral).toBe(true);
    expect(l?.babyChanging).toBe(false);
  });

  it('maps unverified rows with explicit evidence and marks them unverified', () => {
    const l = toPublicLocation({ ...row, status: 'unverified', restroom_verified: false, last_verified_at: null });
    expect(l?.verification).toBe('unverified');
    expect(toPublicLocation(row)?.verification).toBe('verified');
  });

  it('refuses hidden states even if returned by mistake', () => {
    for (const status of ['candidate', 'pending', 'closed']) {
      expect(toPublicLocation({ ...row, status, restroom_verified: false })).toBeNull();
    }
    // Unverified needs explicit evidence and must not claim Open Stall verification.
    expect(toPublicLocation({ ...row, status: 'unverified', restroom_verified: false, restroom_evidence: 'inferred' })).toBeNull();
    expect(toPublicLocation({ ...row, status: 'unverified', restroom_verified: false, restroom_evidence: 'none' })).toBeNull();
    expect(toPublicLocation({ ...row, status: 'unverified', restroom_verified: true })).toBeNull();
    // Verified must be confirmed.
    expect(toPublicLocation({ ...row, restroom_verified: false })).toBeNull();
  });

  it('rejects malformed rows', () => {
    expect(toPublicLocation({ ...row, latitude: 'x' })).toBeNull();
    expect(toPublicLocation(null)).toBeNull();
  });
});
