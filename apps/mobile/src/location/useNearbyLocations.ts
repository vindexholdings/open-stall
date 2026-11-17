import {
  DEFAULT_RADIUS_METERS,
  nearestVerifiedContext,
  rankNearby,
  REFRESH_INTERVAL_MS,
  type Coordinates,
  type NearbyLocation,
} from '@open-stall/domain';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { LocationSource, NearestVerified } from '../data';

export type NearbyState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  locations: NearbyLocation[];
  /** Showing saved results because the network was unavailable. */
  fromCache: boolean;
  /** Context when the nearest result is Unverified; null when not needed or unavailable. */
  nearestVerified: NearestVerified | null;
};

type Settled = {
  key: string;
  status: 'ready' | 'error';
  locations: NearbyLocation[];
  fromCache: boolean;
  nearestVerified: NearestVerified | null;
};

const EMPTY = { locations: [], fromCache: false, nearestVerified: null } as const;

/**
 * Loads public (verified + displayable unverified) locations near `origin`, nearest first.
 * Refreshes when the origin/options change and about every 180 seconds while the app is active
 * (no realtime sockets). "Loading" is derived (no settled result for the current key yet), so
 * no state is set synchronously inside the effect.
 */
export function useNearbyLocations(
  source: LocationSource | null,
  origin: Coordinates | null,
  options: { radiusMeters?: number; verifiedOnly?: boolean } = {},
) {
  const radiusMeters = options.radiusMeters ?? DEFAULT_RADIUS_METERS;
  const verifiedOnly = options.verifiedOnly ?? false;
  const [settled, setSettled] = useState<Settled | null>(null);
  const [attempt, setAttempt] = useState(0);
  const lat = origin?.latitude;
  const lng = origin?.longitude;
  const key =
    lat === undefined || lng === undefined ? null : `${lat},${lng},${radiusMeters},${verifiedOnly}`;

  useEffect(() => {
    if (!source || lat === undefined || lng === undefined || key === null) return;
    let cancelled = false;
    const point = { latitude: lat, longitude: lng };

    const run = async () => {
      try {
        const result = await source.listNearby({ origin: point, radiusMeters, verifiedOnly });
        const ranked = rankNearby(result.locations, point, radiusMeters);
        const ctx = nearestVerifiedContext(ranked);
        let nearestVerified: NearestVerified | null = null;
        if (ctx.kind === 'in-list') {
          nearestVerified = { id: ctx.location.id, name: ctx.location.name, distanceMeters: ctx.location.distanceMeters };
        } else if (ctx.kind === 'lookup' && !result.fromCache) {
          nearestVerified = await source.nearestVerified(point).catch(() => null);
        }
        if (!cancelled) {
          setSettled({ key, status: 'ready', locations: ranked, fromCache: result.fromCache, nearestVerified });
        }
      } catch {
        if (!cancelled) {
          setSettled((s) => ({
            key,
            status: 'error',
            locations: s?.key === key ? s.locations : [],
            fromCache: false,
            nearestVerified: s?.key === key ? s.nearestVerified : null,
          }));
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
  }, [source, lat, lng, key, radiusMeters, verifiedOnly, attempt]);

  const refresh = useCallback(() => setAttempt((n) => n + 1), []);

  let state: NearbyState;
  if (!source || key === null) state = { status: 'idle', ...EMPTY, locations: [] };
  else if (settled?.key !== key) state = { status: 'loading', ...EMPTY, locations: [] };
  else state = { status: settled.status, locations: settled.locations, fromCache: settled.fromCache, nearestVerified: settled.nearestVerified };

  return { state, refresh };
}
