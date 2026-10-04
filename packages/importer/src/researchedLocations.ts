import { b, q } from './manualLocations';
import type { Geocode } from './census';

/**
 * Externally RESEARCHED, UNVERIFIED development/test records (OS-111). Never verified, never
 * first-party observations, never OSM/Google-derived. Provenance lives in location_sources
 * (source 'research'); canonical rows stay Open Stall's. Validates and GENERATES reviewable SQL only.
 */
export const RESEARCH_SOURCE = 'research';
export const RESEARCH_REF = /^os111-[a-z0-9-]{3,40}$/;
export const MAX_RESEARCH_RECORDS = 3;
export const RESEARCH_LICENSE =
  'Facts researched from public web pages (no map-database content copied); coordinates from the US Census Bureau Geocoder (U.S. government data, public domain)';

const PLACEHOLDER = /\b(replace|todo|tbd|xxx|example|lorem|sample|fake|placeholder|changeme)\b|YYYY/i;
const CONTROL = /[\u0000-\u001f\u007f]/;
// Evidence must not come from map databases whose data we are not using.
const FORBIDDEN_EVIDENCE_HOSTS = /(^|\.)(openstreetmap\.org|osm\.org|nominatim|google\.[a-z.]+|goo\.gl|maps\.apple\.com|bing\.com)$/i;

type Tri = boolean | null;

export type ResearchRecord = {
  ref: string;
  name: string;
  street: string;
  city: string;
  region: string;
  postal_code: string;
  evidence_url: string;
  evidence_summary: string;
  researched_on: string;
  researched_by: string;
  notes: string | null;
  opening_hours: string | null;
  wheelchair_accessible: Tri;
  gender_neutral: Tri;
  baby_changing: Tri;
  key_required: Tri;
  purchase_required: Tri;
  fee_required: Tri;
};

export type ResearchValidation = { ok: true; records: ResearchRecord[] } | { ok: false; errors: string[] };

const TRI = ['wheelchair_accessible', 'gender_neutral', 'baby_changing', 'key_required', 'purchase_required', 'fee_required'] as const;

function txt(v: unknown, field: string, e: string[], opts: { max: number; min?: number; required?: boolean }): string | null {
  if (v === undefined || v === null || v === '') {
    if (opts.required) e.push(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') {
    e.push(`${field} must be text`);
    return null;
  }
  const t = v.trim();
  if (CONTROL.test(t)) e.push(`${field} contains control characters`);
  if (t.length > opts.max) e.push(`${field} is longer than ${opts.max} characters`);
  if (t.length < (opts.min ?? 0)) e.push(`${field} must be at least ${opts.min} characters`);
  if (PLACEHOLDER.test(t)) e.push(`${field} still looks like a placeholder ("${t.slice(0, 30)}")`);
  return t;
}

export function validateResearchInput(input: unknown, now: Date = new Date()): ResearchValidation {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, errors: ['input must be a non-empty JSON array'] };
  if (input.length > MAX_RESEARCH_RECORDS) return { ok: false, errors: [`at most ${MAX_RESEARCH_RECORDS} records are allowed for OS-111`] };
  const errors: string[] = [];
  const records: ResearchRecord[] = [];
  const seen = new Set<string>();

  input.forEach((raw, i) => {
    const at = `record ${i + 1}`;
    const e: string[] = [];
    if (typeof raw !== 'object' || raw === null) return void errors.push(`${at}: must be an object`);
    const r = raw as Record<string, unknown>;

    if (r.state !== undefined && r.state !== 'unverified') e.push('state must be "unverified" (researched records are never Verified)');
    if (r.evidence_is_public_web_source !== true) e.push('evidence_is_public_web_source must be true (the restroom evidence comes from a public web page you cite)');
    if (r.no_map_database_content !== true) e.push('no_map_database_content must be true (you recorded facts only; nothing copied from OpenStreetMap, Google Maps or any map database)');

    const ref = typeof r.ref === 'string' ? r.ref : '';
    if (!RESEARCH_REF.test(ref)) e.push('ref must look like os111-<lowercase-letters-digits-dashes> (3-40 chars)');
    else if (seen.has(ref)) e.push(`duplicate ref ${ref}`);
    else seen.add(ref);

    const name = txt(r.name, 'name', e, { max: 120, min: 2, required: true });
    const street = txt(r.street, 'street', e, { max: 200, min: 5, required: true });
    const city = txt(r.city, 'city', e, { max: 120, required: true });
    const region = txt(r.region, 'region', e, { max: 2, min: 2, required: true });
    const zip = txt(r.postal_code, 'postal_code', e, { max: 5, min: 5, required: true });
    if (zip && !/^\d{5}$/.test(zip)) e.push('postal_code must be 5 digits');
    if (region && !/^[A-Za-z]{2}$/.test(region)) e.push('region must be a 2-letter state code');

    const url = txt(r.evidence_url, 'evidence_url', e, { max: 500, required: true });
    if (url) {
      try {
        const u = new URL(url);
        if (u.protocol !== 'https:') e.push('evidence_url must be https');
        if (FORBIDDEN_EVIDENCE_HOSTS.test(u.hostname)) e.push(`evidence_url host ${u.hostname} is a map database; cite a business/official page instead`);
      } catch {
        e.push('evidence_url must be a valid URL');
      }
    }
    const summary = txt(r.evidence_summary, 'evidence_summary', e, { max: 400, min: 15, required: true });
    const by = txt(r.researched_by, 'researched_by', e, { max: 120, required: true });
    let on: string | null = null;
    const o = r.researched_on;
    if (typeof o !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o) || Number.isNaN(Date.parse(`${o}T00:00:00Z`))) e.push('researched_on must be a date like 2026-10-05');
    else if (Date.parse(`${o}T00:00:00Z`) > now.getTime() + 24 * 3600 * 1000) e.push('researched_on is in the future');
    else on = o;

    const tri: Record<string, Tri> = {};
    for (const f of TRI) {
      const v = r[f];
      if (v === undefined || v === null) tri[f] = null;
      else if (typeof v === 'boolean') tri[f] = v;
      else e.push(`${f} must be true, false or null (unknown)`);
    }

    const rec = {
      ref, name: name ?? '', street: street ?? '', city: city ?? '', region: (region ?? '').toUpperCase(), postal_code: zip ?? '',
      evidence_url: url ?? '', evidence_summary: summary ?? '', researched_on: on ?? '', researched_by: by ?? '',
      notes: txt(r.notes, 'notes', e, { max: 500 }),
      opening_hours: txt(r.opening_hours, 'opening_hours', e, { max: 300 }),
      ...tri,
    } as ResearchRecord;
    if (e.length) errors.push(...e.map((m) => `${at}: ${m}`));
    else records.push(rec);
  });
  return errors.length ? { ok: false, errors } : { ok: true, records };
}

/**
 * One ATOMIC, idempotent statement: canonical location (status 'unverified', explicit evidence, NOT
 * verified) plus its 'research' source row with provenance. Does nothing if the reference exists.
 */
export function buildResearchInsertSql(r: ResearchRecord, g: Geocode): string {
  const tags = JSON.stringify({
    purpose: 'os111-dev-test',
    evidence_url: r.evidence_url,
    evidence_summary: r.evidence_summary,
    researched_on: r.researched_on,
    researched_by: r.researched_by,
    notes: r.notes,
    coordinate_source: 'US Census Bureau Geocoder (Public_AR_Current), address-range interpolation',
    coordinate_matched_address: g.matchedAddress,
    coordinate_retrieved_at: g.retrievedAt,
    coordinate_accuracy: 'approximate (street level); replace with surveyed coordinates before launch',
  });
  return `-- ${r.ref}: unverified (externally researched)
with new_loc as (
  insert into public.locations (
    name, address_line, city, region, postal_code, latitude, longitude,
    status, restroom_evidence, restroom_verified, last_verified_at,
    wheelchair_accessible, gender_neutral, baby_changing, key_required, purchase_required, fee_required, opening_hours
  )
  select ${q(r.name)}, ${q(r.street)}, ${q(r.city)}, ${q(r.region)}, ${q(r.postal_code)}, ${g.latitude}, ${g.longitude},
    'unverified', 'explicit', false, null,
    ${b(r.wheelchair_accessible)}, ${b(r.gender_neutral)}, ${b(r.baby_changing)}, ${b(r.key_required)}, ${b(r.purchase_required)}, ${b(r.fee_required)}, ${q(r.opening_hours)}
  where not exists (
    select 1 from public.location_sources where source = '${RESEARCH_SOURCE}' and source_reference = ${q(r.ref)}
  )
  returning id
)
insert into public.location_sources (
  location_id, source, source_reference, license, attribution,
  source_latitude, source_longitude, evidence, tags, is_primary
)
select id, '${RESEARCH_SOURCE}', ${q(r.ref)}, ${q(RESEARCH_LICENSE)}, null,
  ${g.latitude}, ${g.longitude}, 'explicit', ${q(tags)}::jsonb, true
from new_loc;`;
}

export function buildResearchScript(items: readonly { record: ResearchRecord; geocode: Geocode }[]): string {
  return [
    '-- Open Stall OS-111: externally researched UNVERIFIED development/test records.',
    '-- Review, then paste into the Supabase SQL editor for project xzzbcejgprilmolvdaes. Idempotent.',
    ...items.map((i) => buildResearchInsertSql(i.record, i.geocode)),
    buildResearchVerifySql(),
  ].join('\n\n');
}

export function buildResearchVerifySql(): string {
  return `select l.name, l.status, l.restroom_verified, l.latitude, l.longitude,
       s.source_reference, s.tags->>'coordinate_matched_address' as matched_address, s.tags->>'evidence_url' as evidence_url
from public.location_sources s join public.locations l on l.id = s.location_id
where s.source = '${RESEARCH_SOURCE}' order by s.source_reference;`;
}

/** DESTRUCTIVE, human-run only. Removes ONLY OS-111 research records (cascades to their source rows). */
export function buildResearchCleanupSql(): string {
  return `-- DESTRUCTIVE: removes ONLY OS-111 researched dev-test records. Run only if you intend to.
delete from public.locations
where id in (
  select location_id from public.location_sources
  where source = '${RESEARCH_SOURCE}' and source_reference like 'os111-%'
);`;
}
