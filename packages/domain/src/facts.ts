import type { PublicLocation } from './publicLocation';

export type FactValue = 'yes' | 'no' | 'unknown';

/**
 * One fact about a restroom. `label` is a feature-specific phrase for THIS value ("No key needed", "Hot water available",
 * "Fee not reported"), so a row reads on its own without a repeated Yes/No column. `value` keeps the three states distinct
 * (known present, confirmed absent, unknown) so the UI can draw a check, a cross or a question mark next to the words.
 */
export type Fact = { key: string; value: FactValue; label: string };

const toValue = (b: boolean | null | undefined): FactValue => (b === null || b === undefined ? 'unknown' : b ? 'yes' : 'no');

/** [present, absent, unknown] phrases. Absent is used ONLY when the underlying value is false, never when it is null. */
const fact = (key: string, b: boolean | null | undefined, phrases: readonly [string, string, string]): Fact => {
  const value = toValue(b);
  return { key, value, label: value === 'yes' ? phrases[0] : value === 'no' ? phrases[1] : phrases[2] };
};

/**
 * What the detail page lists under "Features & Access": `access` (key, purchase, fee, wheelchair, gender-neutral), then
 * `amenities`, then `secondary` (lower emphasis, still shown). Unknown is its own phrase and never reads as "No". A
 * purchase that is not required says nothing about a usage fee, so fee is its own fact.
 */
export function describeFacts(l: PublicLocation): { access: Fact[]; amenities: Fact[]; secondary: Fact[] } {
  return {
    access: [
      fact('key', l.keyRequired, ['Key required', 'No key needed', 'Key requirement not reported']),
      fact('purchase', l.purchaseRequired, ['Purchase required', 'No purchase required', 'Purchase requirement not reported']),
      fact('fee', l.feeRequired, ['Fee to use', 'No fee to use', 'Fee not reported']),
      fact('wheelchair', l.wheelchairAccessible, ['Wheelchair accessible', 'Not wheelchair accessible', 'Wheelchair access not reported']),
      fact('genderNeutral', l.genderNeutral, ['Gender-neutral', 'Not gender-neutral', 'Gender-neutral not reported']),
    ],
    amenities: [
      fact('babyChanging', l.babyChanging, ['Baby changing available', 'No baby changing', 'Baby changing not reported']),
      fact('hotWater', l.hasHotWater, ['Hot water available', 'No hot water', 'Hot water not reported']),
    ],
    secondary: [fact('coldWater', l.hasColdWater, ['Cold water available', 'No cold water', 'Cold water not reported'])],
  };
}

export type VerificationBadge = { kind: 'verified' | 'unverified'; label: string };

/** "Verified Mar 2026" (or "Verified"), or "Unverified". Shown with text, never color alone. */
export function verificationBadge(l: Pick<PublicLocation, 'verification' | 'lastVerifiedAt'>): VerificationBadge {
  if (l.verification === 'unverified') return { kind: 'unverified', label: 'Unverified' };
  if (!l.lastVerifiedAt) return { kind: 'verified', label: 'Verified' };
  const d = new Date(l.lastVerifiedAt);
  if (Number.isNaN(d.getTime())) return { kind: 'verified', label: 'Verified' };
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return { kind: 'verified', label: `Verified ${month} ${d.getUTCFullYear()}` };
}

/** Plain-language explanation for Unverified listings, encouraging confirmation. */
export const UNVERIFIED_EXPLANATION =
  'Open Stall hasn’t confirmed this restroom yet. Access and condition may differ from what is listed. Been here? Confirming or correcting it will help others once community verification opens.';

export function ratingLabel(average: number | null, count: number): string {
  if (average === null || count === 0) return 'No ratings yet';
  return `${average.toFixed(1)} / 5 (${count} ${count === 1 ? 'rating' : 'ratings'})`;
}

/** Raw source opening hours with an honesty caveat; null means hours are not reported. */
export function hoursLabel(openingHours: string | null): { text: string; reported: boolean } {
  const t = openingHours?.trim();
  return t ? { text: `${t} (from public sources, may be inaccurate)`, reported: true } : { text: 'Not reported', reported: false };
}

/**
 * Short, honest highlights for a result card: only facts that are known (true or false) and matter
 * for "can I use it right now" (key, purchase, fee, wheelchair access). Unknown facts are omitted
 * rather than shown as "No", so a missing fact never reads as a negative.
 */
export function quickFacts(l: Pick<PublicLocation, 'keyRequired' | 'purchaseRequired' | 'feeRequired' | 'wheelchairAccessible'>): string[] {
  const out: string[] = [];
  if (l.keyRequired === true) out.push('Key required');
  else if (l.keyRequired === false) out.push('No key needed');
  if (l.purchaseRequired === true) out.push('Purchase required');
  else if (l.purchaseRequired === false) out.push('No purchase needed');
  if (l.feeRequired === true) out.push('Fee to use');
  if (l.wheelchairAccessible === true) out.push('Wheelchair accessible');
  return out;
}

/** Community rating text for cards ("Community rating 4.2 / 5 (12 ratings)"), or null when there are none. */
export function communityRatingText(average: number | null, count: number): string | null {
  if (average === null || count === 0) return null;
  return `Community rating ${ratingLabel(average, count)}`;
}

/** Icon name + word for a fact value, so Yes/No/Not reported never depends on color alone (the UI draws the icon). */
export function factMark(value: FactValue): { icon: 'check' | 'minus' | 'help'; text: string } {
  // confirmed absent is a neutral minus, not a cross: "No key needed" is good news and must not look like a warning
  return value === 'yes' ? { icon: 'check', text: 'Yes' } : value === 'no' ? { icon: 'minus', text: 'No' } : { icon: 'help', text: 'Not reported' };
}

/** Detail-page rating: always labeled as a community rating; "none yet" is stated, never shown as zero. */
export function communityRatingDetail(average: number | null, count: number): { headline: string; hasRatings: boolean; note: string } {
  const text = communityRatingText(average, count);
  return {
    headline: text ?? 'No community ratings yet',
    hasRatings: text !== null,
    note: 'Ratings come from signed-in community members. They are separate from verification.',
  };
}

/** Plain-language provenance for the "About these details" block. Never claims more than the data supports. */
export function provenanceNotes(l: Pick<PublicLocation, 'verification' | 'lastVerifiedAt' | 'attribution'>): string[] {
  const badge = verificationBadge(l);
  const out = [
    l.verification === 'verified'
      ? `${badge.label}: Open Stall confirmed this restroom exists. Other details can still change.`
      : 'Unverified: Open Stall has not confirmed this restroom yet.',
    'Anything described as “not reported” is unknown. It does not mean “no”.',
    'Details can change. If something here is out of date, tell us.',
  ];
  if (l.attribution) out.push(l.attribution);
  return out;
}
