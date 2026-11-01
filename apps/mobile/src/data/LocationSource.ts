import type { Coordinates, PublicLocation } from '@open-stall/domain';

export type NearbyQuery = { origin: Coordinates; radiusMeters: number; verifiedOnly: boolean };

export type ListResult = {
  locations: PublicLocation[];
  /** True when the network was unavailable and saved (possibly outdated) results were used. */
  fromCache: boolean;
};

export type NearestVerified = { id: string; name: string; distanceMeters: number };

/**
 * Data-source contract for public restroom locations. Screens depend only on this, so the
 * backing store (Supabase today) can change without touching UI code.
 * Implementations MUST return only publicly displayable locations (verified or
 * explicit-evidence unverified); the UI badges the unverified ones.
 */
export interface LocationSource {
  /** Nearest first. The server caps radius and row count. */
  listNearby(query: NearbyQuery, signal?: AbortSignal): Promise<ListResult>;
  /** Null when the id does not exist or is not public. */
  getPublicById(id: string, signal?: AbortSignal): Promise<{ location: PublicLocation | null; fromCache: boolean }>;
  /** The nearest verified location (any distance up to the server cap), or null. */
  nearestVerified(origin: Coordinates, signal?: AbortSignal): Promise<NearestVerified | null>;
}
