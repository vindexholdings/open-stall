-- P3 bounds with MEASURED evidence (a hypothesis until measured): one user with ~3,300 lifetime awards over 36 months, 2,000 users with 30 days each
-- (60,000 awards), and a 500-chain backlog. The data is bulk-seeded with triggers disabled (session_replication_role = replica) for the
-- SEED ONLY: this measures the evaluator's READ cost and the repair loop, not insert cost, and it proves nothing about the write guards (other files do).
-- Wall-clock bounds below are generous CI guards against regression, not performance claims; the EXPLAIN evidence is the real result.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkloc(52.01) as l1 \gset
select pg_temp.mkloc(52.02) as l2 \gset
select pg_temp.mkloc(52.03) as l3 \gset
select pg_temp.mkuser(9001) as ub \gset
select id as pol from rewards.reward_policy_versions order by effective_from limit 1 \gset
select max(id) as sh from rewards.reward_settings_history \gset
set session_replication_role = replica;
-- big user: 3 locations x 1,095 consecutive local days (36 months), one lifetime award each
with d as (select (date '2023-11-01' + g)::date as day, g from generate_series(0, 1094) g),
     l as (select unnest(array[:'l1'::uuid, :'l2'::uuid, :'l3'::uuid]) as loc, generate_series(1, 3) as n),
     v as (select gen_random_uuid() as id, l.loc, d.day, 'bulk-' || l.n || '-' || d.g || '-' || repeat('x', 8) as key from d cross join l),
     iv as (insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone,
                policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
            select id, :'ub'::uuid, loc, key, (day || ' 18:00:00+00')::timestamptz, :'pol', :'sh', 'America/Denver', day, day, 1, 'within_50', 'location_cap', 'awarded' from v returning id, location_id, policy_day_local)
insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', id, :'ub'::uuid, location_id, policy_day_local, :'pol', 'lifetime', 5, 'first_visit_of_local_day' from iv;
-- 2,000 other users x 30 days (60,000 awards), one location each
create temp table _seedu as select gen_random_uuid() as uid from generate_series(1, 2000);
insert into auth.users (id, email) select uid, 'bulk-' || uid || '@test.invalid' from _seedu;
with u as (select uid, :'l1'::uuid as loc from _seedu),
     d as (select (date '2026-09-01' + g)::date as day, g from generate_series(0, 29) g),
     v as (select gen_random_uuid() as id, u.uid, u.loc, d.day, d.g from u cross join d),
     iv as (insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone,
                policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
            select id, uid, :'l1'::uuid, 'bulk2-' || id::text, (day || ' 18:00:00+00')::timestamptz, :'pol', :'sh', 'America/Denver', day, day, 1, 'within_50', 'location_cap', 'awarded' from v returning id, user_id, policy_day_local)
insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', id, user_id, :'l1'::uuid, policy_day_local, :'pol', 'lifetime', 5, 'first_visit_of_local_day' from iv;
reset session_replication_role;
analyze rewards.reward_ledger;
analyze rewards.visits;
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'ub'::uuid) = 3285 and (select count(*) from rewards.reward_ledger) = 63285, 'seeded: 3,285 awards for the big user over 36 months, 63,285 ledger rows in all (60,000 for 2,000 other users)');

-- the catalog: lifetime and monthly keys over every metric
select pg_temp.defn('b_pts', 1, 'lifetime_points_total', 50, 'none', date '2019-01-01');
select pg_temp.defn('b_loc', 1, 'distinct_locations', 5, 'calendar_month', date '2019-01-01');
select pg_temp.defn('b_days', 1, 'distinct_active_days', 8, 'calendar_month', date '2019-01-01');
select pg_temp.defn('b_cnt', 1, 'qualifying_awards', 1, 'calendar_month', date '2019-01-01');
select (select array_agg(e) from (select 'b_pts|lifetime' as e union all
         select k || '|' || to_char(date '2023-11-01' + (m || ' months')::interval, 'YYYY-MM') from unnest(array['b_loc', 'b_days', 'b_cnt']) k, generate_series(0, 35) m) s) as scope109 \gset
select pg_temp.ok(cardinality(:'scope109'::text[]) = 109, 'setup: 109 chains of scope (36 months x 3 keys + the lifetime key)');

-- ============================================================ EXPLAIN (ANALYZE, BUFFERS) evidence of the metric read
\o
\echo '==== EVIDENCE: standing-award read for the big user (3,285 lifetime rows), whole history'
explain (analyze, buffers, costs off, timing on, summary on)
  select coalesce(sum(l.amount), 0), count(distinct l.location_id), count(*), count(distinct l.policy_day_local)
  from rewards.reward_ledger l
  where l.user_id = :'ub'::uuid and l.kind = 'lifetime' and l.entry_type = 'award'
    and not exists (select 1 from rewards.reward_ledger r where r.reverses_entry_id = l.id);
\echo '==== EVIDENCE: the same read for ONE of the 2,000 small users (30 rows) inside a 63,285-row ledger'
explain (analyze, buffers, costs off, timing on, summary on)
  select coalesce(sum(l.amount), 0), count(distinct l.location_id), count(*), count(distinct l.policy_day_local)
  from rewards.reward_ledger l
  where l.user_id = (select user_id from rewards.reward_ledger where user_id <> :'ub'::uuid limit 1) and l.kind = 'lifetime' and l.entry_type = 'award'
    and not exists (select 1 from rewards.reward_ledger r where r.reverses_entry_id = l.id);
\o /dev/null
create function pg_temp.plan_rows(q text) returns integer language plpgsql as $$
declare j jsonb; n integer;
begin
  execute 'explain (analyze, format json) ' || q into j;
  select max((x ->> 'Actual Rows')::integer * (x ->> 'Actual Loops')::integer) into n
    from jsonb_path_query(j, 'strict $.**."Plans"[*]') x where x ->> 'Relation Name' = 'reward_ledger' and x ->> 'Node Type' like '%Scan%' and x ->> 'Parent Relationship' is not null;
  return n;
end $$;
select pg_temp.plan_rows(format($q$select count(*) from rewards.reward_ledger l where l.user_id = %L::uuid and l.kind = 'lifetime' and l.entry_type = 'award'$q$, :'ub')) as scanned_big \gset
select pg_temp.ok(:'scanned_big'::int <= 5000, 'a call examines at most 3,285 ledger rows for the ~3,000-row user (' || :'scanned_big' || ' <= the proposed 5,000-row bound)');
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'ub'::uuid and kind = 'lifetime') <= 5000, 'the big user is inside the proposed row bound');

-- ============================================================ timings of the evaluator and the repair loop
create function pg_temp.timed_ms(q text) returns numeric language plpgsql as $$
declare t0 timestamptz := clock_timestamp();
begin execute q; return extract(epoch from clock_timestamp() - t0) * 1000; end $$;
select pg_temp.timed_ms(format($q$select rewards.evaluate_achievements(%L::uuid, (%L::text[])[1:50], null)$q$, :'ub', :'scope109')) as ms50 \gset
select pg_temp.ok(:'ms50'::numeric < 2000, 'one evaluation of 50 chains for the big user took ' || round(:'ms50'::numeric) || ' ms (< the 2 s hypothesis bound)');
select pg_temp.ok((select count(*) from rewards.achievement_chains where user_id = :'ub'::uuid) > 0, 'the evaluation awarded real chains from the seeded history');
select pg_temp.timed_ms(format($q$select rewards.evaluate_achievements(%L::uuid, (%L::text[])[51:100], null)$q$, :'ub', :'scope109')) as ms100 \gset
select pg_temp.ok(:'ms100'::numeric < 2000, 'a second page of 50 chains took ' || round(:'ms100'::numeric) || ' ms (< 2 s)');
select set_config('request.jwt.claim.sub', :'ub', false);
select pg_temp.timed_ms($q$select public.get_my_progress(null, 50)$q$) as msp \gset
select pg_temp.ok(:'msp'::numeric < 2000, 'a 50-chain progress page for the big user took ' || round(:'msp'::numeric) || ' ms (< 2 s)');
select set_config('request.jwt.claim.sub', '', false);
-- 2,000 users: four chains each (lifetime + three monthly), in ten separate transactions of 200 users (advisory locks are per transaction)
create temp table _small as select uid, row_number() over (order by uid) as rn from (select distinct user_id as uid from rewards.reward_ledger where user_id <> :'ub'::uuid) s;
create temp table _ms (batch integer, ms numeric);
select pg_temp.ok((select count(*) from _small) = 2000, 'the 2,000 small users are present');
insert into _ms select 0, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 1 and 200$q$);
insert into _ms select 1, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 201 and 400$q$);
insert into _ms select 2, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 401 and 600$q$);
insert into _ms select 3, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 601 and 800$q$);
insert into _ms select 4, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 801 and 1000$q$);
insert into _ms select 5, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 1001 and 1200$q$);
insert into _ms select 6, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 1201 and 1400$q$);
insert into _ms select 7, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 1401 and 1600$q$);
insert into _ms select 8, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 1601 and 1800$q$);
insert into _ms select 9, pg_temp.timed_ms($q$select rewards.evaluate_achievements(uid, array['b_pts|lifetime', 'b_loc|2026-09', 'b_days|2026-09', 'b_cnt|2026-09'], null) from _small where rn between 1801 and 2000$q$);
select sum(ms) as ms2000 from _ms \gset
select pg_temp.ok(:'ms2000'::numeric < 60000, 'evaluating four chains for each of 2,000 users took ' || round(:'ms2000'::numeric) || ' ms in total (' || round(:'ms2000'::numeric / 2000, 2) || ' ms per user)');
select pg_temp.ok((select count(*) from rewards.achievement_chains c join _small s on s.uid = c.user_id) > 0, 'the small users earned real chains from their seeded history');
-- 500-chain backlog: ten bounded steps
select pg_temp.mkuser(9002) as ub2 \gset
select rewards.ach_enqueue(:'ub'::uuid, (select array_agg(e) from (select e from unnest(:'scope109'::text[]) e) s), 'seed', null, 0);
select pg_temp.timed_ms(format($q$select rewards.ach_process_queue(%L::uuid) from generate_series(1, 3)$q$, :'ub')) as msq \gset
select pg_temp.ok(:'msq'::numeric < 6000 and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ub'::uuid), 'a 109-chain backlog drained in three bounded steps in ' || round(:'msq'::numeric) || ' ms, then the queue row was deleted');
select pg_temp.finish();
