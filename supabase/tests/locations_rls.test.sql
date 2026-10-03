-- OS-101/102/importer tests. Synthetic rows exist only inside this throwaway cluster and are
-- discarded with it. They are never written to any real database.
\set ON_ERROR_STOP on

insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at, source, source_reference)
values
  ('TEST verified',   10, 10, 'verified',   'explicit', true,  now(), 'admin', 't-verified'),
  ('TEST unverified', 10, 10, 'unverified', 'explicit', false, null,  'osm',   't-unverified'),
  ('TEST candidate',  10, 10, 'candidate',  'inferred', false, null,  'osm',   't-candidate'),
  ('TEST pending',    10, 10, 'pending',    'none',     false, null,  'user_submission', 't-pending'),
  ('TEST closed',     10, 10, 'closed',     'none',     false, null,  'admin', 't-closed');

-- Defaults: new imports are hidden candidates with no evidence.
do $$ declare s text; e text; v boolean; begin
  insert into public.locations (name, latitude, longitude, source) values ('TEST default', 1, 1, 'osm')
    returning status, restroom_evidence, restroom_verified into s, e, v;
  assert s = 'candidate' and e = 'none' and v = false, 'default must be hidden candidate';
end $$;

-- Public reads: verified + displayable unverified only.
set role anon;
do $$ declare n int; begin
  select count(*) into n from public.locations;
  assert n = 2, format('anon should see 2 rows, saw %s', n);
  assert (select array_agg(name order by name) from public.locations) = array['TEST unverified', 'TEST verified'],
    'anon sees verified and unverified only';
end $$;
reset role;

set role authenticated;
do $$ begin
  assert (select count(*) from public.locations) = 2, 'authenticated sees 2 rows';
end $$;
reset role;

-- Importer/bookkeeping columns are not readable by public roles.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    begin
      perform source_tags from public.locations;
      raise exception 'source_tags readable by %', r;
    exception when insufficient_privilege then null; end;
    begin
      perform manually_edited_at from public.locations;
      raise exception 'manually_edited_at readable by %', r;
    exception when insufficient_privilege then null; end;
    begin
      perform * from public.import_runs;
      raise exception 'import_runs readable by %', r;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;

-- Client roles cannot write.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    begin
      insert into public.locations (name, latitude, longitude, source) values ('TEST x', 1, 1, 'osm');
      raise exception 'insert unexpectedly allowed for %', r;
    exception when insufficient_privilege then null; end;
    begin
      update public.locations set name = 'hacked';
      raise exception 'update unexpectedly allowed for %', r;
    exception when insufficient_privilege then null; end;
    begin
      delete from public.locations;
      raise exception 'delete unexpectedly allowed for %', r;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;

-- Client roles cannot run importer functions.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    begin
      perform public.import_locations(gen_random_uuid(), '[]'::jsonb);
      raise exception 'import_locations executable by %', r;
    exception when insufficient_privilege then null; end;
    begin
      perform public.finalize_import_run(gen_random_uuid());
      raise exception 'finalize_import_run executable by %', r;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;

-- Service role (server-side) sees everything.
set role service_role;
do $$ begin
  assert (select count(*) from public.locations) = 6, 'service_role sees all rows';
end $$;
reset role;

-- Constraints.
do $$ begin
  begin
    insert into public.locations (name, latitude, longitude, status, restroom_verified, source)
      values ('TEST bad1', 1, 1, 'verified', false, 'admin');
    raise exception 'verified without confirmation allowed';
  exception when check_violation then null; end;
  begin
    insert into public.locations (name, latitude, longitude, status, restroom_verified, last_verified_at, source)
      values ('TEST bad2', 1, 1, 'candidate', true, now(), 'osm');
    raise exception 'candidate claiming verification allowed';
  exception when check_violation then null; end;
  begin
    insert into public.locations (name, latitude, longitude, status, restroom_evidence, source)
      values ('TEST bad3', 1, 1, 'unverified', 'inferred', 'osm');
    raise exception 'unverified without explicit evidence allowed';
  exception when check_violation then null; end;
  begin
    insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at, source)
      values ('TEST bad4', 1, 1, 'unverified', 'explicit', true, now(), 'osm');
    raise exception 'unverified claiming Open Stall verification allowed';
  exception when check_violation then null; end;
  begin
    insert into public.locations (name, latitude, longitude, source) values ('TEST bad5', 91, 1, 'osm');
    raise exception 'latitude out of range allowed';
  exception when check_violation then null; end;
  begin
    insert into public.locations (name, latitude, longitude, source, source_reference)
      values ('TEST dup', 1, 1, 'osm', 't-candidate');
    raise exception 'duplicate source reference allowed';
  exception when unique_violation then null; end;
end $$;

-- Unknown (NULL) amenities stay distinct from false.
do $$ begin
  assert (select wheelchair_accessible is null from public.locations where name = 'TEST default'),
    'amenities default to unknown (NULL)';
end $$;

-- updated_at trigger.
do $$ declare a timestamptz; b timestamptz; begin
  select updated_at into a from public.locations where name = 'TEST closed';
  perform pg_sleep(0.01);
  update public.locations set access_location = 'x' where name = 'TEST closed';
  select updated_at into b from public.locations where name = 'TEST closed';
  assert b > a, 'updated_at should advance';
end $$;

-- ---------------------------------------------------------------- importer
set role service_role;
create temp table ctx (run1 uuid, run2 uuid);
grant all on ctx to service_role;
insert into public.import_runs (source, area_name, bounds)
  values ('osm', 'test-area', '{"min_lat": 20, "max_lat": 21, "min_lng": 20, "max_lng": 21}') returning id \gset run1_
insert into ctx (run1) values (:'run1_id');

do $$ declare run uuid; res jsonb; begin
  select run1 into run from ctx;
  res := public.import_locations(run, '[
    {"source":"osm","source_reference":"node/1","name":"TEST explicit","latitude":20.5,"longitude":20.5,"evidence":"explicit","source_hash":"h1","source_tags":{"amenity":"toilets"}},
    {"source":"osm","source_reference":"node/2","name":"TEST inferred","latitude":20.6,"longitude":20.6,"evidence":"inferred","source_hash":"h2"}
  ]'::jsonb);
  assert (res->>'inserted')::int = 2, 'two inserts';
  assert (select status from public.locations where source_reference = 'node/1') = 'unverified', 'explicit -> unverified';
  assert (select status from public.locations where source_reference = 'node/2') = 'candidate', 'inferred -> candidate';
end $$;

-- Idempotent rerun: no duplicates, reported unchanged.
do $$ declare run uuid; res jsonb; begin
  select run1 into run from ctx;
  res := public.import_locations(run, '[
    {"source":"osm","source_reference":"node/1","name":"TEST explicit","latitude":20.5,"longitude":20.5,"evidence":"explicit","source_hash":"h1"},
    {"source":"osm","source_reference":"node/2","name":"TEST inferred","latitude":20.6,"longitude":20.6,"evidence":"inferred","source_hash":"h2"}
  ]'::jsonb);
  assert (res->>'inserted')::int = 0 and (res->>'unchanged')::int = 2, format('rerun must not duplicate: %s', res);
  assert (select count(*) from public.locations where source = 'osm' and source_reference in ('node/1', 'node/2')) = 2, 'no duplicates';
end $$;

-- Evidence upgrade/downgrade follows source data for non-protected rows.
do $$ declare run uuid; begin
  select run1 into run from ctx;
  perform public.import_locations(run, '[
    {"source":"osm","source_reference":"node/2","name":"TEST inferred","latitude":20.6,"longitude":20.6,"evidence":"explicit","source_hash":"h3"},
    {"source":"osm","source_reference":"node/1","name":"TEST explicit","latitude":20.5,"longitude":20.5,"evidence":"inferred","source_hash":"h4"}
  ]'::jsonb);
  assert (select status from public.locations where source_reference = 'node/2') = 'unverified', 'upgrade to unverified';
  assert (select status from public.locations where source_reference = 'node/1') = 'candidate', 'downgrade to hidden candidate';
end $$;

-- Verified, pending, closed and admin-edited records are never overwritten by import.
reset role;
insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at, source, source_reference, wheelchair_accessible)
  values ('TEST OS verified', 20.1, 20.1, 'verified', 'explicit', true, now(), 'osm', 'node/10', true);
insert into public.locations (name, latitude, longitude, status, restroom_evidence, source, source_reference, manually_edited_at)
  values ('TEST curated', 20.2, 20.2, 'unverified', 'explicit', 'osm', 'node/11', now());
insert into public.locations (name, latitude, longitude, status, source, source_reference)
  values ('TEST closed osm', 20.3, 20.3, 'closed', 'osm', 'node/12');
set role service_role;
do $$ declare run uuid; res jsonb; begin
  select run1 into run from ctx;
  res := public.import_locations(run, '[
    {"source":"osm","source_reference":"node/10","name":"WEAKER NAME","latitude":20.9,"longitude":20.9,"evidence":"inferred","wheelchair_accessible":false,"source_hash":"x","source_tags":{"new":"tags"}},
    {"source":"osm","source_reference":"node/11","name":"WEAKER NAME","latitude":20.9,"longitude":20.9,"evidence":"inferred","source_hash":"x"},
    {"source":"osm","source_reference":"node/12","name":"WEAKER NAME","latitude":20.9,"longitude":20.9,"evidence":"explicit","source_hash":"x"}
  ]'::jsonb);
  assert (res->>'protected')::int = 3, format('three protected: %s', res);
  assert (select name = 'TEST OS verified' and status = 'verified' and wheelchair_accessible and latitude = 20.1
          from public.locations where source_reference = 'node/10'), 'verified record untouched';
  assert (select source_tags = '{"new":"tags"}'::jsonb from public.locations where source_reference = 'node/10'),
    'provenance refreshed on protected record';
  assert (select name = 'TEST curated' and status = 'unverified' from public.locations where source_reference = 'node/11'), 'curated untouched';
  assert (select name = 'TEST closed osm' and status = 'closed' from public.locations where source_reference = 'node/12'), 'closed untouched';
end $$;

-- Importer cannot write non-import sources or use unknown runs.
do $$ declare run uuid; begin
  select run1 into run from ctx;
  begin
    perform public.import_locations(run, '[{"source":"admin","source_reference":"a","name":"x","latitude":1,"longitude":1,"evidence":"explicit"}]'::jsonb);
    raise exception 'admin source accepted';
  exception when raise_exception then
    if sqlerrm like 'admin source accepted' then raise; end if;
  end;
  begin
    perform public.import_locations(gen_random_uuid(), '[]'::jsonb);
    raise exception 'unknown run accepted';
  exception when raise_exception then
    if sqlerrm like 'unknown run accepted' then raise; end if;
  end;
end $$;

-- Refresh: records not seen in a COMPLETE later run are flagged; unverified ones are hidden,
-- verified ones only flagged; rows outside the run's bounds are untouched.
reset role;
insert into public.locations (name, latitude, longitude, status, restroom_evidence, source, source_reference, last_seen_run)
  values ('TEST outside bounds', 50, 50, 'unverified', 'explicit', 'osm', 'node/99', (select run1 from ctx));
set role service_role;
do $$ declare run2 uuid; res jsonb; begin
  insert into public.import_runs (source, area_name, bounds)
    values ('osm', 'test-area', '{"min_lat": 20, "max_lat": 21, "min_lng": 20, "max_lng": 21}') returning id into run2;
  -- Only node/2 is seen again in the second run.
  perform public.import_locations(run2, '[{"source":"osm","source_reference":"node/2","name":"TEST inferred","latitude":20.6,"longitude":20.6,"evidence":"explicit","source_hash":"h3"}]'::jsonb);
  res := public.finalize_import_run(run2);
  assert (select status from public.locations where source_reference = 'node/2') = 'unverified', 'seen record stays';
  assert (select status from public.locations where source_reference = 'node/1') = 'candidate', 'candidate stays hidden';
  assert (select status = 'verified' and source_missing_since is not null from public.locations where source_reference = 'node/10'),
    'verified missing record is flagged, not hidden';
  assert (select status = 'unverified' and source_missing_since is not null from public.locations where source_reference = 'node/11'),
    'admin-edited unverified record is flagged but not hidden automatically';
  assert (select status = 'unverified' and source_missing_since is null from public.locations where source_reference = 'node/99'),
    'outside-bounds record untouched';
  assert (select finished_at is not null from public.import_runs where id = run2), 'run finished';
end $$;

reset role;
\echo locations_rls: OK
