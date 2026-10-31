// Runs the research SQL generator's OUTPUT (synthetic inputs + fake geocodes, TEST names) against a
// throwaway local Postgres. Used only by scripts/test-db.sh.
import { buildResearchCleanupSql, buildResearchScript, validateResearchInput } from './researchedLocations';

const input = ['aaa', 'bbb'].map((k, i) => ({
  ref: `os111-test-${k}`, name: `TEST research ${k}`, street: `${100 + i} Test St`, city: 'Testville', region: 'WY', postal_code: '82414',
  evidence_url: 'https://station-corp.test/store', evidence_summary: 'Store page states restrooms are available.',
  researched_on: '2026-10-04', researched_by: 'Test Person', evidence_is_public_web_source: true, no_map_database_content: true,
}));
const v = validateResearchInput(input, new Date('2026-10-05T00:00:00Z'));
if (!v.ok) throw new Error(v.errors.join('; '));
const items = v.records.map((record, i) => ({
  record,
  geocode: { latitude: 65 + i * 0.0005, longitude: 65, matchedAddress: `${record.street.toUpperCase()}, TESTVILLE, WY, 82414`, benchmark: 'Public_AR_Current', retrievedAt: '2026-10-05T00:00:00.000Z' },
}));
const sql = buildResearchScript(items);
const cleanup = buildResearchCleanupSql();

process.stdout.write(`
\\set ON_ERROR_STOP on
create temp table rsnap as select
  (select count(*) from public.location_sources where source = 'osm') as osm_before,
  (select count(*) from public.location_sources where source = 'manual') as manual_before,
  (select count(*) from public.locations) as total_before;
${sql}
${sql}
do $$ begin
  assert (select count(*) from public.location_sources where source = 'research') = 2, 'idempotent: 2 research sources after double run';
  assert (select count(*) from public.locations where name like 'TEST research %') = 2, 'no duplicate locations';
  assert (select bool_and(l.status = 'unverified' and l.restroom_evidence = 'explicit' and not l.restroom_verified and l.last_verified_at is null)
          from public.locations l where l.name like 'TEST research %'), 'researched records are UNVERIFIED, never verified';
  assert (select bool_and(s.is_primary and s.evidence = 'explicit' and s.attribution is null and s.license like '%public domain%'
                          and s.tags->>'purpose' = 'os111-dev-test' and s.tags->>'evidence_url' is not null
                          and s.tags->>'coordinate_source' like 'US Census%')
          from public.location_sources s where s.source = 'research'), 'provenance kept separately in location_sources';
  assert (select bool_and(l.manually_edited_at is null) from public.locations l where l.name like 'TEST research %'), 'inserts do not stamp manual edits';
end $$;
set role anon;
do $$ begin
  assert (select array_agg(name order by distance_m) from public.nearby_locations(65, 65, 5000)) = array['TEST research aaa', 'TEST research bbb'], 'public API returns them nearest first';
  assert (select bool_and(verification = 'unverified') from public.nearby_locations(65, 65, 5000)), 'shown as unverified';
  assert (select count(*) from public.nearby_locations(65, 65, 5000, 100, true)) = 0, 'verified-only excludes them';
  assert (select bool_and(attribution is null) from public.nearby_locations(65, 65, 5000)), 'no attribution required';
end $$;
reset role;
${cleanup}
do $$ begin
  assert (select count(*) from public.location_sources where source = 'research') = 0, 'cleanup removed research sources';
  assert (select count(*) from public.locations where name like 'TEST research %') = 0, 'cleanup removed research locations';
  assert (select count(*) from public.location_sources where source = 'osm') = (select osm_before from rsnap), 'cleanup leaves osm sources';
  assert (select count(*) from public.location_sources where source = 'manual') = (select manual_before from rsnap), 'cleanup leaves manual sources';
  assert (select count(*) from public.locations) = (select total_before from rsnap), 'cleanup leaves every other location';
end $$;
\\echo research entry: OK
`);
