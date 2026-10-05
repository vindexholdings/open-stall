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
    'delete_my_review(uuid)', 'check_in(uuid,double precision,double precision)', 'submit_location(jsonb,boolean,text)',
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
  -- Signed-in users still cannot reach import/review (service) functions.
  assert not has_function_privilege('authenticated', 'public.apply_location_review(uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,text,boolean,date)', 'execute'),
    'authenticated must not run validator functions';
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

-- ------------------------------------------------ submissions
select count(*) as pub_before from public.nearby_locations(71.0, 71.0, 50000, 100) \gset
set role authenticated;
select pg_temp.as_user(:'ua');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2,"longitude":71.2}', false)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2}', true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2,"longitude":71.2,"status":"verified"}', true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2,"longitude":71.2,"average_rating":5}', true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":171.2,"longitude":71.2}', true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2,"longitude":71.2,"fee_required":"yes"}', true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Call 307-555-0100 now","latitude":71.2,"longitude":71.2}', true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2,"longitude":71.2}', true, 'see http://spam.example')$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2,"longitude":71.2}', true, 'mail me a@b.co')$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"My house bathroom","latitude":71.2,"longitude":71.2}', true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2,"longitude":71.2,"access_location":"private residence, ring bell"}', true)$q$, '22023');
select pg_temp.fails($q$select public.submit_location('{"name":"Park restroom","latitude":71.2,"longitude":71.2}', true, 'it is at my neighbor''s place')$q$, '22023');
select pg_temp.fails($q$select public.submit_location('[1,2]', true)$q$, '22023');
select pg_temp.fails(format('select public.submit_location_edit(%L, ''{}'', true)', :'la'), '22023');           -- no changes
select pg_temp.fails(format('select public.submit_location_edit(%L, ''{"fee_required":true}'', false)', :'la'), '22023');
select pg_temp.fails(format('select public.submit_location_edit(%L, ''{"fee_required":true}'', true)', :'lg'), '22023');
do $$ begin assert (select count(*) = 0 from public.list_my_submissions()), 'rejected submissions leave no rows'; end $$;
-- valid ones: first flagged as a possible duplicate (same name, ~11 m from ACC verified A)
select public.submit_location('{"name":"ACC Verified A","latitude":71.0001,"longitude":71.0}', true, 'Next to the park entrance') as s1 \gset
select public.submit_location('{"name":"Library restroom","latitude":71.3,"longitude":71.3,"wheelchair_accessible":true}', true) as s2 \gset
select public.submit_location_edit(:'la', '{"fee_required":false,"opening_hours":"Mo-Su 06:00-22:00"}', true) as s3 \gset
select public.submit_report(:'la', 'closed', 'Locked at 3pm');
select public.submit_report(:'la', 'closed', 'Locked at 3pm');   -- duplicate open report = no-op
select pg_temp.fails(format('select public.submit_report(%L, ''bogus'')', :'la'), '22023');
select pg_temp.fails(format('select public.submit_report(%L, ''closed'', ''https://x.example'')', :'la'), '22023');
select pg_temp.fails(format('select public.submit_report(%L, ''closed'')', :'lg'), '22023');
select public.submit_report(:'lb', 'private_property', null);
reset role;
select pg_temp.ok(((select possible_duplicate_of = (select id from public.locations where name = 'ACC verified A') from public.submissions where id = :'s1'::uuid)), 'duplicate flagged, not merged');
select pg_temp.ok(((select count(*) = 3 from public.submissions)), 'three submissions stored');
select pg_temp.ok(((select count(*) = 2 from public.reports)), 'duplicate open report deduplicated');
select pg_temp.ok(((select proposed ? 'status' = false and attested_public from public.submissions where id = :'s1'::uuid)), 'only whitelisted fields stored');
-- Pending submissions are never public: location table and public API unchanged.
select count(*) as locs_after from public.locations \gset
select count(*) as pub_after from public.nearby_locations(71.0, 71.0, 50000, 100) \gset
select pg_temp.ok((:locs_before = :locs_after), 'submissions never write to locations');
select pg_temp.ok((:pub_before = :pub_after), 'submissions never appear in the public API');
-- Isolation + limits.
set role authenticated;
select pg_temp.as_user(:'ub');
do $$ begin assert (select count(*) = 0 from public.list_my_submissions()), 'B sees none of A''s submissions'; end $$;
select public.withdraw_my_submission(:'s2');
reset role;
do $$ begin assert (select count(*) = 3 from public.submissions), 'B cannot withdraw A''s submission'; end $$;
set role authenticated;
select pg_temp.as_user(:'ua');
do $$ begin assert (select count(*) = 3 from public.list_my_submissions()), 'A lists own submissions'; end $$;
select public.withdraw_my_submission(:'s2');
select public.submit_location('{"name":"Rest stop 1","latitude":71.4,"longitude":71.4}', true);
select public.submit_location('{"name":"Rest stop 2","latitude":71.5,"longitude":71.5}', true);
select pg_temp.fails($q$select public.submit_location('{"name":"Rest stop 3","latitude":71.7,"longitude":71.7}', true)$q$, '54000'); -- 5/day
reset role;
-- Pending cap: 10 outstanding (rate limit cleared to isolate the cap).
delete from public.action_log where action = 'submission';
insert into public.submissions (user_id, kind, proposed, attested_public)
  select :'ua'::uuid, 'new_location', '{"name":"filler","latitude":1,"longitude":1}', true from generate_series(1, 6);
set role authenticated;
select pg_temp.as_user(:'ua');
select pg_temp.fails($q$select public.submit_location('{"name":"Over cap","latitude":71.8,"longitude":71.8}', true)$q$, '53400');
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
select pg_temp.ok(((select rating_count = 0 and average_rating is null from public.locations where name = 'ACC verified C')), 'aggregate recomputed after deletion');
select pg_temp.ok((exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000a1')), 'other users untouched');
select pg_temp.ok(((select count(*) = :reports_a_before from public.reports where user_id = '00000000-0000-0000-0000-0000000000a1')), 'other users'' data untouched');
select pg_temp.ok(((select count(*) = :locs_before from public.locations)), 'locations are never deleted by account deletion');
-- Contributions of a deleted user leave with them (pending submissions are removed, not orphaned).
set role authenticated;
select pg_temp.as_user(:'ua');
select public.delete_my_account('DELETE');
reset role;
do $$ begin
  assert (select count(*) = 0 from public.submissions) and (select count(*) = 0 from public.reports) and (select count(*) = 0 from public.checkins),
    'submissions, reports and check-ins removed with the account';
end $$;
delete from public.locations where name like 'ACC %';
