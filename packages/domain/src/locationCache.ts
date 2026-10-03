import type { Bounds } from './nearby';
import { toPublicLocation, type PublicLocation } from './publicLocation';

/**
 * Offline cache of PUBLIC verified locations only. It deliberately stores no user position or
 * search area: results are re-ranked against the device's current position when read.
 */
export type CacheEntry = { location: PublicLocation; cachedAt: number };

export const CACHE_MAX_ENTRIES = 300;
export const CACHE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

const fresh = (e: CacheEntry, now: number) => now - e.cachedAt <= CACHE_MAX_AGE_MS;

const inBounds = (l: PublicLocation, b: Bounds) =>
  l.coordinates.latitude >= b.minLat &&
  l.coordinates.latitude <= b.maxLat &&
  l.coordinates.longitude >= b.minLng &&
  l.coordinates.longitude <= b.maxLng;

/**
 * After a successful online fetch for `bounds`: replace everything cached inside those bounds
 * (so closed/unverified locations disappear), keep the rest, cap the size.
 */
export function updateCache(
  existing: readonly CacheEntry[],
  incoming: readonly PublicLocation[],
  bounds: Bounds,
  now: number,
): CacheEntry[] {
  const kept = existing.filter((e) => fresh(e, now) && !inBounds(e.location, bounds));
  const added = incoming.map((location) => ({ location, cachedAt: now }));
  return [...added, ...kept].sort((a, b) => b.cachedAt - a.cachedAt).slice(0, CACHE_MAX_ENTRIES);
}

export function upsertCached(existing: readonly CacheEntry[], location: PublicLocation, now: number): CacheEntry[] {
  const rest = existing.filter((e) => fresh(e, now) && e.location.id !== location.id);
  return [{ location, cachedAt: now }, ...rest].slice(0, CACHE_MAX_ENTRIES);
}

export function readCache(existing: readonly CacheEntry[], bounds: Bounds, now: number): PublicLocation[] {
  return existing.filter((e) => fresh(e, now) && inBounds(e.location, bounds)).map((e) => e.location);
}

export function findCached(existing: readonly CacheEntry[], id: string, now: number): PublicLocation | null {
  return existing.find((e) => fresh(e, now) && e.location.id === id)?.location ?? null;
}

/** Re-validates stored data; anything malformed or not publicly displayable is dropped. */
export function parseCache(raw: unknown): CacheEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: CacheEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const cachedAt = (item as { cachedAt?: unknown }).cachedAt;
    if (typeof cachedAt !== 'number' || !Number.isFinite(cachedAt)) continue;
    const location = toPublicLocation(rowFromLocation((item as { location?: unknown }).location));
    if (location) out.push({ location, cachedAt });
  }
  return out;
}

// Cached entries are stored as camelCase PublicLocation; toPublicLocation validates snake_case RPC rows.
function rowFromLocation(l: unknown): unknown {
  if (typeof l !== 'object' || l === null) return null;
  const x = l as PublicLocation;
  if (!x.coordinates) return null;
  return {
    id: x.id, name: x.name, address_line: x.addressLine, city: x.city, region: x.region,
    postal_code: x.postalCode, latitude: x.coordinates.latitude, longitude: x.coordinates.longitude,
    verification: x.verification, last_verified_at: x.lastVerifiedAt, opening_hours: x.openingHours,
    fee_required: x.feeRequired, key_required: x.keyRequired, purchase_required: x.purchaseRequired,
    wheelchair_accessible: x.wheelchairAccessible, gender_neutral: x.genderNeutral,
    baby_changing: x.babyChanging, has_hot_water: x.hasHotWater, has_cold_water: x.hasColdWater,
    access_location: x.accessLocation, average_rating: x.averageRating, rating_count: x.ratingCount,
    attribution: x.attribution,
  };
}
