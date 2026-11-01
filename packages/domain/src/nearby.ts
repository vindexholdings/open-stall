import { distanceMeters, type Coordinates } from './geo';
import type { PublicLocation } from './publicLocation';

/** Walking-friendly default search radius: 1 mile (D3; was 5 miles). Farther choices (2, 5, 10, 25 mi) stay one tap away. */
export const DEFAULT_RADIUS_METERS = 1609; // 1 mile
/** Re-query cadence while the app is active (ARCHITECTURE.md): about every 180 seconds. */
export const REFRESH_INTERVAL_MS = 180_000;

export type Bounds = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const METERS_PER_DEGREE_LAT = 111_320;

/** Bounding box around a point; used to narrow the database query before exact ranking. */
export function boundingBox(center: Coordinates, radiusMeters: number): Bounds {
  const dLat = radiusMeters / METERS_PER_DEGREE_LAT;
  const cos = Math.max(Math.cos((center.latitude * Math.PI) / 180), 0.01);
  const dLng = radiusMeters / (METERS_PER_DEGREE_LAT * cos);
  return {
    minLat: Math.max(-90, center.latitude - dLat),
    maxLat: Math.min(90, center.latitude + dLat),
    minLng: Math.max(-180, center.longitude - dLng),
    maxLng: Math.min(180, center.longitude + dLng),
  };
}

export type NearbyLocation = PublicLocation & { distanceMeters: number };

/** Sorts by exact distance (ties by name), dropping anything beyond the radius. */
export function rankNearby(
  locations: readonly PublicLocation[],
  origin: Coordinates,
  radiusMeters: number = DEFAULT_RADIUS_METERS,
): NearbyLocation[] {
  return locations
    .map((l) => ({ ...l, distanceMeters: distanceMeters(origin, l.coordinates) }))
    .filter((l) => l.distanceMeters <= radiusMeters)
    .sort((a, b) => a.distanceMeters - b.distanceMeters || a.name.localeCompare(b.name));
}

export type TravelMode = 'walk' | 'drive' | 'bike';
const SPEED_MPS: Record<TravelMode, number> = { walk: 1.4, bike: 4.5, drive: 11 };

/**
 * Straight-line heuristic at a typical speed. It is NOT a route and ignores roads, paths, crossings and traffic, so the
 * app no longer shows it (D3): distances are labeled straight-line instead. Kept only as a documented helper; any real
 * walking or driving time would need a routing provider, which is not part of this product yet.
 */
export function estimateTravelMinutes(meters: number, mode: TravelMode): number {
  return Math.max(1, Math.round(meters / SPEED_MPS[mode] / 60));
}

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

/**
 * US units, straight-line distance, finer under a mile (D3):
 *  - under 0.2 mi: feet, to the nearest 10 ft ("150 ft")
 *  - 0.2 mi to under 1 mi: miles to the nearest 0.05 ("0.35 mi")
 *  - 1 to under 10 mi: one decimal ("1.4 mi"); 10 mi and up: whole miles.
 */
export function formatDistance(meters: number): string {
  if (meters < 0.2 * METERS_PER_MILE) {
    return `${Math.max(10, Math.round(meters / METERS_PER_FOOT / 10) * 10)} ft`;
  }
  const miles = meters / METERS_PER_MILE;
  if (miles < 1) {
    const rounded = Math.round(miles * 20) / 20;
    if (rounded < 1) return `${Number(rounded.toFixed(2))} mi`;
  }
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

export type NearestVerifiedContext =
  | { kind: 'not-needed' }
  | { kind: 'in-list'; location: NearbyLocation }
  | { kind: 'lookup' };

/**
 * Ranking stays distance-first. When the nearest result is Unverified, surface context about the
 * nearest Verified option: use the list if it contains one, otherwise the caller should look one up.
 */
export function nearestVerifiedContext(ranked: readonly NearbyLocation[]): NearestVerifiedContext {
  const top = ranked[0];
  if (top && top.verification === 'verified') return { kind: 'not-needed' };
  const verified = ranked.find((l) => l.verification === 'verified');
  if (verified) return { kind: 'in-list', location: verified };
  return { kind: 'lookup' };
}
