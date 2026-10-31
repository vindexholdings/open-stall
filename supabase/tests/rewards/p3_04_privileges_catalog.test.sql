-- P3 test 4 (privileges): the COMPLETE P3 catalog inventory (superset of P2) and the executed role x table x operation refusal matrix for the
-- four new tables, plus the function surface (owners, SECURITY DEFINER, fixed search_path, EXECUTE ACLs). The exact P1/P2 inventories keep
-- running unchanged on their own builds; on the P3 build this file supersedes them. Rewards are disabled here, as on a fresh cluster.
\i :ROOT/supabase/tests/rewards/helpers.sql

-- ---------------------------------------------------------------- roles unchanged
select pg_temp.ok((select bool_and(not rolcanlogin and not rolinherit and not rolbypassrls and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication)
                   from pg_roles where rolname in ('reward_writer_owner', 'reward_purge_owner')) and (select count(*) from pg_roles where rolname in ('reward_writer_owner', 'reward_purge_owner')) = 2,
                  'still exactly two reward roles, NOLOGIN/NOINHERIT/no BYPASSRLS/not superuser (P3 adds no role)');
select pg_temp.ok(not exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname in ('reward_writer_owner', 'reward_purge_owner'))
              and not exists (select 1 from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles r on r.oid = m.member
                              where g.rolname in ('reward_writer_owner', 'reward_purge_owner') and r.rolname in ('anon', 'authenticated', 'service_role')),
                  'no reward role is a member of any role, and no client role is a member of either (no SET ROLE path)');

-- ---------------------------------------------------------------- tables
create temp table _tables as select c.oid, c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rewards' and c.relkind in ('r', 'p', 'v', 'm', 'f');
select pg_temp.ok((select array_agg(relname::text order by relname) from _tables) = array['achievement_calc_state','achievement_chains','achievement_definitions','achievement_eval_queue','achievement_events',
  'reward_counters_global_day','reward_counters_user_day','reward_decisions','reward_deleted_aggregate_month','reward_holds','reward_ledger','reward_location_zones','reward_policy_versions',
  'reward_settings','reward_settings_history','visit_clearances','visits'], 'the rewards schema holds exactly the seventeen expected tables (12 earlier + 5 achievement tables) and no view');
select pg_temp.ok((select every(owner = current_user and relrowsecurity and relforcerowsecurity) from _tables), 'every table is owned by the migration role with RLS enabled AND forced');
create temp table _exp_tbl (relname text, grantee text, priv text);
insert into _exp_tbl values
 ('reward_settings','reward_writer_owner','SELECT'), ('reward_settings_history','reward_writer_owner','SELECT'), ('reward_policy_versions','reward_writer_owner','SELECT'), ('reward_location_zones','reward_writer_owner','SELECT'),
 ('visits','reward_writer_owner','SELECT'), ('visits','reward_writer_owner','INSERT'), ('reward_ledger','reward_writer_owner','SELECT'), ('reward_ledger','reward_writer_owner','INSERT'),
 ('reward_counters_user_day','reward_writer_owner','SELECT'), ('reward_counters_user_day','reward_writer_owner','INSERT'), ('reward_counters_user_day','reward_writer_owner','UPDATE'),
 ('reward_counters_global_day','reward_writer_owner','SELECT'), ('reward_counters_global_day','reward_writer_owner','INSERT'), ('reward_counters_global_day','reward_writer_owner','UPDATE'),
 ('reward_decisions','reward_writer_owner','SELECT'), ('reward_decisions','reward_writer_owner','INSERT'),
 ('reward_holds','reward_writer_owner','SELECT'), ('reward_holds','reward_writer_owner','INSERT'), ('reward_holds','reward_writer_owner','DELETE'),
 ('visit_clearances','reward_writer_owner','SELECT'), ('visit_clearances','reward_writer_owner','INSERT'), ('reward_deleted_aggregate_month','reward_writer_owner','SELECT'),
 ('visits','reward_purge_owner','SELECT'), ('visits','reward_purge_owner','DELETE'), ('reward_ledger','reward_purge_owner','SELECT'), ('reward_ledger','reward_purge_owner','DELETE'),
 ('reward_decisions','reward_purge_owner','SELECT'), ('reward_holds','reward_purge_owner','SELECT'), ('visit_clearances','reward_purge_owner','SELECT'),
 ('reward_counters_user_day','reward_purge_owner','SELECT'), ('reward_counters_user_day','reward_purge_owner','DELETE'),
 ('reward_deleted_aggregate_month','reward_purge_owner','SELECT'), ('reward_deleted_aggregate_month','reward_purge_owner','INSERT'), ('reward_deleted_aggregate_month','reward_purge_owner','UPDATE'),
 -- P3
 ('achievement_definitions','reward_writer_owner','SELECT'),
 ('achievement_chains','reward_writer_owner','SELECT'), ('achievement_chains','reward_writer_owner','INSERT'),
 ('achievement_events','reward_writer_owner','SELECT'), ('achievement_events','reward_writer_owner','INSERT'),
 ('achievement_eval_queue','reward_writer_owner','SELECT'), ('achievement_eval_queue','reward_writer_owner','INSERT'), ('achievement_eval_queue','reward_writer_owner','UPDATE'), ('achievement_eval_queue','reward_writer_owner','DELETE'),
 ('achievement_chains','reward_purge_owner','SELECT'), ('achievement_chains','reward_purge_owner','DELETE'),
 ('achievement_events','reward_purge_owner','SELECT'), ('achievement_events','reward_purge_owner','DELETE'),
 ('achievement_eval_queue','reward_purge_owner','SELECT'), ('achievement_eval_queue','reward_purge_owner','DELETE'),
 ('achievement_calc_state','reward_writer_owner','SELECT'), ('achievement_calc_state','reward_writer_owner','INSERT'), ('achievement_calc_state','reward_writer_owner','UPDATE'), ('achievement_calc_state','reward_writer_owner','DELETE'),
 ('achievement_calc_state','reward_purge_owner','SELECT'), ('achievement_calc_state','reward_purge_owner','DELETE');
create temp table _act_tbl as
  select t.relname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee, a.privilege_type as priv
  from _tables t, aclexplode(coalesce((select relacl from pg_class where oid = t.oid), acldefault('r', (select relowner from pg_class where oid = t.oid)))) a
  where a.grantee <> (select relowner from pg_class where oid = t.oid);
select pg_temp.ok(not exists (select * from _act_tbl except select * from _exp_tbl), 'no table grant beyond the golden list (any extra grant fails)');
select pg_temp.ok(not exists (select * from _exp_tbl except select * from _act_tbl), 'every golden table grant exists');
select pg_temp.ok(not exists (select 1 from _act_tbl where grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')), 'no table is granted to PUBLIC, anon, authenticated or service_role');
create temp table _exp_col (relname text, attname text, grantee text, priv text);
insert into _exp_col values
 ('visits','user_id','reward_purge_owner','UPDATE'), ('visits','idempotency_key','reward_purge_owner','UPDATE'), ('visits','accuracy_bucket','reward_purge_owner','UPDATE'), ('visits','distance_bucket','reward_purge_owner','UPDATE'),
 ('reward_ledger','user_id','reward_purge_owner','UPDATE'), ('reward_holds','user_id','reward_purge_owner','UPDATE'), ('reward_decisions','subject_user_id','reward_purge_owner','UPDATE'),
 ('reward_holds','cleared_decision_id','reward_writer_owner','UPDATE'), ('reward_holds','cleared_at','reward_writer_owner','UPDATE'),
 ('achievement_chains','user_id','reward_purge_owner','UPDATE');
create temp table _act_col as
  select t.relname, a.attname, pg_get_userbyid(x.grantee) as grantee, x.privilege_type as priv
  from pg_attribute a join _tables t on t.oid = a.attrelid, aclexplode(a.attacl) x where a.attnum > 0 and a.attacl is not null;
select pg_temp.ok(not exists (select * from _act_col except select * from _exp_col) and not exists (select * from _exp_col except select * from _act_col),
                  'column-level grants are exactly the 10 expected UPDATE grants (the new one: the purge role may update achievement_chains.user_id only; NO column grant on events)');
select pg_temp.ok(not exists (select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'rewards')
              and not exists (select 1 from pg_default_acl d where d.defaclrole in ('reward_writer_owner'::regrole, 'reward_purge_owner'::regrole)), 'no default privilege is defined for or in the rewards schema');

-- ---------------------------------------------------------------- policies
create temp table _exp_pol (tablename text, policyname text, cmd text, role text);
insert into _exp_pol
select tablename, policyname, cmd, case when roles = '{reward_writer_owner}' then 'w' when roles = '{reward_purge_owner}' then 'p' else '?' end from pg_policies where schemaname = 'rewards' and tablename not like 'achievement_%';
insert into _exp_pol values
 ('achievement_definitions','writer_reads_definitions','SELECT','w'),
 ('achievement_chains','writer_reads_chains','SELECT','w'), ('achievement_chains','writer_inserts_chains','INSERT','w'),
 ('achievement_events','writer_reads_events','SELECT','w'), ('achievement_events','writer_inserts_events','INSERT','w'),
 ('achievement_eval_queue','writer_reads_queue','SELECT','w'), ('achievement_eval_queue','writer_inserts_queue','INSERT','w'), ('achievement_eval_queue','writer_updates_queue','UPDATE','w'), ('achievement_eval_queue','writer_deletes_queue','DELETE','w'),
 ('achievement_chains','purge_reads_chains','SELECT','p'), ('achievement_chains','purge_updates_chains','UPDATE','p'), ('achievement_chains','purge_deletes_chains','DELETE','p'),
 ('achievement_events','purge_reads_events','SELECT','p'), ('achievement_events','purge_deletes_events','DELETE','p'),
 ('achievement_eval_queue','purge_reads_queue','SELECT','p'), ('achievement_eval_queue','purge_deletes_queue','DELETE','p'),
 ('achievement_calc_state','writer_reads_calc','SELECT','w'), ('achievement_calc_state','writer_inserts_calc','INSERT','w'), ('achievement_calc_state','writer_updates_calc','UPDATE','w'), ('achievement_calc_state','writer_deletes_calc','DELETE','w'),
 ('achievement_calc_state','purge_reads_calc','SELECT','p'), ('achievement_calc_state','purge_deletes_calc','DELETE','p');
select pg_temp.ok((select count(*) from pg_policies where schemaname = 'rewards') = 61 and (select count(*) from pg_policies where schemaname = 'rewards' and tablename like 'achievement_%') = 22,
                  'exactly 61 policies: the 39 earlier ones are untouched, plus 22 for the five achievement tables');
select pg_temp.ok(not exists (select tablename, policyname, cmd from pg_policies where schemaname = 'rewards' except select tablename, policyname, cmd from _exp_pol)
              and not exists (select tablename, policyname, cmd from _exp_pol except select tablename, policyname, cmd from pg_policies where schemaname = 'rewards'), 'the policy list is exactly the expected set');
select pg_temp.ok((select bool_and(p.roles = case e.role when 'w' then '{reward_writer_owner}'::name[] else '{reward_purge_owner}'::name[] end) from pg_policies p join _exp_pol e using (tablename, policyname) where p.schemaname = 'rewards'),
                  'every policy applies to exactly one reward role, never a client role or PUBLIC');

-- ---------------------------------------------------------------- functions
create temp table _fn as
  select p.oid, n.nspname || '.' || p.proname as sig, n.nspname, p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'rewards' or (n.nspname = 'public' and (p.proname in ('record_visit', 'delete_my_account', 'require_admin', 'get_my_progress', 'repair_achievements') or p.proname like 'admin_reward_%'));
create temp table _p3fn (sig text);
insert into _p3fn values ('rewards.ach_today'), ('rewards.ach_rule'), ('rewards.ach_window_start'), ('rewards.ach_select_version'), ('rewards.ach_metric_value'), ('rewards.ach_metrics'), ('rewards.ach_scope_for_day'),
  ('rewards.ach_candidate_chains'), ('rewards.ach_enqueue'), ('rewards.ach_calc_invalidate'), ('rewards.ach_calc_pass'), ('rewards.ach_calc_get'), ('rewards.ach_calc_start'), ('rewards.ach_calc_step'), ('rewards.guard_achievement_calc_state'), ('rewards.evaluate_achievements'), ('rewards.ach_run'), ('rewards.ach_process_queue'),
  ('rewards.guard_achievement_definitions'), ('rewards.guard_achievement_events'), ('rewards.guard_achievement_chains'), ('rewards.guard_achievement_queue'),
  ('public.get_my_progress'), ('public.repair_achievements');
select pg_temp.ok((select count(*) from _fn where nspname = 'rewards') = 46 and (select count(*) from _fn where nspname = 'public') = 9, 'the surface is 46 rewards functions and 9 public ones in scope (24 + 22, 7 + 2)');
select pg_temp.ok(not exists (select sig from _p3fn except select sig from _fn) and (select count(*) from _fn where sig in (select sig from _p3fn)) = 24, 'all 24 new P3 functions exist (22 in rewards, get_my_progress and repair_achievements in public)');
select pg_temp.ok((select array_agg(sig order by sig) from _fn where prosecdef) = array['public.admin_reward_clear_hold','public.admin_reward_finalize_reversal','public.admin_reward_hold_user',
  'public.admin_reward_recommend_reversal','public.delete_my_account','public.get_my_progress','public.record_visit','public.repair_achievements','public.require_admin',
  'rewards.ach_calc_get','rewards.ach_calc_invalidate','rewards.ach_calc_pass','rewards.ach_calc_start','rewards.ach_calc_step','rewards.ach_enqueue','rewards.ach_process_queue','rewards.ach_run','rewards.award_held_visit','rewards.check_visit_ledger_consistency','rewards.evaluate_achievements',
  'rewards.expire_cleared_holds','rewards.location_check','rewards.purge_my_reward_data','rewards.record_visit_at'], 'the SECURITY DEFINER surface is exactly 24 functions (13 earlier + 11 new)');
select pg_temp.ok((select array_agg(sig order by sig) from _fn where owner = 'reward_writer_owner') = array['public.admin_reward_clear_hold','public.admin_reward_finalize_reversal','public.admin_reward_hold_user',
  'public.admin_reward_recommend_reversal','public.get_my_progress','public.record_visit','public.repair_achievements','rewards.ach_calc_get','rewards.ach_calc_invalidate','rewards.ach_calc_pass','rewards.ach_calc_start','rewards.ach_calc_step','rewards.ach_candidate_chains','rewards.ach_enqueue','rewards.ach_metric_value','rewards.ach_metrics',
  'rewards.ach_process_queue','rewards.ach_rule','rewards.ach_run','rewards.ach_scope_for_day','rewards.ach_select_version','rewards.ach_today','rewards.ach_window_start','rewards.award_held_visit',
  'rewards.check_visit_ledger_consistency','rewards.evaluate_achievements','rewards.expire_cleared_holds','rewards.reconciliation_report','rewards.record_visit_at'],
  'the writer owns exactly 29 functions (10 earlier + 19 new engine and public ones)');
select pg_temp.ok((select array_agg(sig order by sig) from _fn where owner = 'reward_purge_owner') = array['rewards.purge_my_reward_data'], 'the purge owner still owns exactly one function: the (extended) purge');
select pg_temp.ok((select every(owner = current_user) from _fn where owner not in ('reward_writer_owner', 'reward_purge_owner')), 'every other function (guards, pure evaluation, existing public ones) is owned by the migration role');
select pg_temp.ok((select every(proconfig is not null and exists (select 1 from unnest(proconfig) c where c ~ '^search_path=("")?$|^search_path=pg_catalog$')) from _fn), 'every function in scope has a fixed search_path');
select pg_temp.ok((select proconfig @> array['lock_timeout=250ms'] from _fn where sig = 'rewards.evaluate_achievements') and (select count(*) from _fn where exists (select 1 from unnest(proconfig) c where c like 'lock_timeout=%')) = 1,
                  'exactly one function carries a function-level lock_timeout (the evaluator''s bounded wait, 250 ms)');
select pg_temp.ok((select every(proacl is not null) from _fn where nspname = 'rewards' or proname like 'admin_reward_%' or proname in ('record_visit', 'get_my_progress', 'repair_achievements')), 'no rewards function keeps the default (PUBLIC) EXECUTE: every ACL is explicit');
create temp table _exp_fn (sig text, grantee text);
insert into _exp_fn values
 ('rewards.is_valid_time_zone', 'reward_writer_owner'), ('rewards.evaluate_visit', 'reward_writer_owner'), ('rewards.location_check', 'reward_writer_owner'),
 ('rewards.visit_is_retained', 'reward_writer_owner'), ('rewards.visit_is_retained', 'reward_purge_owner'), ('rewards.purge_my_reward_data', current_user),
 ('public.record_visit', 'authenticated'), ('public.admin_reward_hold_user', 'authenticated'), ('public.admin_reward_clear_hold', 'authenticated'),
 ('public.admin_reward_recommend_reversal', 'authenticated'), ('public.admin_reward_finalize_reversal', 'authenticated'),
 ('public.get_my_progress', 'authenticated'), ('public.repair_achievements', 'authenticated');
create temp table _act_fn as
  select f.sig, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
  from _fn f, aclexplode(f.proacl) a where a.grantee <> (select oid from pg_roles where rolname = f.owner) and a.privilege_type = 'EXECUTE'
    and (f.nspname = 'rewards' or f.proname like 'admin_reward_%' or f.proname in ('record_visit', 'get_my_progress', 'repair_achievements'));
select pg_temp.ok(not exists (select * from _act_fn except select * from _exp_fn) and not exists (select * from _exp_fn except select * from _act_fn),
                  'function EXECUTE grants are exactly the golden list: the 17 internal engine helpers are executable by their owner (the writer) and by no other role; authenticated only on get_my_progress and repair_achievements besides the earlier RPCs');
select pg_temp.ok(not exists (select 1 from _fn f where (has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('service_role', f.oid, 'EXECUTE'))
                                and (f.nspname = 'rewards' or f.proname like 'admin_reward_%' or f.proname in ('record_visit', 'get_my_progress', 'repair_achievements'))), 'anon and service_role can execute none of them');
select pg_temp.ok((select array_agg(sig order by sig) from _fn f where has_function_privilege('authenticated', f.oid, 'EXECUTE'))
                  = array['public.admin_reward_clear_hold','public.admin_reward_finalize_reversal','public.admin_reward_hold_user','public.admin_reward_recommend_reversal','public.delete_my_account',
                          'public.get_my_progress','public.record_visit','public.repair_achievements'],
                  'authenticated can execute exactly eight functions: the earlier six and get_my_progress and repair_achievements (NOT require_admin, the purge or any internal)');
select pg_temp.ok(not exists (select 1 from _fn f where has_function_privilege('public', f.oid, 'EXECUTE') and f.sig <> 'public.delete_my_account'), 'PUBLIC can execute no rewards function');
select pg_temp.ok(not has_schema_privilege('anon', 'rewards', 'USAGE') and not has_schema_privilege('authenticated', 'rewards', 'USAGE') and not has_schema_privilege('service_role', 'rewards', 'USAGE')
              and not has_schema_privilege('reward_writer_owner', 'rewards', 'CREATE') and not has_schema_privilege('reward_purge_owner', 'rewards', 'CREATE')
              and not has_schema_privilege('reward_writer_owner', 'public', 'CREATE'), 'no client role has any privilege on schema rewards, and neither reward role keeps CREATE anywhere');

-- ---------------------------------------------------------------- the executed refusal matrix on the four new tables (a privilege refusal is 42501)
create function pg_temp.try(r text, q text) returns text language plpgsql as $$
declare st text;
begin
  begin
    execute format('set local role %I', r);
    execute q;
    execute 'reset role';
    return 'permitted';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    execute 'reset role';
    return case when st = '42501' then 'refused' else 'permitted' end;
  end;
end $$;
create temp table _ops (t text, op text, q text);
insert into _ops values
 ('achievement_definitions','select','select count(*) from rewards.achievement_definitions'), ('achievement_definitions','insert','insert into rewards.achievement_definitions (achievement_key) values (null)'),
 ('achievement_definitions','update','update rewards.achievement_definitions set threshold = 1 where false'), ('achievement_definitions','delete','delete from rewards.achievement_definitions where false'),
 ('achievement_definitions','truncate','truncate rewards.achievement_definitions'),
 ('achievement_chains','select','select count(*) from rewards.achievement_chains'), ('achievement_chains','insert','insert into rewards.achievement_chains (achievement_key) values (null)'),
 ('achievement_chains','update_user_id','update rewards.achievement_chains set user_id = null where false'), ('achievement_chains','update_other','update rewards.achievement_chains set period_key = ''x'' where false'),
 ('achievement_chains','delete','delete from rewards.achievement_chains where false'), ('achievement_chains','truncate','truncate rewards.achievement_chains'),
 ('achievement_events','select','select count(*) from rewards.achievement_events'), ('achievement_events','insert','insert into rewards.achievement_events (seq) values (null)'),
 ('achievement_events','update','update rewards.achievement_events set qualifying_value = 1 where false'), ('achievement_events','delete','delete from rewards.achievement_events where false'),
 ('achievement_events','truncate','truncate rewards.achievement_events'),
 ('achievement_eval_queue','select','select count(*) from rewards.achievement_eval_queue'), ('achievement_eval_queue','insert','insert into rewards.achievement_eval_queue (reason) values (null)'),
 ('achievement_eval_queue','update','update rewards.achievement_eval_queue set reason = reason where false'), ('achievement_eval_queue','delete','delete from rewards.achievement_eval_queue where false'),
 ('achievement_eval_queue','truncate','truncate rewards.achievement_eval_queue'),
 ('achievement_calc_state','select','select count(*) from rewards.achievement_calc_state'), ('achievement_calc_state','insert','insert into rewards.achievement_calc_state (pass) values (null)'),
 ('achievement_calc_state','update','update rewards.achievement_calc_state set steps = steps where false'), ('achievement_calc_state','delete','delete from rewards.achievement_calc_state where false'),
 ('achievement_calc_state','truncate','truncate rewards.achievement_calc_state');
create temp table _allow (t text, op text, role text);
insert into _allow values
 ('achievement_definitions','select','reward_writer_owner'),
 ('achievement_chains','select','reward_writer_owner'), ('achievement_chains','insert','reward_writer_owner'),
 ('achievement_chains','select','reward_purge_owner'), ('achievement_chains','update_user_id','reward_purge_owner'), ('achievement_chains','delete','reward_purge_owner'),
 ('achievement_events','select','reward_writer_owner'), ('achievement_events','insert','reward_writer_owner'),
 ('achievement_events','select','reward_purge_owner'), ('achievement_events','delete','reward_purge_owner'),
 ('achievement_eval_queue','select','reward_writer_owner'), ('achievement_eval_queue','insert','reward_writer_owner'), ('achievement_eval_queue','update','reward_writer_owner'), ('achievement_eval_queue','delete','reward_writer_owner'),
 ('achievement_eval_queue','select','reward_purge_owner'), ('achievement_eval_queue','delete','reward_purge_owner'),
 ('achievement_calc_state','select','reward_writer_owner'), ('achievement_calc_state','insert','reward_writer_owner'), ('achievement_calc_state','update','reward_writer_owner'), ('achievement_calc_state','delete','reward_writer_owner'),
 ('achievement_calc_state','select','reward_purge_owner'), ('achievement_calc_state','delete','reward_purge_owner');
create temp table _matrix as
  select o.t, o.op, r.role, pg_temp.try(r.role, o.q) as got, case when exists (select 1 from _allow a where a.t = o.t and a.op = o.op and a.role = r.role) then 'permitted' else 'refused' end as want
  from _ops o cross join (values ('anon'), ('authenticated'), ('service_role'), ('reward_writer_owner'), ('reward_purge_owner')) r(role);
select pg_temp.ok((select count(*) from _matrix) = 130, 'the matrix executed 130 real statements (26 operations x 5 roles)');
select pg_temp.ok(not exists (select 1 from _matrix where got <> want), 'every one of the 130 executed statements was permitted or refused exactly as the golden matrix says (no extra privilege anywhere)');
select pg_temp.ok((select count(*) from _matrix where got = 'permitted') = 22 and (select count(*) from _matrix where got = 'refused') = 108, 'exactly 22 permitted privilege checks (writer and purge, narrowly), 108 refused');
select pg_temp.ok(not exists (select 1 from _matrix where role in ('anon', 'authenticated', 'service_role') and got = 'permitted'), 'no client role (anon, authenticated, service_role) is permitted a single operation on any achievement table');
select pg_temp.ok(not exists (select 1 from _matrix where op = 'truncate' and got = 'permitted'), 'nobody holds TRUNCATE on any achievement table');
select pg_temp.ok(not exists (select 1 from _matrix where t = 'achievement_events' and op in ('update') and got = 'permitted') and not exists (select 1 from _matrix where t = 'achievement_definitions' and op in ('update', 'delete', 'insert') and got = 'permitted'),
                  'events and definitions can never be updated by any role, and definitions are not even insertable by any reward role (a catalog change is a migration-owner act)');

-- ---------------------------------------------------------------- the client entry points refuse the wrong callers (executed)
select pg_temp.ok(pg_temp.try('anon', 'select public.get_my_progress()') = 'refused' and pg_temp.try('service_role', 'select public.get_my_progress()') = 'refused'
              and pg_temp.try('anon', 'select public.repair_achievements(1)') = 'refused' and pg_temp.try('service_role', 'select public.repair_achievements(1)') = 'refused', 'anon and service_role are refused at EXECUTE on both public entry points');
select pg_temp.ok(pg_temp.try('authenticated', 'select rewards.evaluate_achievements(null, null, null)') = 'refused' and pg_temp.try('authenticated', 'select rewards.ach_run(null, null, null, null)') = 'refused'
              and pg_temp.try('authenticated', 'select rewards.ach_process_queue(null)') = 'refused' and pg_temp.try('authenticated', 'select rewards.ach_enqueue(null, null, null, null, 0)') = 'refused'
              and pg_temp.try('authenticated', 'select rewards.ach_metric_value(null, null, null, null)') = 'refused' and pg_temp.try('authenticated', 'select rewards.ach_metrics(null, null, null, 1)') = 'refused' and pg_temp.try('authenticated', 'select rewards.ach_calc_step(null, null, null, null, 1)') = 'refused' and pg_temp.try('authenticated', 'select rewards.ach_calc_get(null, null)') = 'refused' and pg_temp.try('authenticated', 'select rewards.ach_calc_invalidate(null)') = 'refused' and pg_temp.try('authenticated', 'select rewards.ach_calc_start(null, null)') = 'refused' and pg_temp.try('authenticated', 'select rewards.ach_candidate_chains(null)') = 'refused',
                  'authenticated is refused at EXECUTE on every internal engine function (no subject-parameter path to anyone else''s data)');
select pg_temp.ok(pg_temp.try('reward_purge_owner', 'select rewards.evaluate_achievements(null, null, null)') = 'refused' and pg_temp.try('reward_purge_owner', 'select public.get_my_progress()') = 'refused',
                  'the purge owner cannot run the engine or the progress read');
select pg_temp.finish();
