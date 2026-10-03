import { z } from 'zod';
import { coordinatesSchema, type Coordinates } from './geo';
import { isPubliclyVisible, ratingSchema, verificationStatusSchema } from './location';

/** Nullable boolean: null means unknown, which is different from false. */
const tri = z.boolean().nullable();

/** Row shape returned by the public (RLS-filtered) read of public.locations. */
export const publicLocationRowSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  address_line: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postal_code: z.string().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  status: verificationStatusSchema,
  restroom_verified: z.boolean(),
  last_verified_at: z.string().nullable(),
  source: z.string(),
  source_attribution: z.string().nullable(),
  wheelchair_accessible: tri,
  gender_neutral: tri,
  baby_changing: tri,
  has_hot_water: tri,
  has_cold_water: tri,
  key_required: tri,
  purchase_required: tri,
  access_location: z.string().nullable(),
  average_rating: z.number().nullable(),
  rating_count: z.number().int().nonnegative(),
});
export type PublicLocationRow = z.infer<typeof publicLocationRowSchema>;

export const PUBLIC_LOCATION_COLUMNS = Object.keys(publicLocationRowSchema.shape).join(',');

export type PublicLocation = {
  id: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  coordinates: Coordinates;
  lastVerifiedAt: string | null;
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

/**
 * Validates a raw row and maps it. Returns null for invalid rows and for anything that is
 * not verified+confirmed, so a misconfigured query can never surface candidates/pending rows.
 */
export function toPublicLocation(raw: unknown): PublicLocation | null {
  const parsed = publicLocationRowSchema.safeParse(raw);
  if (!parsed.success) return null;
  const r = parsed.data;
  if (!isPubliclyVisible(r.status) || !r.restroom_verified) return null;
  const coordinates = coordinatesSchema.safeParse({ latitude: r.latitude, longitude: r.longitude });
  if (!coordinates.success) return null;
  if (r.average_rating !== null && !ratingSchema.safeParse(Math.round(r.average_rating)).success) return null;
  return {
    id: r.id,
    name: r.name,
    addressLine: r.address_line,
    city: r.city,
    region: r.region,
    postalCode: r.postal_code,
    coordinates: coordinates.data,
    lastVerifiedAt: r.last_verified_at,
    attribution: r.source_attribution,
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
