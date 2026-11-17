-- Schema, access-control, merge-safety and refresh-safety tests. Synthetic rows exist only inside
-- this throwaway cluster and are discarded with it. Never run against a real database.
\set ON_ERROR_STOP on

-- ------------------------------------------------------------ helpers (session-local)
create function pg_temp.rec(ref text, nm text, lat float8, lng float8, ev text, hash text, extra jsonb default '{}')
returns jsonb language sql as $$
  select jsonb_build_object('source','osm','source_reference',ref,'name',nm,'latitude',lat,'longitude',lng,
    'evidence',ev,'content_hash',hash,'license','ODbL-1.0','attribution','(c) TEST attribution') || extra
$$;
create function pg_temp.mkrun(area text, b jsonb, done boolean default true, sc jsonb default '{"include_candidates": true}')
returns uuid language plpgsql as $$
declare rid uuid; begin
  insert into public.import_runs (source, area_name, bounds, complete, scope)
  values ('osm', area, b, done, sc) returning id into rid;
  return rid;
end $$;
create function pg_temp.runid(area text) returns uuid language sql as
  $$ select id from public.import_runs where area_name = area $$;
create function pg_temp.st(ref text) returns text language sql as
  $$ select l.status from public.location_sources s join public.locations l on l.id = s.location_id where s.source_reference = ref $$;

-- ------------------------------------------------------------ fixtures: every state
insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at, opening_hours, fee_required)
values
  ('TEST verified',   10,      10, 'verified',   'explicit', true,  now(), 'Mo-Su 08:00-20:00', false),
  ('TEST unverified', 10.001,  10, 'unverified', 'explicit', false, null,  null, null),
  ('TEST candidate',  10.0005, 10, 'candidate',  'inferred', false, null,  null, null),
  ('TEST pending',    10.0006, 10, 'pending',    'none',     false, null,  null, null),
  ('TEST closed',     10.0007, 10, 'closed',     'none',     false, null,  null, null);
insert into public.location_sources (location_id, source, source_reference, attribution, source_latitude, source_longitude, evidence)
  select id, 'osm', 'node/f1', '(c) TEST attribution', 10.001, 10, 'explicit' from public.locations where name = 'TEST unverified';

-- ------------------------------------------------------------ no direct table access
do $$ declare r text; t text; begin
  foreach r in array array['anon', 'authenticated'] loop
    foreach t in array array['locations', 'location_sources', 'import_runs'] loop
      execute format('set local role %I', r);
      begin
        execute format('select count(*) from public.%I', t);
        raise exception '% can read table %', r, t;
      exception when insufficient_privilege then null; end;
      begin
        execute format('insert into public.%I default values', t);
        raise exception '% can insert into %', r, t;
      exception when insufficient_privilege then null; end;
      reset role;
    end loop;
    execute format('set local role %I', r);
    begin update public.locations set name = 'hacked'; raise exception '% can update', r;
    exception when insufficient_privilege then null; end;
    begin delete from public.locations; raise exception '% can delete', r;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;

-- ------------------------------------------------------------ public functions
set role anon;
do $$ declare n int; names text[]; begin
  select count(*), array_agg(name order by distance_m) into n, names from public.nearby_locations(10, 10, 5000);
  assert n = 2, format('anon nearby should return 2, got %s', n);
  assert names = array['TEST verified', 'TEST unverified'], format('ordered by distance, got %s', names);
  assert (select verification from public.nearby_locations(10, 10, 5000) where name = 'TEST unverified') = 'unverified', 'badge value';
  assert (select attribution from public.nearby_locations(10, 10, 5000) where name = 'TEST unverified') = '(c) TEST attribution', 'attribution surfaced';
  assert (select opening_hours from public.nearby_locations(10, 10, 5000) where name = 'TEST verified') = 'Mo-Su 08:00-20:00', 'hours surfaced';
  assert (select count(*) from public.nearby_locations(10, 10, 5000, 100, true)) = 1, 'verified_only returns verified only';
  assert (select count(*) from public.get_public_location((select id from public.nearby_locations(10, 10, 5000) limit 1))) = 1, 'single lookup works';
end $$;
reset role;

-- Hidden states are unreachable by id.
do $$ declare r text; hidden uuid[]; begin
  select array_agg(id) into hidden from public.locations where name in ('TEST candidate', 'TEST pending', 'TEST closed');
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    assert (select count(*) from public.get_public_location(hidden[1])) = 0, 'candidate by id';
    assert (select count(*) from public.get_public_location(hidden[2])) = 0, 'pending by id';
    assert (select count(*) from public.get_public_location(hidden[3])) = 0, 'closed by id';
    assert (select count(*) from public.nearby_locations(10, 10, 100000)) = 2, 'authenticated/anon see only displayable';
    reset role;
  end loop;
end $$;

-- Nearest verified is the verified one even when an unverified one is closer.
set role anon;
do $$ declare d float8; begin
  select distance_m into d from public.nearest_verified_location(10.001, 10);
  assert d between 100 and 125, format('nearest verified distance %s', d);
  assert (select name from public.nearest_verified_location(10.001, 10)) = 'TEST verified', 'nearest verified name';
  assert (select count(*) from public.nearest_verified_location(50, 50)) = 0, 'none beyond max distance';
end $$;
reset role;

-- The public type exposes only the intended fields.
do $$ declare cols text[]; begin
  select array_agg(attname::text) into cols from pg_attribute a join pg_type t on t.typrelid = a.attrelid
    where t.typname = 'public_location' and t.typnamespace = 'public'::regnamespace and a.attnum > 0;
  assert not (cols && array['status', 'restroom_evidence', 'restroom_verified', 'created_at', 'updated_at',
    'country_code', 'manually_edited_at', 'possible_duplicate_of', 'tags', 'source_reference', 'content_hash', 'hold_reason']),
    format('public type leaks internal fields: %s', cols);
  assert cols @> array['verification', 'opening_hours', 'fee_required', 'attribution', 'distance_m'], 'public type has needed fields';
end $$;

-- Caps and input validation.
insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
  select 'TEST many ' || i, 20 + i * 0.0001, 20, 'verified', 'explicit', true, now() from generate_series(1, 120) i;
set role anon;
do $$ declare n int; prev float8 := -1; d float8; begin
  select count(*) into n from public.nearby_locations(20, 20, 100000, 100000);
  assert n = 100, format('row cap is 100, got %s', n);
  for d in select distance_m from public.nearby_locations(20, 20, 100000, 100) loop
    assert d >= prev, 'results ordered by distance'; prev := d;
  end loop;
  assert (select name from public.nearby_locations(20, 20, 100000, 1)) = 'TEST many 1', 'true nearest returned first';
  begin perform * from public.nearby_locations(91, 0); raise exception 'accepted lat 91';
  exception when sqlstate '22023' then null; end;
  begin perform * from public.nearby_locations(null, 0); raise exception 'accepted null lat';
  exception when sqlstate '22023' then null; end;
  begin perform * from public.nearest_verified_location(0, 181); raise exception 'accepted lng 181';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;
delete from public.locations where name like 'TEST many %';

-- Importer/internal functions are not callable by clients.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    begin perform public.import_locations(gen_random_uuid(), '[]'::jsonb); raise exception 'import_locations executable by %', r;
    exception when insufficient_privilege then null; end;
    begin perform public.finalize_import_run(gen_random_uuid()); raise exception 'finalize executable by %', r;
    exception when insufficient_privilege then null; end;
    begin perform public.distance_m(0, 0, 0, 0); raise exception 'distance_m executable by %', r;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;

-- ------------------------------------------------------------ constraints and triggers
do $$ begin
  begin insert into public.locations (name, latitude, longitude, status, restroom_verified) values ('TEST bad1', 1, 1, 'verified', false);
    raise exception 'verified without confirmation allowed'; exception when check_violation then null; end;
  begin insert into public.locations (name, latitude, longitude, status, restroom_verified, last_verified_at) values ('TEST bad2', 1, 1, 'candidate', true, now());
    raise exception 'candidate claiming verification allowed'; exception when check_violation then null; end;
  begin insert into public.locations (name, latitude, longitude, status, restroom_evidence) values ('TEST bad3', 1, 1, 'unverified', 'inferred');
    raise exception 'unverified without explicit evidence allowed'; exception when check_violation then null; end;
  begin insert into public.locations (name, latitude, longitude) values ('TEST bad5', 91, 1);
    raise exception 'latitude out of range allowed'; exception when check_violation then null; end;
  begin insert into public.locations (name, latitude, longitude, status, restroom_evidence, possible_duplicate_of)
      values ('TEST bad6', 1, 1, 'unverified', 'explicit', (select id from public.locations limit 1));
    raise exception 'public unverified flagged as duplicate allowed'; exception when check_violation then null; end;
  begin insert into public.import_runs (source, bounds) values ('osm', '{"min_lat":1,"max_lat":2,"min_lng":1,"max_lng":2}');
    raise exception 'non-standard bounds allowed'; exception when check_violation then null; end;
  begin insert into public.import_runs (source, bounds) values ('osm', '{"south":2,"west":1,"north":1,"east":2}');
    raise exception 'inverted bounds allowed'; exception when check_violation then null; end;
  begin insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence)
      values ((select id from public.locations limit 1), 'Bad Source!', 'x', 1, 1, 'explicit');
    raise exception 'bad source name allowed'; exception when check_violation then null; end;
  begin insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence)
      values ((select location_id from public.location_sources limit 1), 'osm', 'node/f1', 1, 1, 'explicit');
    raise exception 'duplicate source reference allowed'; exception when unique_violation then null; end;
end $$;

-- Manual edits are auto-protected; rating updates are not; updated_at advances.
insert into public.locations (name, latitude, longitude) values ('TEST manual', 3, 3), ('TEST rating', 3, 4);
do $$ declare a timestamptz; b timestamptz; begin
  update public.locations set name = 'TEST manual edited' where name = 'TEST manual';
  assert (select manually_edited_at is not null from public.locations where name = 'TEST manual edited'), 'manual edit stamps manually_edited_at';
  update public.locations set average_rating = 4, rating_count = 1 where name = 'TEST rating';
  assert (select manually_edited_at is null from public.locations where name = 'TEST rating'), 'rating update does not stamp';
end $$;
do $$ declare a timestamptz; b timestamptz; begin
  select updated_at into a from public.locations where name = 'TEST rating';
  update public.locations set rating_count = 2 where name = 'TEST rating';
  select updated_at into b from public.locations where name = 'TEST rating';
  assert b > a, 'updated_at advances';
end $$;

-- ------------------------------------------------------------ importer: merge safety
set role service_role;
do $$ declare run uuid; res jsonb; begin
  assert (select count(*) from public.locations) >= 5, 'service_role sees all rows';
  run := pg_temp.mkrun('A1', '{"south":20,"west":20,"north":21,"east":21}');
  res := public.import_locations(run, jsonb_build_array(
    pg_temp.rec('node/1', 'TEST explicit', 20.5, 20.5, 'explicit', 'h1', '{"tags":{"amenity":"toilets"},"opening_hours":"24/7","fee_required":false}'),
    pg_temp.rec('node/2', 'TEST inferred', 20.6, 20.6, 'inferred', 'h2')));
  assert (res->>'inserted')::int = 2, 'two inserts';
  assert pg_temp.st('node/1') = 'unverified' and pg_temp.st('node/2') = 'candidate', 'explicit -> unverified, inferred -> candidate';
  assert (select license = 'ODbL-1.0' and attribution is not null and tags->>'amenity' = 'toilets' and is_primary
          from public.location_sources where source_reference = 'node/1'), 'provenance kept in location_sources';
  assert (select opening_hours = '24/7' and fee_required = false from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/1'), 'hours/fee imported';
  -- idempotent rerun
  res := public.import_locations(run, jsonb_build_array(
    pg_temp.rec('node/1', 'TEST explicit', 20.5, 20.5, 'explicit', 'h1'),
    pg_temp.rec('node/2', 'TEST inferred', 20.6, 20.6, 'inferred', 'h2')));
  assert (res->>'inserted')::int = 0 and (res->>'unchanged')::int = 2, format('rerun unchanged: %s', res);
  assert (select count(*) from public.location_sources where source_reference in ('node/1', 'node/2')) = 2, 'no duplicate sources';
  -- upgrade / downgrade follow evidence; importer updates never stamp manual edits
  perform public.import_locations(run, jsonb_build_array(
    pg_temp.rec('node/2', 'TEST inferred', 20.6, 20.6, 'explicit', 'h3'),
    pg_temp.rec('node/1', 'TEST explicit', 20.5, 20.5, 'inferred', 'h4')));
  assert pg_temp.st('node/2') = 'unverified' and pg_temp.st('node/1') = 'candidate', 'upgrade/downgrade';
  assert (select count(*) from public.locations l join public.location_sources s on s.location_id = l.id
          where s.source_reference in ('node/1', 'node/2') and l.manually_edited_at is not null) = 0, 'importer edits are not manual edits';
end $$;
reset role;

-- A dashboard-style edit (no importer flag) auto-protects the record from later imports.
update public.locations set name = 'EDITED BY HUMAN', status = 'unverified', restroom_evidence = 'explicit'
  where id = (select location_id from public.location_sources where source_reference = 'node/1');
set role service_role;
do $$ declare res jsonb; begin
  res := public.import_locations(pg_temp.runid('A1'), jsonb_build_array(
    pg_temp.rec('node/1', 'SOURCE NAME', 20.9, 20.9, 'inferred', 'h5')));
  assert (res->>'protected')::int = 1, format('edited record protected: %s', res);
  assert (select name = 'EDITED BY HUMAN' and status = 'unverified' and latitude = 20.5
          from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/1'), 'edit survived import';
  assert (select content_hash = 'h5' from public.location_sources where source_reference = 'node/1'), 'source row still refreshed';
end $$;
reset role;

-- Verified, pending and closed locations are never overwritten.
do $$ declare lid uuid; begin
  insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at, wheelchair_accessible)
    values ('TEST OS verified', 20.1, 20.1, 'verified', 'explicit', true, now(), true) returning id into lid;
  insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence) values (lid, 'osm', 'node/10', 20.1, 20.1, 'explicit');
  insert into public.locations (name, latitude, longitude, status) values ('TEST pending osm', 20.2, 20.2, 'pending') returning id into lid;
  insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence) values (lid, 'osm', 'node/11', 20.2, 20.2, 'inferred');
  insert into public.locations (name, latitude, longitude, status) values ('TEST closed osm', 20.3, 20.3, 'closed') returning id into lid;
  insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence) values (lid, 'osm', 'node/12', 20.3, 20.3, 'explicit');
end $$;
set role service_role;
do $$ declare res jsonb; begin
  res := public.import_locations(pg_temp.runid('A1'), jsonb_build_array(
    pg_temp.rec('node/10', 'WEAKER', 20.9, 20.9, 'inferred', 'x', '{"tags":{"new":"tags"},"wheelchair_accessible":false}'),
    pg_temp.rec('node/11', 'WEAKER', 20.9, 20.9, 'explicit', 'x'),
    pg_temp.rec('node/12', 'WEAKER', 20.9, 20.9, 'explicit', 'x')));
  assert (res->>'protected')::int = 3, format('three protected: %s', res);
  assert (select name = 'TEST OS verified' and status = 'verified' and wheelchair_accessible and latitude = 20.1 from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/10'), 'verified untouched';
  assert (select tags = '{"new":"tags"}'::jsonb from public.location_sources where source_reference = 'node/10'), 'provenance refreshed';
  assert pg_temp.st('node/11') = 'pending' and pg_temp.st('node/12') = 'closed', 'pending/closed untouched';
end $$;
reset role;

-- Recent source edits hold NEW or CHANGED records hidden (vandalism guard); unchanged ones are not hidden.
set role service_role;
do $$ declare run uuid; res jsonb; begin
  run := pg_temp.mkrun('H1', '{"south":25,"west":25,"north":26,"east":26}');
  res := public.import_locations(run, jsonb_build_array(
    pg_temp.rec('node/20', 'TEST held', 25.1, 25.1, 'explicit', 'a', '{"hold_reason":"recent_edit"}'),
    pg_temp.rec('node/21', 'TEST stable', 25.2, 25.2, 'explicit', 'b')));
  assert (res->>'held_recent_edit')::int = 1, 'one held';
  assert pg_temp.st('node/20') = 'candidate' and pg_temp.st('node/21') = 'unverified', 'new recent edit hidden';
  perform public.import_locations(run, jsonb_build_array(
    pg_temp.rec('node/20', 'TEST held', 25.1, 25.1, 'explicit', 'a'),
    pg_temp.rec('node/21', 'TEST stable', 25.2, 25.2, 'explicit', 'b', '{"hold_reason":"recent_edit"}')));
  assert pg_temp.st('node/20') = 'unverified', 'held record released once edit ages';
  assert pg_temp.st('node/21') = 'unverified', 'unchanged public record not hidden by hold';
  perform public.import_locations(run, jsonb_build_array(
    pg_temp.rec('node/21', 'TEST stable', 25.2, 25.2, 'explicit', 'b2', '{"hold_reason":"recent_edit"}')));
  assert pg_temp.st('node/21') = 'candidate', 'changed + recent edit is hidden';
  perform public.import_locations(run, jsonb_build_array(pg_temp.rec('node/21', 'TEST stable', 25.2, 25.2, 'explicit', 'b2')));
  assert pg_temp.st('node/21') = 'unverified', 'released after aging';
end $$;
reset role;

-- Possible duplicates are flagged, never merged, and stay hidden.
insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
  values ('TEST Park Restroom', 22, 22, 'verified', 'explicit', true, now());
set role service_role;
do $$ declare run uuid; res jsonb; vid uuid; begin
  select id into vid from public.locations where name = 'TEST Park Restroom';
  run := pg_temp.mkrun('D1', '{"south":22,"west":22,"north":23.5,"east":23.5}');
  res := public.import_locations(run, jsonb_build_array(
    pg_temp.rec('node/30', 'TEST Park Restroom', 22.00005, 22, 'explicit', 'a'),            -- ~5 m, same name
    pg_temp.rec('node/31', 'Different Name', 22.0002, 22, 'explicit', 'b'),                 -- ~22 m, different name: not a duplicate
    pg_temp.rec('node/32', 'Restroom', 22.00022, 22, 'explicit', 'c'),                      -- generic name, 2 m from node/31
    pg_temp.rec('node/33', 'TEST Park Restroom', 22.001, 22, 'explicit', 'd'),              -- ~111 m: not a duplicate
    pg_temp.rec('node/34', 'TEST Park Restroom', 22.00001, 22, 'inferred', 'e'),            -- place-level candidate: not compared
    pg_temp.rec('node/36', 'Some Place', 23, 23, 'inferred', 'f'),
    pg_temp.rec('node/37', 'Restroom', 23.00005, 23, 'explicit', 'g')));                    -- generic, but only a place-level neighbor
  assert (res->>'duplicates_flagged')::int = 2, format('two duplicates flagged: %s', res);
  assert (select possible_duplicate_of = vid and status = 'candidate' from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/30'), 'near same-name flagged against verified, hidden';
  assert (select possible_duplicate_of is null and status = 'unverified' from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/31'), 'different name 22 m away is not a duplicate';
  assert (select possible_duplicate_of is not null and status = 'candidate' from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/32'), 'generic name near an unverified restroom flagged';
  assert (select possible_duplicate_of is null and status = 'unverified' from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/33'), 'far same-name not a duplicate';
  assert (select bool_and(possible_duplicate_of is null) from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference in ('node/34', 'node/36')), 'inferred records are not duplicate-flagged';
  assert (select possible_duplicate_of is null and status = 'unverified' from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/37'), 'place-level neighbor does not hide a restroom';
  assert (select count(*) from public.locations where name = 'TEST Park Restroom') >= 4, 'nothing was merged or deleted';
  -- refresh of a flagged record keeps it hidden and flagged
  perform public.import_locations(run, jsonb_build_array(pg_temp.rec('node/30', 'TEST Park Restroom', 22.00005, 22, 'explicit', 'a2')));
  assert (select possible_duplicate_of = vid and status = 'candidate' from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference = 'node/30'), 'flag survives refresh';
end $$;
reset role;
set role anon;
do $$ begin
  assert (select count(*) from public.nearby_locations(22, 22, 300) where name = 'TEST Park Restroom') = 2, 'only verified original + far unverified are public';
  assert (select count(*) from public.nearby_locations(22, 22, 300) where name = 'Restroom') = 0, 'flagged generic duplicate is hidden';
end $$;
reset role;

-- Importer input validation.
set role service_role;
do $$ declare run uuid; begin
  run := pg_temp.runid('A1');
  begin perform public.import_locations(run, jsonb_build_array(jsonb_build_object('source','admin','source_reference','a','name','x','latitude',1,'longitude',1,'evidence','explicit')));
    raise exception 'admin source accepted'; exception when raise_exception then if sqlerrm = 'admin source accepted' then raise; end if; end;
  begin perform public.import_locations(gen_random_uuid(), '[]'::jsonb);
    raise exception 'unknown run accepted'; exception when raise_exception then if sqlerrm = 'unknown run accepted' then raise; end if; end;
  begin perform public.finalize_import_run(pg_temp.mkrun('INC', '{"south":1,"west":1,"north":2,"east":2}', false));
    raise exception 'incomplete run finalized'; exception when raise_exception then if sqlerrm = 'incomplete run finalized' then raise; end if; end;
end $$;
reset role;

-- ------------------------------------------------------------ finalize: correct bounds, thresholds, scope
-- B1: standard bounds; stale unverified hidden, verified/candidate only flagged, outside untouched.
insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
  values ('TEST final verified', 40.5, 40.5, 'verified', 'explicit', true, now()), ('TEST outside', 50, 50, 'unverified', 'explicit', false, null);
insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence)
  select id, 'osm', 'node/108', 40.5, 40.5, 'explicit' from public.locations where name = 'TEST final verified';
insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence)
  select id, 'osm', 'node/199', 50, 50, 'explicit' from public.locations where name = 'TEST outside';
set role service_role;
do $$ declare r1 uuid; r2 uuid; res jsonb; recs jsonb := '[]'; i int; begin
  r1 := pg_temp.mkrun('F1', '{"south":40,"west":40,"north":41,"east":41}');
  for i in 100..107 loop recs := recs || pg_temp.rec('node/' || i, 'TEST f' || i, 40 + (i - 99) * 0.01, 40.2, 'explicit', 'h' || i); end loop;
  recs := recs || pg_temp.rec('node/109', 'TEST fcand', 40.9, 40.9, 'inferred', 'hc');
  perform public.import_locations(r1, recs);
  r2 := pg_temp.mkrun('F2', '{"south":40,"west":40,"north":41,"east":41}');
  recs := '[]';
  for i in 100..106 loop recs := recs || pg_temp.rec('node/' || i, 'TEST f' || i, 40 + (i - 99) * 0.01, 40.2, 'explicit', 'h' || i); end loop;
  perform public.import_locations(r2, recs);
  res := public.finalize_import_run(r2);
  assert (res->>'hidden_locations')::int = 1, format('one unverified hidden: %s', res);
  assert (res->>'flagged_sources')::int = 3, format('three sources flagged (107, verified 108, candidate 109): %s', res);
  assert pg_temp.st('node/107') = 'candidate', 'stale unverified hidden';
  assert pg_temp.st('node/108') = 'verified', 'verified never hidden by refresh';
  assert (select missing_since is not null from public.location_sources where source_reference = 'node/108'), 'verified flagged for review';
  assert pg_temp.st('node/100') = 'unverified', 'seen record stays public';
  assert pg_temp.st('node/199') = 'unverified' and (select missing_since is null from public.location_sources where source_reference = 'node/199'), 'outside bounds untouched';
  res := public.finalize_import_run(r2);
  assert (res->>'flagged_sources')::int = 0, 'finalize is idempotent';
end $$;
reset role;

-- B2: threshold, zero-seen, scope.
set role service_role;
do $$ declare r1 uuid; r2 uuid; res jsonb; recs jsonb := '[]'; seen jsonb := '[]'; i int; begin
  -- many records vanish: refuse, then allow with force
  r1 := pg_temp.mkrun('C1', '{"south":60,"west":60,"north":61,"east":61}');
  for i in 1..30 loop recs := recs || pg_temp.rec('node/c' || i, 'TEST c' || i, 60 + i * 0.01, 60.5, 'explicit', 'h'); end loop;
  perform public.import_locations(r1, recs);
  for i in 1..10 loop seen := seen || pg_temp.rec('node/c' || i, 'TEST c' || i, 60 + i * 0.01, 60.5, 'explicit', 'h'); end loop;
  r2 := pg_temp.mkrun('C2', '{"south":60,"west":60,"north":61,"east":61}');
  perform public.import_locations(r2, seen);
  begin perform public.finalize_import_run(r2); raise exception 'mass hide allowed';
  exception when raise_exception then if sqlerrm = 'mass hide allowed' then raise; end if; end;
  assert (select count(*) from public.locations l join public.location_sources s on s.location_id = l.id where s.source_reference like 'node/c%' and l.status = 'unverified') = 30, 'nothing hidden by refused finalize';
  res := public.finalize_import_run(r2, true);
  assert (res->>'hidden_locations')::int = 20, 'force hides stale';

  -- empty fetch must not wipe an area
  r1 := pg_temp.mkrun('Z1', '{"south":70,"west":70,"north":71,"east":71}');
  perform public.import_locations(r1, jsonb_build_array(pg_temp.rec('node/z1', 'TEST z', 70.5, 70.5, 'explicit', 'h')));
  r2 := pg_temp.mkrun('Z2', '{"south":70,"west":70,"north":71,"east":71}');
  begin perform public.finalize_import_run(r2); raise exception 'empty run finalized';
  exception when raise_exception then if sqlerrm = 'empty run finalized' then raise; end if; end;
  assert pg_temp.st('node/z1') = 'unverified', 'empty run did not hide anything';

  -- run that did not query candidates must not judge candidates
  r1 := pg_temp.mkrun('S1', '{"south":80,"west":80,"north":81,"east":81}');
  perform public.import_locations(r1, jsonb_build_array(
    pg_temp.rec('node/s1', 'TEST s1', 80.1, 80.1, 'explicit', 'h'), pg_temp.rec('node/s2', 'TEST s2', 80.2, 80.2, 'explicit', 'h'),
    pg_temp.rec('node/sc', 'TEST sc', 80.3, 80.3, 'inferred', 'h')));
  r2 := pg_temp.mkrun('S2', '{"south":80,"west":80,"north":81,"east":81}', true, '{"include_candidates": false}');
  perform public.import_locations(r2, jsonb_build_array(pg_temp.rec('node/s1', 'TEST s1', 80.1, 80.1, 'explicit', 'h')));
  res := public.finalize_import_run(r2);
  assert pg_temp.st('node/s2') = 'candidate' and pg_temp.st('node/s1') = 'unverified', 'explicit judged';
  assert (select missing_since is null from public.location_sources where source_reference = 'node/sc'), 'candidates not judged when not queried';

  -- a location with another live source is not hidden when only one source vanishes
  r1 := pg_temp.mkrun('M1', '{"south":85,"west":85,"north":86,"east":86}');
  perform public.import_locations(r1, jsonb_build_array(pg_temp.rec('node/m1', 'TEST multi', 85.5, 85.5, 'explicit', 'h')));
  insert into public.location_sources (location_id, source, source_reference, source_latitude, source_longitude, evidence, is_primary)
    select location_id, 'osm', 'way/m2', 85.5, 85.5, 'explicit', false from public.location_sources where source_reference = 'node/m1';
  r2 := pg_temp.mkrun('M2', '{"south":85,"west":85,"north":86,"east":86}');
  perform public.import_locations(r2, jsonb_build_array(pg_temp.rec('way/m2', 'TEST multi', 85.5, 85.5, 'explicit', 'h')));
  perform public.finalize_import_run(r2);
  assert pg_temp.st('node/m1') = 'unverified', 'location with a live secondary source stays public';
end $$;
reset role;

\echo locations_rls: OK
