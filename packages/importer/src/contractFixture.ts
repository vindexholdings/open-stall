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

const { records } = classifyAll(elements, { defaultCountry: 'US' });
const json = JSON.stringify(records);

process.stdout.write(`
\\set ON_ERROR_STOP on
set role service_role;
do $$ declare run uuid; res jsonb; begin
  insert into public.import_runs (source, area_name, bounds)
    values ('osm', 'contract', '{"min_lat": 30, "max_lat": 31, "min_lng": 30, "max_lng": 31}') returning id into run;
  res := public.import_locations(run, $json$${json}$json$::jsonb);
  assert (res->>'inserted')::int = 4, format('importer records must insert (restaurant skipped): %s', res);
  assert (select count(*) from public.locations where source_reference in ('node/9001','way/9002')
            and status = 'unverified' and restroom_evidence = 'explicit') = 2, 'explicit -> unverified';
  assert (select count(*) from public.locations where source_reference in ('node/9003','node/9004')
            and status = 'candidate') = 2, 'inferred -> candidate';
  assert (select purchase_required from public.locations where source_reference = 'way/9002'), 'customers -> purchase_required';
  assert (select country_code = 'US' and source_license = 'ODbL-1.0' and source_tags->>'amenity' = 'toilets'
            from public.locations where source_reference = 'node/9001'), 'provenance preserved';
  -- rerun is idempotent
  res := public.import_locations(run, $json$${json}$json$::jsonb);
  assert (res->>'inserted')::int = 0 and (res->>'unchanged')::int = 4, format('rerun unchanged: %s', res);
end $$;
reset role;
\\echo importer contract: OK
`);
