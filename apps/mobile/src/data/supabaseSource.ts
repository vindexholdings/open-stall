import { PUBLIC_LOCATION_COLUMNS, toPublicLocation, type PublicLocation } from '@open-stall/domain';
import { createClient } from '@supabase/supabase-js';
import type { LocationSource } from './LocationSource';

const MAX_ROWS = 500;
const PUBLIC_STATUSES = ['verified', 'unverified'];

/**
 * Reads public locations (verified + displayable unverified) with the public anon key.
 * Row-level security is the real boundary (candidates/pending/closed are unreadable); the explicit filters and toPublicLocation()
 * are defense in depth. Auth/session persistence is off until accounts exist (Phase 2).
 */
export function createSupabaseSource(url: string, anonKey: string): LocationSource {
  const client = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  return {
    async listPublicInBounds(bounds, signal) {
      let query = client
        .from('locations')
        .select(PUBLIC_LOCATION_COLUMNS)
        .in('status', PUBLIC_STATUSES)
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

    async getPublicById(id, signal) {
      let query = client
        .from('locations')
        .select(PUBLIC_LOCATION_COLUMNS)
        .eq('id', id)
        .in('status', PUBLIC_STATUSES);
      if (signal) query = query.abortSignal(signal);

      const { data, error } = await query.maybeSingle();
      if (error) throw new Error(error.message);
      return { location: data ? toPublicLocation(data) : null, fromCache: false };
    },
  };
}
