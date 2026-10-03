import { describe, expect, it, vi } from 'vitest';
import { buildOverpassQuery, fetchTile } from './overpass';

const tile = { south: 1, west: 2, north: 3, east: 4 };
const ok = (elements: unknown[]) => ({ ok: true, status: 200, json: async () => ({ elements }) }) as Response;
const status = (code: number) => ({ ok: false, status: code, json: async () => ({}) }) as Response;

describe('buildOverpassQuery', () => {
  it('always asks for explicit toilet evidence and outputs center + tags', () => {
    const q = buildOverpassQuery(tile, { includeCandidates: false });
    expect(q).toContain('nwr["amenity"="toilets"](1,2,3,4);');
    expect(q).toContain('nwr["toilets"="yes"](1,2,3,4);');
    expect(q).toContain('out center tags;');
    expect(q).not.toContain('fuel');
  });
  it('adds candidate selectors by default', () => {
    const q = buildOverpassQuery(tile);
    expect(q).toContain('fuel|library|townhall|community_centre');
    expect(q).toContain('["information"="visitor_centre"]');
  });
});

describe('fetchTile', () => {
  const noWait = async () => {};
  it('returns elements on success', async () => {
    const f = vi.fn().mockResolvedValue(ok([{ type: 'node', id: 1 }]));
    expect(await fetchTile('q', { fetchImpl: f as unknown as typeof fetch, sleepMs: noWait })).toHaveLength(1);
    expect(f.mock.calls[0]?.[1]?.headers?.['User-Agent']).toContain('open-stall-importer');
  });
  it('retries on 429 then succeeds', async () => {
    const f = vi.fn().mockResolvedValueOnce(status(429)).mockResolvedValueOnce(ok([]));
    expect(await fetchTile('q', { fetchImpl: f as unknown as typeof fetch, sleepMs: noWait })).toEqual([]);
    expect(f).toHaveBeenCalledTimes(2);
  });
  it('fails after retries and does not retry client errors', async () => {
    const always500 = vi.fn().mockResolvedValue(status(504));
    await expect(fetchTile('q', { fetchImpl: always500 as unknown as typeof fetch, sleepMs: noWait, retries: 2 })).rejects.toThrow('failed after retries');
    expect(always500).toHaveBeenCalledTimes(3);
    const bad = vi.fn().mockResolvedValue(status(400));
    await expect(fetchTile('q', { fetchImpl: bad as unknown as typeof fetch, sleepMs: noWait })).rejects.toThrow();
    expect(bad).toHaveBeenCalledTimes(1);
  });
});
