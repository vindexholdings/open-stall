import {
  boundingBox,
  DEFAULT_RADIUS_METERS,
  rankNearby,
  REFRESH_INTERVAL_MS,
  type Coordinates,
  type NearbyLocation,
} from '@open-stall/domain';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { LocationSource } from '../data';

export type NearbyState =
  | { status: 'idle'; locations: NearbyLocation[] }
  | { status: 'loading'; locations: NearbyLocation[] }
  | { status: 'ready'; locations: NearbyLocation[] }
  | { status: 'error'; locations: NearbyLocation[] };

type Settled = { key: string; status: 'ready' | 'error'; locations: NearbyLocation[] };

/**
 * Loads verified locations around `origin`, ranked by distance. Refreshes when the origin
 * changes and about every 180 seconds while the app is active (no realtime sockets).
 * "Loading" is derived (no settled result for the current origin yet), so no state is set
 * synchronously inside the effect.
 */
export function useNearbyLocations(
  source: LocationSource | null,
  origin: Coordinates | null,
  radiusMeters: number = DEFAULT_RADIUS_METERS,
) {
  const [settled, setSettled] = useState<Settled | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lat = origin?.latitude;
  const lng = origin?.longitude;
  const key = lat === undefined || lng === undefined ? null : `${lat},${lng},${radiusMeters}`;

  useEffect(() => {
    if (!source || lat === undefined || lng === undefined || key === null) return;
    let cancelled = false;
    const point = { latitude: lat, longitude: lng };

    const run = async () => {
      try {
        const rows = await source.listVerifiedInBounds(boundingBox(point, radiusMeters));
        if (!cancelled) {
          setSettled({ key, status: 'ready', locations: rankNearby(rows, point, radiusMeters) });
        }
      } catch {
        if (!cancelled) {
          setSettled((s) => ({ key, status: 'error', locations: s?.key === key ? s.locations : [] }));
        }
      }
    };

    void run();
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') void run();
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [source, lat, lng, key, radiusMeters, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  let state: NearbyState;
  if (!source || key === null) state = { status: 'idle', locations: [] };
  else if (settled?.key !== key) state = { status: 'loading', locations: [] };
  else state = { status: settled.status, locations: settled.locations };

  return { state, refresh };
}
