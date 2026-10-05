import {
  boundingBox,
  findCached,
  parseCache,
  readCache,
  updateCache,
  upsertCached,
  type CacheEntry,
} from '@open-stall/domain';
import type { LocationSource } from './LocationSource';

export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
}

const KEY = 'open-stall.public-locations.v1';

/**
 * Wraps a source with an offline cache of public verified locations. On any fetch failure it
 * serves saved results (flagged fromCache) instead of an error. Nothing about the user's
 * position or search area is stored.
 */
export function withOfflineCache(
  source: LocationSource,
  store: KeyValueStore,
  now: () => number = Date.now,
): LocationSource {
  const load = async (): Promise<CacheEntry[]> => {
    try {
      const raw = await store.get(KEY);
      return raw ? parseCache(JSON.parse(raw)) : [];
    } catch {
      return [];
    }
  };
  const save = async (entries: CacheEntry[]) => {
    try {
      await store.set(KEY, JSON.stringify(entries));
    } catch {
      // cache is best-effort
    }
  };

  return {
    async listNearby(query, signal) {
      // Bounds are derived for cache bookkeeping only; the origin/area is never stored.
      const bounds = boundingBox(query.origin, query.radiusMeters);
      try {
        const result = await source.listNearby(query, signal);
        const existing = await load();
        // A verified-only fetch lacks unverified rows, so merge instead of replacing the area.
        const next = query.verifiedOnly
          ? result.locations.reduce((acc, l) => upsertCached(acc, l, now()), existing)
          : updateCache(existing, result.locations, bounds, now());
        await save(next);
        return result;
      } catch (error) {
        if (signal?.aborted) throw error;
        const inArea = readCache(await load(), bounds, now());
        if (inArea.length === 0) throw error;
        // Saved data exists for this area: show it (possibly with nothing matching verified-only).
        const locations = inArea.filter((l) => !query.verifiedOnly || l.verification === 'verified');
        return { locations, fromCache: true };
      }
    },

    async nearestVerified(origin, signal) {
      try {
        return await source.nearestVerified(origin, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        return null; // offline: no context rather than an error
      }
    },

    async getPublicById(id, signal) {
      try {
        const result = await source.getPublicById(id, signal);
        if (result.location) await save(upsertCached(await load(), result.location, now()));
        return result;
      } catch (error) {
        if (signal?.aborted) throw error;
        const cached = findCached(await load(), id, now());
        if (!cached) throw error;
        return { location: cached, fromCache: true };
      }
    },
  };
}
