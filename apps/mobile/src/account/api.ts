import {
  accountErrorMessage,
  sanitizePreferences,
  toPublicLocation,
  type ObservationKey,
  type Preferences,
  type PublicLocation,
  type ReportIssue,
} from '@open-stall/domain';

type ErrLike = { message?: string; code?: string; status?: number } | null;

/** The slice of the Supabase client used here. It must be the signed-in (auth) client, never the anonymous discovery client. */
export interface RpcClientLike {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: ErrLike }>;
}

export type Outcome<T = object> = ({ ok: true } & T) | { ok: false; message: string };

async function call(c: RpcClientLike, fn: string, args?: Record<string, unknown>): Promise<Outcome<{ data: unknown }>> {
  try {
    const { data, error } = await c.rpc(fn, args);
    if (error) return { ok: false, message: accountErrorMessage(error) };
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: accountErrorMessage({ message: e instanceof Error ? e.message : String(e) }) };
  }
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

// ---------------------------------------------------------------- profile / preferences
export async function fetchPreferences(c: RpcClientLike): Promise<Outcome<{ preferences: Preferences }>> {
  const r = await call(c, 'get_my_profile');
  if (!r.ok) return r;
  const row = obj(Array.isArray(r.data) ? r.data[0] : r.data);
  return { ok: true, preferences: sanitizePreferences({ mode: row.preferred_mode, transport: row.default_transport, displayName: row.display_name }) };
}

export async function savePreferences(c: RpcClientLike, p: Preferences): Promise<Outcome> {
  const r = await call(c, 'update_my_profile', { p_display_name: p.displayName, p_mode: p.mode, p_transport: p.transport });
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------- favorites
export async function addFavorite(c: RpcClientLike, id: string): Promise<Outcome<{ count: number; limit: number }>> {
  const r = await call(c, 'add_favorite', { p_location: id });
  if (!r.ok) return r;
  const d = obj(r.data);
  return { ok: true, count: Number(d.count ?? 0), limit: Number(d.limit ?? 0) };
}

export async function removeFavorite(c: RpcClientLike, id: string): Promise<Outcome> {
  const r = await call(c, 'remove_favorite', { p_location: id });
  return r.ok ? { ok: true } : r;
}

export async function listFavorites(c: RpcClientLike, at?: { latitude: number; longitude: number } | null): Promise<Outcome<{ locations: PublicLocation[] }>> {
  const r = await call(c, 'list_my_favorites', { p_lat: at?.latitude ?? null, p_lng: at?.longitude ?? null });
  if (!r.ok) return r;
  const rows = Array.isArray(r.data) ? r.data : [];
  return { ok: true, locations: rows.map(toPublicLocation).filter((l): l is PublicLocation => l !== null) };
}

// ---------------------------------------------------------------- ratings & check-ins
export type MyReview = { rating: number; mode: 'plain' | 'risque'; observations: ObservationKey[] };

export async function fetchMyReview(c: RpcClientLike, id: string): Promise<Outcome<{ review: MyReview | null }>> {
  const r = await call(c, 'get_my_review', { p_location: id });
  if (!r.ok) return r;
  if (r.data === null || r.data === undefined) return { ok: true, review: null };
  const d = obj(r.data);
  const rating = Number(d.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: true, review: null };
  return {
    ok: true,
    review: {
      rating,
      mode: d.mode === 'risque' ? 'risque' : 'plain',
      observations: Array.isArray(d.observations) ? (d.observations.filter((o) => typeof o === 'string') as ObservationKey[]) : [],
    },
  };
}

export async function submitReview(c: RpcClientLike, id: string, rating: number, mode: 'plain' | 'risque', observations: ObservationKey[]): Promise<Outcome> {
  const r = await call(c, 'submit_review', { p_location: id, p_rating: rating, p_mode: mode, p_observations: observations });
  return r.ok ? { ok: true } : r;
}

export async function deleteMyReview(c: RpcClientLike, id: string): Promise<Outcome> {
  const r = await call(c, 'delete_my_review', { p_location: id });
  return r.ok ? { ok: true } : r;
}

/** The position is sent only so the server can confirm you are at the restroom; it is never stored. */
export async function checkIn(c: RpcClientLike, id: string, at: { latitude: number; longitude: number }): Promise<Outcome> {
  const r = await call(c, 'check_in', { p_location: id, p_lat: at.latitude, p_lng: at.longitude });
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------- contributions
/**
 * New restroom, placed at the contributor's CURRENT position (a fresh device fix). The position travels as
 * separate arguments, never inside `proposed`; the database rejects anything else. Every proposal is stored as its
 * own item for review (nearby places are flagged privately for admins, never rejected or merged), and the response
 * says nothing about neighbours. An exact repeat of your own pending request (same payload, fix and note, within
 * 10 minutes) returns the same item; anything else is a new proposal.
 */
export async function submitNewLocation(
  c: RpcClientLike,
  proposed: Record<string, unknown>,
  position: { latitude: number; longitude: number; accuracyM: number },
  note: string | null,
): Promise<Outcome> {
  const r = await call(c, 'submit_location', {
    p_proposed: proposed, p_lat: position.latitude, p_lng: position.longitude, p_accuracy_m: position.accuracyM, p_attested: true, p_note: note,
  });
  if (!r.ok) return r;
  return { ok: true };
}

export async function submitEdit(c: RpcClientLike, id: string, proposed: Record<string, unknown>, note: string | null): Promise<Outcome> {
  const r = await call(c, 'submit_location_edit', { p_location: id, p_proposed: proposed, p_attested: true, p_note: note });
  return r.ok ? { ok: true } : r;
}

export async function submitReport(c: RpcClientLike, id: string, issue: ReportIssue, comment: string): Promise<Outcome> {
  const r = await call(c, 'submit_report', { p_location: id, p_issue: issue, p_comment: comment.trim() || null });
  return r.ok ? { ok: true } : r;
}

// ---------------------------------------------------------------- deletion
export async function deleteAccount(c: RpcClientLike): Promise<Outcome> {
  const r = await call(c, 'delete_my_account', { p_confirm: 'DELETE' });
  return r.ok ? { ok: true } : r;
}
