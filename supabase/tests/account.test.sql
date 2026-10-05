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
-- Already listed: within 25 m of a public restroom, or within 100 m with the same name.
select pg_temp.fails($q$select pg_temp.nl('Anything', 71.00005, 71)$q$, '22023');
select pg_temp.fails($q$select pg_temp.nl('ACC Verified A', 71.0008, 71)$q$, '22023');
do $$ begin
  assert (select count(*) = 0 from public.list_my_submissions()), 'rejected submissions leave no rows';
end $$;
select (pg_temp.nl('Library restroom', 71.3, 71.3, 10, true, 'By the entrance', '{"wheelchair_accessible":true}'))->>'submission_id' as s1 \gset
select pg_temp.fails($q$select pg_temp.nl('Library again', 71.30005, 71.3)$q$, '22023');          -- same person, same place
select pg_temp.ok((select count(*) = 1 from public.list_my_submissions()), 'one queue item for the place');
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
-- Another person reporting the SAME pending place adds support instead of a second queue item.
select pg_temp.ok((pg_temp.nl('Library Restroom', 71.30005, 71.3))->>'coalesced' = 'true', 'second reporter coalesces');
select pg_temp.fails($q$select pg_temp.nl('Library Restroom', 71.30005, 71.3)$q$, '22023');     -- and cannot pile on again
select pg_temp.ok((select count(*) = 0 from public.list_my_submissions()), 'supporter creates no queue item of their own');
-- Hidden candidate (ACC candidate G) within 25 m: accepted and flagged, never revealed.
select (pg_temp.nl('Depot restroom', 71.00605, 71))->>'submission_id' as s5 \gset
select public.submit_location_edit(:'la', '{"latitude":72.0,"longitude":71.0}', true) as s6 \gset
reset role;

select pg_temp.ok((select flags = '{new_account}' from public.submissions where id = :'s1'::uuid), 'first submission flagged only new_account');
select pg_temp.ok((select 'low_accuracy' = any (flags) from public.submissions where id = :'s2'::uuid), 'imprecise fix flagged');
select pg_temp.ok((select 'implausible_travel' = any (flags) from public.submissions where id = :'s3'::uuid), 'impossible travel flagged');
select pg_temp.ok((select 'near_hidden_candidate' = any (flags) from public.submissions where id = :'s5'::uuid), 'hidden-candidate proximity flagged');
select pg_temp.ok((select 'moved_far' = any (flags) from public.submissions where id = :'s6'::uuid), 'long pin move on a correction flagged, not blocked');
select pg_temp.ok((select count(*) = 1 from public.submissions where kind = 'new_location' and proposed->>'latitude' like '71.3%'), 'exactly one moderation item for the shared place');
select pg_temp.ok((select count(*) = 1 from public.submission_supporters where submission_id = :'s1'::uuid), 'supporter recorded');
select pg_temp.ok((select capture_accuracy_m = 10 and attested_public and status = 'pending' from public.submissions where id = :'s1'::uuid), 'stored pending with accuracy and attestation');
select pg_temp.ok((select (proposed->>'latitude')::float8 = 71.3 and (proposed->>'longitude')::float8 = 71.3 from public.submissions where id = :'s1'::uuid), 'coordinates are exactly the device fix');
select pg_temp.ok((select count(*) = 2 from public.reports), 'duplicate open report deduplicated');
select pg_temp.ok((select not (proposed ? 'status') from public.submissions where id = :'s1'::uuid), 'only whitelisted fields stored');
-- No contributor location trail anywhere except the submission's own point.
select pg_temp.ok((not exists (select 1 from information_schema.columns where table_schema = 'public'
  and table_name in ('action_log', 'profiles', 'submission_supporters', 'reports') and column_name ~ '(lat|lng|lon|position|geo)')), 'no location columns outside submissions/locations/checkins-free tables');
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
select pg_temp.ok((pg_temp.nl('Honest restroom', 71.7, 71.7))->>'coalesced' = 'false', 'approvals lift the pause');
reset role;
delete from auth.users where id = :'uc'::uuid;

-- Isolation + withdrawal.
set role authenticated;
select pg_temp.as_user(:'ub');
select public.withdraw_my_submission(:'s1');
reset role;
select pg_temp.ok((select count(*) = 1 from public.submissions where id = :'s1'::uuid), 'B cannot withdraw A''s submission');
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
select pg_temp.ok((not exists (select 1 from public.submission_supporters where user_id = '00000000-0000-0000-0000-0000000000b2')), 'supporter rows removed');
select pg_temp.ok((exists (select 1 from public.submissions where id = :'s1'::uuid)), 'the shared pending item survives a supporter leaving');
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
