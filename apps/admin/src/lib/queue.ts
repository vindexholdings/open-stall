import 'server-only';
import type { AccessChoice, Conditions, RestroomType } from '@open-stall/domain';
import type { SupabaseClient } from '@supabase/supabase-js';
import { adminErrorMessage } from './moderation';

export type View = 'unverified' | 'candidates' | 'verified' | 'closed';
export const VIEWS: { key: View; label: string; status: string; hint: string }[] = [
  { key: 'unverified', label: 'Unverified (public)', status: 'unverified', hint: 'Public with the Unverified badge. Confirm or correct them.' },
  { key: 'candidates', label: 'Hidden candidates', status: 'candidate', hint: 'Not public. Mark "exists" to publish as Unverified, or "does not exist".' },
  { key: 'verified', label: 'Verified', status: 'verified', hint: 'Confirmed by you.' },
  { key: 'closed', label: 'Closed / not existing', status: 'closed', hint: 'Hidden. Review again to reopen.' },
];
export const parseView = (v: unknown): View => (VIEWS.some((x) => x.key === v) ? (v as View) : 'unverified');
const statusOf = (v: View) => VIEWS.find((x) => x.key === v)!.status;

export type SourceRow = { source: string; source_reference: string; is_primary: boolean; tags: Record<string, string> | null; license: string | null; attribution: string | null };
export type ReviewRow = { id: string; reviewer: string; existence: string; personally_verified: boolean; verified_on: string | null; notes: string | null; resulting_status: string; created_at: string; restroom_type?: RestroomType; rating?: number | null; cleanliness_score?: number | null; public_comment?: string | null; conditions?: Partial<Conditions>; cleaning_log?: boolean | null; reviewer_identity?: string };
export type LocationRow = {
  id: string; name: string; address_line: string | null; city: string | null; region: string | null; postal_code: string | null;
  latitude: number; longitude: number; status: string; restroom_evidence: string; restroom_verified: boolean; last_verified_at: string | null;
  wheelchair_accessible: boolean | null; gender_neutral: boolean | null; baby_changing: boolean | null; has_hot_water: boolean | null; has_cold_water: boolean | null;
  customers_only?: boolean | null; family_bathroom?: boolean | null;
  key_required: boolean | null; purchase_required: boolean | null; fee_required: boolean | null; opening_hours: string | null; possible_duplicate_of: string | null;
  location_sources: SourceRow[]; location_reviews: ReviewRow[];
};
export type { AccessChoice };

/** Reads go through the signed-in admin's own session; the database re-checks admin + MFA on every call. */
async function rpc<T>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(adminErrorMessage(error));
  return data as T;
}

const withReviews = (rows: LocationRow[]): LocationRow[] => rows.map((r) => ({ ...r, location_reviews: r.location_reviews ?? [] }));

export async function viewCounts(db: SupabaseClient): Promise<Record<View, number>> {
  const c = await rpc<Record<string, number>>(db, 'admin_location_counts', {});
  const out = {} as Record<View, number>;
  for (const v of VIEWS) out[v.key] = c[v.status] ?? 0;
  return out;
}

export async function listView(db: SupabaseClient, view: View): Promise<{ rows: LocationRow[] }> {
  const rows = await rpc<LocationRow[]>(db, 'admin_list_locations', { p_status: statusOf(view), p_limit: 500 });
  return { rows: withReviews(rows ?? []) };
}

export async function getLocation(db: SupabaseClient, id: string): Promise<{ loc: LocationRow | null }> {
  const row = await rpc<LocationRow | null>(db, 'admin_get_location', { p_id: id });
  return { loc: row ? withReviews([row])[0]! : null };
}

/** Next not-yet-reviewed location in the same view (by name), excluding the current one. */
export async function nextUnreviewed(db: SupabaseClient, view: View, currentId: string): Promise<string | null> {
  const { rows } = await listView(db, view);
  return rows.find((r) => r.id !== currentId && r.location_reviews.length === 0)?.id ?? null;
}

export const osmLink = (ref: string) => (/^(node|way|relation)\/\d+$/.test(ref) ? `https://www.openstreetmap.org/${ref}` : null);
