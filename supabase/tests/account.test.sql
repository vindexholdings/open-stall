-- Account layer tests (OS-203..OS-209): profiles, favorites, ratings, check-ins, submissions, reports, deletion.
-- Throwaway cluster, synthetic rows.
\set ON_ERROR_STOP on

create function pg_temp.mkloc(nm text, st text, ev text, lat float8, lng float8 default 71, verified boolean default false)
returns uuid language plpgsql as $$
declare lid uuid; begin
  insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
  values (nm, lat, lng, st, ev, verified, case when verified then now() end) returning id into lid;
  return lid;
end $$;
create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'ASSERT FAILED: %', msg; end if; end $$;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false)
$$;
-- Runs sql as the current role and asserts it fails with the given SQLSTATE.
create function pg_temp.fails(q text, code text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'expected failure % but succeeded: %', code, q;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'expected failure%' then raise; end if;
  if sqlstate <> code then raise exception 'expected % got % (%): %', code, sqlstate, sqlerrm, q; end if;
end $$;

select pg_temp.mkloc('ACC verified A', 'verified', 'explicit', 71.0000, 71, true) as la \gset
select pg_temp.mkloc('ACC unverified B', 'unverified', 'explicit', 71.0010) as lb \gset
select pg_temp.mkloc('ACC verified C', 'verified', 'explicit', 71.0020, 71, true) as lc \gset
select pg_temp.mkloc('ACC verified D', 'verified', 'explicit', 71.0030, 71, true) as ld \gset
select pg_temp.mkloc('ACC verified E', 'verified', 'explicit', 71.0040, 71, true) as le \gset
select pg_temp.mkloc('ACC verified F', 'verified', 'explicit', 71.0050, 71, true) as lf \gset
select pg_temp.mkloc('ACC candidate G', 'candidate', 'inferred', 71.0060) as lg \gset
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'a@test.invalid'),
  ('00000000-0000-0000-0000-0000000000b2', 'b@test.invalid');
select count(*) as locs_before from public.locations \gset
\set ua '00000000-0000-0000-0000-0000000000a1'
\set ub '00000000-0000-0000-0000-0000000000b2'

-- ------------------------------------------------ privileges: no table access, anon can call nothing
do $$ declare t text; f text; begin
  foreach t in array array['profiles','favorites','reviews','review_observations','checkins','submissions','reports','action_log'] loop
    execute 'set local role anon';
    begin execute format('select 1 from public.%I', t); raise exception 'anon reads %', t;
    exception when insufficient_privilege then null; end;
    execute 'set local role authenticated';
    begin execute format('select 1 from public.%I', t); raise exception 'authenticated reads %', t;
    exception when insufficient_privilege then null; end;
    begin execute format('insert into public.%I default values', t); raise exception 'authenticated writes %', t;
    exception when insufficient_privilege then null; end;
    reset role;
  end loop;
  foreach f in array array[
    'get_my_profile()', 'update_my_profile(text,text,text)', 'add_favorite(uuid)', 'remove_favorite(uuid)',
    'list_my_favorites(double precision,double precision)', 'submit_review(uuid,integer,text,text[])', 'get_my_review(uuid)',
    'delete_my_review(uuid)', 'check_in(uuid,double precision,double precision)', 'submit_location(jsonb,double precision,double precision,double precision,boolean,text)',
    'submit_location_edit(uuid,jsonb,boolean,text)', 'list_my_submissions()', 'withdraw_my_submission(uuid)',
    'submit_report(uuid,text,text)', 'delete_my_account(text)'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), 'anon must not execute ' || f;
    assert has_function_privilege('authenticated', 'public.' || f, 'execute'), 'authenticated must execute ' || f;
  end loop;
  foreach f in array array['enforce_rate_limit(uuid,text,integer,interval)', 'public_location_row(public.locations,double precision)',
    'validate_proposed(jsonb,boolean)', 'free_text_ok(text,integer)', 'looks_residential(text)', 'handle_new_user()'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute') and not has_function_privilege('authenticated', 'public.' || f, 'execute'),
      'internal function exposed: ' || f;
  end loop;
  -- Import/review (validator) functions are service-only: anon and signed-in users are denied.
  foreach f in array array[
    'apply_location_review(uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,text,boolean,date,boolean,boolean,boolean)',
    'apply_location_review_v2(uuid,text,text,text,boolean,date,jsonb)'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), 'anon must not run validator function ' || f;
    assert not has_function_privilege('authenticated', 'public.' || f, 'execute'), 'authenticated must not run validator function ' || f;
    assert has_function_privilege('service_role', 'public.' || f, 'execute'), 'service_role must run validator function ' || f;
  end loop;
end $$;

-- Doctor regression: probing a key column that doesn't exist yields undefined_column (42703) BEFORE the
-- permission check, so profiles/favorites/review_observations (no `id` column) must be probed with select=*.
do $$ declare t text; begin
  execute 'set local role anon';
  foreach t in array array['profiles', 'favorites', 'review_observations'] loop
    begin execute format('select id from public.%I limit 1', t); raise exception '% unexpectedly has id', t;
    exception when undefined_column then null; end;
    begin execute format('select * from public.%I limit 1', t); raise exception 'anon read %', t;
    exception when insufficient_privilege then null; end;
  end loop;
  reset role;
end $$;

-- ------------------------------------------------ not authenticated (no sub) is rejected
set role authenticated;
select pg_temp.as_user(null);
select pg_temp.fails('select * from public.get_my_profile()', '28000');
select pg_temp.fails(format('select public.add_favorite(%L)', :'la'), '28000');
select pg_temp.fails(format('select public.submit_report(%L, ''closed'')', :'la'), '28000');
reset role;

-- ------------------------------------------------ profiles
do $$ begin
  assert (select count(*) = 2 from public.profiles where user_id in ('00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000b2')),
    'profile created automatically for new users';
  insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c3', 'c@test.invalid');
  assert exists (select 1 from public.profiles where user_id = '00000000-0000-0000-0000-0000000000c3'), 'trigger creates profile';
  delete from auth.users where id = '00000000-0000-0000-0000-0000000000c3';
  assert not exists (select 1 from public.profiles where user_id = '00000000-0000-0000-0000-0000000000c3'), 'profile cascades';
end $$;

set role authenticated;
select pg_temp.as_user(:'ua');
do $$ declare r record; begin
  select * into r from public.get_my_profile();
  assert r.preferred_mode = 'plain' and r.default_transport = 'walk' and r.display_name is null and r.points_balance = 0, 'defaults';
  select * into r from public.update_my_profile('Trail Walker', 'risque', 'bike');
  assert r.display_name = 'Trail Walker' and r.preferred_mode = 'risque' and r.default_transport = 'bike', 'profile updated';
  select * into r from public.update_my_profile('  ', 'plain', 'walk');
  assert r.display_name is null, 'blank name clears it';
end $$;
select pg_temp.fails($q$select * from public.update_my_profile('x', 'plain', 'walk')$q$, '22023');
select pg_temp.fails($q$select * from public.update_my_profile('Admin Joe', 'plain', 'walk')$q$, '22023');
select pg_temp.fails($q$select * from public.update_my_profile('Open Stall Staff', 'plain', 'walk')$q$, '22023');
select pg_temp.fails($q$select * from public.update_my_profile('visit www.x', 'plain', 'walk')$q$, '22023');
select pg_temp.fails($q$select * from public.update_my_profile('<b>hi</b>', 'plain', 'walk')$q$, '22023');
select pg_temp.fails($q$select * from public.update_my_profile('a@b.co', 'plain', 'walk')$q$, '22023');
select pg_temp.fails($q$select * from public.update_my_profile('Joe', 'gross', 'walk')$q$, '22023');
select pg_temp.fails($q$select * from public.update_my_profile('Joe', 'plain', 'teleport')$q$, '22023');
-- User B's profile is unaffected by A's edits.
select pg_temp.as_user(:'ub');
do $$ declare r record; begin
  select * into r from public.get_my_profile();
  assert r.display_name is null and r.preferred_mode = 'plain', 'profiles are isolated per user';
end $$;
reset role;

-- ------------------------------------------------ favorites: cap 5, hidden rejected, isolation
set role authenticated;
select pg_temp.as_user(:'ua');
select pg_temp.fails(format('select public.add_favorite(%L)', :'lg'), '22023');
select pg_temp.fails(format('select public.add_favorite(%L)', gen_random_uuid()), '22023');
select public.add_favorite(:'la'), public.add_favorite(:'lb'), public.add_favorite(:'lc'), public.add_favorite(:'ld'), public.add_favorite(:'le');
select pg_temp.ok((public.add_favorite(:'la')->>'added')::boolean = false, 'adding twice is idempotent');
select pg_temp.fails(format('select public.add_favorite(%L)', :'lf'), '53400');
do $$ begin assert (select count(*) = 5 from public.list_my_favorites(71, 71)), 'five favorites listed'; end $$;
do $$ begin assert (select bool_and(distance_m is not null) from public.list_my_favorites(71, 71)), 'distance computed when coordinates given'; end $$;
do $$ begin assert (select bool_and(distance_m is null) from public.list_my_favorites()), 'no coordinates, no distance'; end $$;
select pg_temp.fails($q$select * from public.list_my_favorites(95, 0)$q$, '22023');
select public.remove_favorite(:'la');
select public.add_favorite(:'lf');
select pg_temp.as_user(:'ub');
do $$ begin assert (select count(*) = 0 from public.list_my_favorites()), 'another user sees none of A''s favorites'; end $$;
select public.add_favorite(:'la');
reset role;
-- A location that stops being public no longer counts toward the cap or appears in the list.
update public.locations set status = 'closed' where id = :'ld'::uuid;
update public.locations set restroom_verified = false where id = :'ld'::uuid;
set role authenticated;
select pg_temp.as_user(:'ua');
do $$ begin assert (select count(*) = 4 from public.list_my_favorites()), 'closed location hidden from favorites'; end $$;
select public.add_favorite(:'la');
reset role;
update public.locations set status = 'verified', restroom_verified = true, last_verified_at = now() where id = :'ld'::uuid;

-- ------------------------------------------------ ratings, aggregates
set role authenticated;
select pg_temp.as_user(:'ua');
select pg_temp.fails(format('select public.submit_review(%L, 0, ''plain'', null)', :'la'), '22023');
select pg_temp.fails(format('select public.submit_review(%L, 6, ''plain'', null)', :'la'), '22023');
select pg_temp.fails(format('select public.submit_review(%L, 3, ''gross'', null)', :'la'), '22023');
select pg_temp.fails(format('select public.submit_review(%L, 3, ''plain'', array[''smells fine''])', :'la'), '22023');
select pg_temp.fails(format('select public.submit_review(%L, 3, ''plain'', array[''clean'',''dirty''])', :'la'), '22023');
select pg_temp.fails(format('select public.submit_review(%L, 3, ''plain'', null)', :'lg'), '22023');
select public.submit_review(:'la', 5, 'plain', array['clean','easy_to_find','clean']);
select pg_temp.as_user(:'ub');
select public.submit_review(:'la', 2, 'risque', null);
reset role;
do $$ declare l public.locations; begin
  select * into l from public.locations where name = 'ACC verified A';
  assert l.rating_count = 2 and l.average_rating = 3.5, 'aggregate over two users';
end $$;
set role authenticated;
select pg_temp.as_user(:'ua');
select public.submit_review(:'la', 4, 'plain', array['dirty']);
select pg_temp.ok((public.get_my_review(:'la')->>'rating') = '4', 'one review per user, updated in place');
select pg_temp.ok((public.get_my_review(:'la')->'observations') = '["dirty"]'::jsonb, 'observations replaced');
select pg_temp.as_user(:'ub');
select pg_temp.ok((public.get_my_review(:'la')->>'rating') = '2', 'users only read their own review');
select pg_temp.ok(public.get_my_review(:'lc') is null, 'no review is null');
reset role;
do $$ declare l public.locations; begin
  select * into l from public.locations where name = 'ACC verified A';
  assert l.rating_count = 2 and l.average_rating = 3.0, 'update recomputes aggregate';
  assert (select count(*) = 2 from public.reviews where location_id = l.id), 'still two reviews';
end $$;
set role authenticated;
select public.delete_my_review(:'la');
reset role;
do $$ declare l public.locations; begin
  select * into l from public.locations where name = 'ACC verified A';
  assert l.rating_count = 1 and l.average_rating = 4.0, 'delete recomputes aggregate (B deleted; A remains with 4)';
end $$;

-- ------------------------------------------------ public rating is community-only (admin ratings are history)
-- Admin ratings (apply_location_review_v2) never move the public average/count, in any interleaving.
set role service_role;
select public.apply_location_review_v2(:'la'::uuid, 'Jake', 'local-admin', 'exists', true, current_date, '{"rating":1}'::jsonb);
reset role;
select pg_temp.ok((select rating_count = 1 and average_rating = 4.0 from public.locations where id = :'la'::uuid), 'admin rating does not change a community average');
set role authenticated;
select pg_temp.as_user(:'ua');
select public.submit_review(:'la', 2, 'plain', null);
reset role;
select pg_temp.ok((select rating_count = 1 and average_rating = 2.0 from public.locations where id = :'la'::uuid), 'community update recomputes from community rows only');
set role service_role;
select public.apply_location_review_v2(:'la'::uuid, 'Other', 'other-admin', 'exists', true, current_date, '{"rating":5}'::jsonb);
reset role;
select pg_temp.ok((select rating_count = 1 and average_rating = 2.0 from public.locations where id = :'la'::uuid), 'a later admin rating still cannot overwrite the community average');
set role authenticated;
select pg_temp.as_user(:'ua');
select public.delete_my_review(:'la');
reset role;
select pg_temp.ok((select rating_count = 0 and average_rating is null from public.locations where id = :'la'::uuid), 'community delete leaves no customer rating even though admin ratings exist');
select pg_temp.ok((select count(*) = 2 and count(*) filter (where rating is not null) = 2 from public.location_reviews where location_id = :'la'::uuid and reviewer_kind = 'admin' and rating in (1, 5)),
  'admin ratings are preserved in history/provenance');
-- Admin-only place: no customer rating or count.
set role service_role;
select public.apply_location_review_v2(:'lc'::uuid, 'Jake', 'local-admin', 'exists', true, current_date, '{"rating":5}'::jsonb);
reset role;
select pg_temp.ok((select rating_count = 0 and average_rating is null from public.locations where id = :'lc'::uuid), 'admin-only place has no customer rating or count');
select pg_temp.ok((select status = 'verified' from public.locations where id = :'lc'::uuid), 'admin verification still applies');
-- A stale/contaminated stored aggregate is repaired from community rows only.
update public.locations set average_rating = 5, rating_count = 7 where id = :'lc'::uuid;
select public.recompute_location_rating(:'lc'::uuid);
select pg_temp.ok((select rating_count = 0 and average_rating is null from public.locations where id = :'lc'::uuid), 'recompute repairs a stored aggregate from community rows');
-- Restore community A rating for the rest of the suite.
set role authenticated;
select pg_temp.as_user(:'ua');
select public.submit_review(:'la', 4, 'plain', null);
reset role;
select pg_temp.ok((select rating_count = 1 and average_rating = 4.0 from public.locations where id = :'la'::uuid), 'community rating restored');

-- ------------------------------------------------ check-ins (position checked and discarded)
do $$ begin
  assert not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'checkins'
    and column_name in ('latitude', 'longitude', 'lat', 'lng', 'position')), 'check-ins never store coordinates';
end $$;
set role authenticated;
select pg_temp.as_user(:'ua');
select pg_temp.fails(format('select public.check_in(%L, 71.5, 71)', :'la'), '22023');       -- far away
select pg_temp.fails(format('select public.check_in(%L, 95, 71)', :'la'), '22023');         -- bad coordinates
select pg_temp.fails(format('select public.check_in(%L, null, null)', :'la'), '22023');
select pg_temp.fails(format('select public.check_in(%L, 71, 71)', :'lg'), '22023');         -- hidden location
select public.check_in(:'la', 71.0005, 71);                                                  -- ~55 m
select pg_temp.fails(format('select public.check_in(%L, 71, 71)', :'la'), '54000');         -- repeat within 12 h
select public.check_in(:'lc', 71.0020, 71), public.check_in(:'ld', 71.0030, 71), public.check_in(:'le', 71.0040, 71),
       public.check_in(:'lf', 71.0050, 71);
reset role;

-- ------------------------------------------------ submissions: new restrooms need the current location
select count(*) as pub_before from public.nearby_locations(71.0, 71.0, 50000, 100) \gset
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c3', 'c@test.invalid');
\set uc '00000000-0000-0000-0000-0000000000c3'
-- Helper: a new-restroom submission from a device fix (name, lat, lng, accuracy, attested, note).
create function pg_temp.nl(nm text, lat float8, lng float8, acc float8 default 10, att boolean default true, note text default null, extra jsonb default '{}')
returns jsonb language sql as $$
  select public.submit_location(jsonb_build_object('name', nm) || extra, lat, lng, acc, att, note)
$$;
set role authenticated;
select pg_temp.as_user(:'ua');
-- No current location / unusable fix / forged position: rejected, nothing stored, no rate-limit use.
select pg_temp.fails($q$select pg_temp.nl('Park restroom', null, 71.2)$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, null)$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, null)$q$, '22023');     -- no accuracy
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 0)$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, -5)$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 51)$q$, '22023');       -- too imprecise
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 'NaN')$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 0, 0)$q$, '22023');                  -- null island
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 95, 71.2)$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 'NaN')$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, true, null, '{"latitude":10,"longitude":10}')$q$, '22023'); -- arbitrary pin in the payload
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, false)$q$, '22023');   -- attestation
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, true, null, '{"status":"verified"}')$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, true, null, '{"average_rating":5}')$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, true, null, '{"fee_required":"yes"}')$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Call 307-555-0100 now', 71.2, 71.2)$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, true, 'see http://spam.example')$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, true, 'mail me a@b.co')$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('My house bathroom', 71.2, 71.2)$q$, '22023');          -- private residence
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, true, null, '{"access_location":"private residence, ring bell"}')$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('Park restroom', 71.2, 71.2, 10, true, 'it is at my neighbor''s place')$q$, '22023');
select pg_temp.fails($q$select public.submit_location('[1,2]', 71.2, 71.2, 10, true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location(null, 71.2, 71.2, 10, true)$q$, '22023');
-- The old arbitrary-coordinate signature no longer exists.
select pg_temp.fails($q$select public.submit_location('{"name":"x","latitude":71.2,"longitude":71.2}'::jsonb, true, null::text)$q$, '42883');
do $$ begin
  assert (select count(*) = 0 from public.list_my_submissions()), 'rejected submissions leave no rows';
end $$;
select (pg_temp.nl('Library restroom', 71.3, 71.3, 10, true, 'By the entrance', '{"wheelchair_accessible":true}'))->>'submission_id' as s1 \gset
select pg_temp.ok((select count(*) = 1 from public.list_my_submissions()), 'one proposal so far');
select (pg_temp.nl('Boat ramp restroom', 71.4, 71.4, 40))->>'submission_id' as s2 \gset
select (pg_temp.nl('Far away restroom', 72.4, 71.4))->>'submission_id' as s3 \gset
select pg_temp.fails($q$select pg_temp.nl('Fourth restroom', 71.6, 71.6)$q$, '54000');            -- 3 per hour
-- Corrections to an existing restroom (no GPS rule).
select public.submit_location_edit(:'la', '{"fee_required":false,"opening_hours":"Mo-Su 06:00-22:00"}', true) as s4 \gset
select pg_temp.fails(format('select public.submit_location_edit(%L, ''{"fee_required":true}'', true)', :'la'), '22023');   -- one open correction per restroom
select pg_temp.fails(format('select public.submit_location_edit(%L, ''{}'', true)', :'la'), '22023');
select pg_temp.fails(format('select public.submit_location_edit(%L, ''{"fee_required":true}'', false)', :'lb'), '22023');
select pg_temp.fails(format('select public.submit_location_edit(%L, ''{"fee_required":true}'', true)', :'lg'), '22023');
select pg_temp.ok(public.submit_location_edit(:'lb', '{"fee_required":true}', true) is not null, 'a legitimate correction is accepted');
-- Reports.
select public.submit_report(:'la', 'closed', 'Locked at 3pm');
select public.submit_report(:'la', 'closed', 'Locked at 3pm');   -- duplicate open report = no-op
select pg_temp.fails(format('select public.submit_report(%L, ''bogus'')', :'la'), '22023');
select pg_temp.fails(format('select public.submit_report(%L, ''closed'', ''https://x.example'')', :'la'), '22023');
select pg_temp.fails(format('select public.submit_report(%L, ''closed'')', :'lg'), '22023');
select public.submit_report(:'lb', 'private_property', null);
select pg_temp.as_user(:'ub');
-- Another person reporting the SAME pending place gets their own raw proposal (nothing is merged or hidden).
select (pg_temp.nl('Library Restroom', 71.30005, 71.3))->>'submission_id' as s7 \gset
select pg_temp.ok((select count(*) = 1 from public.list_my_submissions()), 'second reporter has their own queue item');
select pg_temp.ok(not ((pg_temp.nl('Library Restroom', 71.30005, 71.3)) ? 'coalesced'), 'there is no coalesced outcome any more');
-- Hidden candidate (ACC candidate G) within 25 m: accepted and flagged, never revealed.
select (pg_temp.nl('Depot restroom', 71.00605, 71))->>'submission_id' as s5 \gset
select public.submit_location_edit(:'la', '{"latitude":72.0,"longitude":71.0}', true) as s6 \gset
reset role;

-- ------------------------------------------------ nearby proposals are accepted and privately flagged (account D)
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d4', 'd@test.invalid');
\set ud '00000000-0000-0000-0000-0000000000d4'
set role authenticated;
select pg_temp.as_user(:'ud');
-- Within 25 m of a public restroom, and 100 m with the same name: accepted (distinct units can share a place), flagged.
select pg_temp.nl('Anything', 71.00005, 71)->>'submission_id' as d1 \gset
select pg_temp.nl('ACC Verified A', 71.0008, 71)->>'submission_id' as d2 \gset
select pg_temp.ok((select count(*) = 2 from public.list_my_submissions()), 'near-listed proposals are stored, not rejected');
-- The client contract carries no neighbour information at all.
select pg_temp.ok((select array(select jsonb_object_keys(pg_temp.nl('Anything', 71.00005, 71))) = array['submission_id']), 'response exposes only the id: no retry, duplicate or neighbour hints');
select pg_temp.ok((pg_temp.nl('Anything', 71.00005, 71))->>'submission_id' = :'d1', 'an exact retry returns the same item');
select pg_temp.ok((select count(*) = 2 from public.list_my_submissions()), 'exact retries create no extra queue items');
select pg_temp.ok((select not (to_jsonb(s) ?| array['flags', 'possible_duplicate_of', 'duplicate_submission_ids']) from public.list_my_submissions() s limit 1), 'my-submissions never returns private flags');
reset role;
delete from public.action_log where action = 'new_restroom_hour';
set role authenticated;
select pg_temp.as_user(:'ud');
-- Two distinct restrooms a few metres apart by the same person (mall units): both kept, second flags the first.
select pg_temp.nl('Mall restroom', 71.9, 71.9, 10, true, null, '{"gender_neutral":true}')->>'submission_id' as d3 \gset
select pg_temp.nl('Mall restroom', 71.90005, 71.9, 10, true, null, '{"wheelchair_accessible":true}')->>'submission_id' as d4 \gset
select pg_temp.ok(:'d3' <> :'d4', 'distinct nearby proposals from one person are separate');
-- Exact retry (identical payload, fix, accuracy and note within 10 min) is the same request: same id, no quota.
-- Anything different, even only the note, is its own proposal (two real units get separate fixes).
select (public.submit_location(jsonb_build_object('name', 'Mall restroom', 'wheelchair_accessible', true), 71.90005, 71.9, 10, true, null))->>'submission_id' as d4b \gset
select (public.submit_location(jsonb_build_object('name', 'Mall restroom', 'wheelchair_accessible', true), 71.90005, 71.9, 10, true, 'second stall room'))->>'submission_id' as d4c \gset
select pg_temp.ok(:'d4b' = :'d4', 'an identical repeat from the same user is the same proposal');
select pg_temp.ok(:'d4c' <> :'d4', 'a changed repeat from the same user is a separate proposal');
reset role;
select pg_temp.ok((select possible_duplicate_of = :'la'::uuid and 'near_listed_restroom' = any (flags) from public.submissions where id = :'d1'::uuid), 'within 25 m of a public restroom: duplicate candidate recorded privately');
select pg_temp.ok((select possible_duplicate_of in (:'la'::uuid, :'lb'::uuid) and 'near_listed_restroom' = any (flags) from public.submissions where id = :'d2'::uuid), 'same name within 100 m: nearest listed restroom recorded privately as the duplicate candidate');
select pg_temp.ok((select 'near_own_pending' = any (flags) and duplicate_submission_ids = array[:'d3'::uuid] and possible_duplicate_of is null from public.submissions where id = :'d4'::uuid), 'second unit flags the first, no listed duplicate');
select pg_temp.ok((select count(*) = 5 and count(distinct id) = 5 from public.submissions where user_id = :'ud'::uuid), 'every distinct call stored its own raw proposal; exact retries none');
select pg_temp.ok((select count(*) = 3 from public.action_log where user_id = :'ud'::uuid and action = 'new_restroom_hour'), 'exact retries consumed no hourly quota');
select pg_temp.ok((select count(distinct proposed) = 1 and count(note) = 1 from public.submissions where id in (:'d4'::uuid, :'d4c'::uuid)),
  'the separate pair has equal payload and differs only in the note');
select pg_temp.ok((select duplicate_submission_ids = array[:'d3'::uuid, :'d4'::uuid] and 'near_own_pending' = any (flags) from public.submissions where id = :'d4c'::uuid), 'the later proposal flags both earlier nearby ones');
set role authenticated;
select pg_temp.as_user(:'ud');
select pg_temp.fails($q$select pg_temp.nl('Mall restroom', 71.90005, 71.9, 10, true, null, '{"baby_changing":true}')$q$, '53400');   -- pending cap unchanged
-- Withdrawing one of the pair leaves the other.
select public.withdraw_my_submission(:'d4c');
reset role;
select pg_temp.ok((select count(*) = 1 from public.submissions where id = :'d4'::uuid) and (select count(*) = 0 from public.submissions where id = :'d4c'::uuid), 'withdrawing one nearby proposal does not remove the other');
delete from auth.users where id = :'ud'::uuid;

select pg_temp.ok((select flags = '{new_account}' from public.submissions where id = :'s1'::uuid), 'first submission flagged only new_account');
select pg_temp.ok((select 'low_accuracy' = any (flags) from public.submissions where id = :'s2'::uuid), 'imprecise fix flagged');
select pg_temp.ok((select 'implausible_travel' = any (flags) from public.submissions where id = :'s3'::uuid), 'impossible travel flagged');
select pg_temp.ok((select 'near_hidden_candidate' = any (flags) from public.submissions where id = :'s5'::uuid), 'hidden-candidate proximity flagged');
select pg_temp.ok((select 'moved_far' = any (flags) from public.submissions where id = :'s6'::uuid), 'long pin move on a correction flagged, not blocked');
select pg_temp.ok((select count(*) = 2 from public.submissions where kind = 'new_location' and proposed->>'latitude' like '71.3%'), 'both raw proposals for the shared place are stored');
select pg_temp.ok((select 'near_pending_submission' = any (flags) and duplicate_submission_ids = array[:'s1'::uuid] from public.submissions where id = :'s7'::uuid),
  'the later proposal is privately flagged against the earlier one');
select pg_temp.ok((select not ('near_pending_submission' = any (flags)) and duplicate_submission_ids = '{}' from public.submissions where id = :'s1'::uuid),
  'the earlier proposal is left untouched');
select pg_temp.ok((to_regclass('public.submission_supporters') is not null and (select count(*) = 0 from public.submission_supporters)),
  'historical supporter table is preserved and the new submission path never writes to it');
select pg_temp.ok((select capture_accuracy_m = 10 and attested_public and status = 'pending' from public.submissions where id = :'s1'::uuid), 'stored pending with accuracy and attestation');
select pg_temp.ok((select (proposed->>'latitude')::float8 = 71.3 and (proposed->>'longitude')::float8 = 71.3 from public.submissions where id = :'s1'::uuid), 'coordinates are exactly the device fix');
select pg_temp.ok((select count(*) = 2 from public.reports), 'duplicate open report deduplicated');
select pg_temp.ok((select not (proposed ? 'status') from public.submissions where id = :'s1'::uuid), 'only whitelisted fields stored');
-- No contributor location trail anywhere except the submission's own point.
select pg_temp.ok((not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name in ('action_log', 'profiles', 'reports') and column_name ~ '(lat|lng|lon|position|geo)')), 'no location columns outside submissions/locations/checkins-free tables');
-- Pending submissions are never public: location table and public API unchanged.
select count(*) as locs_after from public.locations \gset
select count(*) as pub_after from public.nearby_locations(71.0, 71.0, 50000, 100) \gset
select pg_temp.ok((:locs_before = :locs_after), 'submissions never write to locations');
select pg_temp.ok((:pub_before = :pub_after), 'submissions never appear in the public API');
-- Public discovery still works for anonymous callers.
set role anon;
select pg_temp.ok((select count(*) >= 1 from public.nearby_locations(71.0, 71.0, 50000, 100)), 'anonymous discovery still works');
reset role;
-- Admin / manual coordinate workflows are untouched: service_role can place and move records directly.
set role service_role;
insert into public.locations (name, latitude, longitude, status) values ('ACC admin placed', 71.9, 71.9, 'candidate');
update public.locations set latitude = 71.0055, longitude = 71.0001 where id = :'lf'::uuid;
select pg_temp.ok((select latitude = 71.0055 and manually_edited_at is not null from public.locations where id = :'lf'::uuid), 'admin coordinate edit works and is marked manual');
reset role;
select pg_temp.ok((select count(*) = 1 from public.locations where name = 'ACC admin placed'), 'admin can place a location at arbitrary coordinates');
update public.locations set latitude = 71.0050, longitude = 71 where id = :'lf'::uuid;
delete from public.locations where name = 'ACC admin placed';

-- Repeat-rejection pause (account C): 5 rejected, none approved -> paused; approvals lift it.
insert into public.submissions (user_id, kind, proposed, attested_public, status)
  select :'uc'::uuid, 'new_location', '{"name":"junk","latitude":60,"longitude":60}', true, 'rejected' from generate_series(1, 5);
set role authenticated;
select pg_temp.as_user(:'uc');
select pg_temp.fails($q$select pg_temp.nl('Honest restroom', 71.7, 71.7)$q$, '54000');
reset role;
insert into public.submissions (user_id, kind, proposed, attested_public, status)
  select :'uc'::uuid, 'new_location', '{"name":"good","latitude":61,"longitude":61}', true, 'approved' from generate_series(1, 2);
set role authenticated;
select pg_temp.ok((pg_temp.nl('Honest restroom', 71.7, 71.7)) ? 'submission_id', 'approvals lift the pause');
reset role;
delete from auth.users where id = :'uc'::uuid;
-- Decided submissions survive the deletion, anonymised (Phase 3A); purge them as the superuser so later totals stay simple.
select pg_temp.ok((select count(*) = 7 and bool_and(user_id is null) from public.submissions where proposed->>'name' in ('junk', 'good')), 'decided submissions are kept with the submitter severed');
set session_replication_role = replica;
delete from public.submissions where proposed->>'name' in ('junk', 'good');
reset session_replication_role;

-- Isolation + withdrawal.
set role authenticated;
select pg_temp.as_user(:'ub');
select public.withdraw_my_submission(:'s1');
reset role;
select pg_temp.ok((select count(*) = 1 from public.submissions where id = :'s1'::uuid), 'B cannot withdraw A''s submission');
-- B withdraws their own separate proposal for the same place; A's is untouched.
set role authenticated;
select pg_temp.as_user(:'ub');
select public.withdraw_my_submission(:'s7');
reset role;
select pg_temp.ok((select count(*) = 0 from public.submissions where id = :'s7'::uuid) and (select count(*) = 1 from public.submissions where id = :'s1'::uuid and status = 'pending'),
  'withdrawing one separate proposal for a shared place leaves the other');
set role authenticated;
select pg_temp.as_user(:'ua');
select public.withdraw_my_submission(:'s2');
reset role;
-- Daily and pending caps (hourly log cleared to isolate each).
delete from public.action_log where action = 'new_restroom_hour';
delete from public.action_log where action = 'submission';
insert into public.submissions (user_id, kind, proposed, attested_public)
  select :'ua'::uuid, 'new_location', jsonb_build_object('name', 'filler' || g, 'latitude', 10 + g, 'longitude', 10), true from generate_series(1, 5) g;
set role authenticated;
select pg_temp.as_user(:'ua');
select pg_temp.fails($q$select pg_temp.nl('Over cap', 71.8, 71.8)$q$, '53400');                  -- pending cap
reset role;
delete from public.submissions where proposed->>'name' like 'filler%';
set role authenticated;
select pg_temp.as_user(:'ua');
select pg_temp.nl('Daily one', 71.81, 71.81);
select pg_temp.nl('Daily two', 71.82, 71.82);
reset role;
delete from public.action_log where action = 'new_restroom_hour';
insert into public.action_log (user_id, action) select :'ua'::uuid, 'submission' from generate_series(1, 3);   -- 5 so far today
set role authenticated;
select pg_temp.as_user(:'ua');
select pg_temp.fails($q$select pg_temp.nl('Daily over', 71.83, 71.83)$q$, '54000');
reset role;

-- ------------------------------------------------ rate limiter is per user and action
do $$ declare i int; begin
  for i in 1..3 loop perform public.enforce_rate_limit('00000000-0000-0000-0000-0000000000b2', 'unit', 3, interval '1 hour'); end loop;
  begin perform public.enforce_rate_limit('00000000-0000-0000-0000-0000000000b2', 'unit', 3, interval '1 hour');
    raise exception 'limit not enforced'; exception when sqlstate '54000' then null; end;
  perform public.enforce_rate_limit('00000000-0000-0000-0000-0000000000a1', 'unit', 3, interval '1 hour');
  perform public.enforce_rate_limit('00000000-0000-0000-0000-0000000000b2', 'other', 3, interval '1 hour');
end $$;

-- ------------------------------------------------ account deletion
set role authenticated;
select pg_temp.as_user(:'ub');
select pg_temp.fails($q$select public.delete_my_account('delete')$q$, '22023');
select pg_temp.fails($q$select public.delete_my_account(null)$q$, '22023');
select public.submit_review(:'lc', 1, 'plain', null);
reset role;
do $$ begin assert exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000b2'), 'wrong confirmation deletes nothing'; end $$;
select count(*) as reports_a_before from public.reports where user_id = :'ua' \gset
set role authenticated;
select pg_temp.as_user(:'ub');
select public.delete_my_account('DELETE');
reset role;
select pg_temp.ok((not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000b2')), 'user removed');
select pg_temp.ok((not exists (select 1 from public.profiles where user_id = '00000000-0000-0000-0000-0000000000b2')), 'profile removed');
select pg_temp.ok((not exists (select 1 from public.favorites where user_id = '00000000-0000-0000-0000-0000000000b2')), 'favorites removed');
select pg_temp.ok((not exists (select 1 from public.reviews where user_id = '00000000-0000-0000-0000-0000000000b2')), 'reviews removed');
select pg_temp.ok((not exists (select 1 from public.action_log where user_id = '00000000-0000-0000-0000-0000000000b2')), 'action log removed');
select pg_temp.ok((not exists (select 1 from public.submissions where user_id = '00000000-0000-0000-0000-0000000000b2')), 'deleted user''s proposals removed');
select pg_temp.ok((exists (select 1 from public.submissions where id = :'s1'::uuid)), 'the other user''s nearby pending proposal survives');
select pg_temp.ok(((select rating_count = 0 and average_rating is null from public.locations where name = 'ACC verified C')), 'aggregate recomputed after deletion');
select pg_temp.ok((exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a1')), 'other users untouched');
select pg_temp.ok(((select count(*) = :reports_a_before from public.reports where user_id = '00000000-0000-0000-0000-0000000000a1')), 'other users'' data untouched');
select pg_temp.ok(((select count(*) = :locs_before from public.locations)), 'locations are never deleted by account deletion');
-- Contributions of a deleted user leave with them (pending submissions are removed, not orphaned).
set role authenticated;
select pg_temp.as_user(:'ua');
select public.delete_my_account('DELETE');
reset role;
select pg_temp.ok((not exists (select 1 from public.submissions where user_id is not null)) and (select count(*) = 0 from public.reports) and (select count(*) = 0 from public.checkins),
  'nothing linked to a deleted person remains (submissions, reports, check-ins)');
-- Superuser-deleted accounts (test shortcuts above) leave anonymised pending rows; clear them so other suites start clean.
set session_replication_role = replica;
delete from public.submissions;
reset session_replication_role;
delete from public.locations where name like 'ACC %';
