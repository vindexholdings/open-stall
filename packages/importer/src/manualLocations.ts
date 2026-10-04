/**
 * Safe process for adding a FEW manually confirmed development/test locations.
 * This module only VALIDATES input and GENERATES reviewable SQL; it never connects to a database.
 * Records are first-party observations (source 'manual', never OSM/Google data), so they carry no
 * third-party license. Imports (source 'osm') never touch them.
 */
export const MANUAL_SOURCE = 'manual';
export const MANUAL_LICENSE = 'Open Stall original data (first-party on-site observation); no third-party data';
export const MAX_MANUAL_RECORDS = 3;
export const REF_PATTERN = /^dev-test-[a-z0-9-]{3,40}$/;

const PLACEHOLDER = /\b(replace|todo|tbd|xxx|example|lorem|sample|fake|placeholder|changeme)\b/i;
const CONTROL = /[\u0000-\u001f\u007f]/;

type Tri = boolean | null;

export type ManualRecord = {
  ref: string;
  name: string;
  state: 'verified' | 'unverified';
  latitude: number;
  longitude: number;
  address_line: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  confirmed_on: string | null;
  confirmed_by: string | null;
  basis: string | null;
  notes: string | null;
  opening_hours: string | null;
  access_location: string | null;
  wheelchair_accessible: Tri;
  gender_neutral: Tri;
  baby_changing: Tri;
  has_hot_water: Tri;
  has_cold_water: Tri;
  key_required: Tri;
  purchase_required: Tri;
  fee_required: Tri;
};

export type ValidationResult = { ok: true; records: ManualRecord[] } | { ok: false; errors: string[] };

const TRI_FIELDS = ['wheelchair_accessible', 'gender_neutral', 'baby_changing', 'has_hot_water', 'has_cold_water', 'key_required', 'purchase_required', 'fee_required'] as const;

function text(v: unknown, field: string, max: number, errors: string[], required = false, min = 0): string | null {
  if (v === undefined || v === null || v === '') {
    if (required) errors.push(`${field} is required`);
    return null;
  }
  if (typeof v !== 'string') {
    errors.push(`${field} must be text`);
    return null;
  }
  const t = v.trim();
  if (CONTROL.test(t)) errors.push(`${field} contains control characters`);
  if (t.length > max) errors.push(`${field} is longer than ${max} characters`);
  if (t.length < min) errors.push(`${field} must be at least ${min} characters`);
  if (PLACEHOLDER.test(t)) errors.push(`${field} looks like a placeholder ("${t.slice(0, 30)}")`);
  return t;
}

/** Strict validation. `now` is injectable for tests. */
export function validateManualInput(input: unknown, now: Date = new Date()): ValidationResult {
  const errors: string[] = [];
  if (!Array.isArray(input) || input.length === 0) return { ok: false, errors: ['input must be a non-empty JSON array'] };
  if (input.length > MAX_MANUAL_RECORDS) {
    return { ok: false, errors: [`at most ${MAX_MANUAL_RECORDS} manual records are allowed for this checkpoint`] };
  }
  const records: ManualRecord[] = [];
  const seen = new Set<string>();

  input.forEach((raw, i) => {
    const at = `record ${i + 1}`;
    const e: string[] = [];
    if (typeof raw !== 'object' || raw === null) return void errors.push(`${at}: must be an object`);
    const r = raw as Record<string, unknown>;

    // Attestations: the human takes responsibility for provenance and public access.
    if (r.original_observation !== true) e.push('original_observation must be true (data comes from your own on-site observation, NOT copied from OpenStreetMap, Google, or any other database)');
    if (r.attested_public !== true) e.push('attested_public must be true (this is a genuinely public restroom, not a private residence)');

    const ref = typeof r.ref === 'string' ? r.ref : '';
    if (!REF_PATTERN.test(ref)) e.push('ref must look like dev-test-<lowercase-letters-digits-dashes> (3-40 chars)');
    else if (seen.has(ref)) e.push(`duplicate ref ${ref}`);
    else seen.add(ref);

    const name = text(r.name, 'name', 120, e, true, 3);
    const lat = r.latitude;
    const lng = r.longitude;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || Math.abs(lat) > 90) e.push('latitude must be a number between -90 and 90');
    if (typeof lng !== 'number' || !Number.isFinite(lng) || Math.abs(lng) > 180) e.push('longitude must be a number between -180 and 180');
    if (lat === 0 && lng === 0) e.push('coordinates 0,0 are not a real location');

    const state = r.state;
    if (state !== 'verified' && state !== 'unverified') e.push('state must be "verified" or "unverified"');

    let confirmedOn: string | null = null;
    const co = r.confirmed_on;
    if (co !== undefined && co !== null && co !== '') {
      if (typeof co !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(co) || Number.isNaN(Date.parse(`${co}T00:00:00Z`))) e.push('confirmed_on must be a date like 2026-10-05');
      else if (Date.parse(`${co}T00:00:00Z`) > now.getTime() + 24 * 3600 * 1000) e.push('confirmed_on is in the future');
      else confirmedOn = co;
    }
    const confirmedBy = text(r.confirmed_by, 'confirmed_by', 120, e, state === 'verified');
    const basis = text(r.basis, 'basis', 300, e, state === 'unverified', 10);
    if (state === 'verified' && !confirmedOn) e.push('confirmed_on is required for a verified record');

    const tri: Record<string, Tri> = {};
    for (const f of TRI_FIELDS) {
      const v = r[f];
      if (v === undefined || v === null) tri[f] = null;
      else if (typeof v === 'boolean') tri[f] = v;
      else e.push(`${f} must be true, false or null (unknown)`);
    }

    const rec = {
      ref, name: name ?? '', state: state as 'verified' | 'unverified',
      latitude: typeof lat === 'number' ? Math.round(lat * 1e6) / 1e6 : NaN,
      longitude: typeof lng === 'number' ? Math.round(lng * 1e6) / 1e6 : NaN,
      address_line: text(r.address_line, 'address_line', 300, e),
      city: text(r.city, 'city', 120, e),
      region: text(r.region, 'region', 120, e),
      postal_code: text(r.postal_code, 'postal_code', 20, e),
      confirmed_on: confirmedOn,
      confirmed_by: confirmedBy,
      basis,
      notes: text(r.notes, 'notes', 500, e),
      opening_hours: text(r.opening_hours, 'opening_hours', 300, e),
      access_location: text(r.access_location, 'access_location', 300, e),
      ...tri,
    } as ManualRecord;

    if (e.length) errors.push(...e.map((m) => `${at}: ${m}`));
    else records.push(rec);
  });

  return errors.length ? { ok: false, errors } : { ok: true, records };
}

export const q = (s: string | null): string => {
  if (s === null) return 'null';
  if (s.includes('\u0000')) throw new Error('NUL character in text');
  return `'${s.replace(/'/g, "''")}'`;
};
export const b = (v: Tri) => (v === null ? 'null' : v ? 'true' : 'false');

/**
 * One ATOMIC, idempotent statement per record: inserts the canonical location and its 'manual'
 * source row together, and does nothing if that reference already exists.
 */
export function buildInsertSql(r: ManualRecord): string {
  const verified = r.state === 'verified';
  const tags = JSON.stringify({
    purpose: 'mvp-checkpoint-dev-test',
    confirmed_by: r.confirmed_by,
    confirmed_on: r.confirmed_on,
    basis: r.basis,
    notes: r.notes,
  });
  return `-- ${r.ref}: ${r.state}
with new_loc as (
  insert into public.locations (
    name, address_line, city, region, postal_code, latitude, longitude,
    status, restroom_evidence, restroom_verified, last_verified_at,
    wheelchair_accessible, gender_neutral, baby_changing, has_hot_water, has_cold_water,
    key_required, purchase_required, fee_required, access_location, opening_hours
  )
  select ${q(r.name)}, ${q(r.address_line)}, ${q(r.city)}, ${q(r.region)}, ${q(r.postal_code)}, ${r.latitude}, ${r.longitude},
    ${verified ? "'verified'" : "'unverified'"}, 'explicit', ${verified}, ${verified ? `${q(`${r.confirmed_on}T12:00:00Z`)}::timestamptz` : 'null'},
    ${b(r.wheelchair_accessible)}, ${b(r.gender_neutral)}, ${b(r.baby_changing)}, ${b(r.has_hot_water)}, ${b(r.has_cold_water)},
    ${b(r.key_required)}, ${b(r.purchase_required)}, ${b(r.fee_required)}, ${q(r.access_location)}, ${q(r.opening_hours)}
  where not exists (
    select 1 from public.location_sources where source = '${MANUAL_SOURCE}' and source_reference = ${q(r.ref)}
  )
  returning id
)
insert into public.location_sources (
  location_id, source, source_reference, license, attribution,
  source_latitude, source_longitude, evidence, tags, is_primary
)
select id, '${MANUAL_SOURCE}', ${q(r.ref)}, ${q(MANUAL_LICENSE)}, null,
  ${r.latitude}, ${r.longitude}, 'explicit', ${q(tags)}::jsonb, true
from new_loc;`;
}

export function buildInsertScript(records: readonly ManualRecord[]): string {
  return [
    '-- Open Stall: manual development/test locations (first-party observations only).',
    '-- Review, then paste into the Supabase SQL editor for project xzzbcejgprilmolvdaes. Idempotent.',
    ...records.map(buildInsertSql),
    buildVerifySql(),
  ].join('\n\n');
}

/** Read-only check of what exists (owner view). */
export function buildVerifySql(): string {
  return `select l.name, l.status, l.restroom_verified, l.last_verified_at, l.latitude, l.longitude,
       l.manually_edited_at is not null as protected, s.source_reference, s.license
from public.location_sources s join public.locations l on l.id = s.location_id
where s.source = '${MANUAL_SOURCE}' order by s.source_reference;`;
}

/**
 * DESTRUCTIVE (human-run only, and only when you want these test records gone). Deletes ONLY locations
 * whose source row is source 'manual' with a dev-test reference; cascades to their source rows.
 */
export function buildCleanupSql(): string {
  return `-- DESTRUCTIVE: removes ONLY manual dev-test records. Run only if you intend to.
delete from public.locations
where id in (
  select location_id from public.location_sources
  where source = '${MANUAL_SOURCE}' and source_reference like 'dev-test-%'
);`;
}
