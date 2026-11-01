-- Authenticated seeded-location review: database-boundary authorization (signed-out / non-admin / AAL1 /
-- disabled admin / anon), real-admin reviewer provenance, legacy evidence untouched, unchanged verification
-- semantics and community-only public ratings, append-only audit, and self-adjudication on contributed restrooms.
\set ON_ERROR_STOP on

create function pg_temp.ok(c boolean, msg text) returns void language plpgsql as $$ begin if c is not true then raise exception 'ASSERT FAILED: %', msg; end if; end $$;
create function pg_temp.login(u uuid, aal text default 'aal2', extra jsonb default '{}') returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false),
         set_config('request.jwt.claims', (jsonb_build_object('sub', u, 'aal', aal) || extra)::text, false)
$$;
create function pg_temp.fails(q text, code text) returns void language plpgsql as $$
begin
  execute q;
  raise exception 'expected failure % but succeeded: %', code, q;
exception when others then
  if sqlstate = 'P0001' and sqlerrm like 'expected failure%' then raise; end if;
  if sqlstate <> code then raise exception 'expected % got % (%): %', code, sqlstate, sqlerrm, q; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005a1', 'sr-adm1@test.invalid'), ('00000000-0000-0000-0000-0000000005a2', 'sr-adm2@test.invalid'),
  ('00000000-0000-0000-0000-0000000005a3', 'sr-disabled@test.invalid'), ('00000000-0000-0000-0000-0000000005b1', 'sr-user@test.invalid');
\set adm1 '00000000-0000-0000-0000-0000000005a1'
\set adm2 '00000000-0000-0000-0000-0000000005a2'
\set adm3 '00000000-0000-0000-0000-0000000005a3'
\set usr '00000000-0000-0000-0000-0000000005b1'
insert into public.admin_users (user_id) values (:'adm1'), (:'adm2');
insert into public.admin_users (user_id, disabled_at) values (:'adm3', now());

insert into public.locations (name, latitude, longitude, status, restroom_evidence, purchase_required)
  values ('SR hidden candidate', 74.0, 74.0, 'candidate', 'inferred', false) returning id as lc \gset
insert into public.locations (name, latitude, longitude, status, restroom_evidence, purchase_required)
  values ('SR unverified', 74.1, 74.1, 'unverified', 'explicit', false) returning id as lu \gset
insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
  values ('SR verified', 74.2, 74.2, 'verified', 'explicit', true, now()) returning id as lv \gset
insert into public.locations (name, latitude, longitude, status, restroom_evidence)
  values ('SR closed', 74.3, 74.3, 'closed', 'inferred') returning id as lx \gset
insert into public.locations (name, latitude, longitude, status, restroom_evidence)
  values ('SR candidate two', 74.4, 74.4, 'candidate', 'inferred') returning id as lc2 \gset
insert into public.location_sources (location_id, source, source_reference, is_primary, license, attribution, source_latitude, source_longitude, evidence)
  values (:'lc', 'osm', 'node/7770001', true, 'ODbL', 'OpenStreetMap contributors', 74.0, 74.0, 'inferred');

-- Legacy evidence written by the old local path, with its stable local identity.
set role service_role;
select public.apply_location_review_v2(:'lu', 'Legacy alias', 'local-admin', 'exists', false, null, '{"hot_water":true,"restroom_type":"women","rating":5}'::jsonb) as legacy \gset
reset role;
select count(*) as legacy_rows from public.location_reviews where location_id = :'lu' \gset
select pg_temp.ok((select reviewer_identity = 'local-admin' from public.location_reviews where id = (:'legacy'::jsonb->>'review_id')::uuid), 'legacy identity');

-- A community rating on a verified place: the public aggregate must never move because of admin reviews.
set role authenticated;
select pg_temp.login(:'usr', 'aal1');
select public.submit_review(:'lv', 4, 'plain', array['clean']);
reset role;
select pg_temp.ok((select rating_count = 1 and average_rating = 4 from public.locations where id = :'lv'), 'community rating recorded');
select count(*) as log_before from public.moderation_log \gset
select count(*) as rev_before from public.location_reviews \gset

-- ------------------------------------------------ privileges
do $$ declare f text; begin
  foreach f in array array['admin_location_counts()', 'admin_list_locations(text,integer)', 'admin_get_location(uuid)',
                          'admin_apply_location_review(uuid,text,text,boolean,date,jsonb)'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), 'anon must not execute ' || f;
    assert has_function_privilege('authenticated', 'public.' || f, 'execute'), 'authenticated may call ' || f || ' (it checks admin itself)';
  end loop;
  assert not has_function_privilege('anon', 'public.admin_location_json(uuid)', 'execute')
     and not has_function_privilege('authenticated', 'public.admin_location_json(uuid)', 'execute'), 'internal json builder is not client-callable';
  -- The privileged writers stay service_role-only (importer/manual tooling), never client roles.
  assert not has_function_privilege('authenticated', 'public.apply_location_review_v2(uuid,text,text,text,boolean,date,jsonb)', 'execute'), 'v2 writer not client-callable';
  assert not has_function_privilege('anon', 'public.apply_location_review(uuid,text,text,text,boolean,boolean,boolean,boolean,boolean,text,boolean,date,boolean,boolean,boolean)', 'execute'), 'legacy writer not anon-callable';
end $$;

-- ------------------------------------------------ authorization at the database boundary
create function pg_temp.deny_all(code text) returns void language plpgsql as $$
begin
  perform pg_temp.fails('select public.admin_location_counts()', code);
  perform pg_temp.fails($q$select public.admin_list_locations('candidate')$q$, code);
  perform pg_temp.fails(format('select public.admin_get_location(%L)', current_setting('sr.lc')), code);
  perform pg_temp.fails(format($q$select public.admin_apply_location_review(%L, 'X', 'exists', false, null, '{}'::jsonb)$q$, current_setting('sr.lc')), code);
end $$;
select set_config('sr.lc', :'lc', false);

set role authenticated;
-- Non-admin, even with MFA and admin-looking metadata/claims.
select pg_temp.login(:'usr', 'aal2', '{"role":"admin","user_metadata":{"is_admin":true,"role":"admin"},"app_metadata":{"role":"admin"}}');
select pg_temp.deny_all('42501');
-- Listed admin without MFA.
select pg_temp.login(:'adm1', 'aal1');
select pg_temp.deny_all('42501');
select pg_temp.login(:'adm1', '');
select pg_temp.deny_all('42501');
-- Disabled admin, even with MFA.
select pg_temp.login(:'adm3', 'aal2');
select pg_temp.deny_all('42501');
-- Signed out.
select pg_temp.login(null);
select pg_temp.deny_all('28000');
reset role;
set role anon;
select pg_temp.deny_all('42501');
reset role;
select pg_temp.ok((select count(*) = :log_before from public.moderation_log) and (select count(*) = :rev_before from public.location_reviews), 'refused callers wrote nothing');

-- ------------------------------------------------ reads (admin + MFA)
set role authenticated;
select pg_temp.login(:'adm1', 'aal2');
select pg_temp.ok((public.admin_location_counts()->>'candidate')::int >= 2 and (public.admin_location_counts()->>'closed')::int >= 1, 'counts include hidden candidates and closed');
select pg_temp.ok((select bool_or(e->>'id' = :'lc') from jsonb_array_elements(public.admin_list_locations('candidate')) e), 'hidden candidate is listed for admins');
select pg_temp.ok((select e->'location_sources'->0->>'source' = 'osm' and e->'location_sources'->0->>'attribution' = 'OpenStreetMap contributors'
  from jsonb_array_elements(public.admin_list_locations('candidate')) e where e->>'id' = :'lc'), 'sources and attribution included');
select pg_temp.ok((select jsonb_array_length(e->'location_reviews') = :legacy_rows and e->'location_reviews'->0->>'reviewer_identity' = 'local-admin'
  from jsonb_array_elements(public.admin_list_locations('unverified')) e where e->>'id' = :'lu'), 'review history and legacy identity included');
select pg_temp.fails($q$select public.admin_list_locations('pending')$q$, '22023');
select pg_temp.fails($q$select public.admin_list_locations(null)$q$, '22023');
select pg_temp.ok(public.admin_get_location(gen_random_uuid()) is null, 'unknown location -> null');
select pg_temp.ok(public.admin_get_location(:'lu')->>'name' = 'SR unverified', 'single location read');
select pg_temp.ok((select jsonb_array_length(public.admin_list_locations('candidate', 1)) = 1), 'limit honoured');
reset role;

-- ------------------------------------------------ writes: real identity, unchanged semantics, audit
set role authenticated;
select pg_temp.login(:'adm1', 'aal2');
select public.admin_apply_location_review(:'lc', 'Jake alias', 'exists', true, current_date,
  '{"hot_water":true,"customers_only":false,"restroom_type":"all_gender","rating":2,"cleanliness_score":3,"public_comment":"Fine.","conditions":{"floor":"clean"},"notes":"private"}'::jsonb) as r1 \gset
reset role;
select pg_temp.ok((select status = 'verified' and restroom_verified and rating_count = 0 and average_rating is null from public.locations where id = :'lc'),
  'verified, and an admin rating never becomes public');
select pg_temp.ok((select reviewer_identity = 'admin:' || :'adm1' and reviewer_kind = 'admin' and reviewer = 'Jake alias' and restroom_type = 'all_gender'
  and conditions->>'floor' = 'clean' and rating = 2 and notes = 'private' from public.location_reviews where id = (:'r1'::jsonb->>'review_id')::uuid),
  'real admin id recorded as reviewer identity; visit details preserved');
select pg_temp.ok((select count(*) = 1 from public.location_sources where location_id = :'lc' and source = 'open_stall')
  and (select count(*) = 1 from public.location_sources where location_id = :'lc' and source = 'osm' and is_primary), 'first-party source added; OSM source untouched');
select pg_temp.ok((select actor_id = :'adm1'::uuid and target_type = 'location' and target_id = :'lc'::uuid and detail->>'resulting_status' = 'verified'
  from public.moderation_log where action = 'seed_review' order by id desc limit 1), 'audit row names the real admin');
-- Unverified (exists, not personally confirmed) and not-exists keep their semantics.
set role authenticated;
select pg_temp.login(:'adm2', 'aal2');
select public.admin_apply_location_review(:'lc2', 'A', 'exists', false, null, '{}'::jsonb) as r2 \gset
select public.admin_apply_location_review(:'lx', 'A', 'not_exists', false, null, '{}'::jsonb) as r3 \gset
reset role;
select pg_temp.ok((:'r2'::jsonb->>'status') = 'unverified' and (:'r2'::jsonb->>'public')::boolean, 'exists but not confirmed -> Unverified, public');
select pg_temp.ok((:'r3'::jsonb->>'status') = 'closed' and not (:'r3'::jsonb->>'public')::boolean, 'not_exists -> closed, hidden');
-- Verified community place: an admin review leaves the community aggregate alone.
set role authenticated;
select pg_temp.login(:'adm1', 'aal2');
select public.admin_apply_location_review(:'lv', 'Jake alias', 'exists', true, current_date, '{"rating":1}'::jsonb);
reset role;
select pg_temp.ok((select rating_count = 1 and average_rating = 4 from public.locations where id = :'lv'), 'community-only public rating unchanged');
-- Legacy rows are untouched.
select pg_temp.ok((select count(*) = :legacy_rows and bool_and(reviewer_identity = 'local-admin') from public.location_reviews where location_id = :'lu'), 'legacy evidence preserved');

-- Invalid input is refused with nothing written (no review row, no audit row).
select count(*) as log_mid from public.moderation_log \gset
select count(*) as rev_mid from public.location_reviews \gset
set role authenticated;
select pg_temp.login(:'adm1', 'aal2');
select pg_temp.fails(format($q$select public.admin_apply_location_review(%L, 'A', 'exists', false, null, '{"rating":9}'::jsonb)$q$, :'lu'), '22023');
select pg_temp.fails(format($q$select public.admin_apply_location_review(%L, 'A', 'exists', true, null, '{}'::jsonb)$q$, :'lu'), '22023');
select pg_temp.fails($q$select public.admin_apply_location_review(gen_random_uuid(), 'A', 'exists', false, null, '{}'::jsonb)$q$, '22023');
select pg_temp.fails(format($q$select public.admin_apply_location_review(%L, 'A', 'exists', false, null, '{"surprise":true}'::jsonb)$q$, :'lu'), '22023');
reset role;
select pg_temp.ok((select count(*) = :log_mid from public.moderation_log) and (select count(*) = :rev_mid from public.location_reviews), 'refused reviews wrote nothing');

-- ------------------------------------------------ self-adjudication: not on a restroom the admin contributed
set role authenticated;
select pg_temp.login(:'adm2', 'aal2');
select (public.submit_location('{"name":"SR contributed by admin 2"}'::jsonb, 74.5, 74.5, 10, true, null)->>'submission_id')::uuid as sub_own \gset
select pg_temp.login(:'adm1', 'aal2');
select public.admin_decide_submission(:'sub_own', 'approve');
reset role;
select result_location_id as l_own from public.submissions where id = :'sub_own' \gset
select pg_temp.ok(:'l_own' <> '' and (select status = 'unverified' from public.locations where id = :'l_own'), 'approved contribution is Unverified');
select count(*) as rev_own from public.location_reviews where location_id = :'l_own' \gset
set role authenticated;
select pg_temp.login(:'adm2', 'aal2');
select pg_temp.fails(format($q$select public.admin_apply_location_review(%L, 'A', 'exists', true, current_date, '{}'::jsonb)$q$, :'l_own'), '42501');
select pg_temp.login(:'adm1', 'aal2');
select public.admin_apply_location_review(:'l_own', 'A', 'exists', true, current_date, '{}'::jsonb);
reset role;
select pg_temp.ok((select count(*) = :rev_own + 1 from public.location_reviews where location_id = :'l_own'), 'a different admin may review it; the contributor admin could not');
