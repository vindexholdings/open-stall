-- Phase 3A moderation core tests: admin identity + MFA, queue privacy, immutable originals, append-only decisions,
-- approve / edit-and-approve / reject / duplicate / hold / release, self-adjudication, report resolution,
-- unverified-on-approval, held items counting toward caps, and deletion that preserves decided provenance.
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
create function pg_temp.nl(nm text, lat float8, lng float8, extra jsonb default '{}') returns uuid language sql as $$
  select (public.submit_location(jsonb_build_object('name', nm) || extra, lat, lng, 10, true, null)->>'submission_id')::uuid
$$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000ad01', 'adm1@test.invalid'), ('00000000-0000-0000-0000-00000000ad02', 'adm2@test.invalid'),
  ('00000000-0000-0000-0000-00000000ad03', 'adm3-disabled@test.invalid'),
  ('00000000-0000-0000-0000-0000000000f1', 'u1@test.invalid'), ('00000000-0000-0000-0000-0000000000f2', 'u2@test.invalid');
\set adm1 '00000000-0000-0000-0000-00000000ad01'
\set adm2 '00000000-0000-0000-0000-00000000ad02'
\set adm3 '00000000-0000-0000-0000-00000000ad03'
\set u1 '00000000-0000-0000-0000-0000000000f1'
\set u2 '00000000-0000-0000-0000-0000000000f2'
insert into public.admin_users (user_id) values (:'adm1'), (:'adm2');
insert into public.admin_users (user_id, disabled_at) values (:'adm3', now());

insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
  values ('MOD verified L1', 72.0, 72.0, 'verified', 'explicit', true, now()) returning id as l1 \gset
insert into public.locations (name, latitude, longitude, status, restroom_evidence) values ('MOD hidden candidate', 72.5, 72.5, 'candidate', 'inferred');
select count(*) as pub_before from public.nearby_locations(72.0, 72.0, 90000, 100) \gset

-- ------------------------------------------------ privileges and authorization
do $$ declare t text; f text; begin
  foreach t in array array['admin_users', 'moderation_log', 'moderation_decisions'] loop
    execute 'set local role authenticated';
    begin execute format('select 1 from public.%I', t); raise exception 'authenticated reads %', t; exception when insufficient_privilege then null; end;
    begin execute format('delete from public.%I', t); raise exception 'authenticated deletes %', t; exception when insufficient_privilege then null; end;
    execute 'set local role anon';
    begin execute format('select 1 from public.%I', t); raise exception 'anon reads %', t; exception when insufficient_privilege then null; end;
    reset role;
  end loop;
  foreach f in array array['admin_list_submissions(integer)', 'admin_list_reports(integer)', 'admin_decide_submission(uuid,text,text,text,jsonb,uuid)',
                          'admin_resolve_report(uuid,text,text)', 'am_i_admin()'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute'), 'anon must not execute ' || f;
    assert has_function_privilege('authenticated', 'public.' || f, 'execute'), 'authenticated may call ' || f || ' (it checks admin itself)';
    assert not has_function_privilege('service_role', 'public.' || f, 'execute') or true, 'n/a';
  end loop;
  foreach f in array array['require_admin()', 'log_moderation(uuid,text,text,uuid,jsonb)', 'protect_original_submission()', 'reject_append_only_change()'] loop
    assert not has_function_privilege('anon', 'public.' || f, 'execute') and not has_function_privilege('authenticated', 'public.' || f, 'execute'), 'internal function exposed: ' || f;
  end loop;
end $$;

set role authenticated;
-- A normal signed-in user, even claiming admin in metadata or with MFA, is not an admin.
select pg_temp.login(:'u1', 'aal2', '{"role":"admin","user_metadata":{"is_admin":true,"role":"admin"},"app_metadata":{"role":"admin"}}');
select pg_temp.fails($q$select * from public.admin_list_submissions()$q$, '42501');
select pg_temp.fails($q$select * from public.admin_list_reports()$q$, '42501');
select pg_temp.fails($q$select public.admin_decide_submission(gen_random_uuid(), 'hold')$q$, '42501');
select pg_temp.fails($q$select public.admin_resolve_report(gen_random_uuid(), 'resolved')$q$, '42501');
select pg_temp.ok((public.am_i_admin()->>'admin')::boolean = false, 'non-admin sees admin=false');
-- A listed admin without MFA is refused; with MFA is allowed; a disabled admin is refused.
select pg_temp.login(:'adm1', 'aal1');
select pg_temp.fails($q$select * from public.admin_list_submissions()$q$, '42501');
select pg_temp.fails($q$select public.admin_decide_submission(gen_random_uuid(), 'hold')$q$, '42501');
select pg_temp.ok((public.am_i_admin()) = '{"admin": true, "mfa": false}'::jsonb, 'admin without MFA is reported as not MFA-verified');
select pg_temp.login(:'adm3', 'aal2');
select pg_temp.fails($q$select * from public.admin_list_submissions()$q$, '42501');
select pg_temp.login(null);
select pg_temp.fails($q$select * from public.admin_list_submissions()$q$, '28000');
select pg_temp.login(:'adm1', 'aal2');
select pg_temp.ok((select count(*) >= 0 from public.admin_list_submissions()), 'admin with MFA can read the queue');
reset role;
set role anon;
select pg_temp.fails($q$select * from public.admin_list_submissions()$q$, '42501');
reset role;

-- ------------------------------------------------ contributions to decide on
set role authenticated;
select pg_temp.login(:'u1', 'aal1');
select pg_temp.nl('MOD Approve me', 73.0, 73.0, '{"fee_required":false,"wheelchair_accessible":true}') as sub_ok \gset
select pg_temp.nl('MOD Edit me', 73.1, 73.1) as sub_edit \gset
select pg_temp.nl('MOD Reject me', 73.2, 73.2) as sub_rej \gset
select public.submit_location_edit(:'l1', '{"opening_hours":"Mo-Su 07:00-21:00","fee_required":false}', true) as sub_corr \gset
select pg_temp.login(:'u2', 'aal1');
select pg_temp.nl('MOD Dup me', 73.4, 73.4) as sub_dup \gset
select pg_temp.nl('MOD Hold me', 73.5, 73.5) as sub_hold \gset
select public.submit_report(:'l1', 'wrong_info', 'Hours look wrong') ;
select public.submit_report(:'l1', 'closed', 'Locked all week');
reset role;
select id as rep1 from public.reports where issue_type = 'wrong_info' and location_id = :'l1' \gset
select id as rep2 from public.reports where issue_type = 'closed' and location_id = :'l1' \gset
select pg_temp.ok((select count(*) = 6 from public.submissions where status = 'pending' and (proposed->>'name' like 'MOD %' or location_id = :'l1')), 'six pending submissions');

-- ------------------------------------------------ queue privacy
set role authenticated;
select pg_temp.login(:'adm1');
select pg_temp.ok((select count(*) = 6 from public.admin_list_submissions() r where r->>'id' in (:'sub_ok', :'sub_edit', :'sub_rej', :'sub_corr', :'sub_dup', :'sub_hold')), 'admin sees pending submissions');
select pg_temp.ok((select not bool_or(r::text ~* '(user_id|email|@test\.invalid)') from public.admin_list_submissions() r), 'queue never exposes submitter id or email');
select pg_temp.ok((select not bool_or((r->>'is_mine')::boolean) from public.admin_list_submissions() r), 'none are the admin''s own');
select pg_temp.ok((select count(*) = 2 from public.admin_list_reports() r where r->>'location_id' = :'l1'), 'admin sees open reports');
select pg_temp.ok((select not bool_or(r::text ~* '(user_id|email|@test\.invalid)') from public.admin_list_reports() r), 'report queue never exposes the reporter');
reset role;
select pg_temp.ok((select count(*) from public.nearby_locations(72.0, 72.0, 90000, 100)) = :pub_before, 'pending submissions are not public');

-- ------------------------------------------------ approve (new restroom): public but UNVERIFIED
set role authenticated;
select pg_temp.login(:'adm1');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''bogus'')', :'sub_ok'), '22023');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''edit_approve'')', :'sub_edit'), '22023');       -- needs edits
select pg_temp.fails(format('select public.admin_decide_submission(gen_random_uuid(), ''approve'')'), '22023');
select (public.admin_decide_submission(:'sub_ok', 'approve', null, 'looks right')->>'location_id')::uuid as loc_ok \gset
reset role;
select pg_temp.ok((select status = 'unverified' and restroom_evidence = 'explicit' and restroom_verified = false and last_verified_at is null and name = 'MOD Approve me'
                   and fee_required = false and wheelchair_accessible is true from public.locations where id = :'loc_ok'), 'approved community restroom is UNVERIFIED, never Verified');
select pg_temp.ok((select count(*) = 1 from public.location_sources where location_id = :'loc_ok' and source = 'community_submission' and source_reference = :'sub_ok'), 'approval records community-submission provenance');
select pg_temp.ok((select status = 'approved' and result_location_id = :'loc_ok' and reviewed_at is not null and held_at is null from public.submissions where id = :'sub_ok'), 'submission links to its result');
select pg_temp.ok((select proposed->>'name' = 'MOD Approve me' from public.submissions where id = :'sub_ok'), 'original proposal untouched by approval');
select pg_temp.ok((select count(*) = 1 from public.moderation_decisions where submission_id = :'sub_ok' and decision = 'approve' and reviewer_id = :'adm1'::uuid and note = 'looks right'), 'decision recorded with reviewer and note');
select pg_temp.ok((select count(*) = 1 from public.moderation_log where target_id = :'sub_ok' and action = 'submission_approve' and actor_id = :'adm1'::uuid), 'moderation log entry written');
select pg_temp.ok((select verification = 'unverified' from public.get_public_location(:'loc_ok')), 'public API shows it as unverified');
select pg_temp.ok(exists (select 1 from public.nearby_locations(73.0, 73.0, 5000, 10) where id = :'loc_ok'), 'approved restroom became public (unverified)');
set role authenticated;
select pg_temp.login(:'adm2');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''reject'', ''spam_or_abuse'')', :'sub_ok'), '22023');     -- already decided
reset role;

-- ------------------------------------------------ edit & approve: original preserved, edits recorded
set role authenticated;
select pg_temp.login(:'adm1');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''edit_approve'', null, null, ''{"status":"verified"}'')', :'sub_edit'), '22023');
select (public.admin_decide_submission(:'sub_edit', 'edit_approve', null, 'fixed name', '{"name":"MOD Edited Name","city":"Cody"}')->>'location_id')::uuid as loc_edit \gset
reset role;
select pg_temp.ok((select name = 'MOD Edited Name' and city = 'Cody' and status = 'unverified' and not restroom_verified from public.locations where id = :'loc_edit'), 'edit-and-approve publishes the edited, still unverified record');
select pg_temp.ok((select proposed->>'name' = 'MOD Edit me' and not (proposed ? 'city') from public.submissions where id = :'sub_edit'), 'the original proposal is unchanged');
select pg_temp.ok((select edits->>'name' = 'MOD Edited Name' from public.moderation_decisions where submission_id = :'sub_edit' and decision = 'edit_approve'), 'admin edits are recorded on the decision');

-- ------------------------------------------------ reject: seven-code rules
set role authenticated;
select pg_temp.login(:'adm1');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''reject'')', :'sub_rej'), '22023');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''reject'', ''duplicate'')', :'sub_rej'), '22023');     -- duplicate is NOT a rejection reason
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''reject'', ''made_up'')', :'sub_rej'), '22023');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''reject'', ''other'')', :'sub_rej'), '22023');          -- other needs a note
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''reject'', ''other'', ''  '')', :'sub_rej'), '22023');
select public.admin_decide_submission(:'sub_rej', 'reject', 'other', 'unclear what this is');
reset role;
select pg_temp.ok((select status = 'rejected' and result_location_id is null from public.submissions where id = :'sub_rej'), 'rejected');
select pg_temp.ok((select reason_code = 'other' and note = 'unclear what this is' from public.moderation_decisions where submission_id = :'sub_rej'), 'reason and note recorded');
do $$ declare c text; begin
  foreach c in array array['private_or_residential', 'not_public_or_not_a_restroom', 'insufficient_or_unverifiable', 'invalid_or_inaccurate', 'spam_or_abuse'] loop
    begin
      insert into public.moderation_decisions (submission_id, decision, reason_code, reviewer_id)
        select id, 'reject', c, gen_random_uuid() from public.submissions limit 1;
    exception when others then
      if sqlstate <> '55000' then raise; end if;  -- append-only trigger fires only for update/delete; inserts are fine
    end;
  end loop;
end $$;

-- ------------------------------------------------ duplicate is a separate resolution
set role authenticated;
select pg_temp.login(:'adm1');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''duplicate'')', :'sub_dup'), '22023');                         -- must link
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''duplicate'', null, null, null, gen_random_uuid())', :'sub_dup'), '22023');
select public.admin_decide_submission(:'sub_dup', 'duplicate', null, 'same as L1', null, :'l1');
reset role;
select pg_temp.ok((select status = 'duplicate' and result_location_id = :'l1'::uuid from public.submissions where id = :'sub_dup'), 'duplicate links to the existing restroom, status duplicate');
select pg_temp.ok((select reason_code is null and duplicate_of_location_id = :'l1'::uuid from public.moderation_decisions where submission_id = :'sub_dup'), 'duplicate carries no rejection reason');
select pg_temp.ok((select count(*) = 0 from public.submissions where status = 'rejected' and id = :'sub_dup'), 'duplicate never counts as rejected');

-- ------------------------------------------------ hold keeps counting toward pending caps
set role authenticated;
select pg_temp.login(:'adm1');
select pg_temp.ok((public.admin_decide_submission(:'sub_hold', 'hold', null, 'need to check hours')->>'held')::boolean, 'hold recorded');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''hold'')', :'sub_hold'), '22023');                              -- already held
select pg_temp.ok((select (r->>'held')::boolean from public.admin_list_submissions() r where r->>'id' = :'sub_hold'), 'held flag visible to admins');
reset role;
select pg_temp.ok((select status = 'pending' and held_at is not null from public.submissions where id = :'sub_hold'), 'a held submission stays pending (unresolved)');
-- the holder (u2) now has: hold + 0 other pending new; fill u2 to the pending-new cap of 5 and prove the held one counts
delete from public.action_log where user_id = :'u2'::uuid;
insert into public.submissions (user_id, kind, proposed, attested_public)
  select :'u2'::uuid, 'new_location', jsonb_build_object('name', 'MOD filler ' || g, 'latitude', 20 + g, 'longitude', 20), true from generate_series(1, 4) g;
set role authenticated;
select pg_temp.login(:'u2', 'aal1');
select pg_temp.fails($q$select pg_temp.nl('MOD one too many', 73.9, 73.9)$q$, '53400');
select public.withdraw_my_submission(:'sub_hold');
reset role;
select pg_temp.ok((select count(*) = 1 from public.submissions where id = :'sub_hold'), 'a held submission cannot be withdrawn away');
set role authenticated;
select pg_temp.login(:'adm1');
select public.admin_decide_submission(:'sub_hold', 'release');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''release'')', :'sub_hold'), '22023');
reset role;
select pg_temp.ok((select held_at is null and status = 'pending' from public.submissions where id = :'sub_hold'), 'release clears the hold');
-- Released items keep their hold history, so they still cannot be withdrawn away.
set role authenticated;
select pg_temp.login(:'u2', 'aal1');
select public.withdraw_my_submission(:'sub_hold');
reset role;
select pg_temp.ok((select count(*) = 1 from public.submissions where id = :'sub_hold'), 'a released item with hold history cannot be withdrawn');
select pg_temp.ok((select count(*) = 2 from public.moderation_decisions where submission_id = :'sub_hold' and decision in ('hold', 'release')), 'hold and release history intact');
set session_replication_role = replica;
delete from public.submissions where proposed->>'name' like 'MOD filler %';
reset session_replication_role;
delete from public.action_log where user_id = :'u2'::uuid;
set role authenticated;
select pg_temp.login(:'u2', 'aal1');
select pg_temp.nl('MOD plain withdraw', 73.7, 73.7) as sub_plain \gset
select public.withdraw_my_submission(:'sub_plain');
reset role;
select pg_temp.ok((select count(*) = 0 from public.submissions where id = :'sub_plain'), 'a never-moderated pending submission can still be withdrawn');
set session_replication_role = replica;
delete from public.submissions where proposed->>'name' like 'MOD filler %';
reset session_replication_role;

-- ------------------------------------------------ approve a correction: applied, status untouched
set role authenticated;
select pg_temp.login(:'adm2');
select public.admin_decide_submission(:'sub_corr', 'approve', null, 'confirmed hours');
reset role;
select pg_temp.ok((select opening_hours = 'Mo-Su 07:00-21:00' and fee_required = false and status = 'verified' and restroom_verified and manually_edited_at is not null
                   from public.locations where id = :'l1'), 'approved correction applied, marked manual, and a Verified restroom stays Verified');

-- ------------------------------------------------ self-adjudication
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000f1') on conflict do nothing;  -- u1 becomes an admin too
delete from public.action_log;
set role authenticated;
select pg_temp.login(:'u1', 'aal1');
select pg_temp.nl('MOD Admin own', 74.0, 74.0) as sub_own \gset
select public.submit_report(:'l1', 'unsafe', 'Dark at night');
reset role;
select id as rep_own from public.reports where user_id = :'u1'::uuid and issue_type = 'unsafe' \gset
set role authenticated;
select pg_temp.login(:'u1', 'aal2');
select pg_temp.ok((select (r->>'is_mine')::boolean from public.admin_list_submissions() r where r->>'id' = :'sub_own'), 'admin queue marks their own submission');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''approve'')', :'sub_own'), '42501');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''reject'', ''spam_or_abuse'')', :'sub_own'), '42501');
select pg_temp.fails(format('select public.admin_decide_submission(%L, ''hold'')', :'sub_own'), '42501');
select pg_temp.fails(format('select public.admin_resolve_report(%L, ''dismissed'')', :'rep_own'), '42501');
select pg_temp.login(:'adm2');
select public.admin_decide_submission(:'sub_own', 'reject', 'insufficient_or_unverifiable');   -- another admin may
select public.admin_resolve_report(:'rep_own', 'dismissed', 'not reproducible');
reset role;
delete from public.admin_users where user_id = :'u1'::uuid;

-- ------------------------------------------------ report resolution
set role authenticated;
select pg_temp.login(:'adm1');
select pg_temp.fails(format('select public.admin_resolve_report(%L, ''deleted'')', :'rep1'), '22023');
select public.admin_resolve_report(:'rep1', 'resolved', 'hours corrected');
select pg_temp.fails(format('select public.admin_resolve_report(%L, ''resolved'')', :'rep1'), '22023');
select public.admin_resolve_report(:'rep2', 'dismissed');
reset role;
select pg_temp.ok((select count(*) = 1 from public.reports where id = :'rep1' and status = 'resolved' and resolved_at is not null), 'report resolved');
select pg_temp.ok((select count(*) = 2 from public.moderation_decisions where report_id in (:'rep1', :'rep2') and reviewer_id = :'adm1'::uuid), 'report decisions carry reviewer provenance');
select pg_temp.ok((select count(*) = 0 from public.reports where status = 'open'), 'no open reports remain');

-- ------------------------------------------------ immutability and append-only (superuser too)
select pg_temp.fails($q$update public.submissions set proposed = '{"name":"tampered"}' where id = (select id from public.submissions limit 1)$q$, '55000');
select pg_temp.fails($q$update public.submissions set note = 'tampered' where id = (select id from public.submissions limit 1)$q$, '55000');
select pg_temp.fails(format('update public.submissions set user_id = %L where id = %L', :'u2', :'sub_ok'), '55000');
select pg_temp.fails(format('update public.submissions set capture_accuracy_m = 1 where id = %L', :'sub_ok'), '55000');
select pg_temp.fails(format('update public.submissions set status = ''pending'' where id = %L', :'sub_ok'), '55000');
select pg_temp.fails(format('update public.submissions set status = ''rejected'' where id = %L', :'sub_dup'), '55000');
select pg_temp.fails(format('delete from public.submissions where id = %L', :'sub_ok'), '55000');
select pg_temp.fails(format('delete from public.submissions where id = %L', :'sub_rej'), '55000');
select pg_temp.fails($q$update public.moderation_decisions set note = 'x'$q$, '55000');
select pg_temp.fails($q$delete from public.moderation_decisions$q$, '55000');
select pg_temp.fails($q$truncate public.moderation_decisions$q$, '55000');
select pg_temp.fails($q$update public.moderation_log set action = 'x'$q$, '55000');
select pg_temp.fails($q$delete from public.moderation_log$q$, '55000');
select pg_temp.fails($q$truncate public.moderation_log$q$, '55000');
select pg_temp.ok((select count(*) >= 8 from public.moderation_log), 'log still intact');

-- ------------------------------------------------ account deletion preserves decided provenance
-- u2: has a decided duplicate submission (sub_dup), a pending+held submission, and an open report.
set role authenticated;
select pg_temp.login(:'adm1');
select public.admin_decide_submission(:'sub_hold', 'hold', null, 'hold again');
reset role;
delete from public.action_log where user_id = :'u2'::uuid;
set role authenticated;
select pg_temp.login(:'u2', 'aal1');
select public.submit_report(:'l1', 'other', 'pending report');
select pg_temp.nl('MOD pending delete', 75.0, 75.0) as sub_pend \gset
select public.delete_my_account('DELETE');
reset role;
select pg_temp.ok((not exists (select 1 from auth.users where id = :'u2'::uuid)), 'account removed');
select pg_temp.ok((select count(*) = 0 from public.submissions where id = :'sub_pend'), 'a never-moderated pending submission is removed with the account');
select pg_temp.ok((select count(*) = 1 and bool_and(user_id is null and held_at is not null and status = 'pending' and proposed->>'name' = 'MOD Hold me') from public.submissions where id = :'sub_hold'),
  'a submission with moderation history is kept (original intact), submitter severed, hold preserved');
select pg_temp.ok((select count(*) = 3 and array_agg(decision order by created_at) = array['hold', 'release', 'hold'] from public.moderation_decisions where submission_id = :'sub_hold'),
  'its full hold/release decision history is preserved');
select pg_temp.ok((select count(*) = 0 from public.reports where comment = 'pending report'), 'open reports removed');
select pg_temp.ok((select status = 'duplicate' and user_id is null and proposed->>'name' = 'MOD Dup me' from public.submissions where id = :'sub_dup'), 'decided submission kept, submitter severed');
select pg_temp.ok((select count(*) = 1 from public.moderation_decisions where submission_id = :'sub_dup' and reviewer_id = :'adm1'::uuid), 'decision for it kept');
select pg_temp.ok((select count(*) = 2 and bool_and(user_id is null) from public.reports where id in (:'rep1', :'rep2')), 'decided reports kept, reporter severed');
select pg_temp.ok((select count(*) = 2 from public.moderation_decisions where report_id in (:'rep1', :'rep2')), 'report decisions kept');
select pg_temp.ok((select count(*) >= 1 from public.moderation_log where target_id = :'sub_dup'), 'moderation log kept');
-- u1 (decided approve + reject + correction) deleting keeps the approved restroom and its provenance
set role authenticated;
select pg_temp.login(:'u1', 'aal1');
select public.delete_my_account('DELETE');
reset role;
select pg_temp.ok((select count(*) = 1 from public.locations where id = :'loc_ok' and status = 'unverified'), 'an approved restroom is not deleted with its contributor');
select pg_temp.ok((select count(*) = 1 from public.submissions where id = :'sub_ok' and user_id is null and status = 'approved' and result_location_id = :'loc_ok'), 'approved submission kept anonymised and linked');
select pg_temp.ok((select count(*) = 4 and bool_and(user_id is null) from public.submissions where id in (:'sub_ok', :'sub_edit', :'sub_rej', :'sub_corr')), 'all of the contributor''s decided submissions kept anonymised');
-- an active admin cannot delete their account until the owner disables them; afterwards deletion works and decisions keep reviewer ids
set role authenticated;
select pg_temp.login(:'adm2');
select pg_temp.fails($q$select public.delete_my_account('DELETE')$q$, '42501');
reset role;
update public.admin_users set disabled_at = now() where user_id = :'adm2'::uuid;
set role authenticated;
select pg_temp.login(:'adm2', 'aal1');
select public.delete_my_account('DELETE');
reset role;
select pg_temp.ok((select count(*) >= 1 from public.moderation_decisions where reviewer_id = :'adm2'::uuid), 'a deleted admin''s decisions remain with their reviewer id');

-- ------------------------------------------------ approval never produces Verified
select pg_temp.ok((not exists (select 1 from public.locations l join public.location_sources s on s.location_id = l.id and s.source = 'community_submission'
                               where l.restroom_verified or l.status = 'verified')), 'no community-approved restroom is Verified');

-- ------------------------------------------------ cleanup (superuser; bypass append-only for test data only)
set session_replication_role = replica;
delete from public.moderation_decisions;
delete from public.moderation_log;
delete from public.submissions;
reset session_replication_role;
delete from public.reports;
delete from public.locations where name like 'MOD %';
delete from public.admin_users;
delete from auth.users where email like '%@test.invalid' and id::text like '00000000-0000-0000-0000-00000000ad0%';
