import { describe, expect, it, vi } from 'vitest';
import { buildCensusUrl, geocodeCensus, parseCensusResponse } from './census';

// Synthetic responses shaped like the Census Geocoder's JSON. No network, no real data.
const addr = { street: '100 Test St', city: 'Testville', region: 'WY', postal_code: '82414' };
const match = (over: Record<string, unknown> = {}) => ({
  matchedAddress: '100 TEST ST, TESTVILLE, WY, 82414',
  coordinates: { x: -109.1234567, y: 44.1234567 },
  addressComponents: { zip: '82414', state: 'WY' },
  ...over,
});
const resp = (matches: unknown[]) => ({ result: { addressMatches: matches } });

describe('Census geocoder client', () => {
  it('builds a structured-address URL with the public benchmark', () => {
    const u = new URL(buildCensusUrl(addr));
    expect(u.hostname).toBe('geocoding.geo.census.gov');
    expect(u.searchParams.get('street')).toBe('100 Test St');
    expect(u.searchParams.get('zip')).toBe('82414');
    expect(u.searchParams.get('benchmark')).toBe('Public_AR_Current');
  });

  it('maps x/y to longitude/latitude, rounds, and records provenance', () => {
    const g = parseCensusResponse(resp([match()]), addr, '2026-10-05T00:00:00.000Z');
    expect(g).toMatchObject({ latitude: 44.123457, longitude: -109.123457, benchmark: 'Public_AR_Current', retrievedAt: '2026-10-05T00:00:00.000Z' });
    expect(g.matchedAddress).toContain('TEST ST');
  });

  it('refuses no match, multiple matches, ZIP/state mismatches and unusable coordinates', () => {
    expect(() => parseCensusResponse(resp([]), addr, 'x')).toThrow('no match');
    expect(() => parseCensusResponse(resp([match(), match()]), addr, 'x')).toThrow('refusing to guess');
    expect(() => parseCensusResponse(resp([match({ addressComponents: { zip: '99999', state: 'WY' } })]), addr, 'x')).toThrow('ZIP');
    expect(() => parseCensusResponse(resp([match({ addressComponents: { zip: '82414', state: 'MT' } })]), addr, 'x')).toThrow('state');
    expect(() => parseCensusResponse(resp([match({ coordinates: { x: 0, y: 0 } })]), addr, 'x')).toThrow('unusable');
    expect(() => parseCensusResponse(resp([match({ coordinates: { x: 'a', y: 1 } })]), addr, 'x')).toThrow('unusable');
    expect(() => parseCensusResponse({}, addr, 'x')).toThrow('no match');
  });

  it('geocodeCensus uses the injected fetch and surfaces HTTP errors', async () => {
    const ok = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => resp([match()]) });
    const g = await geocodeCensus(addr, { fetchImpl: ok as unknown as typeof fetch, now: () => new Date('2026-10-05T00:00:00Z') });
    expect(g.latitude).toBe(44.123457);
    expect(String(ok.mock.calls[0]?.[0])).toContain('geocoding.geo.census.gov');
    const bad = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    await expect(geocodeCensus(addr, { fetchImpl: bad as unknown as typeof fetch })).rejects.toThrow('HTTP 503');
  });
});
