import { describe, expect, it } from 'vitest';
import { buildNavigationUrl, parseLocationId } from './navigation';

const dest = { latitude: 44.5263, longitude: -109.0565 };

describe('buildNavigationUrl', () => {
  it('builds Google Maps directions with travel mode and destination only', () => {
    expect(buildNavigationUrl('google', dest, 'bike')).toBe(
      'https://www.google.com/maps/dir/?api=1&destination=44.5263,-109.0565&travelmode=bicycling',
    );
  });
  it('builds Apple Maps directions; bike falls back to walking', () => {
    expect(buildNavigationUrl('apple', dest, 'drive')).toBe('https://maps.apple.com/?daddr=44.5263,-109.0565&dirflg=d');
    expect(buildNavigationUrl('apple', dest, 'bike')).toContain('dirflg=w');
  });
  it('never includes an origin', () => {
    expect(buildNavigationUrl('google', dest, 'walk')).not.toMatch(/origin|saddr/);
    expect(buildNavigationUrl('apple', dest, 'walk')).not.toMatch(/origin|saddr/);
  });
  it('rejects invalid coordinates', () => {
    expect(buildNavigationUrl('google', { latitude: 200, longitude: 0 }, 'walk')).toBeNull();
  });
});

describe('parseLocationId', () => {
  it('accepts uuids only', () => {
    expect(parseLocationId('3f2b8c1e-8a4d-4a8b-9a53-0d6f3c5f1a11')).toBe('3f2b8c1e-8a4d-4a8b-9a53-0d6f3c5f1a11');
    expect(parseLocationId("1' or 1=1")).toBeNull();
    expect(parseLocationId(undefined)).toBeNull();
  });
});
