import { PUBLIC_LOCATION_COLUMNS, toPublicLocation, type PublicLocation } from '@open-stall/domain';
import { createClient } from '@supabase/supabase-js';
import type { LocationSource } from './LocationSource';

const MAX_ROWS = 500;

/**
 * Reads verified locations with the public anon key. Row-level security is the real
 * boundary (only verified rows are readable); the explicit filters and toPublicLocation()
 * are defense in depth. Auth/session persistence is off until accounts exist (Phase 2).
 */
export function createSupabaseSource(url: string, anonKey: string): LocationSource {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async listVerifiedInBounds(bounds, signal) {
      let query = client
        .from('locations')
        .select(PUBLIC_LOCATION_COLUMNS)
        .eq('status', 'verified')
        .eq('restroom_verified', true)
        .gte('latitude', bounds.minLat)
        .lte('latitude', bounds.maxLat)
        .gte('longitude', bounds.minLng)
        .lte('longitude', bounds.maxLng)
        .limit(MAX_ROWS);
      if (signal) query = query.abortSignal(signal);

      const { data, error } = await query;
      if (error) throw new Error(error.message);
      const locations = (data ?? [])
        .map((row) => toPublicLocation(row))
        .filter((l): l is PublicLocation => l !== null);
      return { locations, fromCache: false };
    },

    async getVerifiedById(id, signal) {
      let query = client
        .from('locations')
        .select(PUBLIC_LOCATION_COLUMNS)
        .eq('id', id)
        .eq('status', 'verified')
        .eq('restroom_verified', true);
      if (signal) query = query.abortSignal(signal);

      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      return { location: data ? toPublicLocation(data) : null, fromCache: false };
    },
  };
}
