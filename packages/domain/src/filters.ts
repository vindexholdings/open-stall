import type { NearbyLocation } from './nearby';
import { DEFAULT_RADIUS_METERS } from './nearby';

export type LocationFilters = {
  radiusMeters: number;
  /** Hide Unverified locations. */
  verifiedOnly: boolean;
  minRating: number | null;
  wheelchairAccessible: boolean;
  genderNeutral: boolean;
  babyChanging: boolean;
  hotWater: boolean;
  coldWaterOnly: boolean;
  /** 'required' = key needed; 'not_required' = known to need no key. */
  key: 'any' | 'required' | 'not_required';
  /** 'required' = purchase needed; 'free' = known to need no purchase (says nothing about a usage fee). */
  purchase: 'any' | 'required' | 'free';
};

export const DEFAULT_FILTERS: LocationFilters = {
  radiusMeters: DEFAULT_RADIUS_METERS,
  verifiedOnly: false,
  minRating: null,
  wheelchairAccessible: false,
  genderNeutral: false,
  babyChanging: false,
  hotWater: false,
  coldWaterOnly: false,
  key: 'any',
  purchase: 'any',
};

/**
 * Applies filters to already-public results (verified and unverified). A positive amenity filter requires the
 * fact to be known-true: unknown (null) never matches, so nobody is sent to a restroom
 * that may not be accessible. Filters never gate access to the information itself.
 */
export function applyFilters(
  locations: readonly NearbyLocation[],
  f: LocationFilters,
): NearbyLocation[] {
  return locations.filter((l) => {
    if (l.distanceMeters > f.radiusMeters) return false;
    if (f.verifiedOnly && l.verification !== 'verified') return false;
    if (f.minRating !== null && (l.averageRating === null || l.averageRating < f.minRating)) return false;
    if (f.wheelchairAccessible && l.wheelchairAccessible !== true) return false;
    if (f.genderNeutral && l.genderNeutral !== true) return false;
    if (f.babyChanging && l.babyChanging !== true) return false;
    if (f.hotWater && l.hasHotWater !== true) return false;
    if (f.coldWaterOnly && !(l.hasColdWater === true && l.hasHotWater === false)) return false;
    if (f.key === 'required' && l.keyRequired !== true) return false;
    if (f.key === 'not_required' && l.keyRequired !== false) return false;
    if (f.purchase === 'required' && l.purchaseRequired !== true) return false;
    if (f.purchase === 'free' && l.purchaseRequired !== false) return false;
    return true;
  });
}

export function countActiveFilters(f: LocationFilters): number {
  return [
    f.radiusMeters !== DEFAULT_FILTERS.radiusMeters,
    f.verifiedOnly,
    f.minRating !== null,
    f.wheelchairAccessible,
    f.genderNeutral,
    f.babyChanging,
    f.hotWater,
    f.coldWaterOnly,
    f.key !== 'any',
    f.purchase !== 'any',
  ].filter(Boolean).length;
}

export type ActiveFilter = { key: string; label: string };

const METERS_PER_MILE = 1609.344;

/**
 * Human-readable list of the filters currently narrowing results, in a stable order. Drives the
 * visible summary chips (so a hidden filter panel never hides why the list is short) and the
 * per-filter "remove" action.
 */
export function describeActiveFilters(f: LocationFilters): ActiveFilter[] {
  const out: ActiveFilter[] = [];
  if (f.radiusMeters !== DEFAULT_FILTERS.radiusMeters) {
    const mi = Math.round((f.radiusMeters / METERS_PER_MILE) * 10) / 10;
    out.push({ key: 'radius', label: `Within ${mi} mi` });
  }
  if (f.verifiedOnly) out.push({ key: 'verifiedOnly', label: 'Verified only' });
  if (f.minRating !== null) out.push({ key: 'minRating', label: `Rating ${f.minRating}+` });
  if (f.wheelchairAccessible) out.push({ key: 'wheelchairAccessible', label: 'Wheelchair accessible' });
  if (f.genderNeutral) out.push({ key: 'genderNeutral', label: 'Gender-neutral' });
  if (f.babyChanging) out.push({ key: 'babyChanging', label: 'Baby changing' });
  if (f.hotWater) out.push({ key: 'hotWater', label: 'Hot water' });
  if (f.coldWaterOnly) out.push({ key: 'coldWaterOnly', label: 'Cold water only' });
  if (f.key !== 'any') out.push({ key: 'key', label: f.key === 'required' ? 'Key required' : 'No key needed' });
  if (f.purchase !== 'any') out.push({ key: 'purchase', label: f.purchase === 'required' ? 'Purchase required' : 'No purchase required' });
  return out;
}

/** Returns the filters with one active filter reset to its default. Unknown keys change nothing. */
export function clearFilter(f: LocationFilters, key: string): LocationFilters {
  switch (key) {
    case 'radius': return { ...f, radiusMeters: DEFAULT_FILTERS.radiusMeters };
    case 'verifiedOnly': return { ...f, verifiedOnly: false };
    case 'minRating': return { ...f, minRating: null };
    case 'wheelchairAccessible': return { ...f, wheelchairAccessible: false };
    case 'genderNeutral': return { ...f, genderNeutral: false };
    case 'babyChanging': return { ...f, babyChanging: false };
    case 'hotWater': return { ...f, hotWater: false };
    case 'coldWaterOnly': return { ...f, coldWaterOnly: false };
    case 'key': return { ...f, key: 'any' };
    case 'purchase': return { ...f, purchase: 'any' };
    default: return f;
  }
}

/** One-line result summary for the results header and screen-reader announcements. */
export function resultsSummary(count: number, filtersActive: number): string {
  if (count === 0) return filtersActive > 0 ? 'No restrooms match your filters' : 'No restrooms found nearby';
  const noun = count === 1 ? 'restroom' : 'restrooms';
  return filtersActive > 0
    ? `${count} ${noun} nearby, filtered`
    : `${count} ${noun} nearby, nearest first`;
}
