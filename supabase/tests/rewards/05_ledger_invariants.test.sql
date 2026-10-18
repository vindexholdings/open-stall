-- P1 test 7: append-only (UPDATE/DELETE/TRUNCATE refused for every role), uniqueness, check constraints, the visit/ledger
-- consistency rule, monotonic gross counters, balances equal ledger sums and counters equal issued awards.
\i :ROOT/supabase/tests/rewards/helpers.sql
select pg_temp.enable_rewards(1000000);

select pg_temp.mkuser(51) as u \gset
select pg_temp.mkuser(52) as u2 \gset
select pg_temp.mkloc(31.0) as l \gset
select pg_temp.mkloc(31.1) as l2 \gset
select pg_temp.vo('2026-10-27 15:00:00+00', :'u', :'l', 'inv-key-00000000001') as r1 \gset
select pg_temp.vo('2026-10-27 15:00:05+00', :'u', :'l', 'inv-key-00000000002') as r2 \gset
select pg_temp.vo('2026-10-27 15:00:10+00', :'u', :'l', 'inv-key-00000000003') as r3 \gset
select pg_temp.vo('2026-10-27 15:00:15+00', :'u', :'l2', 'inv-key-00000000004') as r4 \gset
select pg_temp.vo('2026-10-27 15:00:20+00', :'u2', :'l', 'inv-key-00000000005') as r5 \gset
select id as v1, user_id as vu from rewards.visits where idempotency_key = 'inv-key-00000000001' \gset
select id as v2 from rewards.visits where idempotency_key = 'inv-key-00000000002' \gset
select pg_temp.ok((select count(*) from rewards.reward_ledger) = 8, 'setup: 5 visits wrote 5 spendable and 3 lifetime awards (8 ledger rows)');

-- ---------------------------------------------------------------- append-only, every role, every protected table
create function pg_temp.try(role_name text, q text) returns text language plpgsql as $$
declare st text;
begin
  if role_name <> 'superuser' then execute 'set role ' || quote_ident(role_name); end if;
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
create temp table _mut (role text, tbl text, op text, got text);
do $$
declare r text; t text; op text; q text;
begin
  foreach r in array array['superuser', 'reward_writer_owner', 'authenticated', 'anon', 'service_role'] loop
    foreach t in array array['visits', 'reward_ledger', 'reward_settings_history', 'reward_policy_versions'] loop
      foreach op in array array['update', 'delete', 'truncate'] loop
        q := case op
          when 'update' then format('update rewards.%I set %s', t, case t when 'visits' then 'ordinal = ordinal' when 'reward_ledger' then 'amount = amount'
                                      when 'reward_settings_history' then 'rewards_enabled = rewards_enabled' else 'spendable_per_visit = spendable_per_visit' end)
          when 'delete' then format('delete from rewards.%I', t)
          else format('truncate rewards.%I', t) end;
        insert into _mut values (r, t, op, pg_temp.try(r, q));
      end loop;
    end loop;
  end loop;
end $$;
select pg_temp.ok(not exists (select 1 from _mut where op in ('update', 'delete') and got <> '42501'),
                  'UPDATE and DELETE are refused (42501) on visits, ledger, settings history and policy versions for superuser, writer, authenticated, anon and service_role');
select pg_temp.ok(not exists (select 1 from _mut where op = 'truncate' and got not in ('42501', '0A000')), 'TRUNCATE is refused for every role on every protected table');
select pg_temp.ok(not exists (select 1 from _mut where tbl = 'reward_ledger' and op = 'truncate' and got <> '42501'), 'TRUNCATE of the ledger is refused by its guard (42501) even for the superuser');
select pg_temp.ok((select count(*) from rewards.reward_ledger) = 8 and (select count(*) from rewards.visits) = 5, 'no row was lost to any refused statement');
select pg_temp.ok(pg_temp.try('superuser', 'truncate rewards.reward_counters_user_day') = '42501' and pg_temp.try('superuser', 'truncate rewards.reward_counters_global_day') = '42501'
                  and pg_temp.try('superuser', 'truncate rewards.reward_location_zones') = '42501', 'counters and the zone table cannot be truncated either');

-- ---------------------------------------------------------------- uniqueness
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', id, user_id, location_id, policy_day_local, policy_version_id, 'spendable', 5, 'dup' from rewards.visits where id = '$$ || :'v1' || $$'$$,
  '23505', 'a second spendable award for the same visit is refused (unique visit+kind)');
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', id, user_id, location_id, policy_day_local, policy_version_id, 'lifetime', 5, 'dup' from rewards.visits where id = '$$ || :'v1' || $$'$$,
  '23505', 'a second lifetime award for the same visit is refused');
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', id, user_id, location_id, policy_day_local, policy_version_id, 'lifetime', 5, 'dup' from rewards.visits where id = '$$ || :'v2' || $$'$$,
  '23505', 'a second lifetime award for the same user/location/local day on ANOTHER visit is refused');

-- ---------------------------------------------------------------- check constraints and the P1 reversal gate
create temp table _tmpl as select id as vid, user_id, location_id, policy_day_local, policy_version_id from rewards.visits where id = :'v2';
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', vid, user_id, location_id, policy_day_local, policy_version_id, 'spendable', 0, 'x' from _tmpl$$, '23514', 'an award of 0 is refused');
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', vid, user_id, location_id, policy_day_local, policy_version_id, 'spendable', -5, 'x' from _tmpl$$, '23514', 'a negative award is refused');
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', vid, user_id, location_id, policy_day_local, policy_version_id, 'bonus', 5, 'x' from _tmpl$$, '23514', 'an unknown kind is refused');
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', vid, user_id, location_id, policy_day_local, policy_version_id, 'spendable', 5, '' from _tmpl$$, '23514', 'an empty reason is refused');
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'refund', vid, user_id, location_id, policy_day_local, policy_version_id, 'spendable', 5, 'x' from _tmpl$$, '0A000,23514', 'an unknown entry type is refused');
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reverses_entry_id)
  select 'award', vid, user_id, location_id, policy_day_local, policy_version_id, 'spendable', 5, 'x', gen_random_uuid() from _tmpl$$, '23514,23503', 'an award that claims to reverse something is refused');
select pg_temp.fails($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'reversal', vid, user_id, location_id, policy_day_local, policy_version_id, 'spendable', -5, 'x' from _tmpl$$, '0A000', 'a reversal row is refused in P1 (reversals are P2)');
select pg_temp.ok((select count(*) from rewards.reward_ledger) = 8, 'no refused insert left a row');

-- ---------------------------------------------------------------- visit / ledger consistency (checked at commit)
select pg_temp.fails_c($$insert into rewards.visits (user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
  select user_id, location_id, 'consistency-key-00001', now(), policy_version_id, settings_history_id, 'UTC', policy_day_local, issuance_day_utc, 9, 'within_50', 'awarded', 'not_first_daily' from rewards.visits where id = '$$ || :'v2' || $$'$$,
  '23514', 'a visit marked awarded with no spendable ledger row is refused at commit');
select pg_temp.fails_c($$with v as (insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
    select gen_random_uuid(), user_id, location_id, 'consistency-key-00003', now(), policy_version_id, settings_history_id, 'UTC', policy_day_local, issuance_day_utc, 9, 'within_50', 'location_cap', 'not_first_daily' from rewards.visits where id = '$$ || :'v2' || $$' returning id, user_id, location_id, policy_day_local, policy_version_id)
  insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', id, user_id, location_id, policy_day_local, policy_version_id, 'spendable', 5, 'x' from v$$,
  '23514', 'a ledger award for a visit whose outcome is NOT awarded is refused at commit');
select pg_temp.fails_c($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', gen_random_uuid(), user_id, location_id, policy_day_local, policy_version_id, 'spendable', 5, 'x' from _tmpl$$,
  '23503', 'a ledger row that references no visit is refused');
select pg_temp.ok((select count(*) from rewards.reward_ledger) = 8 and (select count(*) from rewards.visits) = 5, 'the probes left no residue');

-- ---------------------------------------------------------------- counters are gross and monotonic
select pg_temp.fails($$update rewards.reward_counters_user_day set spendable = spendable - 1$$, '42501', 'a user counter can never decrease');
select pg_temp.fails($$update rewards.reward_counters_global_day set spendable = spendable - 1$$, '42501', 'the global counter can never decrease');
select pg_temp.fails($$delete from rewards.reward_counters_user_day$$, '42501', 'a user counter row cannot be deleted');
select pg_temp.fails($$delete from rewards.reward_counters_global_day$$, '42501', 'a global counter row cannot be deleted');
select pg_temp.fails($$update rewards.reward_counters_user_day set issuance_day_utc = issuance_day_utc + 1$$, '42501', 'a counter key cannot be changed');
select pg_temp.fails($$update rewards.reward_counters_user_day set user_id = (select id from auth.users where id <> user_id limit 1)$$, '42501', 'a counter owner cannot be changed');
select pg_temp.fails($$update rewards.reward_counters_user_day set spendable = -1$$, '23514,42501', 'a negative counter is refused');

-- ---------------------------------------------------------------- balances and counters reconcile with the ledger
select pg_temp.ok((select spendable from rewards.user_balances(:'u')) = 20 and (select lifetime from rewards.user_balances(:'u')) = 10, 'user 1 balances: 20 spendable (4 awards) and 10 lifetime (two locations)');
select pg_temp.ok((select spendable from rewards.user_balances(:'u2')) = 5 and (select lifetime from rewards.user_balances(:'u2')) = 5, 'user 2 balances: 5 and 5');
select pg_temp.ok(not exists (
  select 1 from (select user_id, issuance_day_utc, spendable from rewards.reward_counters_user_day) c
  full join (select l.user_id, v.issuance_day_utc, sum(l.amount)::int as s from rewards.reward_ledger l join rewards.visits v on v.id = l.visit_id
             where l.kind = 'spendable' and l.entry_type = 'award' group by 1, 2) a using (user_id, issuance_day_utc)
  where c.spendable is distinct from a.s), 'every user-day counter equals that user/day''s spendable awards joined through the visit');
select pg_temp.ok(not exists (
  select 1 from rewards.reward_counters_global_day c
  full join (select v.issuance_day_utc, sum(l.amount)::int as s from rewards.reward_ledger l join rewards.visits v on v.id = l.visit_id
             where l.kind = 'spendable' and l.entry_type = 'award' group by 1) a using (issuance_day_utc)
  where c.spendable is distinct from a.s), 'every global-day counter equals that day''s spendable awards');
select pg_temp.ok(not exists (
  select 1 from rewards.visits v where (v.spendable_outcome = 'awarded') <> exists (select 1 from rewards.reward_ledger l where l.visit_id = v.id and l.kind = 'spendable')
     or (v.lifetime_outcome = 'awarded') <> exists (select 1 from rewards.reward_ledger l where l.visit_id = v.id and l.kind = 'lifetime')),
  'every visit''s outcomes agree with its ledger rows');
select pg_temp.ok((select count(*) from public.profiles) = 0 or (select coalesce(max(points_balance), 0) from public.profiles) = 0, 'profiles.points_balance is never written by P1 (balances are derived, not cached)');
select pg_temp.finish();
