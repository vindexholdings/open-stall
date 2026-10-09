import type { PublicLocation } from './publicLocation';

export type FactValue = 'yes' | 'no' | 'unknown';

export type Fact = { key: string; label: string; value: FactValue; text: string };

const toValue = (b: boolean | null): FactValue => (b === null ? 'unknown' : b ? 'yes' : 'no');
const word: Record<FactValue, string> = { yes: 'Yes', no: 'No', unknown: 'Not reported' };

const fact = (key: string, label: string, b: boolean | null): Fact => {
  const value = toValue(b);
  return { key, label, value, text: word[value] };
};

/**
 * Access facts shown first on a location (key, purchase, accessibility), then amenities.
 * Unknown is displayed as "Not reported" and is never presented as "No".
 */
export function describeFacts(l: PublicLocation): { access: Fact[]; amenities: Fact[] } {
  return {
    access: [
      fact('key', 'Key required', l.keyRequired),
      fact('purchase', 'Purchase required', l.purchaseRequired),
      fact('fee', 'Fee to use', l.feeRequired),
      fact('wheelchair', 'Wheelchair accessible', l.wheelchairAccessible),
      fact('genderNeutral', 'Gender-neutral', l.genderNeutral),
    ],
    amenities: [
      fact('babyChanging', 'Baby changing', l.babyChanging),
      fact('hotWater', 'Hot water', l.hasHotWater),
      fact('coldWater', 'Cold water', l.hasColdWater),
    ],
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

/** Symbol + word for a fact value, so Yes/No/Not reported never depends on color alone. */
export function factMark(value: FactValue): { symbol: string; text: string } {
  return value === 'yes' ? { symbol: '✓', text: 'Yes' } : value === 'no' ? { symbol: '✕', text: 'No' } : { symbol: '?', text: 'Not reported' };
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
    'Facts marked “Not reported” are unknown. They are not the same as “No”.',
    'Details can change. If something here is out of date, tell us.',
  ];
  if (l.attribution) out.push(l.attribution);
  return out;
}
