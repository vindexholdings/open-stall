import { toPublicLocation, type PublicLocation } from '@open-stall/domain';
import { createClient } from '@supabase/supabase-js';
import type { LocationSource } from './LocationSource';

const MAX_ROWS = 100;

/**
 * Reads public locations ONLY through constrained server functions (nearby_locations,
 * get_public_location, nearest_verified_location) with the public anon key. Public roles have no
 * direct table access, so hidden candidates, pending submissions and internal metadata are
 * unreachable. Rows are re-validated client-side. Auth/session persistence is off until
 * accounts exist (Phase 2).
 */
export function createSupabaseSource(url: string, anonKey: string): LocationSource {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const mapRows = (data: unknown): PublicLocation[] =>
    (Array.isArray(data) ? data : [])
      .map((row) => toPublicLocation(row))
      .filter((l): l is PublicLocation => l !== null);

  return {
    async listNearby({ origin, radiusMeters, verifiedOnly }, signal) {
      let query = client.rpc('nearby_locations', {
        p_lat: origin.latitude,
        p_lng: origin.longitude,
        p_radius_m: Math.round(radiusMeters),
        p_limit: MAX_ROWS,
        p_verified_only: verifiedOnly,
      });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { locations: mapRows(data), fromCache: false };
    },

    async getPublicById(id, signal) {
      let query = client.rpc('get_public_location', { p_id: id });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return { location: mapRows(data)[0] ?? null, fromCache: false };
    },

    async nearestVerified(origin, signal) {
      let query = client.rpc('nearest_verified_location', { p_lat: origin.latitude, p_lng: origin.longitude });
      if (signal) query = query.abortSignal(signal);
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data : [])[0] as { distance_m?: unknown } | undefined;
      const location = mapRows(data)[0];
      if (!location || typeof row?.distance_m !== 'number') return null;
      return { id: location.id, name: location.name, distanceMeters: row.distance_m };
    },
  };
}
