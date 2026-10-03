import type { NearbyLocation } from './nearby';
import { DEFAULT_RADIUS_METERS } from './nearby';

export type LocationFilters = {
  radiusMeters: number;
  minRating: number | null;
  wheelchairAccessible: boolean;
  genderNeutral: boolean;
  babyChanging: boolean;
  hotWater: boolean;
  coldWaterOnly: boolean;
  /** 'required' = key needed; 'not_required' = known to need no key. */
  key: 'any' | 'required' | 'not_required';
  /** 'required' = purchase needed; 'free' = known to need no purchase. */
  purchase: 'any' | 'required' | 'free';
};

export const DEFAULT_FILTERS: LocationFilters = {
  radiusMeters: DEFAULT_RADIUS_METERS,
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
 * Applies filters to already-public (verified) results. A positive amenity filter requires the
 * fact to be known-true: unknown (null) never matches, so nobody is sent to a restroom
 * that may not be accessible. All public results are verified, so there is no separate
 * verified-only switch. Filters never gate access to the information itself.
 */
export function applyFilters(
  locations: readonly NearbyLocation[],
  f: LocationFilters,
): NearbyLocation[] {
  return locations.filter((l) => {
    if (l.distanceMeters > f.radiusMeters) return false;
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
