// Emits SQL that feeds importer output (from synthetic in-memory OSM elements) into
// public.import_locations(), proving the TypeScript records match the database contract.
// Used only by scripts/test-db.sh against a throwaway local Postgres.
import { classifyAll } from './osmClassify';
import type { OsmElement } from './types';

const elements: OsmElement[] = [
  { type: 'node', id: 9001, lat: 30.1, lon: 30.1, tags: { amenity: 'toilets', wheelchair: 'yes', 'addr:street': 'Test St' } },
  { type: 'way', id: 9002, center: { lat: 30.2, lon: 30.2 }, tags: { amenity: 'toilets', access: 'customers', name: 'Test customers WC' } },
  { type: 'node', id: 9003, lat: 30.3, lon: 30.3, tags: { amenity: 'fuel', name: 'Test fuel (candidate)' } },
  { type: 'node', id: 9004, lat: 30.4, lon: 30.4, tags: { amenity: 'cafe', name: 'Test cafe', toilets: 'yes' } },
  { type: 'node', id: 9005, lat: 30.5, lon: 30.5, tags: { amenity: 'restaurant', name: 'Test restaurant' } },
];

const { records } = classifyAll(elements, { defaultCountry: 'US', now: new Date('2026-10-04T00:00:00Z') });
// The exact run payload the importer sends (standard bounds shape, complete flag, scope).
const bounds = { south: 30, west: 30, north: 31, east: 31 };
const runPayload = JSON.stringify({ source: 'osm', area_name: 'contract', bounds, scope: { include_candidates: true }, complete: true, tool_version: 'contract-test' });
const json = JSON.stringify(records);

const seenAgain = JSON.stringify(records.filter((r) => r.source_reference !== 'way/9002'));

process.stdout.write(`
\\set ON_ERROR_STOP on
set role service_role;
do $$ declare run uuid; run2 uuid; res jsonb; begin
  insert into public.import_runs (source, area_name, bounds, scope, complete, tool_version)
    select source, area_name, bounds, scope, complete, tool_version
    from jsonb_populate_record(null::public.import_runs, $payload$${runPayload}$payload$::jsonb) returning id into run;
  res := public.import_locations(run, $json$${json}$json$::jsonb);
  assert (res->>'inserted')::int = 4, format('importer records must insert (restaurant skipped): %s', res);
  assert (select count(*) from public.location_sources s join public.locations l on l.id = s.location_id
            where s.source_reference in ('node/9001','way/9002') and l.status = 'unverified' and l.restroom_evidence = 'explicit') = 2, 'explicit -> unverified';
  assert (select count(*) from public.location_sources s join public.locations l on l.id = s.location_id
            where s.source_reference in ('node/9003','node/9004') and l.status = 'candidate') = 2, 'inferred -> candidate';
  assert (select l.purchase_required from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'way/9002'), 'customers -> purchase_required';
  assert (select l.country_code = 'US' and s.license = 'ODbL-1.0' and s.tags->>'amenity' = 'toilets' and s.is_primary
            from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/9001'), 'provenance preserved in location_sources';
  res := public.import_locations(run, $json$${json}$json$::jsonb);
  assert (res->>'inserted')::int = 0 and (res->>'unchanged')::int = 4, format('rerun unchanged: %s', res);

  -- Refresh: second complete run sees everything except way/9002; finalize uses the importer's own bounds shape.
  insert into public.import_runs (source, area_name, bounds, scope, complete, tool_version)
    select source, area_name, bounds, scope, complete, tool_version
    from jsonb_populate_record(null::public.import_runs, $payload$${runPayload}$payload$::jsonb) returning id into run2;
  perform public.import_locations(run2, $seen$${seenAgain}$seen$::jsonb);
  res := public.finalize_import_run(run2);
  assert (res->>'flagged_sources')::int = 1 and (res->>'hidden_locations')::int = 1, format('finalize works end to end: %s', res);
  assert (select l.status from public.location_sources s join public.locations l on l.id = s.location_id where s.source_reference = 'way/9002') = 'candidate', 'vanished unverified record hidden';
  assert (select l.status from public.location_sources s join public.locations l on l.id = s.location_id where s.source_reference = 'node/9001') = 'unverified', 'seen record still public';
end $$;
reset role;
\\echo importer contract: OK
`);
