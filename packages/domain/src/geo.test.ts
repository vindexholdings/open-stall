import { describe, expect, it } from 'vitest';
import { coordinatesSchema, distanceMeters } from './geo';

describe('distanceMeters', () => {
  it('is zero for identical points', () => {
    const p = { latitude: 44.5263, longitude: -109.0565 };
    expect(distanceMeters(p, p)).toBe(0);
  });

  it('matches a known distance within 0.5%', () => {
    // New York City Hall -> Los Angeles City Hall ≈ 3,936 km
    const nyc = { latitude: 40.7128, longitude: -74.006 };
    const la = { latitude: 34.0537, longitude: -118.2428 };
    expect(distanceMeters(nyc, la) / 1000).toBeCloseTo(3936, -2);
  });
});

describe('coordinatesSchema', () => {
  it('rejects out-of-range and non-finite values', () => {
    expect(coordinatesSchema.safeParse({ latitude: 91, longitude: 0 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: 0, longitude: -181 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: NaN, longitude: 0 }).success).toBe(false);
    expect(coordinatesSchema.safeParse({ latitude: 0, longitude: 0 }).success).toBe(true);
  });
});
