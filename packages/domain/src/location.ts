import { z } from 'zod';

/** Numeric rating is always stored 1–5; Plain/Risqué only changes presentation. */
export const ratingSchema = z.number().int().min(1).max(5);
export type Rating = z.infer<typeof ratingSchema>;

export const verificationStatusSchema = z.enum(['candidate', 'pending', 'unverified', 'verified', 'closed']);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const displayModeSchema = z.enum(['plain', 'risque']);
export type DisplayMode = z.infer<typeof displayModeSchema>;
export const DEFAULT_DISPLAY_MODE: DisplayMode = 'plain';

export const restroomEvidenceSchema = z.enum(['none', 'inferred', 'explicit']);
export type RestroomEvidence = z.infer<typeof restroomEvidenceSchema>;

/**
 * Public visibility rules (mirrors the RLS policy on public.locations):
 * - verified: Open Stall confirmed it.
 * - unverified: visible only with EXPLICIT external restroom evidence; the UI must badge it.
 * - candidate, pending, closed: never public. Merely being a business is not evidence.
 */
export function isPubliclyVisible(
  status: VerificationStatus,
  evidence: RestroomEvidence = 'none',
): boolean {
  if (status === 'verified') return true;
  return status === 'unverified' && evidence === 'explicit';
}
