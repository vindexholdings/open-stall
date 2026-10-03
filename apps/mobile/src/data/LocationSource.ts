import type { Bounds, PublicLocation } from '@open-stall/domain';

export type ListResult = {
  locations: PublicLocation[];
  /** True when the network was unavailable and saved (possibly outdated) results were used. */
  fromCache: boolean;
};

/**
 * Data-source contract for public restroom locations. Screens depend only on this, so the
 * backing store (Supabase today) can change without touching UI code.
 * Implementations MUST return only publicly displayable locations (verified or
 * explicit-evidence unverified); the UI badges the unverified ones.
 */
export interface LocationSource {
  listPublicInBounds(bounds: Bounds, signal?: AbortSignal): Promise<ListResult>;
  /** Null when the id does not exist or is not public. */
  getPublicById(id: string, signal?: AbortSignal): Promise<{ location: PublicLocation | null; fromCache: boolean }>;
}
