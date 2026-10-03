import { distanceMeters, type Coordinates } from './geo';
import type { PublicLocation } from './publicLocation';

export const DEFAULT_RADIUS_METERS = 8047; // 5 miles
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

/** Straight-line estimate, shown as approximate; routing providers can replace it later. */
export function estimateTravelMinutes(meters: number, mode: TravelMode): number {
  return Math.max(1, Math.round(meters / SPEED_MPS[mode] / 60));
}

const METERS_PER_MILE = 1609.344;
const METERS_PER_FOOT = 0.3048;

/** US units: feet under 0.1 mi, otherwise miles. */
export function formatDistance(meters: number): string {
  if (meters < 0.1 * METERS_PER_MILE) {
    return `${Math.max(10, Math.round(meters / METERS_PER_FOOT / 10) * 10)} ft`;
  }
  const miles = meters / METERS_PER_MILE;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}
