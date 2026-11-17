/** Visit observations are separate from imported facts and historical private notes. */
export const RESTROOM_TYPES = ['unknown', 'men', 'women', 'all_gender', 'family', 'single_occupancy'] as const;
export const CONDITION_OPTIONS = {
  seats: ['unknown', 'clean', 'dirty', 'not_applicable'],
  mirrors: ['unknown', 'clean', 'dirty', 'missing', 'broken'],
  stall_doors: ['unknown', 'working', 'broken', 'not_applicable'],
  toilet_paper: ['unknown', 'available', 'out'],
  floor: ['unknown', 'clean', 'dirty'],
} as const;
export type RestroomType = typeof RESTROOM_TYPES[number];
export type Conditions = { [K in keyof typeof CONDITION_OPTIONS]: typeof CONDITION_OPTIONS[K][number] };
export type ReviewDetails = {
  customers_only: boolean | null;
  family_bathroom: boolean | null;
  cold_water: boolean | null;
  cleaning_log: boolean | null;
  restroom_type: RestroomType;
  rating: number | null;
  cleanliness_score: number | null;
  public_comment: string | null;
  conditions: Conditions;
};
const asTri = (v: unknown) => v === 'yes' ? true : v === 'no' ? false : v === 'unknown' || v === null || v === undefined || v === '' ? null : undefined;
export function parseReviewDetails(form: { get(name: string): unknown }): { ok: true; details: ReviewDetails } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const booleans: Record<string, boolean | null> = {};
  for (const key of ['customers_only', 'family_bathroom', 'cold_water', 'cleaning_log']) {
    const value = asTri(form.get(key));
    if (value === undefined) errors.push(`${key} must be Yes, No or Unknown.`);
    else booleans[key] = value;
  }
  const restroomType = form.get('restroom_type') ?? 'unknown';
  if (!RESTROOM_TYPES.includes(restroomType as RestroomType)) errors.push('Choose a restroom type.');
  const scores: Record<string, number | null> = {};
  for (const key of ['rating', 'cleanliness_score']) {
    const raw = form.get(key);
    if (raw === null || raw === undefined || raw === '') scores[key] = null;
    else if (typeof raw === 'string' && /^[1-5]$/.test(raw)) scores[key] = Number(raw);
    else errors.push(`${key} must be a whole number from 1 to 5.`);
  }
  const conditions = {} as Conditions;
  for (const [key, choices] of Object.entries(CONDITION_OPTIONS)) {
    const value = form.get(key) ?? 'unknown';
    if (!(choices as readonly unknown[]).includes(value)) errors.push(`Choose a valid ${key} condition.`);
    else Object.assign(conditions, { [key]: value });
  }
  const rawComment = form.get('public_comment');
  const comment = typeof rawComment === 'string' ? rawComment.trim() || null : null;
  if (comment && (comment.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(comment))) errors.push('Public comments must be at most 1000 characters without control characters.');
  if (form.get('existence') !== 'exists' && (scores.rating != null || scores.cleanliness_score != null || comment)) errors.push('Ratings and public comments require an existing restroom.');
  if (errors.length) return { ok: false, errors };
  return { ok: true, details: {
    customers_only: booleans.customers_only ?? null, family_bathroom: booleans.family_bathroom ?? null,
    cold_water: booleans.cold_water ?? null, cleaning_log: booleans.cleaning_log ?? null,
    restroom_type: restroomType as RestroomType, rating: scores.rating ?? null,
    cleanliness_score: scores.cleanliness_score ?? null, public_comment: comment, conditions,
  } };
}
