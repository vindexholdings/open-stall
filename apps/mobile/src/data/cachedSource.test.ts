import type { PublicLocation } from '@open-stall/domain';
import { describe, expect, it } from 'vitest';
import { withOfflineCache, type KeyValueStore } from './cachedSource';
import type { LocationSource } from './LocationSource';

// Synthetic, in-memory fixtures only; nothing touches a real database or device storage.
const loc: PublicLocation = {
  id: '00000000-0000-4000-8000-000000000001',
  verification: 'unverified',
  openingHours: null,
  feeRequired: null,
  name: 'TEST cached',
  addressLine: null, city: null, region: null, postalCode: null,
  coordinates: { latitude: 10, longitude: 10 }, lastVerifiedAt: null, attribution: null,
  wheelchairAccessible: null, genderNeutral: null, babyChanging: null, hasHotWater: null,
  hasColdWater: null, keyRequired: null, purchaseRequired: null, accessLocation: null,
  averageRating: null, ratingCount: 0,
};
const query = { origin: { latitude: 10, longitude: 10 }, radiusMeters: 5000, verifiedOnly: false };

const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
};

function flaky() {
  let online = true;
  const source: LocationSource = {
    listNearby: async () => {
      if (!online) throw new Error('offline');
      return { locations: [loc], fromCache: false };
    },
    getPublicById: async () => {
      if (!online) throw new Error('offline');
      return { location: loc, fromCache: false };
    },
    nearestVerified: async () => {
      if (!online) throw new Error('offline');
      return { id: loc.id, name: loc.name, distanceMeters: 100 };
    },
  };
  return { source, setOnline: (v: boolean) => (online = v) };
}

describe('withOfflineCache', () => {
  it('serves saved results flagged fromCache when offline', async () => {
    const { source, setOnline } = flaky();
    const cached = withOfflineCache(source, memoryStore());
    expect((await cached.listNearby(query)).fromCache).toBe(false);
    setOnline(false);
    const offline = await cached.listNearby(query);
    expect(offline.fromCache).toBe(true);
    expect(offline.locations.map((l) => l.name)).toEqual(['TEST cached']);
  });

  it('still errors when offline with nothing saved', async () => {
    const { source, setOnline } = flaky();
    setOnline(false);
    await expect(withOfflineCache(source, memoryStore()).listNearby(query)).rejects.toThrow('offline');
  });

  it('serves a detail record from cache when offline', async () => {
    const { source, setOnline } = flaky();
    const cached = withOfflineCache(source, memoryStore());
    await cached.getPublicById(loc.id);
    setOnline(false);
    expect((await cached.getPublicById(loc.id)).location?.name).toBe('TEST cached');
  });

  it('stores only public location data, never the search area or position', async () => {
    const { source } = flaky();
    const store = memoryStore();
    await withOfflineCache(source, store).listNearby(query);
    const raw = [...store.data.values()].join('');
    expect(raw).not.toMatch(/minLat|maxLat|origin|userLocation|radius/);
  });

  it('verified-only fetches merge into the cache instead of dropping unverified entries', async () => {
    const { source } = flaky();
    const store = memoryStore();
    const cached = withOfflineCache(source, store);
    await cached.listNearby(query);
    await cached.listNearby({ ...query, verifiedOnly: true }); // source returns the same row here
    const offline = withOfflineCache(
      { ...source, listNearby: async () => { throw new Error('offline'); } },
      store,
    );
    expect((await offline.listNearby(query)).locations).toHaveLength(1);
    expect((await offline.listNearby({ ...query, verifiedOnly: true })).locations).toHaveLength(0);
  });

  it('nearestVerified degrades to null offline', async () => {
    const { source, setOnline } = flaky();
    const cached = withOfflineCache(source, memoryStore());
    expect((await cached.nearestVerified(query.origin))?.distanceMeters).toBe(100);
    setOnline(false);
    expect(await cached.nearestVerified(query.origin)).toBeNull();
  });

  it('does not mask aborts', async () => {
    const { source, setOnline } = flaky();
    const cached = withOfflineCache(source, memoryStore());
    await cached.listNearby(query);
    setOnline(false);
    const c = new AbortController();
    c.abort();
    await expect(cached.listNearby(query, c.signal)).rejects.toThrow();
  });
});
