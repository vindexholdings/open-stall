import { z } from 'zod';
import { coordinatesSchema, type Coordinates } from './geo';
import { ratingSchema } from './location';

/** Nullable boolean: null means unknown, which is different from false. */
const tri = z.boolean().nullable();

/**
 * Row returned by the public RPCs (nearby_locations / get_public_location). The database only
 * ever returns verified or displayable-unverified rows; clients reject anything else.
 * Internal fields (status internals, evidence level, sources, timestamps) are not exposed.
 */
export const publicLocationRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  address_line: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postal_code: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  verification: z.enum(['verified', 'unverified']),
  last_verified_at: z.string().nullable(),
  opening_hours: z.string().nullable(),
  fee_required: tri,
  key_required: tri,
  purchase_required: tri,
  wheelchair_accessible: tri,
  gender_neutral: tri,
  baby_changing: tri,
  has_hot_water: tri,
  has_cold_water: tri,
  access_location: z.string().nullable(),
  average_rating: z.number().nullable(),
  rating_count: z.number().int().nonnegative(),
  attribution: z.string().nullable(),
  distance_m: z.number().nullable().optional(),
});
export type PublicLocationRow = z.infer<typeof publicLocationRowSchema>;

export type Verification = 'verified' | 'unverified';

export type PublicLocation = {
  id: string;
  /** Unverified locations must be shown with an "Unverified" badge. */
  verification: Verification;
  name: string;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  coordinates: Coordinates;
  lastVerifiedAt: string | null;
  /** Raw source text (e.g. OSM); display as "may be inaccurate". */
  openingHours: string | null;
  feeRequired: boolean | null;
  attribution: string | null;
  wheelchairAccessible: boolean | null;
  genderNeutral: boolean | null;
  babyChanging: boolean | null;
  hasHotWater: boolean | null;
  hasColdWater: boolean | null;
  keyRequired: boolean | null;
  purchaseRequired: boolean | null;
  accessLocation: string | null;
  averageRating: number | null;
  ratingCount: number;
};

/** Validates an RPC row and maps it. Returns null for malformed rows or unexpected verification values. */
export function toPublicLocation(raw: unknown): PublicLocation | null {
  const parsed = publicLocationRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  const coordinates = coordinatesSchema.safeParse({ latitude: r.latitude, longitude: r.longitude });
  if (!coordinates.success) return null;
  if (r.average_rating !== null && !ratingSchema.safeParse(Math.round(r.average_rating)).success) return null;
  return {
    id: r.id,
    verification: r.verification,
    name: r.name,
    addressLine: r.address_line,
    city: r.city,
    region: r.region,
    postalCode: r.postal_code,
    coordinates: coordinates.data,
    lastVerifiedAt: r.last_verified_at,
    openingHours: r.opening_hours,
    feeRequired: r.fee_required,
    attribution: r.attribution,
    wheelchairAccessible: r.wheelchair_accessible,
    genderNeutral: r.gender_neutral,
    babyChanging: r.baby_changing,
    hasHotWater: r.has_hot_water,
    hasColdWater: r.has_cold_water,
    keyRequired: r.key_required,
    purchaseRequired: r.purchase_required,
    accessLocation: r.access_location,
    averageRating: r.average_rating,
    ratingCount: r.rating_count,
  };
}
