-- P2 test 4 (privileges): the COMPLETE P2 catalog inventory (every role, table, column, sequence, function, schema privilege, ownership,
-- default ACL, RLS enabled+forced, explicit policy and fixed search_path) and the real refusal matrices for anon, authenticated,
-- service_role, the internal writer and the purge owner. The exact P1 inventory (04_privileges_catalog) still runs unchanged on the
-- P1-only build; this file is its P2 superset. Rewards are disabled here, as on a fresh cluster.
\i :ROOT/supabase/tests/rewards/helpers.sql

-- ---------------------------------------------------------------- roles
select pg_temp.ok((select bool_and(not rolcanlogin and not rolinherit and not rolbypassrls and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication)
                   from pg_roles where rolname in ('reward_writer_owner', 'reward_purge_owner')) and (select count(*) from pg_roles where rolname in ('reward_writer_owner', 'reward_purge_owner')) = 2,
                   'exactly two reward roles exist, both NOLOGIN, NOINHERIT, no BYPASSRLS, not superuser, no createdb/createrole/replication');
select pg_temp.ok(not exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname in ('reward_writer_owner', 'reward_purge_owner')), 'neither reward role is a member of any role');
select pg_temp.ok(not exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles r on r.oid = m.member
                              where g.rolname in ('reward_writer_owner', 'reward_purge_owner') and r.rolname in ('anon', 'authenticated', 'service_role')),
                  'no client role is a member of either reward role (no SET ROLE path into them)');

-- ---------------------------------------------------------------- the complete object inventory
create temp table _tables as select c.oid, c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rewards' and c.relkind in ('r', 'p', 'v', 'm', 'f');
select pg_temp.ok((select array_agg(relname::text order by relname) from _tables) = array['reward_counters_global_day','reward_counters_user_day','reward_decisions','reward_deleted_aggregate_month',
  'reward_holds','reward_ledger','reward_location_zones','reward_policy_versions','reward_settings','reward_settings_history','visit_clearances','visits'], 'the rewards schema holds exactly the twelve expected tables and no view');
select pg_temp.ok((select every(owner = current_user) from _tables), 'all tables are owned by the migration role, not by a reward role');
select pg_temp.ok((select every(relrowsecurity and relforcerowsecurity) from _tables), 'every rewards table has RLS enabled AND forced');

create temp table _exp_tbl (relname text, grantee text, priv text);
insert into _exp_tbl values
 ('reward_settings','reward_writer_owner','SELECT'), ('reward_settings_history','reward_writer_owner','SELECT'),
 ('reward_policy_versions','reward_writer_owner','SELECT'), ('reward_location_zones','reward_writer_owner','SELECT'),
 ('visits','reward_writer_owner','SELECT'), ('visits','reward_writer_owner','INSERT'),
 ('reward_ledger','reward_writer_owner','SELECT'), ('reward_ledger','reward_writer_owner','INSERT'),
 ('reward_counters_user_day','reward_writer_owner','SELECT'), ('reward_counters_user_day','reward_writer_owner','INSERT'), ('reward_counters_user_day','reward_writer_owner','UPDATE'),
 ('reward_counters_global_day','reward_writer_owner','SELECT'), ('reward_counters_global_day','reward_writer_owner','INSERT'), ('reward_counters_global_day','reward_writer_owner','UPDATE'),
 ('reward_decisions','reward_writer_owner','SELECT'), ('reward_decisions','reward_writer_owner','INSERT'),
 ('reward_holds','reward_writer_owner','SELECT'), ('reward_holds','reward_writer_owner','INSERT'), ('reward_holds','reward_writer_owner','DELETE'),
 ('visit_clearances','reward_writer_owner','SELECT'), ('visit_clearances','reward_writer_owner','INSERT'),
 ('reward_deleted_aggregate_month','reward_writer_owner','SELECT'),
 ('visits','reward_purge_owner','SELECT'), ('visits','reward_purge_owner','DELETE'),
 ('reward_ledger','reward_purge_owner','SELECT'), ('reward_ledger','reward_purge_owner','DELETE'),
 ('reward_decisions','reward_purge_owner','SELECT'), ('reward_holds','reward_purge_owner','SELECT'), ('visit_clearances','reward_purge_owner','SELECT'),
 ('reward_counters_user_day','reward_purge_owner','SELECT'), ('reward_counters_user_day','reward_purge_owner','DELETE'),
 ('reward_deleted_aggregate_month','reward_purge_owner','SELECT'), ('reward_deleted_aggregate_month','reward_purge_owner','INSERT'), ('reward_deleted_aggregate_month','reward_purge_owner','UPDATE');
create temp table _act_tbl as
  select t.relname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee, a.privilege_type as priv
  from _tables t, aclexplode(coalesce((select relacl from pg_class where oid = t.oid), acldefault('r', (select relowner from pg_class where oid = t.oid)))) a
  where a.grantee <> (select relowner from pg_class where oid = t.oid);
select pg_temp.ok(not exists (select * from _act_tbl except select * from _exp_tbl), 'no table grant beyond the golden list (any extra grant fails)');
select pg_temp.ok(not exists (select * from _exp_tbl except select * from _act_tbl), 'every golden table grant exists');
select pg_temp.ok(not exists (select 1 from _act_tbl where grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')), 'no table is granted to PUBLIC, anon, authenticated or service_role');
-- column-level grants: exactly the sever-only and clearance columns, in both directions
create temp table _exp_col (relname text, attname text, grantee text, priv text);
insert into _exp_col values
 ('visits','user_id','reward_purge_owner','UPDATE'), ('visits','idempotency_key','reward_purge_owner','UPDATE'), ('visits','accuracy_bucket','reward_purge_owner','UPDATE'), ('visits','distance_bucket','reward_purge_owner','UPDATE'),
 ('reward_ledger','user_id','reward_purge_owner','UPDATE'), ('reward_holds','user_id','reward_purge_owner','UPDATE'), ('reward_decisions','subject_user_id','reward_purge_owner','UPDATE'),
 ('reward_holds','cleared_decision_id','reward_writer_owner','UPDATE'), ('reward_holds','cleared_at','reward_writer_owner','UPDATE');
create temp table _act_col as
  select t.relname, a.attname, pg_get_userbyid(x.grantee) as grantee, x.privilege_type as priv
  from pg_attribute a join _tables t on t.oid = a.attrelid, aclexplode(a.attacl) x where a.attnum > 0 and a.attacl is not null;
select pg_temp.ok(not exists (select * from _act_col except select * from _exp_col) and not exists (select * from _exp_col except select * from _act_col),
                  'column-level grants are exactly the 9 sever-only/clearance column UPDATE grants (purge: identity, signal and idempotency columns only)');
select pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace,
                                   aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
                              where n.nspname = 'rewards' and c.relkind = 'S' and a.grantee <> c.relowner), 'rewards sequences have no non-owner grant');

-- policies, exactly
create temp table _exp_pol (tablename text, policyname text, cmd text, role text);
insert into _exp_pol values
 ('reward_settings','writer_reads_settings','SELECT','w'), ('reward_settings_history','writer_reads_settings_history','SELECT','w'),
 ('reward_policy_versions','writer_reads_policy','SELECT','w'), ('reward_location_zones','writer_reads_zones','SELECT','w'),
 ('visits','writer_reads_visits','SELECT','w'), ('visits','writer_inserts_visits','INSERT','w'),
 ('reward_ledger','writer_reads_ledger','SELECT','w'), ('reward_ledger','writer_inserts_ledger','INSERT','w'),
 ('reward_counters_user_day','writer_reads_user_counters','SELECT','w'), ('reward_counters_user_day','writer_inserts_user_counters','INSERT','w'), ('reward_counters_user_day','writer_updates_user_counters','UPDATE','w'),
 ('reward_counters_global_day','writer_reads_global_counters','SELECT','w'), ('reward_counters_global_day','writer_inserts_global_counters','INSERT','w'), ('reward_counters_global_day','writer_updates_global_counters','UPDATE','w'),
 ('reward_decisions','writer_reads_decisions','SELECT','w'), ('reward_decisions','writer_inserts_decisions','INSERT','w'),
 ('reward_holds','writer_reads_holds','SELECT','w'), ('reward_holds','writer_inserts_holds','INSERT','w'), ('reward_holds','writer_updates_holds','UPDATE','w'), ('reward_holds','writer_deletes_holds','DELETE','w'),
 ('visit_clearances','writer_reads_clearances','SELECT','w'), ('visit_clearances','writer_inserts_clearances','INSERT','w'), ('reward_deleted_aggregate_month','writer_reads_aggregate','SELECT','w'),
 ('visits','purge_reads_visits','SELECT','p'), ('visits','purge_updates_visits','UPDATE','p'), ('visits','purge_deletes_visits','DELETE','p'),
 ('reward_ledger','purge_reads_ledger','SELECT','p'), ('reward_ledger','purge_updates_ledger','UPDATE','p'), ('reward_ledger','purge_deletes_ledger','DELETE','p'),
 ('reward_decisions','purge_reads_decisions','SELECT','p'), ('reward_decisions','purge_updates_decisions','UPDATE','p'),
 ('reward_holds','purge_reads_holds','SELECT','p'), ('reward_holds','purge_updates_holds','UPDATE','p'), ('visit_clearances','purge_reads_clearances','SELECT','p'),
 ('reward_counters_user_day','purge_reads_user_counters','SELECT','p'), ('reward_counters_user_day','purge_deletes_user_counters','DELETE','p'),
 ('reward_deleted_aggregate_month','purge_reads_aggregate','SELECT','p'), ('reward_deleted_aggregate_month','purge_inserts_aggregate','INSERT','p'), ('reward_deleted_aggregate_month','purge_updates_aggregate','UPDATE','p');
select pg_temp.ok(not exists (select tablename, policyname, cmd from pg_policies where schemaname = 'rewards' except select tablename, policyname, cmd from _exp_pol)
                  and not exists (select tablename, policyname, cmd from _exp_pol except select tablename, policyname, cmd from pg_policies where schemaname = 'rewards'), 'the RLS policy list is exactly the 39 expected policies (14 P1 + 25 P2)');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'rewards') = 39, 'there are exactly 39 policies');
select pg_temp.ok((select bool_and(p.roles = case e.role when 'w' then '{reward_writer_owner}'::name[] else '{reward_purge_owner}'::name[] end) from pg_policies p join _exp_pol e using (tablename, policyname) where p.schemaname = 'rewards'),
                  'every policy applies to exactly its one reward role (writer or purge owner), never to a client role or PUBLIC');

-- functions
create temp table _fn as
  select p.oid, n.nspname || '.' || p.proname as sig, n.nspname, p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'rewards' or (n.nspname = 'public' and (p.proname in ('record_visit', 'delete_my_account', 'require_admin') or p.proname like 'admin_reward_%'));
select pg_temp.ok((select array_agg(sig order by sig) from _fn where nspname = 'rewards') = array[
  'rewards.award_held_visit','rewards.check_visit_ledger_consistency','rewards.decisions_validate','rewards.evaluate_visit','rewards.expire_cleared_holds','rewards.guard_aggregate_change',
  'rewards.guard_append_only','rewards.guard_counter_monotonic','rewards.guard_decisions_change','rewards.guard_holds_change','rewards.guard_ledger_change','rewards.guard_settings_delete',
  'rewards.guard_truncate','rewards.guard_visits_change','rewards.is_valid_time_zone','rewards.ledger_insert_guard','rewards.location_check','rewards.policy_versions_prospective',
  'rewards.purge_my_reward_data','rewards.reconciliation_report','rewards.record_visit_at','rewards.settings_history_trigger','rewards.user_balances','rewards.visit_is_retained'],
  'the rewards schema holds exactly the 24 expected functions');
select pg_temp.ok((select array_agg(sig order by sig) from _fn where nspname = 'public') = array['public.admin_reward_clear_hold','public.admin_reward_finalize_reversal','public.admin_reward_hold_user',
  'public.admin_reward_recommend_reversal','public.delete_my_account','public.record_visit','public.require_admin'], 'the public functions in scope are exactly record_visit, the four admin reward RPCs, delete_my_account and require_admin');
select pg_temp.ok((select array_agg(sig order by sig) from _fn where prosecdef) = array['public.admin_reward_clear_hold','public.admin_reward_finalize_reversal','public.admin_reward_hold_user',
  'public.admin_reward_recommend_reversal','public.delete_my_account','public.record_visit','public.require_admin','rewards.award_held_visit','rewards.check_visit_ledger_consistency',
  'rewards.expire_cleared_holds','rewards.location_check','rewards.purge_my_reward_data','rewards.record_visit_at'], 'the SECURITY DEFINER surface is exactly the 13 expected functions');
select pg_temp.ok((select array_agg(sig order by sig) from _fn where owner = 'reward_writer_owner') = array['public.admin_reward_clear_hold','public.admin_reward_finalize_reversal','public.admin_reward_hold_user',
  'public.admin_reward_recommend_reversal','public.record_visit','rewards.award_held_visit','rewards.check_visit_ledger_consistency','rewards.expire_cleared_holds','rewards.reconciliation_report','rewards.record_visit_at'],
  'the writer owns exactly ten functions (the recorder, its wrapper, the admin RPCs, clearance award, the consistency check, expiry and reconciliation)');
select pg_temp.ok((select array_agg(sig order by sig) from _fn where owner = 'reward_purge_owner') = array['rewards.purge_my_reward_data'], 'the purge owner owns exactly one function: the purge');
select pg_temp.ok((select every(owner = current_user) from _fn where owner not in ('reward_writer_owner', 'reward_purge_owner')), 'every other function (guards, pure evaluation, helpers, existing public ones) is owned by the migration role');
select pg_temp.ok((select every(proconfig is not null and exists (select 1 from unnest(proconfig) c where c ~ '^search_path=("")?$|^search_path=pg_catalog$')) from _fn where sig <> 'public.delete_my_account' or true),
                  'every function in scope has a fixed search_path (empty, or pg_catalog for the pure zone check)');
select pg_temp.ok((select every(proacl is not null) from _fn where nspname = 'rewards' or proname like 'admin_reward_%' or proname = 'record_visit'), 'no rewards function keeps the default (PUBLIC) EXECUTE: every ACL is explicit');
create temp table _exp_fn (sig text, grantee text);
insert into _exp_fn values
 ('rewards.is_valid_time_zone', 'reward_writer_owner'), ('rewards.evaluate_visit', 'reward_writer_owner'), ('rewards.location_check', 'reward_writer_owner'),
 ('rewards.visit_is_retained', 'reward_writer_owner'), ('rewards.visit_is_retained', 'reward_purge_owner'),
 ('rewards.purge_my_reward_data', current_user),
 ('public.record_visit', 'authenticated'),
 ('public.admin_reward_hold_user', 'authenticated'), ('public.admin_reward_clear_hold', 'authenticated'),
 ('public.admin_reward_recommend_reversal', 'authenticated'), ('public.admin_reward_finalize_reversal', 'authenticated');
create temp table _act_fn as
  select f.sig, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
  from _fn f, aclexplode(f.proacl) a where a.grantee <> (select oid from pg_roles where rolname = f.owner) and a.privilege_type = 'EXECUTE'
    and (f.nspname = 'rewards' or f.proname like 'admin_reward_%' or f.proname = 'record_visit');
select pg_temp.ok(not exists (select * from _act_fn except select * from _exp_fn) and not exists (select * from _exp_fn except select * from _act_fn),
                  'function EXECUTE grants are exactly: writer on 4 internals, purge owner on visit_is_retained, the deletion-path owner on the purge, authenticated on record_visit and the four admin RPCs');
select pg_temp.ok(not exists (select 1 from _fn f where (has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('service_role', f.oid, 'EXECUTE'))
                                and (f.nspname = 'rewards' or f.proname like 'admin_reward_%' or f.proname = 'record_visit')), 'anon and service_role can execute no rewards function, admin reward RPC or record_visit');
select pg_temp.ok(has_function_privilege('service_role', 'public.require_admin()', 'EXECUTE') and not has_function_privilege('anon', 'public.require_admin()', 'EXECUTE'),
                  'unchanged pre-existing fact: service_role keeps its default EXECUTE on public.require_admin (the P2 delta is only the writer grant, proven by test 07); it still cannot reach any admin reward RPC');
select pg_temp.ok((select array_agg(sig order by sig) from _fn f where has_function_privilege('authenticated', f.oid, 'EXECUTE'))
                  = array['public.admin_reward_clear_hold','public.admin_reward_finalize_reversal','public.admin_reward_hold_user','public.admin_reward_recommend_reversal','public.delete_my_account','public.record_visit'],
                  'authenticated can execute exactly the four admin RPCs, record_visit and the existing delete_my_account (NOT require_admin, the purge or any internal)');
select pg_temp.ok(not exists (select 1 from _fn f where has_function_privilege('public', f.oid, 'EXECUTE') and f.sig <> 'public.delete_my_account'), 'PUBLIC can execute no rewards function');
select pg_temp.ok(not exists (select 1 from _act_fn where grantee in ('anon', 'service_role', 'PUBLIC')), 'no ACL entry names anon, service_role or PUBLIC');
select pg_temp.ok(has_function_privilege('reward_writer_owner', 'public.require_admin()', 'EXECUTE') and not has_function_privilege('reward_purge_owner', 'public.require_admin()', 'EXECUTE')
                  and not has_function_privilege('authenticated', 'public.require_admin()', 'EXECUTE') and not has_function_privilege('anon', 'public.require_admin()', 'EXECUTE'),
                  'the admin gate public.require_admin is executable by the writer (the one P2 grant) and never by anon, authenticated or the purge owner');
select pg_temp.ok(not has_table_privilege('reward_writer_owner', 'public.admin_users', 'SELECT') and not has_table_privilege('reward_purge_owner', 'public.admin_users', 'SELECT')
                  and not has_table_privilege('authenticated', 'public.admin_users', 'SELECT'), 'nobody in scope has direct access to public.admin_users');

-- schemas, ownership, default privileges
select pg_temp.ok((select pg_get_userbyid(nspowner) = current_user from pg_namespace where nspname = 'rewards'), 'the rewards schema is owned by the migration role');
select pg_temp.ok(not has_schema_privilege('anon', 'rewards', 'USAGE') and not has_schema_privilege('authenticated', 'rewards', 'USAGE')
                  and not has_schema_privilege('service_role', 'rewards', 'USAGE') and not has_schema_privilege('public', 'rewards', 'USAGE'), 'no client role or PUBLIC has USAGE on the rewards schema');
select pg_temp.ok(not has_schema_privilege('anon', 'rewards', 'CREATE') and not has_schema_privilege('authenticated', 'rewards', 'CREATE') and not has_schema_privilege('service_role', 'rewards', 'CREATE')
                  and not has_schema_privilege('reward_writer_owner', 'rewards', 'CREATE') and not has_schema_privilege('reward_purge_owner', 'rewards', 'CREATE'), 'nobody but the owner has CREATE on the rewards schema (every temporary CREATE was revoked)');
select pg_temp.ok(not has_schema_privilege('reward_writer_owner', 'public', 'CREATE') and not has_schema_privilege('reward_purge_owner', 'public', 'CREATE'), 'neither reward role has CREATE on schema public');
select pg_temp.ok((select array_agg(pg_get_userbyid(a.grantee)::text order by pg_get_userbyid(a.grantee)::text) from pg_namespace n, aclexplode(n.nspacl) a where n.nspname = 'rewards' and a.grantee <> n.nspowner and a.privilege_type = 'USAGE' and a.grantee <> 0)
                  = array['reward_purge_owner', 'reward_writer_owner'], 'the only non-owner USAGE grants on the rewards schema are the writer and the purge owner');
select pg_temp.ok(has_schema_privilege('reward_writer_owner', 'auth', 'USAGE') and has_schema_privilege('reward_purge_owner', 'auth', 'USAGE')
                  and not has_schema_privilege('reward_writer_owner', 'auth', 'CREATE') and not has_schema_privilege('reward_purge_owner', 'auth', 'CREATE'), 'both reward roles may use the auth schema (auth.uid) but not create in it');
select pg_temp.ok(not has_table_privilege('reward_writer_owner', 'auth.users', 'SELECT') and not has_table_privilege('reward_purge_owner', 'auth.users', 'SELECT')
                  and not has_table_privilege('reward_purge_owner', 'auth.users', 'DELETE'), 'neither reward role can read or delete auth.users');
select pg_temp.ok(not exists (select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'rewards'), 'no default privileges exist in the rewards schema');
select pg_temp.ok(not exists (select 1 from pg_default_acl d where d.defaclrole in ('reward_writer_owner'::regrole, 'reward_purge_owner'::regrole)), 'neither reward role has default privileges anywhere');
select pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname ~ '^(visits|reward_|visit_)'), 'no rewards table was created in schema public');
select pg_temp.ok((select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rewards' and not t.tgisinternal) = 
                  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rewards' and not t.tgisinternal and t.tgenabled = 'O'), 'every rewards trigger is enabled (none is disabled or replica-only)');
-- the P1 rewards-DML guard on the legacy-visible tables: P2 does not touch policies of profiles/check_ins
select pg_temp.ok(not exists (select 1 from pg_policies where schemaname = 'public' and (policyname ~ 'reward' or qual ~ 'rewards\.' or with_check ~ 'rewards\.')), 'no public-schema RLS policy refers to rewards objects');

-- ---------------------------------------------------------------- refusal matrix, executed under each role
create function pg_temp.try(roles text, q text) returns text language plpgsql as $$
declare st text;
begin
  execute 'set role ' || quote_ident(roles);
  begin
    execute q;
    execute 'reset role';
    return 'ok';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    execute 'reset role';
    return st;
  end;
end $$;
create temp table _matrix (role text, tbl text, op text, got text);
do $$
declare r text; t text; op text; q text;
begin
  foreach r in array array['anon', 'authenticated', 'service_role', 'reward_writer_owner', 'reward_purge_owner'] loop
    for t in select relname from _tables order by relname loop
      foreach op in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
        q := case op
          when 'select' then format('select count(*) from rewards.%I', t)
          when 'insert' then format('insert into rewards.%I select * from rewards.%I where false', t, t)
          when 'update' then format('update rewards.%I set %s where false', t, (select quote_ident(attname) || ' = ' || quote_ident(attname) from pg_attribute where attrelid = ('rewards.' || quote_ident(t))::regclass and attnum > 0 and not attisdropped order by attnum limit 1))
          when 'delete' then format('delete from rewards.%I where false', t)
          else format('truncate rewards.%I', t) end;
        insert into _matrix values (r, t, op, pg_temp.try(r, q));
      end loop;
    end loop;
  end loop;
end $$;
select pg_temp.ok((select count(*) from _matrix) = 5 * 12 * 5, 'the matrix covers 5 roles x 12 tables x 5 operations');
select pg_temp.ok(not exists (select 1 from _matrix where role in ('anon', 'authenticated', 'service_role') and got <> '42501'),
                  'anon, authenticated and service_role are refused (42501) every select/insert/update/delete/truncate on every rewards table');
select pg_temp.ok(not exists (select 1 from _matrix where op = 'truncate' and got <> '42501'), 'NOBODY holds TRUNCATE: every role is refused on every table');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_writer_owner' and op = 'select' and got <> 'ok'), 'the writer can SELECT every table');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_writer_owner' and op = 'insert'
                              and ((tbl in ('visits', 'reward_ledger', 'reward_counters_user_day', 'reward_counters_global_day', 'reward_decisions', 'reward_holds', 'visit_clearances')) <> (got = 'ok'))),
                  'the writer can INSERT only into visits, the ledger, the two counters, decisions, holds and clearances (never settings, policy, zones or the aggregate)');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_writer_owner' and op = 'update' and ((tbl in ('reward_counters_user_day', 'reward_counters_global_day')) <> (got = 'ok'))),
                  'the writer can UPDATE only the two counters at table level (holds clearance is column-level and probed separately)');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_writer_owner' and op = 'delete' and ((tbl = 'reward_holds') <> (got = 'ok'))), 'the writer can DELETE only from holds (the 90-day expiry; the guard decides which rows)');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_purge_owner' and op = 'select' and ((tbl in ('visits', 'reward_ledger', 'reward_decisions', 'reward_holds', 'visit_clearances', 'reward_counters_user_day', 'reward_deleted_aggregate_month')) <> (got = 'ok'))),
                  'the purge owner can SELECT exactly its seven tables (no settings, policy, zones, global counters)');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_purge_owner' and op = 'insert' and ((tbl = 'reward_deleted_aggregate_month') <> (got = 'ok'))),
                  'the purge owner can INSERT only into the anonymous aggregate (NO INSERT into visits or the ledger)');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_purge_owner' and op = 'update' and ((tbl = 'reward_deleted_aggregate_month') <> (got = 'ok'))),
                  'the purge owner has table-level UPDATE only on the aggregate (all other updates are column-level, probed separately)');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_purge_owner' and op = 'delete' and ((tbl in ('visits', 'reward_ledger', 'reward_counters_user_day')) <> (got = 'ok'))),
                  'the purge owner can DELETE only from visits, the ledger and the per-user counters');
-- column-level probes
select pg_temp.ok(pg_temp.try('reward_purge_owner', $$update rewards.visits set user_id = user_id where false$$) = 'ok' and pg_temp.try('reward_purge_owner', $$update rewards.visits set occurred_at = occurred_at where false$$) = '42501'
              and pg_temp.try('reward_purge_owner', $$update rewards.reward_ledger set amount = amount where false$$) = '42501' and pg_temp.try('reward_purge_owner', $$update rewards.reward_decisions set reason = reason where false$$) = '42501'
              and pg_temp.try('reward_purge_owner', $$update rewards.reward_holds set cleared_at = cleared_at where false$$) = '42501',
                  'column probes: the purge owner can update the identity column and no other');
select pg_temp.ok(pg_temp.try('reward_writer_owner', $$update rewards.reward_holds set cleared_at = cleared_at where false$$) = 'ok' and pg_temp.try('reward_writer_owner', $$update rewards.reward_holds set user_id = user_id where false$$) = '42501'
              and pg_temp.try('reward_writer_owner', $$update rewards.reward_holds set hold_decision_id = hold_decision_id where false$$) = '42501', 'column probes: the writer can update only the two clearance columns of a hold');

-- ---------------------------------------------------------------- function surface under SET ROLE
create temp table _fq (sig text, call text);
insert into _fq values
 ('evaluate_visit', 'select rewards.evaluate_visit(5,5,4,60,1,0,0,true,10,false)'),
 ('record_visit_at', $$select rewards.record_visit_at(now(), '00000000-0000-0000-0000-000000000001', 0, 0, 'abcdefghijklmnop', null)$$),
 ('award_held_visit', 'select rewards.award_held_visit(gen_random_uuid(), gen_random_uuid())'),
 ('reconciliation_report', 'select * from rewards.reconciliation_report()'),
 ('expire_cleared_holds', 'select rewards.expire_cleared_holds()'),
 ('purge_my_reward_data', 'select rewards.purge_my_reward_data()'),
 ('visit_is_retained', 'select rewards.visit_is_retained(gen_random_uuid())'),
 ('user_balances', 'select * from rewards.user_balances(gen_random_uuid())');
select pg_temp.ok(not exists (select 1 from _fq, unnest(array['anon', 'authenticated', 'service_role']) r where pg_temp.try(r, call) <> '42501'), 'no client role can call any internal rewards function (42501 for all 8 x 3)');
select pg_temp.ok(pg_temp.try('anon', $$select public.record_visit('00000000-0000-0000-0000-000000000001', 0, 0, 'abcdefghijklmnop')$$) = '42501', 'anon cannot call record_visit');
select pg_temp.ok(pg_temp.try('service_role', $$select public.record_visit('00000000-0000-0000-0000-000000000001', 0, 0, 'abcdefghijklmnop')$$) = '42501', 'service_role cannot call record_visit');
select pg_temp.ok(pg_temp.try('reward_writer_owner', $$update rewards.reward_settings set rewards_enabled = true$$) = '42501', 'the writer cannot enable rewards');
select pg_temp.ok(pg_temp.try('reward_writer_owner', $$insert into rewards.reward_policy_versions (effective_from, spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day) values (now() + interval '1 day', 1,1,1,1)$$) = '42501', 'the writer cannot create a policy version');
select pg_temp.ok(pg_temp.try('reward_writer_owner', $$insert into rewards.reward_location_zones values ('00000000-0000-0000-0000-000000000001', 'UTC')$$) = '42501', 'the writer cannot create a location zone');
select pg_temp.ok(pg_temp.try('reward_writer_owner', $$select rewards.purge_my_reward_data()$$) = '42501' and pg_temp.try('reward_purge_owner', $$select rewards.record_visit_at(now(), '00000000-0000-0000-0000-000000000001', 0, 0, 'abcdefghijklmnop', null)$$) = '42501',
                  'the writer cannot purge and the purge owner cannot record (no cross-authority)');
select pg_temp.ok(pg_temp.try('reward_purge_owner', $$select public.require_admin()$$) = '42501' and pg_temp.try('anon', $$select public.require_admin()$$) = '42501' and pg_temp.try('authenticated', $$select public.require_admin()$$) = '42501',
                  'the purge owner, anon and authenticated cannot use the admin gate');

-- ---------------------------------------------------------------- search_path attack: decoys in an attacker schema change nothing
select pg_temp.enable_rewards(1000000);
select pg_temp.mkuser(41) as u \gset
select pg_temp.mkloc(30.0) as l \gset
create schema evil;
create table evil.visits (like rewards.visits including all);
create table evil.reward_ledger (like rewards.reward_ledger including all);
create table evil.reward_settings (like rewards.reward_settings including all);
create function evil.is_valid_time_zone(text) returns boolean language sql as $$ select false $$;
create function evil.evaluate_visit(integer,integer,integer,integer,integer,integer,integer,boolean,integer,boolean) returns table (a text, b text, c integer, d integer) language sql as $$ select 'x','y',999,999 $$;
set search_path = evil, public;
select pg_temp.visit_at('2026-10-26 15:00:00+00', :'u', :'l', 'searchpath-key-0000001') as r \gset
set search_path = "$user", public;
select pg_temp.ok(pg_temp.oc(:'r'::jsonb) = 'awarded|awarded|5|5', 'with a hostile search_path the writer still uses the real objects and policy');
select pg_temp.ok((select count(*) from evil.visits) = 0 and (select count(*) from evil.reward_ledger) = 0 and (select count(*) from rewards.visits where user_id = :'u') = 1,
                  'nothing was written to the decoy schema');
-- ---------------------------------------------------------------- the golden privilege list (evidence)
\o
\echo '== P2 golden privilege list: table grants to non-owner roles (owner of every table: the migration role)'
select relname, grantee, priv from _exp_tbl order by relname, grantee, priv;
\echo '== P2 golden column-level grants'
select relname, attname, grantee, priv from _exp_col order by relname, attname, grantee;
\echo '== P2 golden function EXECUTE grants to non-owner roles'
select sig, grantee from _exp_fn order by sig, grantee;
\echo '== functions: owner, SECURITY DEFINER, fixed search_path'
select sig, owner, prosecdef as security_definer, proconfig from _fn order by sig;
\echo '== RLS policies'
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'rewards' order by tablename, policyname;
\echo '== role attributes'
select rolname, rolcanlogin, rolinherit, rolbypassrls, rolsuper from pg_roles where rolname in ('reward_writer_owner', 'reward_purge_owner', 'anon', 'authenticated', 'service_role') order by 1;
\echo '== refusal matrix (5 roles x 12 tables x 5 operations were executed): writer and purge owner'
select role, tbl, op, got from _matrix where role in ('reward_writer_owner', 'reward_purge_owner') order by role, tbl, op;
\echo '== refusal matrix summary by role: statements refused (42501) and permitted'
select role, count(*) filter (where got = '42501') as refused, count(*) filter (where got = 'ok') as permitted, count(*) filter (where got not in ('ok', '42501')) as other from _matrix group by role order by role;
\o /dev/null
select pg_temp.finish();
