import type { PublicLocation } from '@open-stall/domain';
import { describe, expect, it } from 'vitest';
import { withOfflineCache, type KeyValueStore } from './cachedSource';
import type { LocationSource } from './LocationSource';

// Synthetic, in-memory fixtures only; nothing touches a real database or device storage.
const loc: PublicLocation = {
  id: '00000000-0000-4000-8000-000000000001',
  verification: 'unverified',
  name: 'TEST cached',
  addressLine: null, city: null, region: null, postalCode: null,
  coordinates: { latitude: 10, longitude: 10 }, lastVerifiedAt: null, attribution: null,
  wheelchairAccessible: null, genderNeutral: null, babyChanging: null, hasHotWater: null,
  hasColdWater: null, keyRequired: null, purchaseRequired: null, accessLocation: null,
  averageRating: null, ratingCount: 0,
};
const bounds = { minLat: 9, maxLat: 11, minLng: 9, maxLng: 11 };

const memoryStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, set: async (k, v) => void data.set(k, v) };
};

function flaky() {
  let online = true;
  const source: LocationSource = {
    listPublicInBounds: async () => {
      if (!online) throw new Error('offline');
      return { locations: [loc], fromCache: false };
    },
    getPublicById: async () => {
      if (!online) throw new Error('offline');
      return { location: loc, fromCache: false };
    },
  };
  return { source, setOnline: (v: boolean) => (online = v) };
}

describe('withOfflineCache', () => {
  it('serves saved results flagged fromCache when offline', async () => {
    const { source, setOnline } = flaky();
    const cached = withOfflineCache(source, memoryStore());
    expect((await cached.listPublicInBounds(bounds)).fromCache).toBe(false);
    setOnline(false);
    const offline = await cached.listPublicInBounds(bounds);
    expect(offline.fromCache).toBe(true);
    expect(offline.locations.map((l) => l.name)).toEqual(['TEST cached']);
  });

  it('still errors when offline with nothing saved', async () => {
    const { source, setOnline } = flaky();
    setOnline(false);
    await expect(withOfflineCache(source, memoryStore()).listPublicInBounds(bounds)).rejects.toThrow('offline');
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
    await withOfflineCache(source, store).listPublicInBounds(bounds);
    const raw = [...store.data.values()].join('');
    expect(raw).not.toMatch(/minLat|maxLat|origin|userLocation/);
  });

  it('does not mask aborts', async () => {
    const { source, setOnline } = flaky();
    const cached = withOfflineCache(source, memoryStore());
    await cached.listPublicInBounds(bounds);
    setOnline(false);
    const c = new AbortController();
    c.abort();
    await expect(cached.listPublicInBounds(bounds, c.signal)).rejects.toThrow();
  });
});
