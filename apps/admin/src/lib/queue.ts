import 'server-only';
import type { AccessChoice } from '@open-stall/domain';
import { adminDb } from './db';

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
export type ReviewRow = { id: string; reviewer: string; existence: string; personally_verified: boolean; verified_on: string | null; notes: string | null; resulting_status: string; created_at: string };
export type LocationRow = {
  id: string; name: string; address_line: string | null; city: string | null; region: string | null; postal_code: string | null;
  latitude: number; longitude: number; status: string; restroom_evidence: string; restroom_verified: boolean; last_verified_at: string | null;
  wheelchair_accessible: boolean | null; gender_neutral: boolean | null; baby_changing: boolean | null; has_hot_water: boolean | null; has_cold_water: boolean | null;
  key_required: boolean | null; purchase_required: boolean | null; fee_required: boolean | null; opening_hours: string | null; possible_duplicate_of: string | null;
  location_sources: SourceRow[]; location_reviews: ReviewRow[];
};
export type { AccessChoice };

const BASE =
  'id,name,address_line,city,region,postal_code,latitude,longitude,status,restroom_evidence,restroom_verified,last_verified_at,' +
  'wheelchair_accessible,gender_neutral,baby_changing,has_hot_water,has_cold_water,key_required,purchase_required,fee_required,opening_hours,possible_duplicate_of,' +
  'location_sources(source,source_reference,is_primary,tags,license,attribution)';
const REVIEWS = ',location_reviews(id,reviewer,existence,personally_verified,verified_on,notes,resulting_status,created_at)';

/**
 * Reads work before the review migration is installed: if the reviews relationship does not exist
 * yet, retry without it and report reviewsAvailable=false (saving is disabled by the database).
 */
async function query<T>(run: (columns: string) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<{ data: T; reviewsAvailable: boolean }> {
  const full = await run(BASE + REVIEWS);
  if (!full.error) return { data: full.data as T, reviewsAvailable: true };
  if (!/location_reviews|relationship|schema cache/i.test(full.error.message)) throw new Error(full.error.message);
  const base = await run(BASE);
  if (base.error) throw new Error(base.error.message);
  return { data: base.data as T, reviewsAvailable: false };
}

const withReviews = (rows: LocationRow[]): LocationRow[] => rows.map((r) => ({ ...r, location_reviews: r.location_reviews ?? [] }));

export async function viewCounts(): Promise<Record<View, number>> {
  const db = adminDb();
  const out = {} as Record<View, number>;
  for (const v of VIEWS) {
    const { count, error } = await db.from('locations').select('id', { count: 'exact', head: true }).eq('status', v.status);
    if (error) throw new Error(error.message);
    out[v.key] = count ?? 0;
  }
  return out;
}

export async function listView(view: View): Promise<{ rows: LocationRow[]; reviewsAvailable: boolean }> {
  const { data, reviewsAvailable } = await query<LocationRow[]>((cols) =>
    adminDb().from('locations').select(cols).eq('status', statusOf(view)).order('name').limit(500),
  );
  return { rows: withReviews(data ?? []), reviewsAvailable };
}

export async function getLocation(id: string): Promise<{ loc: LocationRow | null; reviewsAvailable: boolean }> {
  const { data, reviewsAvailable } = await query<LocationRow | null>((cols) =>
    adminDb().from('locations').select(cols).eq('id', id).maybeSingle(),
  );
  return { loc: data ? withReviews([data])[0]! : null, reviewsAvailable };
}

/** Next not-yet-reviewed location in the same view (by name), excluding the current one. */
export async function nextUnreviewed(view: View, currentId: string): Promise<string | null> {
  const { rows } = await listView(view);
  return rows.find((r) => r.id !== currentId && r.location_reviews.length === 0)?.id ?? null;
}

export const osmLink = (ref: string) => (/^(node|way|relation)\/\d+$/.test(ref) ? `https://www.openstreetmap.org/${ref}` : null);
