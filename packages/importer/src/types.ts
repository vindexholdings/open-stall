export type OsmElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
  /** OSM edit timestamp (ISO). Editor identity is never read or stored. */
  timestamp?: string;
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
  fee_required: boolean | null;
  access_location: string | null;
  opening_hours: string | null;
  license: string;
  attribution: string;
  tags: Record<string, string>;
  /** Hash of source-derived content (excludes timestamps and hold state). */
  content_hash: string;
  source_edited_at: string | null;
  /** Set when a recent source edit holds this record hidden until it ages (vandalism guard). */
  hold_reason: 'recent_edit' | null;
};

export type Classification =
  | { kind: 'record'; record: ImportRecord; reason: string }
  | { kind: 'skip'; reason: string };

/** Standard area shape, also enforced by the database (import_runs.bounds). */
export type Bbox = { south: number; west: number; north: number; east: number };
