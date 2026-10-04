import { createHash } from 'node:crypto';
import type { Classification, Evidence, ImportRecord, OsmElement } from './types';

export const OSM_LICENSE = 'ODbL-1.0';
export const OSM_ATTRIBUTION = '© OpenStreetMap contributors';

/**
 * Place types that OFTEN have a restroom but prove nothing: imported as hidden candidates only
 * (gas stations, grocery/convenience stores, lodging, campgrounds, visitor centres, rest areas, civic buildings).
 * Restaurants, cafes and bars are deliberately not imported.
 */
export type CandidateCategory = { key: string; values: string[]; require?: Record<string, string> };

export const DEFAULT_CANDIDATE_CATEGORIES: CandidateCategory[] = [
  { key: 'amenity', values: ['fuel', 'library', 'townhall', 'community_centre'] },
  { key: 'tourism', values: ['camp_site', 'caravan_site', 'picnic_site'] },
  { key: 'tourism', values: ['hotel', 'motel', 'guest_house', 'hostel'] },
  { key: 'shop', values: ['supermarket', 'convenience'] },
  { key: 'tourism', values: ['information'], require: { information: 'visitor_centre' } },
  { key: 'highway', values: ['rest_area', 'services'] },
];

/** Tags kept for audit/refresh. Anything else (phones, emails, notes) is deliberately dropped. */
const KEPT_TAGS = [
  'amenity', 'name', 'access', 'toilets', 'toilets:access', 'toilets:wheelchair', 'wheelchair',
  'unisex', 'changing_table', 'fee', 'opening_hours', 'operator', 'tourism', 'highway',
  'information', 'building', 'addr:housenumber', 'addr:street', 'addr:city', 'addr:state',
  'addr:postcode', 'addr:country', 'check_date', 'survey:date',
];

const PUBLIC_ACCESS = new Set(['yes', 'permissive', 'public']);
const RESIDENTIAL_BUILDINGS = new Set(['house', 'residential', 'apartments', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'dormitory']);

export type ClassifyOptions = {
  defaultCountry?: string;
  includeCandidates?: boolean;
  candidateCategories?: CandidateCategory[];
  /** Injectable clock for tests. */
  now?: Date;
  /** Explicit-evidence records edited more recently than this are held hidden. Default 14. */
  recentEditDays?: number;
};

const triFromYesNo = (v: string | undefined): boolean | null =>
  v === 'yes' || v === 'designated' ? true : v === 'no' ? false : null;

function pick(tags: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of KEPT_TAGS) if (tags[k] !== undefined) out[k] = tags[k];
  return out;
}

function stableHash(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, sort(x)]))
        : v;
  return createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}

function matchesCandidate(tags: Record<string, string>, cats: CandidateCategory[]): boolean {
  return cats.some((c) => {
    const v = tags[c.key];
    if (v === undefined || !c.values.includes(v)) return false;
    return Object.entries(c.require ?? {}).every(([k, want]) => tags[k] === want);
  });
}

/**
 * Decides what (if anything) to import for one OSM element.
 *
 * Explicit evidence (-> public "unverified"):
 *   - amenity=toilets with public/customer access, or
 *   - toilets=yes together with toilets:access public/customers.
 * Inferred (-> hidden "candidate"): a place type that often has a restroom, or toilets=yes
 *   with unknown access. A business existing is NEVER treated as proof of a public restroom.
 * Skipped: private/restricted access, residential buildings, disused/abandoned, no coordinates,
 *   unnamed non-toilet places.
 */
export function classifyOsmElement(el: OsmElement, opts: ClassifyOptions = {}): Classification {
  const tags = el.tags;
  if (!tags) return { kind: 'skip', reason: 'no-tags' };

  const lat = el.lat ?? el.center?.lat;
  const lon = el.lon ?? el.center?.lon;
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { kind: 'skip', reason: 'no-coordinates' };
  }

  if (tags.disused === 'yes' || tags.abandoned === 'yes' || tags['disused:amenity'] || tags['abandoned:amenity']) {
    return { kind: 'skip', reason: 'disused' };
  }
  if (tags.building && RESIDENTIAL_BUILDINGS.has(tags.building)) {
    return { kind: 'skip', reason: 'residential-building' };
  }

  const isToiletFeature = tags.amenity === 'toilets';
  const toiletsTag = tags.toilets === 'yes';
  const access = isToiletFeature ? tags.access : tags['toilets:access'] ?? tags.access;

  let evidence: Evidence;
  let reason: string;
  let customersOnly = false;

  if (isToiletFeature) {
    if (access !== undefined && !PUBLIC_ACCESS.has(access) && access !== 'customers') {
      return { kind: 'skip', reason: 'restricted-access' };
    }
    evidence = 'explicit';
    reason = 'amenity=toilets';
    customersOnly = access === 'customers';
  } else if (toiletsTag && tags['toilets:access'] !== undefined) {
    const a = tags['toilets:access'];
    if (!PUBLIC_ACCESS.has(a) && a !== 'customers') return { kind: 'skip', reason: 'restricted-access' };
    evidence = 'explicit';
    reason = 'toilets=yes with public access';
    customersOnly = a === 'customers';
  } else if (toiletsTag) {
    if (tags.access !== undefined && !PUBLIC_ACCESS.has(tags.access) && tags.access !== 'customers') {
      return { kind: 'skip', reason: 'restricted-access' };
    }
    evidence = 'inferred';
    reason = 'toilets=yes, public access unknown';
  } else if (opts.includeCandidates !== false && matchesCandidate(tags, opts.candidateCategories ?? DEFAULT_CANDIDATE_CATEGORIES)) {
    if (tags.access !== undefined && !PUBLIC_ACCESS.has(tags.access) && tags.access !== 'customers') {
      return { kind: 'skip', reason: 'restricted-access' };
    }
    evidence = 'inferred';
    reason = 'place type often has a restroom';
  } else {
    return { kind: 'skip', reason: 'not-relevant' };
  }

  if (evidence === 'inferred' && opts.includeCandidates === false) return { kind: 'skip', reason: 'candidates-disabled' };

  const rawName = tags.name?.trim();
  if (!rawName && evidence === 'inferred') return { kind: 'skip', reason: 'unnamed-candidate' };
  const name = (rawName || 'Restroom').slice(0, 200);

  const street = [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ');
  const country = /^[A-Za-z]{2}$/.test(tags['addr:country'] ?? '')
    ? tags['addr:country']!.toUpperCase()
    : (opts.defaultCountry ?? 'US').toUpperCase();

  const wheelchair = triFromYesNo(isToiletFeature ? tags.wheelchair : tags['toilets:wheelchair'] ?? tags.wheelchair);

  const edited = el.timestamp && !Number.isNaN(Date.parse(el.timestamp)) ? new Date(el.timestamp).toISOString() : null;
  const holdMs = (opts.recentEditDays ?? 14) * 24 * 60 * 60 * 1000;
  const recent = edited !== null && (opts.now ?? new Date()).getTime() - Date.parse(edited) < holdMs;

  const base = {
    source: 'osm' as const,
    source_reference: `${el.type}/${el.id}`,
    name,
    address_line: street || null,
    city: tags['addr:city'] ?? null,
    region: tags['addr:state'] ?? null,
    postal_code: tags['addr:postcode'] ?? null,
    country_code: country,
    latitude: Math.round(lat * 1e6) / 1e6,
    longitude: Math.round(lon * 1e6) / 1e6,
    evidence,
    wheelchair_accessible: wheelchair,
    gender_neutral: tags.unisex === 'yes' ? true : null,
    baby_changing: triFromYesNo(tags.changing_table),
    has_hot_water: null,
    has_cold_water: null,
    key_required: null,
    purchase_required: customersOnly ? true : null,
    fee_required: tags.fee === 'yes' ? true : tags.fee === 'no' ? false : null,
    access_location: null,
    opening_hours: tags.opening_hours ? tags.opening_hours.slice(0, 300) : null,
    license: OSM_LICENSE,
    attribution: OSM_ATTRIBUTION,
    tags: pick(tags),
  };
  const record: ImportRecord = {
    ...base,
    content_hash: stableHash(base),
    source_edited_at: edited,
    hold_reason: evidence === 'explicit' && recent ? 'recent_edit' : null,
  };
  return { kind: 'record', record, reason };
}

export type ClassifySummary = {
  records: ImportRecord[];
  reasons: Record<string, number>;
  skipped: Record<string, number>;
};

/** Classifies many elements, de-duplicating by source reference (a feature can match several selectors). */
export function classifyAll(elements: readonly OsmElement[], opts: ClassifyOptions = {}): ClassifySummary {
  const byRef = new Map<string, ImportRecord>();
  const reasons: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  for (const el of elements) {
    const c = classifyOsmElement(el, opts);
    if (c.kind === 'skip') {
      skipped[c.reason] = (skipped[c.reason] ?? 0) + 1;
      continue;
    }
    if (byRef.has(c.record.source_reference)) continue;
    byRef.set(c.record.source_reference, c.record);
    const label = `${c.record.evidence}: ${c.reason}`;
    reasons[label] = (reasons[label] ?? 0) + 1;
  }
  return { records: [...byRef.values()], reasons, skipped };
}

/**
 * Keeps only the fields we use. Overpass `meta` output also carries editor identity (user, uid,
 * changeset); that is personal data we never need, so it is dropped at the door and never saved.
 */
export function sanitizeElement(el: OsmElement): OsmElement {
  const out: OsmElement = { type: el.type, id: el.id };
  if (el.lat !== undefined) out.lat = el.lat;
  if (el.lon !== undefined) out.lon = el.lon;
  if (el.center !== undefined) out.center = { lat: el.center.lat, lon: el.center.lon };
  if (el.tags !== undefined) out.tags = el.tags;
  if (el.timestamp !== undefined) out.timestamp = el.timestamp;
  return out;
}
