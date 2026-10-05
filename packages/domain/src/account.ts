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
export type LocationDraft = {
  name: string;
  addressLine: string;
  city: string;
  region: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
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
  name: '', addressLine: '', city: '', region: '', postalCode: '', latitude: null, longitude: null,
  accessLocation: '', openingHours: '', fee: null, key: null, purchase: null, wheelchair: null, genderNeutral: null,
  babyChanging: null, note: '', attestedPublic: false,
};

export const ATTESTATION_TEXT =
  'This is a restroom the public can use, such as a park, library, shop or station. It is not inside a private home.';

export type DraftResult = { ok: true; proposed: Record<string, string | number | boolean>; note: string | null } | { ok: false; errors: string[] };

/**
 * Builds the `proposed` payload (only the fields that were filled in). Edits send just the changed
 * fields; new locations need a name and coordinates. Unknown (null) booleans are omitted, never sent as false.
 */
export function buildProposal(d: LocationDraft, kind: 'new' | 'edit'): DraftResult {
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

  if (d.latitude !== null || d.longitude !== null) {
    if (d.latitude === null || d.longitude === null || !Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)
      || Math.abs(d.latitude) > 90 || Math.abs(d.longitude) > 180) {
      errors.push('Enter a valid latitude and longitude.');
    } else {
      out.latitude = d.latitude;
      out.longitude = d.longitude;
    }
  }
  if (kind === 'new') {
    if (!('name' in out) && d.name.trim() === '') errors.push('Enter the name.');
    if (!('latitude' in out) && d.latitude === null) errors.push('Choose the location on the map or use your current position.');
  } else if (errors.length === 0 && Object.keys(out).length === 0) {
    errors.push('Change at least one detail.');
  }
  if (d.note.trim() !== '') {
    const e = validateFreeText(d.note, 'your note', 300);
    if (e) errors.push(e);
  }
  if (!d.attestedPublic) errors.push('Confirm this is a public restroom, not inside a private home.');
  if (looksResidential(JSON.stringify(out)) || looksResidential(d.note)) {
    errors.push('Private homes can’t be added. Open Stall only lists restrooms the public may use.');
  }
  return errors.length ? { ok: false, errors } : { ok: true, proposed: out, note: d.note.trim() || null };
}

// ---------------------------------------------------------------- server error mapping
type ErrLike = { message?: string; code?: string; status?: number } | null | undefined;

/** Friendly message for a failed account RPC. Never echoes raw backend text. */
export function accountErrorMessage(err: ErrLike): string {
  const code = err?.code ?? '';
  const msg = (err?.message ?? '').toLowerCase();
  if (code === '28000' || msg.includes('not authenticated') || msg.includes('jwt') || err?.status === 401) return 'Please sign in again.';
  if (code === '54000' || msg.includes('rate limit')) return 'You’re doing that a lot. Please try again later.';
  if (code === '53400' && msg.includes('favorites')) return `You can save up to ${FREE_FAVORITES_LIMIT} favorites. Remove one to add another.`;
  if (code === '53400') return 'You have too many pending submissions. Wait for some to be reviewed or withdraw one.';
  if (msg.includes('too far')) return `You need to be within ${CHECKIN_RADIUS_METERS} meters of the restroom to check in.`;
  if (msg.includes('already checked in')) return 'You already checked in here recently.';
  if (msg.includes('residence')) return 'Private homes can’t be added. Open Stall only lists restrooms the public may use.';
  if (msg.includes('location not available')) return 'This restroom is no longer available.';
  if (code === '22023') return 'Some details weren’t accepted. Check them and try again.';
  if (msg.includes('network') || msg.includes('fetch')) return 'Could not reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}
