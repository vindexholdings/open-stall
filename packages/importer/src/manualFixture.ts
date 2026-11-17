// Emits SQL that runs the manual-entry generator's OUTPUT (from synthetic in-memory inputs) against a
// throwaway local Postgres and asserts behavior. Used only by scripts/test-db.sh.
import { buildCleanupSql, buildInsertScript, validateManualInput } from './manualLocations';

const input = [
  { ref: 'dev-test-m01', name: "TEST mrec verified O'Brien", state: 'verified', latitude: 55.0, longitude: 55.0, city: 'Test', confirmed_on: '2026-10-04', confirmed_by: 'Test Person', opening_hours: 'Mo-Su 08:00-20:00', original_observation: true, attested_public: true },
  { ref: 'dev-test-m02', name: 'TEST mrec unverified', state: 'unverified', latitude: 55.0005, longitude: 55.0, basis: 'Saw the posted sign; access not checked', original_observation: true, attested_public: true },
];
const result = validateManualInput(input, new Date('2026-10-05T00:00:00Z'));
if (!result.ok) throw new Error(result.errors.join('; '));
const sql = buildInsertScript(result.records);
const cleanup = buildCleanupSql();

process.stdout.write(`
\\set ON_ERROR_STOP on
-- unrelated rows that cleanup must never touch
create temp table snap as select (select count(*) from public.location_sources where source = 'osm') as osm_before;
insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
  values ('TEST unrelated verified', 56, 56, 'verified', 'explicit', true, now());
${sql}
${sql}
do $$ begin
  assert (select count(*) from public.location_sources where source = 'manual') = 2, 'idempotent: exactly 2 manual sources after double run';
  assert (select count(*) from public.locations where name like 'TEST mrec%') = 2, 'idempotent: no duplicate locations';
  assert (select name from public.locations where name like 'TEST mrec verified%') = 'TEST mrec verified O''Brien', 'quote preserved';
  assert (select status = 'verified' and restroom_verified and last_verified_at is not null and opening_hours = 'Mo-Su 08:00-20:00'
          from public.locations where name like 'TEST mrec verified%'), 'verified record is valid';
  assert (select status = 'unverified' and restroom_evidence = 'explicit' and not restroom_verified
          from public.locations where name = 'TEST mrec unverified'), 'unverified record is valid';
  assert (select bool_and(s.license like 'Open Stall original data%' and s.attribution is null and s.is_primary)
          from public.location_sources s where s.source = 'manual'), 'manual provenance, no third-party license';
  assert (select tags->>'purpose' = 'mvp-checkpoint-dev-test' from public.location_sources where source_reference = 'dev-test-m01'), 'tagged as dev/test';
end $$;
set role anon;
do $$ declare names text[]; begin
  select array_agg(name order by distance_m) into names from public.nearby_locations(55, 55, 5000);
  assert names = array['TEST mrec verified O''Brien', 'TEST mrec unverified'], format('public API returns manual rows nearest first: %s', names);
  assert (select count(*) from public.nearby_locations(55, 55, 5000, 100, true)) = 1, 'verified-only returns the verified one';
  assert (select name from public.nearest_verified_location(55.0005, 55)) = 'TEST mrec verified O''Brien', 'nearest verified from the unverified spot';
end $$;
reset role;
-- an importer record at the same spot with the same name is flagged, never merged or made public
set role service_role;
do $$ declare run uuid; res jsonb; begin
  insert into public.import_runs (source, area_name, bounds, complete) values ('osm', 'manual-vs-import', '{"south":54,"west":54,"north":57,"east":57}', true) returning id into run;
  res := public.import_locations(run, jsonb_build_array(jsonb_build_object('source','osm','source_reference','node/77','name','TEST mrec verified O''Brien',
    'latitude',55.00003,'longitude',55.0,'evidence','explicit','content_hash','x','license','ODbL-1.0','attribution','(c) TEST')));
  assert (res->>'duplicates_flagged')::int = 1, format('import near a manual record is flagged: %s', res);
  assert (select count(*) from public.locations where name = 'TEST mrec verified O''Brien') = 2, 'nothing merged';
  -- refresh by importer never touches manual records
  perform public.finalize_import_run(run, true);
  assert (select count(*) from public.location_sources where source = 'manual' and missing_since is not null) = 0, 'finalize never touches manual sources';
end $$;
reset role;
${cleanup}
do $$ begin
  assert (select count(*) from public.location_sources where source = 'manual') = 0, 'cleanup removed manual sources';
  assert (select count(*) from public.locations where name like 'TEST mrec unverified') = 0, 'cleanup removed manual locations';
  assert (select count(*) from public.locations where name = 'TEST unrelated verified') = 1, 'cleanup never touches unrelated rows';
  assert (select count(*) from public.location_sources where source = 'osm') = (select osm_before + 1 from snap), 'cleanup never touches osm sources';
end $$;
\\echo manual entry: OK
`);
