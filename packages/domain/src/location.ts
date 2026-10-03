import { z } from 'zod';

/** Numeric rating is always stored 1–5; Plain/Risqué only changes presentation. */
export const ratingSchema = z.number().int().min(1).max(5);
export type Rating = z.infer<typeof ratingSchema>;

export const verificationStatusSchema = z.enum(['candidate', 'pending', 'verified', 'closed']);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const displayModeSchema = z.enum(['plain', 'risque']);
export type DisplayMode = z.infer<typeof displayModeSchema>;
export const DEFAULT_DISPLAY_MODE: DisplayMode = 'plain';

/**
 * Only verified locations are publicly listed. Imported candidates (not restroom-verified)
 * and pending submissions are never public. Mirrors the RLS policy on public.locations.
 */
export function isPubliclyVisible(status: VerificationStatus): boolean {
  return status === 'verified';
}
