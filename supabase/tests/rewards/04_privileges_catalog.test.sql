-- P1 test 6 (privileges): golden catalog inventory, complete (table, column, sequence, function, schema privileges, ownership,
-- default privileges, PUBLIC grants, RLS enabled+forced, explicit policy list, fixed search paths) plus an actual refusal
-- matrix executed under SET ROLE for every client role and the writer. Rewards are disabled here, as on a fresh cluster.
\i :ROOT/supabase/tests/rewards/helpers.sql

-- ---------------------------------------------------------------- roles
select pg_temp.ok((select not rolcanlogin and not rolinherit and not rolbypassrls and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication
                   from pg_roles where rolname = 'reward_writer_owner'), 'reward_writer_owner is NOLOGIN, NOINHERIT, no BYPASSRLS, not superuser, no createdb/createrole/replication');
select pg_temp.ok(not exists (select 1 from pg_auth_members m join pg_roles r on r.oid = m.member where r.rolname = 'reward_writer_owner'), 'reward_writer_owner is a member of no role');
select pg_temp.ok((select count(*) from pg_roles where rolname in ('reward_writer_owner', 'reward_purge_owner')) = 1, 'P1 creates the writer role only (no purge role: that is P2)');

-- ---------------------------------------------------------------- the complete object inventory
create temp table _tables as select c.oid, c.relname, pg_get_userbyid(c.relowner) as owner, c.relrowsecurity, c.relforcerowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'rewards' and c.relkind in ('r', 'p', 'v', 'm', 'f');
select pg_temp.ok((select array_agg(relname::text order by relname) from _tables) = array['reward_counters_global_day','reward_counters_user_day','reward_ledger',
  'reward_location_zones','reward_policy_versions','reward_settings','reward_settings_history','visits'], 'the rewards schema holds exactly the eight expected tables and no view');
select pg_temp.ok((select every(owner = current_user) from _tables), 'all tables are owned by the migration role, not by the writer');
select pg_temp.ok((select every(relrowsecurity and relforcerowsecurity) from _tables), 'every rewards table has RLS enabled AND forced');

-- table privileges (non-owner grantees), complete in both directions; PUBLIC shows as grantee 0
create temp table _exp_tbl (relname text, grantee text, priv text);
insert into _exp_tbl values
 ('reward_settings','reward_writer_owner','SELECT'), ('reward_settings_history','reward_writer_owner','SELECT'),
 ('reward_policy_versions','reward_writer_owner','SELECT'), ('reward_location_zones','reward_writer_owner','SELECT'),
 ('visits','reward_writer_owner','SELECT'), ('visits','reward_writer_owner','INSERT'),
 ('reward_ledger','reward_writer_owner','SELECT'), ('reward_ledger','reward_writer_owner','INSERT'),
 ('reward_counters_user_day','reward_writer_owner','SELECT'), ('reward_counters_user_day','reward_writer_owner','INSERT'), ('reward_counters_user_day','reward_writer_owner','UPDATE'),
 ('reward_counters_global_day','reward_writer_owner','SELECT'), ('reward_counters_global_day','reward_writer_owner','INSERT'), ('reward_counters_global_day','reward_writer_owner','UPDATE');
create temp table _act_tbl as
  select t.relname, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee, a.privilege_type as priv
  from _tables t, aclexplode(coalesce((select relacl from pg_class where oid = t.oid), acldefault('r', (select relowner from pg_class where oid = t.oid)))) a
  where a.grantee <> (select relowner from pg_class where oid = t.oid);
select pg_temp.ok(not exists (select * from _act_tbl except select * from _exp_tbl), 'no table grant beyond the golden list (any extra grant fails)');
select pg_temp.ok(not exists (select * from _exp_tbl except select * from _act_tbl), 'every golden table grant exists');
select pg_temp.ok(not exists (select 1 from _act_tbl where grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')), 'no table is granted to PUBLIC, anon, authenticated or service_role');
select pg_temp.ok(not exists (select 1 from pg_attribute a join _tables t on t.oid = a.attrelid where a.attnum > 0 and a.attacl is not null), 'no column-level grants exist on any rewards table');
-- sequences (identity columns): owner only
select pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace,
                                   aclexplode(coalesce(c.relacl, acldefault('S', c.relowner))) a
                              where n.nspname = 'rewards' and c.relkind = 'S' and a.grantee <> c.relowner), 'rewards sequences have no non-owner grant');

-- policies, exactly
create temp table _exp_pol (tablename text, policyname text, cmd text);
insert into _exp_pol values
 ('reward_settings','writer_reads_settings','SELECT'), ('reward_settings_history','writer_reads_settings_history','SELECT'),
 ('reward_policy_versions','writer_reads_policy','SELECT'), ('reward_location_zones','writer_reads_zones','SELECT'),
 ('visits','writer_reads_visits','SELECT'), ('visits','writer_inserts_visits','INSERT'),
 ('reward_ledger','writer_reads_ledger','SELECT'), ('reward_ledger','writer_inserts_ledger','INSERT'),
 ('reward_counters_user_day','writer_reads_user_counters','SELECT'), ('reward_counters_user_day','writer_inserts_user_counters','INSERT'), ('reward_counters_user_day','writer_updates_user_counters','UPDATE'),
 ('reward_counters_global_day','writer_reads_global_counters','SELECT'), ('reward_counters_global_day','writer_inserts_global_counters','INSERT'), ('reward_counters_global_day','writer_updates_global_counters','UPDATE');
select pg_temp.ok(not exists (select tablename, policyname, cmd from pg_policies where schemaname = 'rewards' except select * from _exp_pol)
                  and not exists (select * from _exp_pol except select tablename, policyname, cmd from pg_policies where schemaname = 'rewards'), 'the RLS policy list is exactly the 14 expected policies');
select pg_temp.ok((select every(roles = '{reward_writer_owner}') from pg_policies where schemaname = 'rewards'), 'every policy applies to the writer role only');

-- functions: ACLs, owners, definer surface, fixed search_path
create temp table _fn as
  select p.oid, n.nspname || '.' || p.proname as sig, n.nspname, p.proname, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig, p.proacl
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'rewards' or (n.nspname = 'public' and p.proname = 'record_visit');
select pg_temp.ok((select count(*) from _fn where nspname = 'rewards') = 13 and (select count(*) from _fn where nspname = 'public') = 1, 'exactly 13 rewards functions and 1 public function');
select pg_temp.ok((select array_agg(proname::text order by proname) from _fn where prosecdef) = array['location_check','record_visit','record_visit_at'], 'only three SECURITY DEFINER functions exist (the writer, its wrapper and the read-only location helper)');
select pg_temp.ok((select every(owner = 'reward_writer_owner') from _fn where proname in ('record_visit', 'record_visit_at'))
                  and (select every(owner = current_user) from _fn where proname not in ('record_visit', 'record_visit_at')), 'the writer owns only the two record_visit functions; everything else is owned by the migration role');
select pg_temp.ok((select every(proconfig is not null and exists (select 1 from unnest(proconfig) c where c ~ '^search_path=("")?$|^search_path=pg_catalog$')) from _fn),
                  'every rewards function has a fixed search_path (empty, or pg_catalog for the pure zone check)');
select pg_temp.ok((select every(proacl is not null) from _fn), 'no function keeps the default (PUBLIC) EXECUTE: every ACL is explicit');
create temp table _exp_fn (sig text, grantee text);
insert into _exp_fn values
 ('rewards.is_valid_time_zone', 'reward_writer_owner'),
 ('rewards.evaluate_visit', 'reward_writer_owner'),
 ('rewards.location_check', 'reward_writer_owner'),
 ('public.record_visit', 'authenticated');
create temp table _act_fn as
  select f.sig, case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee
  from _fn f, aclexplode(f.proacl) a where a.grantee <> (select oid from pg_roles where rolname = f.owner) and a.privilege_type = 'EXECUTE';
select pg_temp.ok(not exists (select * from _act_fn except select * from _exp_fn) and not exists (select * from _exp_fn except select * from _act_fn),
                  'function EXECUTE grants are exactly: writer on 3 internals, authenticated on public.record_visit');
select pg_temp.ok(not exists (select 1 from _fn f where has_function_privilege('anon', f.oid, 'EXECUTE') or has_function_privilege('service_role', f.oid, 'EXECUTE')),
                  'anon and service_role can execute no rewards function');
select pg_temp.ok((select array_agg(sig) from _fn f where has_function_privilege('authenticated', f.oid, 'EXECUTE'))
                  = array['public.record_visit'], 'authenticated can execute public.record_visit and NOTHING else');
select pg_temp.ok(not exists (select 1 from _fn f where has_function_privilege('public', f.oid, 'EXECUTE')), 'PUBLIC can execute no rewards function');

-- schemas, ownership, default privileges
select pg_temp.ok((select pg_get_userbyid(nspowner) = current_user from pg_namespace where nspname = 'rewards'), 'the rewards schema is owned by the migration role');
select pg_temp.ok(not has_schema_privilege('anon', 'rewards', 'USAGE') and not has_schema_privilege('authenticated', 'rewards', 'USAGE')
                  and not has_schema_privilege('service_role', 'rewards', 'USAGE') and not has_schema_privilege('public', 'rewards', 'USAGE'), 'no client role or PUBLIC has USAGE on the rewards schema');
select pg_temp.ok(not has_schema_privilege('anon', 'rewards', 'CREATE') and not has_schema_privilege('authenticated', 'rewards', 'CREATE') and not has_schema_privilege('service_role', 'rewards', 'CREATE')
                  and not has_schema_privilege('reward_writer_owner', 'rewards', 'CREATE'), 'nobody but the owner has CREATE on the rewards schema (the temporary writer CREATE was revoked)');
select pg_temp.ok(has_schema_privilege('reward_writer_owner', 'rewards', 'USAGE'), 'the writer has USAGE on the rewards schema');
select pg_temp.ok(not has_schema_privilege('reward_writer_owner', 'public', 'CREATE'), 'the writer has no CREATE on schema public (the temporary grant was revoked)');
select pg_temp.ok((select (select array_agg(pg_get_userbyid(a.grantee)::text order by 1) from aclexplode(nspacl) a where a.grantee <> nspowner and a.privilege_type = 'USAGE' and a.grantee <> 0) = array['reward_writer_owner']
                   from pg_namespace where nspname = 'rewards'), 'the only non-owner USAGE grant on the rewards schema is the writer');
select pg_temp.ok(has_schema_privilege('reward_writer_owner', 'auth', 'USAGE') and not has_schema_privilege('reward_writer_owner', 'auth', 'CREATE'), 'the writer may use the auth schema (for auth.uid) but not create in it');
select pg_temp.ok(not exists (select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'rewards'),
                  'no default privileges exist in the rewards schema (new objects there would receive no automatic grant)');
select pg_temp.ok(exists (select 1 from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public'),
                  'the Supabase-style default grants in schema public are present (mirrored by bootstrap), and the rewards schema is deliberately outside them');
select pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname ~ '^(visits|reward_)'),
                  'no rewards table was created in schema public');

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
  foreach r in array array['anon', 'authenticated', 'service_role', 'reward_writer_owner'] loop
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
select pg_temp.ok(not exists (select 1 from _matrix where role in ('anon', 'authenticated', 'service_role') and got <> '42501'),
                  'anon, authenticated and service_role are refused (42501) every select/insert/update/delete/truncate on every rewards table');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_writer_owner' and op in ('delete', 'truncate') and got <> '42501'), 'the writer is refused DELETE and TRUNCATE on every table');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_writer_owner' and op = 'select' and got <> 'ok'), 'the writer can SELECT every table');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_writer_owner' and op = 'insert' and ((tbl in ('visits', 'reward_ledger', 'reward_counters_user_day', 'reward_counters_global_day')) <> (got = 'ok'))),
                  'the writer can INSERT only into visits, the ledger and the two counters');
select pg_temp.ok(not exists (select 1 from _matrix where role = 'reward_writer_owner' and op = 'update' and ((tbl in ('reward_counters_user_day', 'reward_counters_global_day')) <> (got = 'ok'))),
                  'the writer can UPDATE only the two counters (never the ledger, visits, settings or policy)');
select pg_temp.ok((select count(*) from _matrix) = 4 * 8 * 5, 'the matrix covers 4 roles x 8 tables x 5 operations');
\o
select role, tbl, op, got from _matrix where role = 'reward_writer_owner' order by tbl, op;
\o /dev/null

-- ---------------------------------------------------------------- function surface under SET ROLE
select pg_temp.ok(pg_temp.try('authenticated', $$select rewards.evaluate_visit(5,5,4,60,1,0,0,true,10,false)$$) = '42501', 'authenticated cannot call the internal evaluate_visit');
select pg_temp.ok(pg_temp.try('authenticated', $$select rewards.record_visit_at(now(), '00000000-0000-0000-0000-000000000001', 0, 0, 'abcdefghijklmnop', null)$$) = '42501', 'authenticated cannot call the internal time-injected recorder (a client cannot choose the time)');
select pg_temp.ok(pg_temp.try('anon', $$select public.record_visit('00000000-0000-0000-0000-000000000001', 0, 0, 'abcdefghijklmnop')$$) = '42501', 'anon cannot call record_visit');
select pg_temp.ok(pg_temp.try('service_role', $$select public.record_visit('00000000-0000-0000-0000-000000000001', 0, 0, 'abcdefghijklmnop')$$) = '42501', 'service_role cannot call record_visit');
select pg_temp.ok(pg_temp.try('reward_writer_owner', $$update rewards.reward_settings set rewards_enabled = true$$) = '42501', 'the writer cannot enable rewards');
select pg_temp.ok(pg_temp.try('reward_writer_owner', $$insert into rewards.reward_policy_versions (effective_from, spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day) values (now() + interval '1 day', 1,1,1,1)$$) = '42501', 'the writer cannot create a policy version');
select pg_temp.ok(pg_temp.try('reward_writer_owner', $$insert into rewards.reward_location_zones values ('00000000-0000-0000-0000-000000000001', 'UTC')$$) = '42501', 'the writer cannot create a location zone');

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
select pg_temp.finish();
