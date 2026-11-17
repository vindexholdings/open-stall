-- P2 test 5: account deletion through the existing owner path. One purge authority, auth.uid subject, exact sever-only fields,
-- disjoint retained/deleted sets, month-keyed anonymous aggregate, zero drift, atomic rollback.
\i :ROOT/supabase/tests/rewards/p2_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(5001) as a1 \gset
select pg_temp.mkadmin(5002) as a2 \gset
select pg_temp.mkuser(5101) as p \gset
select pg_temp.mkuser(5102) as q \gset
select pg_temp.mkloc(48.0) as la \gset
select pg_temp.mkloc(48.1) as lb \gset
select pg_temp.mkloc(48.2, null) as lz \gset
select pg_temp.setf('p', :'p'), pg_temp.setf('q', :'q'), pg_temp.setf('a1', :'a1'), pg_temp.setf('a2', :'a2');

select pg_temp.vid('2026-09-15 15:00:00+00', :'p', :'lb', 'purge-sep-0000000000001') as pd \gset
select pg_temp.vid('2026-10-20 15:00:00+00', :'p', :'la', 'purge-oct-0000000000001') as pa \gset
select pg_temp.vid('2026-10-20 15:00:10+00', :'p', :'la', 'purge-oct-0000000000002') as pb \gset
select pg_temp.vid('2026-10-20 15:00:20+00', :'p', :'lz', 'purge-nozone-00000000001') as pn \gset
select pg_temp.vid('2026-10-20 15:00:00+00', :'q', :'la', 'purge-other-0000000000001') as qv \gset
select pg_temp.recommend_as(:'a1', :'pb') as rec \gset
select pg_temp.finalize_as(:'a2', :'rec') as fin \gset
select pg_temp.hold_as(:'a1', :'p') as hd \gset
select pg_temp.vid('2026-11-02 15:00:00+00', :'p', :'la', 'purge-held-00000000001') as pc \gset
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'p') = 5, 'setup: five visits for the account (three unmoderated, one reversed, one held)');

-- snapshots: the retained evidence (everything except the severed columns), totals, other account
create temp table _keep_visits as select id, to_jsonb(v) - array['user_id', 'idempotency_key', 'accuracy_bucket', 'distance_bucket'] as j from rewards.visits v where id in (:'pb'::uuid, :'pc'::uuid);
create temp table _keep_ledger as select id, to_jsonb(l) - 'user_id' as j from rewards.reward_ledger l where visit_id = :'pb'::uuid;
create temp table _keep_dec as select id, to_jsonb(d) - 'subject_user_id' as j from rewards.reward_decisions d where subject_user_id = :'p';
create temp table _keep_hold as select id, to_jsonb(h) - 'user_id' as j from rewards.reward_holds h where user_id = :'p';
create temp table _q_before as select (select count(*) from rewards.visits where user_id = :'q') as v, (select count(*) from rewards.reward_ledger where user_id = :'q') as l,
  (select sum(spendable) from rewards.reward_counters_user_day where user_id = :'q') as c;
select sum(spendable) as gsum from rewards.reward_counters_global_day \gset
select pg_temp.ok((select count(*) from _keep_ledger) = 2 and (select count(*) from _keep_dec) = 3 and (select count(*) from _keep_hold) = 1, 'setup: retained evidence snapshot (award+reversal, 3 decisions, 1 active hold)');

-- ============================================================ atomicity: a failure AFTER the purge ran rolls everything back
create table public.zz_block (u uuid references auth.users (id));
insert into public.zz_block values (:'p');
select pg_temp.fails_as('authenticated', :'p'::uuid, 'aal1', $$select public.delete_my_account('DELETE')::text$$, '23503', 'a failure after the purge step (foreign key on auth.users) is refused');
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'p') = 5 and (select count(*) from rewards.reward_ledger where user_id = :'p') = 6
              and (select count(*) from rewards.reward_deleted_aggregate_month) = 0 and (select count(*) from rewards.reward_counters_user_day where user_id = :'p') = 2,
                  'the failed deletion rolled back atomically: visits, ledger, counters and the aggregate are exactly as before');
drop table public.zz_block;

-- ============================================================ authority probes BEFORE the real purge
select pg_temp.fails_as('authenticated', :'p'::uuid, 'aal1', $$select rewards.purge_my_reward_data()::text$$, '42501', 'authenticated cannot call the purge function directly');
select pg_temp.fails_as('anon', :'p'::uuid, 'aal1', $$select rewards.purge_my_reward_data()::text$$, '42501', 'anon cannot call the purge function');
select pg_temp.fails_as('service_role', :'p'::uuid, 'aal1', $$select rewards.purge_my_reward_data()::text$$, '42501', 'service_role cannot call the purge function');
select pg_temp.fails_as('reward_writer_owner', :'p'::uuid, 'aal1', $$select rewards.purge_my_reward_data()::text$$, '42501', 'the writer cannot call the purge function');
select pg_temp.ok(not exists (select 1 from pg_roles r where r.rolname in ('anon', 'authenticated', 'service_role', 'reward_writer_owner', 'public')
                               and has_function_privilege(r.rolname, 'rewards.purge_my_reward_data()', 'execute')), 'no client role or the writer holds EXECUTE on the purge function');
select pg_temp.ok(not has_function_privilege('public', 'rewards.purge_my_reward_data()', 'execute') and has_function_privilege('postgres', 'rewards.purge_my_reward_data()', 'execute')
              and has_function_privilege('reward_purge_owner', 'rewards.purge_my_reward_data()', 'execute'),
                  'EXECUTE is held only by the owner of public.delete_my_account (the account-deletion path) and the purge owner itself');
select pg_temp.ok(not exists (select 1 from pg_roles r where r.rolname <> 'reward_purge_owner' and r.rolname !~ '^pg_' and pg_has_role(r.rolname, 'reward_purge_owner', 'usage')
                               and not r.rolsuper and r.rolname <> 'postgres'), 'no role other than the migration owner and superusers is a member of reward_purge_owner');
select pg_temp.ok((select (rolcanlogin, rolinherit, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole, rolreplication) = (false, false, false, false, false, false, false) from pg_roles where rolname = 'reward_purge_owner'),
                  'reward_purge_owner is NOLOGIN, NOINHERIT, NOBYPASSRLS, not superuser/createdb/createrole/replication');
select pg_temp.ok((select count(*) from pg_proc p where p.proowner = 'reward_purge_owner'::regrole) = 1 and (select proname from pg_proc p where p.proowner = 'reward_purge_owner'::regrole) = 'purge_my_reward_data',
                  'reward_purge_owner owns exactly one function: purge_my_reward_data');
select pg_temp.ok((select prosecdef and proconfig = array['search_path=""'] from pg_proc where oid = 'rewards.purge_my_reward_data()'::regprocedure), 'the purge function is SECURITY DEFINER with a fixed empty search_path');
-- guards decide by current_user and the auth.uid subject: nothing else (GUC, superuser) can delete or alter retained evidence
select pg_temp.claims(:'p', 'aal1');
select pg_temp.fails($$delete from rewards.visits where id in (select id from _keep_visits)$$, '42501', 'a superuser (current_user postgres) cannot delete retained visits even with the subject claim');
select pg_temp.fails($$update rewards.visits set user_id = null where user_id = pg_temp.f('p')$$, '42501', 'a superuser cannot sever either: only the purge owner may');
select pg_temp.fails($$select set_config('rewards.purge', 'on', false); delete from rewards.reward_ledger where user_id = pg_temp.f('p')$$, '42501', 'a session flag changes nothing');
select pg_temp.claims(null, null);
select pg_temp.fails_as('reward_purge_owner', :'q'::uuid, 'aal1', format($$delete from rewards.visits where id = %L::uuid$$, :'pa'), '42501', 'purge owner with ANOTHER subject cannot delete the account''s visits');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$delete from rewards.visits where id = %L::uuid$$, :'pb'), '42501', 'purge owner cannot delete a retained (reversed) visit');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$delete from rewards.visits where id = %L::uuid$$, :'pc'), '42501', 'purge owner cannot delete a held visit');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$delete from rewards.reward_ledger where visit_id = %L::uuid$$, :'pb'), '42501', 'purge owner cannot delete the ledger rows of a retained pair (nor reversal rows)');
select pg_temp.fails_as('reward_purge_owner', null, null, format($$delete from rewards.visits where id = %L::uuid$$, :'pa'), '42501', 'purge owner with no auth.uid subject cannot delete');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$update rewards.visits set occurred_at = now() where id = %L::uuid$$, :'pa'), '42501', 'purge owner cannot alter a non-identity visit column (no column privilege)');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$update rewards.visits set user_id = %L::uuid where id = %L::uuid$$, :'q', :'pa'), '42501', 'purge owner cannot re-point a visit at another account (only NULL is allowed)');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$update rewards.visits set user_id = null, time_zone = 'UTC' where id = %L::uuid$$, :'pa'), '42501', 'purge owner cannot change anything but the approved identity/signal columns in the same statement');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$update rewards.reward_ledger set amount = 99 where visit_id = %L::uuid$$, :'pa'), '42501', 'purge owner cannot change a ledger amount');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$update rewards.reward_decisions set reason = 'tampered' where id = %L::uuid$$, :'rec'), '42501', 'purge owner cannot rewrite a decision');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', format($$delete from rewards.reward_decisions where id = %L::uuid$$, :'rec'), '42501', 'nobody deletes a decision');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', $$insert into rewards.visits (user_id) values (gen_random_uuid())$$, '42501', 'purge owner has no INSERT into visits');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', $$insert into rewards.reward_ledger (user_id) values (gen_random_uuid())$$, '42501', 'purge owner has no INSERT into the ledger');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', $$delete from rewards.reward_counters_global_day$$, '42501', 'purge owner cannot touch the global counters');
select pg_temp.fails_as('reward_purge_owner', :'p'::uuid, 'aal1', $$delete from rewards.reward_deleted_aggregate_month$$, '42501', 'the aggregate cannot be deleted');
select pg_temp.fails_as('reward_purge_owner', :'q'::uuid, 'aal1', format($$delete from rewards.reward_counters_user_day where user_id = %L::uuid$$, :'p'), '42501', 'purge owner cannot delete another account''s user counters');
select pg_temp.fails_as('reward_writer_owner', :'p'::uuid, 'aal1', format($$update rewards.visits set user_id = null, idempotency_key = null, accuracy_bucket = null, distance_bucket = null where id = %L::uuid$$, :'pa'), '42501', 'the writer cannot sever identity');

-- ============================================================ the real purge, through the existing deletion path as the account holder
select pg_temp.as_role('authenticated', :'p'::uuid, 'aal1', $$select public.delete_my_account('DELETE')::text$$) as r \gset
select pg_temp.ok(not exists (select 1 from auth.users where id = :'p'), 'the account is deleted');
-- unmoderated rows are DELETED (3 visits: sep, oct award, no-zone) and counted ONLY in the month-keyed anonymous aggregate
select pg_temp.ok((select count(*) from rewards.visits where id in (:'pd'::uuid, :'pa'::uuid, :'pn'::uuid)) = 0 and (select count(*) from rewards.reward_ledger where visit_id in (:'pd'::uuid, :'pa'::uuid)) = 0,
                  'unmoderated visits and their awards are deleted');
select pg_temp.ok((select jsonb_agg(to_jsonb(a) order by month_utc) from rewards.reward_deleted_aggregate_month a)
  = '[{"month_utc":"2026-09-01","deleted_visits":1,"deleted_spendable":5,"deleted_lifetime":5},{"month_utc":"2026-10-01","deleted_visits":2,"deleted_spendable":5,"deleted_lifetime":5}]'::jsonb,
                  'the anonymous aggregate holds exactly the DELETED rows by UTC month (Sep: 1 visit 5/5; Oct: 2 visits 5/5) and nothing retained');
-- retained evidence is kept TOGETHER and only severed
select pg_temp.ok((select count(*) from rewards.visits where id in (:'pb'::uuid, :'pc'::uuid)) = 2
              and (select count(*) from rewards.visits where id in (:'pb'::uuid, :'pc'::uuid) and user_id is null and idempotency_key is null and accuracy_bucket is null and distance_bucket is null) = 2,
                  'the reversed and the held visit are kept with exactly user_id, idempotency_key, accuracy_bucket and distance_bucket nulled');
select pg_temp.ok((select count(*) from _keep_visits k join rewards.visits v on v.id = k.id where to_jsonb(v) - array['user_id', 'idempotency_key', 'accuracy_bucket', 'distance_bucket'] = k.j) = 2,
                  'every other column of the retained visits is byte-for-byte unchanged (amounts, days, policy, location, outcomes)');
select pg_temp.ok((select count(*) from _keep_ledger k join rewards.reward_ledger l on l.id = k.id where to_jsonb(l) - 'user_id' = k.j and l.user_id is null) = 2
              and (select count(*) from rewards.reward_ledger where visit_id = :'pb'::uuid) = 2,
                  'the award and its reversal stay together, unchanged except user_id');
select pg_temp.ok((select count(*) from _keep_dec k join rewards.reward_decisions d on d.id = k.id where to_jsonb(d) - 'subject_user_id' = k.j and d.subject_user_id is null) = 3
              and (select count(*) from rewards.reward_decisions) = 3, 'the three decisions are preserved with the subject severed (admins and reasons intact)');
select pg_temp.ok((select count(*) from _keep_hold k join rewards.reward_holds h on h.id = k.id where to_jsonb(h) - 'user_id' = k.j and h.user_id is null) = 1, 'the hold row is preserved with the account severed');
select pg_temp.ok((select count(*) from rewards.reward_counters_user_day where user_id = :'p') = 0, 'the account''s per-user counters are removed');
select pg_temp.ok((select sum(spendable) from rewards.reward_counters_global_day) = :'gsum'::bigint, 'the global gross counters are untouched by the purge');
select pg_temp.ok((select drift_spendable from rewards.reconciliation_report()) = 0, 'zero drift: global gross = ledger awards + deleted aggregate after the purge');
select pg_temp.ok((select (ledger_award_spendable, deleted_spendable, reversed_spendable, outstanding_spendable) = (10, 10, 5, 5) from rewards.reconciliation_report()),
                  'reporting: ledger awards 10 (qv 5 + pb 5), deleted 10 (pd 5 + pa 5), reversed 5, outstanding 5');
select pg_temp.ok(not exists (select 1 from (select to_jsonb(t)::text s from rewards.visits t union all select to_jsonb(t)::text from rewards.reward_ledger t union all
                                             select to_jsonb(t)::text from rewards.reward_decisions t union all select to_jsonb(t)::text from rewards.reward_holds t union all
                                             select to_jsonb(t)::text from rewards.visit_clearances t union all select to_jsonb(t)::text from rewards.reward_counters_user_day t) x where s like '%' || :'p' || '%'),
                  'no rewards row anywhere still contains the deleted account''s id');
select pg_temp.ok((select (v, l, c) = (select v, l, c from _q_before) from (select (select count(*) from rewards.visits where user_id = :'q') v, (select count(*) from rewards.reward_ledger where user_id = :'q') l,
                    (select sum(spendable) from rewards.reward_counters_user_day where user_id = :'q') c) z), 'another account''s visits, ledger and counters are untouched');
-- a second purge for the same subject adds nothing (only rows DELETE actually removed are ever aggregated)
select pg_temp.claims(:'p', 'aal1');
select rewards.purge_my_reward_data() as again \gset
select pg_temp.claims(null, null);
select pg_temp.ok((select (:'again'::jsonb ->> 'deleted_ledger_rows')::int = 0 and (:'again'::jsonb ->> 'deleted_visits')::int = 0 from (select 1) z)
              and (select sum(deleted_spendable) from rewards.reward_deleted_aggregate_month) = 10 and (select sum(deleted_visits) from rewards.reward_deleted_aggregate_month) = 3,
                  'repeating the purge deletes nothing and the aggregate does not grow (no double counting)');
select pg_temp.fails_as('reward_purge_owner', :'q'::uuid, 'aal1', $$update rewards.reward_deleted_aggregate_month set deleted_spendable = 0$$, '42501', 'the aggregate cannot shrink');
-- retained evidence of a DELETED account can no longer be adjudicated, and the held visit can never be cleared
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_recommend_reversal(%L::uuid, 'after deletion')$$, :'pc'), 'RW030', 'a severed visit cannot be recommended for reversal');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_clear_hold(%L::uuid, 'after deletion')$$, :'p'), 'RW032', 'the severed hold can no longer be cleared (no active hold for any account)');
-- a DISABLED administrator who authored decisions can still delete their own account, and the decisions keep their admin id (no foreign key)
select pg_temp.mkadmin(5003, true) as dadm \gset
select pg_temp.mkuser(5103) as dsub \gset
insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, reason) values ('hold_user', :'dadm', :'dsub', 'fixture by a later-disabled admin') returning id as ddec \gset
select pg_temp.as_role('authenticated', :'dadm'::uuid, 'aal1', $$select public.delete_my_account('DELETE')::text$$) as r \gset
select pg_temp.ok(not exists (select 1 from auth.users where id = :'dadm') and (select admin_id from rewards.reward_decisions where id = :'ddec'::uuid) = :'dadm'::uuid,
                  'a disabled administrator can delete their account and their decisions keep the admin id as provenance');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_hold_user(%L::uuid, 'active admin self')$$, :'a1'), '42501', 'an active administrator still cannot be adjudicated by themselves');
select pg_temp.finish();
