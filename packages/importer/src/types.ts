export type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

/** Evidence level of a restroom: explicit => publicly visible "unverified"; inferred => hidden candidate. */
export type Evidence = 'explicit' | 'inferred';

/** One record sent to public.import_locations(). Field names match that function. */
export type ImportRecord = {
  source: 'osm';
  source_reference: string;
  name: string;
  address_line: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  country_code: string;
  latitude: number;
  longitude: number;
  evidence: Evidence;
  wheelchair_accessible: boolean | null;
  gender_neutral: boolean | null;
  baby_changing: boolean | null;
  has_hot_water: boolean | null;
  has_cold_water: boolean | null;
  key_required: boolean | null;
  purchase_required: boolean | null;
  access_location: string | null;
  source_license: string;
  source_attribution: string;
  source_tags: Record<string, string>;
  source_hash: string;
};

export type Classification =
  | { kind: 'record'; record: ImportRecord; reason: string }
  | { kind: 'skip'; reason: string };

export type Bbox = { south: number; west: number; north: number; east: number };
