/**
 * Pure account/contribution rules. These mirror the database checks so users get instant feedback,
 * but the database remains the authority (never trust the client).
 */
import type { DisplayMode } from './location';

export const FREE_FAVORITES_LIMIT = 5;
export const CHECKIN_RADIUS_METERS = 150;
export const DELETE_CONFIRMATION = 'DELETE';

export type TransportMode = 'walk' | 'drive' | 'bike';
export const TRANSPORT_MODES: readonly TransportMode[] = ['walk', 'bike', 'drive'];
export const DEFAULT_TRANSPORT: TransportMode = 'walk';

export type Preferences = { mode: DisplayMode; transport: TransportMode; displayName: string | null };
export const DEFAULT_PREFERENCES: Preferences = { mode: 'plain', transport: DEFAULT_TRANSPORT, displayName: null };

/** Narrows untrusted stored/remote values to a valid Preferences object, falling back per field. */
export function sanitizePreferences(raw: unknown): Preferences {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const mode: DisplayMode = r.mode === 'risque' ? 'risque' : 'plain';
  const transport = TRANSPORT_MODES.find((t) => t === r.transport) ?? DEFAULT_TRANSPORT;
  const displayName = typeof r.displayName === 'string' && validateDisplayName(r.displayName) === null ? r.displayName.trim() : null;
  return { mode, transport, displayName };
}

// ---------------------------------------------------------------- free text safety
const LINK_OR_CONTACT = /(https?:|www\.|\.com|\.net|\.org|\.io|[a-z0-9._-]+@[a-z0-9.-]+|\+?[0-9][0-9 ().-]{8,})/i;
const RESIDENTIAL =
  /(\b(my|our|his|her|their)\s+(house|home|apartment|apt|condo|place|yard|garage|porch|bathroom|restroom)\b|\bresidence\b|\bresidential\b|\bprivate\s+(home|house|residence|bathroom|restroom|property)\b|\bmy\s+neighbo)/i;
const BAD_CHARS = /[<>\u0000-\u001f\u007f]/;

export function looksResidential(text: string | null | undefined): boolean {
  return !!text && RESIDENTIAL.test(text);
}

/** Returns an error message, or null when `text` is acceptable free text (no links, contact details, markup). */
export function validateFreeText(text: string, label: string, max: number): string | null {
  const t = text.trim();
  if (t.length === 0) return `Enter ${label}.`;
  if (t.length > max) return `${label[0]!.toUpperCase()}${label.slice(1)} must be ${max} characters or fewer.`;
  if (BAD_CHARS.test(t)) return `${label[0]!.toUpperCase()}${label.slice(1)} contains characters that aren’t allowed.`;
  if (LINK_OR_CONTACT.test(t)) return `Please don’t include links, email addresses or phone numbers in ${label}.`;
  return null;
}

// ---------------------------------------------------------------- display name
const NAME_FORBIDDEN = /[<>@/\\:;{}[\]|=+*&%$#^~`"\u0000-\u001f]/;
const NAME_RESERVED = /(admin|moderator|support|staff|official|open ?stall|crapper ?mapper|https?|www\.|\.com|\.net|\.org)/i;

export function validateDisplayName(name: string): string | null {
  const t = name.trim();
  if (t.length < 2 || t.length > 30) return 'Use 2 to 30 characters.';
  if (NAME_FORBIDDEN.test(t)) return 'Use letters, numbers, spaces and simple punctuation only.';
  if (NAME_RESERVED.test(t)) return 'That name isn’t allowed. Choose another.';
  return null;
}

// ---------------------------------------------------------------- ratings & observations
export const OBSERVATIONS = [
  { key: 'clean', label: 'Clean', opposite: 'dirty' },
  { key: 'dirty', label: 'Dirty', opposite: 'clean' },
  { key: 'supplies_stocked', label: 'Supplies stocked', opposite: 'supplies_missing' },
  { key: 'supplies_missing', label: 'Supplies missing', opposite: 'supplies_stocked' },
  { key: 'easy_to_find', label: 'Easy to find', opposite: 'hard_to_find' },
  { key: 'hard_to_find', label: 'Hard to find', opposite: 'easy_to_find' },
] as const;
export type ObservationKey = (typeof OBSERVATIONS)[number]['key'];

/** Selecting an observation clears its opposite so contradictory input can't be built. */
export function toggleObservation(selected: readonly ObservationKey[], key: ObservationKey): ObservationKey[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  const opposite = OBSERVATIONS.find((o) => o.key === key)!.opposite;
  return [...selected.filter((k) => k !== opposite), key];
}

export function validateRating(n: number | null): string | null {
  return n !== null && Number.isInteger(n) && n >= 1 && n <= 5 ? null : 'Choose a rating from 1 to 5.';
}

/** Plain: stars. Risqué: playful wording. Stored value is always the number 1-5. */
export function ratingChoiceLabel(n: number, mode: DisplayMode): string {
  if (mode === 'risque') return ['', 'Hold it', 'Meh', 'Gets the job done', 'Throne-worthy', 'Royal flush'][n] ?? String(n);
  return `${n} ${n === 1 ? 'star' : 'stars'}`;
}

// ---------------------------------------------------------------- reports
export const REPORT_ISSUES = [
  { key: 'closed', label: 'It’s closed or gone' },
  { key: 'wrong_location', label: 'It’s in the wrong place' },
  { key: 'wrong_info', label: 'Some details are wrong' },
  { key: 'unsafe', label: 'It feels unsafe' },
  { key: 'private_property', label: 'It’s private property' },
  { key: 'not_a_restroom', label: 'There’s no public restroom here' },
  { key: 'other', label: 'Something else' },
] as const;
export type ReportIssue = (typeof REPORT_ISSUES)[number]['key'];

export function validateReport(issue: ReportIssue | null, comment: string): string | null {
  if (!issue) return 'Choose what’s wrong.';
  if (comment.trim().length > 0) return validateFreeText(comment, 'your note', 300);
  return null;
}

// ---------------------------------------------------------------- submissions
/** A new restroom must be added from where the contributor is standing, using a fresh, reasonably accurate device fix. */
export const MAX_NEW_LOCATION_ACCURACY_M = 50;
export const LOCATION_FIX_MAX_AGE_MS = 120_000;

/** One device position reading. Held in memory only; sent once with a submission and never kept as a history. */
export type LocationFix = { latitude: number; longitude: number; accuracyM: number; capturedAt: number };

/** Returns a user-facing problem with the fix, or null when it is usable for a new-restroom submission. */
export function fixProblem(fix: LocationFix | null, now: number = Date.now()): string | null {
  if (!fix) return 'We need your current location to add a restroom. Allow location access and stand at the restroom.';
  const { latitude, longitude, accuracyM } = fix;
  if (![latitude, longitude, accuracyM].every(Number.isFinite) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180
    || (latitude === 0 && longitude === 0) || accuracyM <= 0) {
    return 'We couldn’t get a valid location from your device. Try again.';
  }
  if (accuracyM > MAX_NEW_LOCATION_ACCURACY_M) {
    return `Your location isn’t accurate enough yet (about ${Math.round(accuracyM)} m). Move near open sky or wait a few seconds, then refresh it.`;
  }
  if (now - fix.capturedAt > LOCATION_FIX_MAX_AGE_MS) return 'Your location is out of date. Refresh it while you’re at the restroom.';
  return null;
}

export type LocationDraft = {
  name: string;
  addressLine: string;
  city: string;
  region: string;
  postalCode: string;
  /** New restroom: required. Correction: optional, only to fix a wrong pin. */
  fix: LocationFix | null;
  accessLocation: string;
  openingHours: string;
  fee: boolean | null;
  key: boolean | null;
  purchase: boolean | null;
  wheelchair: boolean | null;
  genderNeutral: boolean | null;
  babyChanging: boolean | null;
  note: string;
  attestedPublic: boolean;
};

export const EMPTY_DRAFT: LocationDraft = {
  name: '', addressLine: '', city: '', region: '', postalCode: '', fix: null,
  accessLocation: '', openingHours: '', fee: null, key: null, purchase: null, wheelchair: null, genderNeutral: null,
  babyChanging: null, note: '', attestedPublic: false,
};

export const ATTESTATION_TEXT =
  'This is a restroom the public can use, such as a park, library, shop or station. It is not inside a private home.';

export type DraftResult =
  | { ok: true; proposed: Record<string, string | number | boolean>; note: string | null; position: { latitude: number; longitude: number; accuracyM: number } | null }
  | { ok: false; errors: string[] };

/**
 * Builds the `proposed` payload (only the fields that were filled in). Unknown (null) booleans are omitted, never sent as false.
 * - 'new': coordinates are NOT part of `proposed`; they come from the device fix and are returned as `position`.
 * - 'edit': only changed fields; an optional fix updates the pin (sent inside `proposed`).
 */
export function buildProposal(d: LocationDraft, kind: 'new' | 'edit', now: number = Date.now()): DraftResult {
  const errors: string[] = [];
  const out: Record<string, string | number | boolean> = {};
  const text = (key: string, value: string, label: string, max: number) => {
    if (value.trim() === '') return;
    const e = validateFreeText(value, label, max);
    if (e) errors.push(e);
    else out[key] = value.trim();
  };
  text('name', d.name, 'the name', 120);
  text('address_line', d.addressLine, 'the address', 300);
  text('city', d.city, 'the city', 120);
  text('region', d.region, 'the state', 120);
  text('postal_code', d.postalCode, 'the ZIP code', 20);
  text('access_location', d.accessLocation, 'where to find it', 300);
  text('opening_hours', d.openingHours, 'the hours', 300);
  const bools: [string, boolean | null][] = [
    ['fee_required', d.fee], ['key_required', d.key], ['purchase_required', d.purchase],
    ['wheelchair_accessible', d.wheelchair], ['gender_neutral', d.genderNeutral], ['baby_changing', d.babyChanging],
  ];
  for (const [k, v] of bools) if (v !== null) out[k] = v;

  let position: { latitude: number; longitude: number; accuracyM: number } | null = null;
  if (kind === 'new') {
    if (d.name.trim() === '') errors.push('Enter the name.');
    const problem = fixProblem(d.fix, now);
    if (problem) errors.push(problem);
    else if (d.fix) position = { latitude: d.fix.latitude, longitude: d.fix.longitude, accuracyM: d.fix.accuracyM };
  } else if (d.fix) {
    const problem = fixProblem(d.fix, now);
    if (problem) errors.push(problem);
    else {
      out.latitude = d.fix.latitude;
      out.longitude = d.fix.longitude;
    }
  }
  if (kind === 'edit' && errors.length === 0 && Object.keys(out).length === 0) errors.push('Change at least one detail.');
  if (d.note.trim() !== '') {
    const e = validateFreeText(d.note, 'your note', 300);
    if (e) errors.push(e);
  }
  if (!d.attestedPublic) errors.push('Confirm this is a public restroom, not inside a private home.');
  if (looksResidential(JSON.stringify(out)) || looksResidential(d.note)) {
    errors.push('Private homes can’t be added. Open Stall only lists restrooms the public may use.');
  }
  return errors.length ? { ok: false, errors } : { ok: true, proposed: out, note: d.note.trim() || null, position };
}

// ---------------------------------------------------------------- server error mapping
type ErrLike = { message?: string; code?: string; status?: number } | null | undefined;

/** Friendly message for a failed account RPC. Never echoes raw backend text. */
/**
 * Error codes the Open Stall database functions and the API gateway raise to REJECT a request before or instead of
 * storing anything (see the migrations: 22023 invalid/duplicate, 28000 not authenticated, 42501 not permitted,
 * 53400 caps, 54000 rate limit, 55000 object state; PGRST301/302 are PostgREST rejecting the token before running
 * the function). Only these prove "nothing was stored".
 */
export const AUTHORITATIVE_REJECTION_CODES: readonly string[] = ['22023', '28000', '42501', '53400', '54000', '55000', 'PGRST301', 'PGRST302'];

/**
 * Whether a failed write may nevertheless have taken effect. Certainty is limited to the known structured
 * rejections above. Everything else stays uncertain: no response, connection resets and timeouts (ECONNRESET,
 * ETIMEDOUT, ...), gateway or proxy errors, unknown or unexpected codes, internal errors. For those the request may
 * have committed before the response was lost, so the UI must not claim that nothing happened and must never
 * resend automatically.
 */
export function isUncertainOutcome(err: ErrLike): boolean {
  return !(typeof err?.code === 'string' && AUTHORITATIVE_REJECTION_CODES.includes(err.code));
}

/** Truthful copy for a write whose outcome is unknown (see isUncertainOutcome). Never says nothing happened. */
export function uncertainWriteMessage(what: string): string {
  return `We couldn’t confirm whether ${what}. We never resend automatically, so check first and then try again if needed.`;
}

export const UNCERTAIN_DELETE_MESSAGE =
  'We couldn’t confirm whether your account was deleted, so please don’t assume either way. A sign-in that fails can’t tell us on its own, because it can fail for other reasons too. If you can sign in, the account still exists and you can try the deletion again. Otherwise check your connection and try again later.';

export function accountErrorMessage(err: ErrLike): string {
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  if (code === '28000' || msg.includes('not authenticated') || msg.includes('jwt') || err?.status === 401) return 'Please sign in again.';
  if (msg.includes('submissions paused')) return 'New restroom submissions are paused for your account for now.';
  if (code === '54000' || msg.includes('rate limit')) return 'You’re doing that a lot. Please try again later.';
  if (code === '53400' && msg.includes('favorites')) return `You can save up to ${FREE_FAVORITES_LIMIT} favorites. Remove one to add another.`;
  if (code === '53400') return 'You have too many pending submissions. Wait for some to be reviewed or withdraw one.';
  if (msg.includes('too far')) return `You need to be within ${CHECKIN_RADIUS_METERS} meters of the restroom to check in.`;
  if (msg.includes('already checked in')) return 'You already checked in here recently.';
  if (msg.includes('pending correction')) return 'You already have a correction waiting for this restroom.';
  if (msg.includes('not accurate enough')) return 'Your location isn’t accurate enough yet. Move near open sky and try again.';
  if (msg.includes('current location') || msg.includes('position must come')) return 'We need your current location to add a restroom. Stand at the restroom and try again.';
  if (msg.includes('residence')) return 'Private homes can’t be added. Open Stall only lists restrooms the public may use.';
  if (msg.includes('location not available')) return 'This restroom is no longer available.';
  if (code === '22023') return 'Some details weren’t accepted. Check them and try again.';
  if (msg.includes('network') || msg.includes('fetch')) return 'Could not reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
