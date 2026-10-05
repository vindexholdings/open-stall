-- Review/validator workflow tests (throwaway cluster, synthetic rows).
\set ON_ERROR_STOP on

create function pg_temp.mk(nm text, st text, ev text, lat float8, verified boolean default false, extra text default null)
returns uuid language plpgsql as $$
declare lid uuid; begin
  insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at, baby_changing, wheelchair_accessible, gender_neutral, has_hot_water)
  values (nm, lat, 70, st, ev, verified, case when verified then '2026-01-01T12:00:00Z'::timestamptz end, true, true, true, true) returning id into lid;
  insert into public.location_sources (location_id, source, source_reference, license, attribution, source_latitude, source_longitude, evidence, tags, is_primary)
  values (lid, 'osm', 'review-test/' || nm, 'ODbL-1.0', '(c) TEST OSM', lat, 70, 'explicit', jsonb_build_object('amenity', 'toilets', 'name', nm), true);
  return lid;
end $$;
create function pg_temp.rev(lid uuid, existence text, access text default 'unknown', wc boolean default null, gn boolean default null,
  bc boolean default null, hot boolean default null, cold boolean default null, notes text default null, personal boolean default false, vdate date default null)
returns jsonb language sql as $$
  select public.apply_location_review(lid, 'Test Reviewer', existence, access, wc, gn, bc, hot, cold, notes, personal, vdate)
$$;

select pg_temp.mk('REV A unverified', 'unverified', 'explicit', 70.0000) as a \gset
select pg_temp.mk('REV B candidate', 'candidate', 'inferred', 70.0010) as b \gset
select pg_temp.mk('REV C unverified', 'unverified', 'explicit', 70.0020) as c \gset
select pg_temp.mk('REV D unverified', 'unverified', 'explicit', 70.0030) as d \gset
select pg_temp.mk('REV E verified', 'verified', 'explicit', 70.0040, true) as e \gset
select pg_temp.mk('REV F candidate', 'candidate', 'inferred', 70.0050) as f \gset
insert into public.locations (name, latitude, longitude, status) values ('REV pending', 70.1, 70, 'pending') returning id as pend \gset

-- Clients cannot see or call anything review-related.
do $$ declare r text; begin
  foreach r in array array['anon', 'authenticated'] loop
    execute format('set local role %I', r);
    begin perform count(*) from public.location_reviews; raise exception '% reads location_reviews', r;
    exception when insufficient_privilege then null; end;
    begin perform public.apply_location_review(gen_random_uuid(), 'x', 'exists', 'unknown', null, null, null, null, null, null, false, null);
      raise exception '% can call apply_location_review', r;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
end $$;

set role service_role;

-- A: personally verified with facts; unknown stays null; OSM provenance preserved; first-party source added.
select pg_temp.rev(:'a', 'exists', 'public_free', true, null, null, null, null, 'Checked in person', true, '2026-10-05') as res_a \gset
do $$ declare lid uuid := (select id from public.locations where name = 'REV A unverified'); begin
  assert (select status = 'verified' and restroom_verified and last_verified_at = '2026-10-05T12:00:00Z' and restroom_evidence = 'explicit'
          from public.locations where id = lid), 'A is Verified with the confirmed date';
  assert (select wheelchair_accessible and baby_changing is null and gender_neutral is null and has_hot_water is null and has_cold_water is null
          from public.locations where id = lid), 'facts are exactly the answers; unknown (and previously imported) values become null';
  assert (select key_required = false and purchase_required = false and fee_required = false from public.locations where id = lid), 'public/free sets key, purchase and fee to false';
  assert (select count(*) = 1 and bool_and(is_primary and tags->>'name' = 'REV A unverified' and license = 'ODbL-1.0' and attribution = '(c) TEST OSM')
          from public.location_sources where location_id = lid and source = 'osm'), 'OSM source row preserved untouched and still primary';
  assert (select count(*) = 1 and bool_and(not is_primary and license like 'Open Stall original data%' and tags->>'personally_verified' = 'true' and tags->>'verified_on' = '2026-10-05')
          from public.location_sources where location_id = lid and source = 'open_stall'), 'first-party provenance added separately';
  assert (select count(*) = 1 and bool_and(personally_verified and verified_on = '2026-10-05' and notes = 'Checked in person' and previous->>'status' = 'unverified' and (previous->>'baby_changing')::boolean)
          from public.location_reviews where location_id = lid), 'audit row with previous state';
  assert (select manually_edited_at is not null from public.locations where id = lid), 'reviewed records are protected from import overwrites';
end $$;

-- B: exists but NOT personally verified -> public Unverified, never Verified; customers only.
select pg_temp.rev(:'b', 'exists', 'customers_only', null, true, false, true) as res_b \gset
do $$ declare lid uuid := (select id from public.locations where name = 'REV B candidate'); begin
  assert (select status = 'unverified' and not restroom_verified and last_verified_at is null and restroom_evidence = 'explicit' from public.locations where id = lid), 'B becomes Unverified, not Verified';
  assert (select purchase_required and key_required is null and fee_required is null and gender_neutral and baby_changing = false and has_hot_water from public.locations where id = lid), 'B facts applied';
  assert (select count(*) = 1 from public.location_sources where location_id = lid and source = 'open_stall' and tags->>'personally_verified' = 'false'), 'B first-party source marks it not personally verified';
end $$;

-- C: does not exist -> Closed, hidden, never republished by import.
select pg_temp.rev(:'c', 'not_exists', 'unknown', null, null, null, null, null, 'No restroom there') as res_c \gset
do $$ declare lid uuid := (select id from public.locations where name = 'REV C unverified'); res jsonb; run uuid; begin
  assert (select status = 'closed' and not restroom_verified from public.locations where id = lid), 'C is closed';
  assert (select count(*) = 0 from public.location_sources where location_id = lid and source = 'open_stall'), 'no first-party "exists" provenance for a nonexistent restroom';
  assert (select count(*) = 1 from public.location_reviews where location_id = lid and existence = 'not_exists'), 'decision recorded';
  insert into public.import_runs (source, area_name, bounds, complete) values ('osm', 'rev-test', '{"south":69,"west":69,"north":71,"east":71}', true) returning id into run;
  res := public.import_locations(run, jsonb_build_array(jsonb_build_object('source','osm','source_reference','review-test/REV C unverified','name','REV C unverified','latitude',70.002,'longitude',70,'evidence','explicit','content_hash','new')));
  assert (res->>'protected')::int = 1, 'import treats closed as protected';
  assert (select status = 'closed' from public.locations where id = lid), 'import never republishes a closed record';
end $$;

-- D: unsure -> no status/fact change, review recorded.
select pg_temp.rev(:'d', 'unsure', 'public_free', true, true, true, true, null, 'Not sure') as res_d \gset
do $$ declare lid uuid := (select id from public.locations where name = 'REV D unverified'); begin
  assert (select status = 'unverified' and baby_changing and wheelchair_accessible and key_required is null from public.locations where id = lid), 'unsure changes nothing';
  assert (select count(*) = 1 and bool_and(resulting_status = 'unverified' and notes = 'Not sure') from public.location_reviews where location_id = lid), 'unsure recorded with notes';
  assert (select manually_edited_at is not null from public.locations where id = lid), 'reviewed even when unsure';
end $$;

-- E: an already verified record is not downgraded by a non-verifying review and keeps its date.
select pg_temp.rev(:'e', 'exists', 'key_required', null, false) as res_e \gset
do $$ declare lid uuid := (select id from public.locations where name = 'REV E verified'); begin
  assert (select status = 'verified' and restroom_verified and last_verified_at = '2026-01-01T12:00:00Z' and key_required and gender_neutral = false from public.locations where id = lid), 'E stays verified, date kept, facts updated';
end $$;

-- Closed can be reopened by an explicit "exists" review.
select pg_temp.rev(:'c', 'exists') as res_c2 \gset
do $$ begin
  assert (select status = 'unverified' and not restroom_verified from public.locations where name = 'REV C unverified'), 'reopened as Unverified';
end $$;

-- Cold-water-only mapping.
select pg_temp.rev(:'f', 'exists', 'unknown', null, null, null, null, true) as res_f \gset
do $$ begin
  assert (select has_hot_water = false and has_cold_water from public.locations where name = 'REV F candidate'), 'cold-water-only -> hot false, cold true';
end $$;

-- Validation and safety.
do $$ declare lid uuid := (select id from public.locations where name = 'REV E verified'); begin
  begin perform pg_temp.rev(lid, 'exists', 'unknown', null, null, null, null, null, null, true, null); raise exception 'personal without date accepted';
  exception when sqlstate '22023' then null; end;
  begin perform pg_temp.rev(lid, 'not_exists', 'unknown', null, null, null, null, null, null, true, '2026-10-05'); raise exception 'personal with not_exists accepted';
  exception when sqlstate '22023' then null; end;
  begin perform pg_temp.rev(lid, 'exists', 'unknown', null, null, null, null, null, null, true, '2099-01-01'); raise exception 'future date accepted';
  exception when sqlstate '22023' then null; end;
  begin perform pg_temp.rev(lid, 'exists', 'unknown', null, null, null, true, true); raise exception 'hot+cold accepted';
  exception when sqlstate '22023' then null; end;
  begin perform pg_temp.rev(lid, 'maybe'); raise exception 'bad existence accepted';
  exception when sqlstate '22023' then null; end;
  begin perform pg_temp.rev(lid, 'exists', 'free'); raise exception 'bad access accepted';
  exception when sqlstate '22023' then null; end;
  begin perform pg_temp.rev(gen_random_uuid(), 'exists'); raise exception 'unknown location accepted';
  exception when sqlstate '22023' then null; end;
  begin perform pg_temp.rev((select id from public.locations where name = 'REV pending'), 'exists'); raise exception 'pending accepted';
  exception when sqlstate '22023' then null; end;
  assert (select count(*) from public.location_reviews where location_id = lid) = 1, 'rejected reviews leave no trace';
end $$;

-- A possible-duplicate record cannot be made public Unverified until the flag is resolved.
reset role;
update public.locations set status = 'candidate', has_hot_water = null, has_cold_water = null,
  possible_duplicate_of = (select id from public.locations where name = 'REV E verified') where name = 'REV F candidate';
set role service_role;
do $$ begin
  begin perform pg_temp.rev((select id from public.locations where name = 'REV F candidate'), 'exists'); raise exception 'duplicate made public';
  exception when sqlstate '22023' then null; end;
end $$;
reset role;

-- Public output reflects the decisions.
set role anon;
do $$ begin
  assert (select verification from public.nearby_locations(70.002, 70, 2000) where name = 'REV A unverified') = 'verified', 'A is public Verified';
  assert (select verification from public.nearby_locations(70.002, 70, 2000) where name = 'REV B candidate') = 'unverified', 'B is public Unverified';
  assert (select count(*) from public.nearby_locations(70.002, 70, 2000) where name = 'REV F candidate') = 0, 'flagged duplicate stays hidden';
end $$;
reset role;
\echo reviews: OK
