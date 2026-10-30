-- P1 test 6/8 (coexistence): every pre-existing public/auth object is unchanged except the one documented grant; legacy
-- check_in keeps its 12-hour guard and 10/day limit; anonymous discovery still works and rewards never touch profiles.
\i :ROOT/supabase/tests/rewards/helpers.sql
\i :ROOT/supabase/tests/rewards/snapshot_fn.sql
\i :ROOT/supabase/tests/rewards/golden_baseline_acl.sql

-- ---------------------------------------------------------------- golden catalog diff (before = bootstrap + existing migrations only)
create temp table _live as select * from pg_temp.snap();
create temp table _diff as
  (select 'removed-or-changed' as side, * from (select * from _golden except select * from _live) a)
  union all
  (select 'added-or-changed', * from (select * from _live except select * from _golden) b);
\o
select * from _diff order by name, side;
\o /dev/null
select pg_temp.ok((select count(*) from _golden) > 60, 'the golden baseline lists the existing public/auth tables, functions and schemas (' || (select count(*) from _golden) || ' objects)');
\if :p2
-- P2 phase: the complete expected delta against the pre-rewards baseline, nothing implicit.
select pg_temp.ok(not exists (select 1 from _diff where kind = 'table'), 'P2: no existing table changed owner, ACL, RLS setting or search_path');
select pg_temp.ok((select array_agg(distinct name::text order by name::text) from _diff where kind = 'function' and name !~ '^admin_reward_') = array['delete_my_account(text)', 'require_admin()'],
                  'P2: exactly two existing functions differ: delete_my_account (replaced) and require_admin (one added EXECUTE grant)');
select pg_temp.ok((select array_agg(name::text order by name::text) from _diff where kind = 'function' and name ~ '^admin_reward_' and side = 'added-or-changed')
                = array['admin_reward_clear_hold(uuid,text)', 'admin_reward_finalize_reversal(uuid,text)', 'admin_reward_hold_user(uuid,text)', 'admin_reward_recommend_reversal(uuid,text)']
              and not exists (select 1 from _diff where kind = 'function' and name ~ '^admin_reward_' and side = 'removed-or-changed'),
                  'P2: the only added public functions are the four admin reward RPCs (nothing else new in public)');
select pg_temp.ok((select count(distinct owner || acl || extra) from _golden where kind = 'function' and name = 'delete_my_account(text)') = 1
              and (select owner from _live where name = 'delete_my_account(text)') = (select owner from _golden where name = 'delete_my_account(text)')
              and (select acl from _live where name = 'delete_my_account(text)') = (select acl from _golden where name = 'delete_my_account(text)')
              and (select split_part(extra, ':', 2) from _live where name = 'delete_my_account(text)') = (select split_part(extra, ':', 2) from _golden where name = 'delete_my_account(text)')
              and (select extra from _live where name = 'delete_my_account(text)') is distinct from (select extra from _golden where name = 'delete_my_account(text)'),
                  'P2: delete_my_account keeps owner, ACL, security-definer flag and search_path; only its source changed');
select pg_temp.ok((select owner from _live where name = 'require_admin()') = (select owner from _golden where name = 'require_admin()')
              and (select extra from _live where name = 'require_admin()') = (select extra from _golden where name = 'require_admin()')
              and (select array_agg(x order by x) from unnest(string_to_array(trim(both '{}' from (select acl from _live where name = 'require_admin()')), ',')) x)
                = (select array_agg(x order by x) from unnest(string_to_array(trim(both '{}' from (select acl from _golden where name = 'require_admin()')) || ',reward_writer_owner=X/' || (select owner from _golden where name = 'require_admin()'), ',')) x),
                  'P2: require_admin gained exactly one EXECUTE grant, to reward_writer_owner (same source, still revoked from every client role)');
select pg_temp.ok((select array_agg(x order by x) from unnest(string_to_array(trim(both '{}' from (select acl from _live where kind = 'schema' and name = 'auth')), ',')) x)
                = (select array_agg(x order by x) from unnest(string_to_array(trim(both '{}' from (select acl from _golden where kind = 'schema' and name = 'auth')) || ',reward_writer_owner=U/' || (select owner from _golden where kind = 'schema' and name = 'auth') || ',reward_purge_owner=U/' || (select owner from _golden where kind = 'schema' and name = 'auth'), ',')) x)
              and not exists (select 1 from _diff where kind = 'schema' and name <> 'auth'),
                  'P2: the only schema ACL changes are USAGE on auth for the writer and for the purge owner (auth.uid); public is unchanged');
\else
select pg_temp.ok(not exists (select 1 from _diff where kind in ('table', 'function')), 'no existing table or function changed owner, ACL, RLS setting, source or search_path (golden diff is empty for tables and functions)');
select pg_temp.ok((select count(*) from _diff where kind = 'schema') = 2 and not exists (select 1 from _diff where kind = 'schema' and name <> 'auth'),
                  'the only change to an existing object is the auth schema ACL (one before row, one after row)');
select pg_temp.ok((select acl from _live where kind = 'schema' and name = 'auth') = (select regexp_replace(acl, '\}$', ',reward_writer_owner=U/' || owner || '}') from _golden where kind = 'schema' and name = 'auth'),
                  'and that change is exactly one added grant: USAGE on schema auth for reward_writer_owner (needed for auth.uid)');
select pg_temp.ok((select acl from _live where kind = 'schema' and name = 'public') = (select acl from _golden where kind = 'schema' and name = 'public'), 'the public schema ACL is unchanged (the temporary CREATE grant left no trace)');
\endif
select pg_temp.ok((select count(*) from _live where kind = 'function' and name ~ 'record_visit') = 0 and (select count(*) from _golden where name ~ 'check_in|nearby_locations|get_public') >= 3,
                  'check_in, nearby_locations and the public lookup functions are part of the compared baseline');

-- ---------------------------------------------------------------- legacy check_in is unchanged: 12-hour guard and 10/day
select pg_temp.mkuser(81) as u \gset
select pg_temp.mkloc(34.0) as l \gset
select pg_temp.enable_rewards(1000000);
select pg_temp.as_user(:'u');
set role authenticated;
select public.check_in(:'l', 34.0, -100) as c1 \gset
reset role;
select pg_temp.ok((:'c1'::jsonb) ? 'checkin_id', 'check_in still returns {checkin_id}');
select pg_temp.fails($$set role authenticated; select public.check_in('$$ || :'l' || $$', 34.0, -100)$$, '54000', 'check_in still refuses a second check-in within 12 hours');
reset role;
-- The new recorder has NO 12-hour guard: four visits at the same location are all recorded and rewarded, in the same session as a check-in.
select pg_temp.vo('2026-10-29 15:00:00+00', :'u', :'l', 'legacy-key-000000001') as a \gset
select pg_temp.vo('2026-10-29 15:00:01+00', :'u', :'l', 'legacy-key-000000002') as b \gset
select pg_temp.vo('2026-10-29 15:00:02+00', :'u', :'l', 'legacy-key-000000003') as c \gset
select pg_temp.vo('2026-10-29 15:00:03+00', :'u', :'l', 'legacy-key-000000004') as d \gset
select pg_temp.ok(:'a' = 'awarded|awarded|5|5' and :'d' = 'awarded|not_first_daily|5|0', 'record_visit is not limited by the legacy 12-hour same-location guard');
select pg_temp.ok((select count(*) from public.checkins where user_id = :'u') = 1, 'recording visits does not create or consume check-ins');
select pg_temp.mkuser(82) as u2 \gset
create function pg_temp.checkin_loop(u uuid) returns text language plpgsql as $$
declare i integer; ls uuid[] := '{}'; res text := 'ok';
begin
  for i in 1..11 loop ls := ls || pg_temp.mkloc(35 + i / 100.0); end loop;   -- locations are created BEFORE the role switch
  perform pg_temp.as_user(u);
  execute 'set role authenticated';
  for i in 1..11 loop
    begin
      perform public.check_in(ls[i], 35 + i / 100.0, -100);
    exception when others then
      res := case when i = 11 and sqlstate = '54000' then 'limit-at-11' else 'unexpected-' || sqlstate || '-' || i end;
    end;
  end loop;
  execute 'reset role';
  return res;
end $$;
select pg_temp.ok(pg_temp.checkin_loop(:'u2') = 'limit-at-11', 'check_in still allows 10 per day and refuses the 11th');

-- ---------------------------------------------------------------- anonymous discovery is unchanged
set role anon;
select count(*) as n from public.nearby_locations(34.0, -100, 5000, 10, false) \gset
reset role;
select pg_temp.ok(:'n'::int >= 1, 'anon can still call nearby_locations and read public restrooms');
select pg_temp.fails($$set role anon; select * from public.locations limit 1$$, '42501', 'anon still cannot read the locations table directly');
reset role;
select pg_temp.fails($$set role anon; select * from public.checkins limit 1$$, '42501', 'anon still cannot read check-ins');
reset role;
select pg_temp.ok((select coalesce(max(points_balance), 0) from public.profiles) = 0, 'no profile points_balance was written');
select pg_temp.finish();
