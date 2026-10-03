import {
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
    async listPublicInBounds(bounds, signal) {
      try {
        const result = await source.listPublicInBounds(bounds, signal);
        await save(updateCache(await load(), result.locations, bounds, now()));
        return result;
      } catch (error) {
        if (signal?.aborted) throw error;
        const cached = readCache(await load(), bounds, now());
        if (cached.length === 0) throw error;
        return { locations: cached, fromCache: true };
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
