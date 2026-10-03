-- OS-101/102 tests. Synthetic rows below exist only inside this throwaway cluster
-- and are discarded with it. They are never written to any real database.
\set ON_ERROR_STOP on

insert into public.locations (name, latitude, longitude, status, restroom_verified, last_verified_at, source, source_reference)
values
  ('TEST verified',  10, 10, 'verified',  true,  now(), 'admin', 't-verified'),
  ('TEST candidate', 10, 10, 'candidate', false, null,  'osm',   't-candidate'),
  ('TEST pending',   10, 10, 'pending',   false, null,  'user_submission', 't-pending'),
  ('TEST closed',    10, 10, 'closed',    false, null,  'admin', 't-closed');

-- Defaults: imports are unverified candidates.
do $$ declare s text; v boolean; begin
  insert into public.locations (name, latitude, longitude, source) values ('TEST default', 1, 1, 'osm')
    returning status, restroom_verified into s, v;
  assert s = 'candidate' and v = false, 'default must be unverified candidate';
end $$;

-- Public reads see only verified rows.
set role anon;
do $$ declare n int; begin
  select count(*) into n from public.locations;
  assert n = 1, format('anon should see 1 row, saw %s', n);
  assert (select name from public.locations) = 'TEST verified', 'anon sees only verified';
end $$;
reset role;

set role authenticated;
do $$ declare n int; begin
  select count(*) into n from public.locations;
  assert n = 1, format('authenticated should see 1 row, saw %s', n);
end $$;
reset role;

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

-- Service role (server-side) can see everything.
set role service_role;
do $$ begin
  assert (select count(*) from public.locations) = 5, 'service_role sees all rows';
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
    insert into public.locations (name, latitude, longitude, source) values ('TEST bad3', 91, 1, 'osm');
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

\echo locations_rls: OK
