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

/** e.g. "Verified Mar 2026"; falls back to "Verified" when the date is missing/invalid. */
export function verificationLabel(lastVerifiedAt: string | null): string {
  if (!lastVerifiedAt) return 'Verified';
  const d = new Date(lastVerifiedAt);
  if (Number.isNaN(d.getTime())) return 'Verified';
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  return `Verified ${month} ${d.getUTCFullYear()}`;
}

export function ratingLabel(average: number | null, count: number): string {
  if (average === null || count === 0) return 'No ratings yet';
  return `${average.toFixed(1)} / 5 (${count} ${count === 1 ? 'rating' : 'ratings'})`;
}
