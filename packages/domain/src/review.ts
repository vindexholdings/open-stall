/**
 * Validator/review rules (shared by the admin UI and mirrored by the database function
 * public.apply_location_review, which enforces them again server-side).
 *
 * Outcomes:
 *  - restroom does NOT exist  -> status 'closed' (hidden, never re-published by imports)
 *  - exists + personally verified -> 'verified' (only on explicit confirmation, with a date)
 *  - exists, not personally verified -> 'unverified' (public, badged), unless already verified
 *  - unsure -> no status change; the review and notes are recorded
 * Facts: the form values are written exactly as given; "unknown" is null (never guessed).
 */
export const EXISTENCE_VALUES = ['exists', 'not_exists', 'unsure'] as const;
export const ACCESS_VALUES = ['public_free', 'customers_only', 'key_required', 'unknown'] as const;
export type Existence = (typeof EXISTENCE_VALUES)[number];
export type AccessChoice = (typeof ACCESS_VALUES)[number];
type Tri = boolean | null;

export type ReviewInput = {
  reviewer: string;
  existence: Existence;
  access: AccessChoice;
  key_required?: Tri;
  purchase_required?: Tri;
  fee_required?: Tri;
  wheelchair_accessible: Tri;
  gender_neutral: Tri;
  baby_changing: Tri;
  hot_water: Tri;
  cold_water_only: Tri;
  notes: string | null;
  personally_verified: boolean;
  verified_on: string | null;
};

export type ReviewParse = { ok: true; input: ReviewInput } | { ok: false; errors: string[] };

type FormLike = { get(name: string): unknown };
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const tri = (v: unknown): Tri | undefined => (v === 'yes' ? true : v === 'no' ? false : v === 'unknown' || v === null || v === undefined || v === '' ? null : undefined);

/** Parses an HTML form (radio values yes/no/unknown). `now` is injectable for tests. */
export function parseReviewForm(form: FormLike, now: Date = new Date()): ReviewParse {
  const errors: string[] = [];
  const existence = form.get('existence');
  const independentAccess = form.get('access_mode') === 'independent';
  const access = independentAccess ? 'unknown' : form.get('access');
  if (!EXISTENCE_VALUES.includes(existence as Existence)) errors.push('Choose whether the restroom exists, does not exist, or you are unsure.');
  if (!ACCESS_VALUES.includes(access as AccessChoice)) errors.push('Choose an access option (or Unknown).');

  const reviewer = typeof form.get('reviewer') === 'string' ? (form.get('reviewer') as string).trim() : '';
  if (reviewer.length < 1 || reviewer.length > 120) errors.push('Reviewer name is required (max 120 characters).');

  const facts: Record<string, Tri> = {};
  for (const f of ['wheelchair_accessible', 'gender_neutral', 'baby_changing', 'hot_water', 'cold_water_only']) {
    const v = tri(form.get(f));
    if (v === undefined) errors.push(`${f} must be Yes, No or Unknown.`);
    else facts[f] = v;
  }
  if (facts.hot_water === true && facts.cold_water_only === true) errors.push('Hot water and cold-water-only cannot both be Yes.');

  const accessValues: Record<string, Tri> = independentAccess ? {} : accessFacts(access as AccessChoice);
  if (independentAccess) {
    for (const f of ['key_required', 'purchase_required', 'fee_required']) {
      const v = tri(form.get(f));
      if (v === undefined) errors.push(`${f} must be Yes, No or Unknown.`);
      else accessValues[f] = v;
    }
  }

  const rawNotes = form.get('notes');
  let notes: string | null = null;
  if (typeof rawNotes === 'string' && rawNotes.trim() !== '') {
    notes = rawNotes.trim();
    if (notes.length > 1000) errors.push('Notes are limited to 1000 characters.');
    if (CONTROL.test(notes)) errors.push('Notes contain unsupported control characters.');
  }

  const personally = form.get('personally_verified') === 'on' || form.get('personally_verified') === 'yes';
  let verifiedOn: string | null = null;
  const vo = form.get('verified_on');
  if (typeof vo === 'string' && vo !== '') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(vo) || Number.isNaN(Date.parse(`${vo}T00:00:00Z`))) errors.push('Verification date must be a real date.');
    else if (Date.parse(`${vo}T00:00:00Z`) > now.getTime() + 24 * 3600 * 1000) errors.push('Verification date cannot be in the future.');
    else verifiedOn = vo;
  }
  if (personally) {
    if (existence !== 'exists') errors.push('Only a restroom that exists can be marked personally verified.');
    if (!verifiedOn) errors.push('A verification date is required when you personally verified it.');
  } else {
    verifiedOn = null;
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    input: {
      reviewer, existence: existence as Existence, access: access as AccessChoice,
      ...accessValues,
      wheelchair_accessible: facts.wheelchair_accessible ?? null, gender_neutral: facts.gender_neutral ?? null,
      baby_changing: facts.baby_changing ?? null, hot_water: facts.hot_water ?? null, cold_water_only: facts.cold_water_only ?? null,
      notes, personally_verified: personally, verified_on: verifiedOn,
    },
  };
}

/** Access choice -> canonical columns. Only what the choice states is set; the rest is unknown (null). */
export function accessFacts(a: AccessChoice): { key_required: Tri; purchase_required: Tri; fee_required: Tri } {
  switch (a) {
    case 'public_free': return { key_required: false, purchase_required: false, fee_required: false };
    case 'customers_only': return { key_required: null, purchase_required: true, fee_required: null };
    case 'key_required': return { key_required: true, purchase_required: null, fee_required: null };
    default: return { key_required: null, purchase_required: null, fee_required: null };
  }
}

/** Hot/cold form fields -> canonical columns. Cold-water-only implies hot=false, cold=true. */
export function waterFacts(hot: Tri, coldOnly: Tri): { has_hot_water: Tri; has_cold_water: Tri } {
  if (coldOnly === true) return { has_hot_water: false, has_cold_water: true };
  if (hot === true) return { has_hot_water: true, has_cold_water: null };
  return { has_hot_water: hot, has_cold_water: null };
}

export type ReviewableStatus = 'candidate' | 'unverified' | 'verified' | 'closed';
export type ReviewOutcome = { status: ReviewableStatus; applyFacts: boolean; publicAfter: boolean; message: string };

/** What saving this review will do, shown to the reviewer before they submit; mirrored in SQL. */
export function reviewOutcome(current: ReviewableStatus, input: ReviewInput): ReviewOutcome {
  if (input.existence === 'not_exists') {
    return { status: 'closed', applyFacts: false, publicAfter: false, message: 'Marked as not existing (Closed) and hidden from the public app. Imports will not republish it.' };
  }
  if (input.existence === 'unsure') {
    return { status: current, applyFacts: false, publicAfter: current === 'verified' || current === 'unverified', message: 'No status change. Your notes are recorded.' };
  }
  if (input.personally_verified) {
    return { status: 'verified', applyFacts: true, publicAfter: true, message: `Becomes Verified (confirmed by you on ${input.verified_on}) and public. Facts below replace imported ones; Unknown stays unknown.` };
  }
  if (current === 'verified') {
    return { status: 'verified', applyFacts: true, publicAfter: true, message: 'Stays Verified. Facts below are updated.' };
  }
  return { status: 'unverified', applyFacts: true, publicAfter: true, message: 'Becomes Unverified: public with the "Unverified" badge. It is NOT Verified until you confirm personally.' };
}

/** Pre-selects the access radio from current canonical facts (so the form starts from what is stored). */
export function deriveAccess(f: { key_required: Tri; purchase_required: Tri }): AccessChoice {
  if (f.key_required === false && f.purchase_required === false) return 'public_free';
  if (f.purchase_required === true) return 'customers_only';
  if (f.key_required === true) return 'key_required';
  return 'unknown';
}

/** Pre-selects the hot / cold-only radios from canonical water facts. */
export function deriveWater(f: { has_hot_water: Tri; has_cold_water: Tri }): { hot_water: Tri; cold_water_only: Tri } {
  if (f.has_cold_water === true && f.has_hot_water === false) return { hot_water: false, cold_water_only: true };
  return { hot_water: f.has_hot_water, cold_water_only: f.has_hot_water === true ? false : null };
}
