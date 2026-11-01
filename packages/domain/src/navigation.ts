import { z } from 'zod';
import { coordinatesSchema, type Coordinates } from './geo';
import type { TravelMode } from './nearby';

export type NavigationProvider = 'apple' | 'google';

const GOOGLE_MODE: Record<TravelMode, string> = { walk: 'walking', drive: 'driving', bike: 'bicycling' };
// Apple Maps supports driving and walking directions; cycling falls back to walking.
const APPLE_MODE: Record<TravelMode, string> = { walk: 'w', drive: 'd', bike: 'w' };

/**
 * Directions link to an external maps app. Only the destination is sent; the maps app uses
 * the device's own current location as the origin, so we never pass the user's position.
 * Returns null for invalid coordinates.
 */
export function buildNavigationUrl(
  provider: NavigationProvider,
  destination: Coordinates,
  mode: TravelMode,
): string | null {
  const parsed = coordinatesSchema.safeParse(destination);
  if (!parsed.success) return null;
  const dest = `${parsed.data.latitude},${parsed.data.longitude}`;
  if (provider === 'google') {
    return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${GOOGLE_MODE[mode]}`;
  }
  return `https://maps.apple.com/?daddr=${dest}&dirflg=${APPLE_MODE[mode]}`;
}

const idSchema = z.string().uuid();

/** Deep-link/route params are untrusted; accept only well-formed location ids. */
export function parseLocationId(value: unknown): string | null {
  const r = idSchema.safeParse(value);
  return r.success ? r.data : null;
}
