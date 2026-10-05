/**
 * Coordinates from the US Census Bureau Geocoder: U.S. government data (public domain), so storing
 * it is allowed. Values are address-range interpolations (street-level, typically tens of meters,
 * sometimes ~100 m off): fine for development/testing, to be replaced by surveyed coordinates
 * before launch. We deliberately do NOT use Google, OpenStreetMap/Nominatim or other map databases.
 */
export const CENSUS_BENCHMARK = 'Public_AR_Current';
export const CENSUS_URL = 'https://geocoding.geo.census.gov/geocoder/locations/address';

export type CensusAddress = { street: string; city: string; region: string; postal_code: string };
export type Geocode = {
  latitude: number;
  longitude: number;
  matchedAddress: string;
  benchmark: string;
  retrievedAt: string;
};

type CensusResponse = {
  result?: {
    addressMatches?: {
      matchedAddress?: string;
      coordinates?: { x?: number; y?: number };
      addressComponents?: { zip?: string; state?: string };
    }[];
  };
};

export function buildCensusUrl(a: CensusAddress): string {
  const p = new URLSearchParams({
    street: a.street, city: a.city, state: a.region, zip: a.postal_code,
    benchmark: CENSUS_BENCHMARK, format: 'json',
  });
  return `${CENSUS_URL}?${p.toString()}`;
}

/** Parses a Census response; refuses empty, ambiguous, mismatched or out-of-range results. */
export function parseCensusResponse(json: unknown, a: CensusAddress, retrievedAt: string): Geocode {
  const matches = (json as CensusResponse)?.result?.addressMatches ?? [];
  if (matches.length === 0) throw new Error(`Census geocoder found no match for "${a.street}, ${a.city}, ${a.region} ${a.postal_code}"`);
  if (matches.length > 1) throw new Error(`Census geocoder returned ${matches.length} matches for "${a.street}"; refusing to guess`);
  const m = matches[0]!;
  const lng = m.coordinates?.x;
  const lat = m.coordinates?.y;
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) {
    throw new Error(`Census geocoder returned unusable coordinates for "${a.street}"`);
  }
  if (m.addressComponents?.zip && m.addressComponents.zip !== a.postal_code) {
    throw new Error(`Census match ZIP ${m.addressComponents.zip} differs from ${a.postal_code}; refusing`);
  }
  if (m.addressComponents?.state && m.addressComponents.state.toUpperCase() !== a.region.toUpperCase()) {
    throw new Error(`Census match state ${m.addressComponents.state} differs from ${a.region}; refusing`);
  }
  return {
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lng * 1e6) / 1e6,
    matchedAddress: m.matchedAddress ?? '',
    benchmark: CENSUS_BENCHMARK,
    retrievedAt,
  };
}

export async function geocodeCensus(
  a: CensusAddress,
  opts: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<Geocode> {
  const res = await (opts.fetchImpl ?? fetch)(buildCensusUrl(a));
  if (!res.ok) throw new Error(`Census geocoder HTTP ${res.status}`);
  return parseCensusResponse(await res.json(), a, (opts.now ?? (() => new Date()))().toISOString());
}
