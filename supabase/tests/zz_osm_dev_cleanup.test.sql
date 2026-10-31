-- The dev-OSM cleanup removes only unedited OSM-only candidate/unverified rows seen by "-dev" runs.
-- Synthetic rows; throwaway cluster only.
\set ON_ERROR_STOP on
create function pg_temp.mk(nm text, st text, ev text, edited boolean, srcs text[], run uuid)
returns uuid language plpgsql as $$
declare lid uuid; s text; i int := 0; begin
  insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at, manually_edited_at)
  values (nm, 5 + random(), 5 + random(), st, ev, st = 'verified', case when st = 'verified' then now() end, case when edited then now() end)
  returning id into lid;
  foreach s in array srcs loop
    i := i + 1;
    insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence, is_primary, last_seen_run)
    values (lid, s, 'cleanup-' || nm || '-' || i, 5, 5, 'explicit', i = 1, run);
  end loop;
  return lid;
end $$;

insert into public.import_runs (source, area_name, bounds, complete) values
  ('osm', 'cody-dev', '{"south":5,"west":5,"north":6,"east":6}', true),
  ('osm', 'real-region', '{"south":5,"west":5,"north":6,"east":6}', true);
do $$ declare dev uuid; real uuid; begin
  select id into dev from public.import_runs where area_name = 'cody-dev';
  select id into real from public.import_runs where area_name = 'real-region';
  perform pg_temp.mk('CLEAN gone unverified', 'unverified', 'explicit', false, array['osm'], dev);
  perform pg_temp.mk('CLEAN gone candidate', 'candidate', 'inferred', false, array['osm'], dev);
  perform pg_temp.mk('CLEAN keep verified', 'verified', 'explicit', false, array['osm'], dev);
  perform pg_temp.mk('CLEAN keep edited', 'unverified', 'explicit', true, array['osm'], dev);
  perform pg_temp.mk('CLEAN keep multisource', 'unverified', 'explicit', false, array['osm', 'extra'], dev);
  perform pg_temp.mk('CLEAN keep research', 'unverified', 'explicit', false, array['extratwo'], dev);
  perform pg_temp.mk('CLEAN keep non-dev run', 'unverified', 'explicit', false, array['osm'], real);
  perform pg_temp.mk('CLEAN keep pending', 'pending', 'none', false, array['osm'], dev);
  insert into public.locations (name, latitude, longitude) values ('CLEAN keep no source', 5, 5);
end $$;

\i :ROOT/supabase/dev/osm-dev-cleanup.sql

do $$ begin
  assert (select count(*) from public.locations where name like 'CLEAN gone%') = 0, 'dev OSM-only unedited candidate/unverified rows are removed';
  assert (select count(*) from public.locations where name like 'CLEAN keep%') = 7, 'everything else is kept';
  assert (select count(*) from public.location_sources where source_reference like 'cleanup-CLEAN gone%') = 0, 'their source rows cascade away';
  assert (select count(*) from public.import_runs where area_name = 'cody-dev') = 0, 'dev run rows removed';
  assert (select count(*) from public.import_runs where area_name = 'real-region') = 1, 'non-dev runs kept';
end $$;
\echo osm dev cleanup: OK
