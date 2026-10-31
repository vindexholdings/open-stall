-- P1 test 8 (bounds): representative disposable data, EXPLAIN (ANALYZE, BUFFERS) and timings for the P1 hot paths.
-- Data: 2,000 users x 30 daily visits (60,000 visits, 120,000 awards) plus one heavy user with about 3,000 lifetime rows over
-- 36 months. Bulk loading runs as the superuser with the commit-time consistency triggers disabled for speed; a set-based
-- query then proves the same invariant for every row, and the triggers are re-enabled before anything is measured.
\i :ROOT/supabase/tests/rewards/helpers.sql
select pg_temp.enable_rewards(1000000000);

insert into auth.users (id, email) select ('00000000-0000-0000-0001-' || lpad(g::text, 12, '0'))::uuid, 'bulk' || g || '@test.invalid' from generate_series(1, 2001) g;
insert into public.locations (id, name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
  select ('00000000-0000-0000-0002-' || lpad(g::text, 12, '0'))::uuid, 'bulk loc ' || g, 20 + g / 100.0, -100, 'verified', 'explicit', true, now() from generate_series(1, 60) g;
insert into rewards.reward_location_zones select id, 'America/Denver' from public.locations where name like 'bulk loc %';

alter table rewards.visits disable trigger visits_ledger_consistent_v;
alter table rewards.reward_ledger disable trigger visits_ledger_consistent_l;
-- 2,000 users x 30 days: one visit per day at one of 60 locations (first visit of the local day: spendable + lifetime)
create temp table _bulk as
  select gen_random_uuid() as vid, ('00000000-0000-0000-0001-' || lpad(u::text, 12, '0'))::uuid as uid,
         ('00000000-0000-0000-0002-' || lpad((1 + (u + d) % 60)::text, 12, '0'))::uuid as lid,
         (timestamptz '2026-01-01 15:00:00+00' + (d || ' days')::interval) as at, d
  from generate_series(1, 2000) u, generate_series(0, 29) d;
insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone, policy_day_local,
                            issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
  select vid, uid, lid, 'bulk-' || replace(vid::text, '-', ''), at, 1, (select history_id from rewards.reward_settings), 'America/Denver', (at at time zone 'America/Denver')::date,
         (at at time zone 'UTC')::date, 1, 'within_50', 'awarded', 'awarded' from _bulk;
insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', vid, uid, lid, (at at time zone 'America/Denver')::date, 1, k, 5, 'bulk' from _bulk, (values ('spendable'), ('lifetime')) t(k);
insert into rewards.reward_counters_user_day select uid, (at at time zone 'UTC')::date, 5 from _bulk;
insert into rewards.reward_counters_global_day select (at at time zone 'UTC')::date, 5 * count(*) from _bulk group by 1;
-- the heavy user (user 2001): ~3 locations per day over 36 months
create temp table _heavy as
  select gen_random_uuid() as vid, '00000000-0000-0000-0001-000000002001'::uuid as uid,
         ('00000000-0000-0000-0002-' || lpad((1 + (d * 3 + k) % 60)::text, 12, '0'))::uuid as lid,
         (timestamptz '2023-10-01 15:00:00+00' + (d || ' days')::interval + (k || ' minutes')::interval) as at
  from generate_series(0, 1090) d, generate_series(0, 2) k where (d * 3 + k) % 4 <> 0;   -- ~2,450 visits
insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone, policy_day_local,
                            issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
  select vid, uid, lid, 'heavy-' || replace(vid::text, '-', ''), at, 1, (select history_id from rewards.reward_settings), 'America/Denver', (at at time zone 'America/Denver')::date,
         (at at time zone 'UTC')::date, 1, 'within_50', 'awarded', 'awarded' from _heavy;
insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', vid, uid, lid, (at at time zone 'America/Denver')::date, 1, k, 5, 'bulk' from _heavy, (values ('spendable'), ('lifetime')) t(k);
insert into rewards.reward_counters_user_day select uid, d, sum(5) from (select uid, (at at time zone 'UTC')::date d from _heavy) x group by 1, 2;
update rewards.reward_counters_global_day g set spendable = g.spendable + h.s from (select (at at time zone 'UTC')::date d, 5 * count(*) s from _heavy group by 1) h where h.d = g.issuance_day_utc;
insert into rewards.reward_counters_global_day select h.d, h.s from (select (at at time zone 'UTC')::date d, 5 * count(*) s from _heavy group by 1) h
  where not exists (select 1 from rewards.reward_counters_global_day g where g.issuance_day_utc = h.d);
alter table rewards.visits enable trigger visits_ledger_consistent_v;
alter table rewards.reward_ledger enable trigger visits_ledger_consistent_l;
analyze rewards.visits; analyze rewards.reward_ledger; analyze rewards.reward_counters_user_day; analyze rewards.reward_counters_global_day;

select pg_temp.ok((select count(*) from rewards.visits) = 60000 + (select count(*) from _heavy), 'bulk load: ' || (select count(*) from rewards.visits) || ' visits');
select pg_temp.ok((select count(*) from rewards.reward_ledger) = 2 * (select count(*) from rewards.visits), 'bulk load: two awards per visit (' || (select count(*) from rewards.reward_ledger) || ' ledger rows)');
select pg_temp.ok(not exists (select 1 from rewards.visits v where (v.spendable_outcome = 'awarded') <> exists (select 1 from rewards.reward_ledger l where l.visit_id = v.id and l.kind = 'spendable')
                              or (v.lifetime_outcome = 'awarded') <> exists (select 1 from rewards.reward_ledger l where l.visit_id = v.id and l.kind = 'lifetime')),
                  'the bulk data satisfies the visit/ledger consistency invariant for every row (set-based check)');
select pg_temp.ok(not exists (select 1 from rewards.reward_counters_global_day c left join (select v.issuance_day_utc d, sum(l.amount) s from rewards.reward_ledger l join rewards.visits v on v.id = l.visit_id
                              where l.kind = 'spendable' group by 1) a on a.d = c.issuance_day_utc where c.spendable is distinct from a.s::int), 'bulk counters reconcile with the ledger');

-- ---------------------------------------------------------------- plans and timings (evidence)
select lid as hloc, (at at time zone 'America/Denver')::date as hday from _heavy order by at desc limit 1 \gset
\o
\echo '== evidence'
select version();
\echo '== heavy user (about 2,450 visits / 4,900 ledger rows over 36 months): canonical ordinal count'
explain (analyze, buffers, costs off) select count(*) + 1 from rewards.visits
  where user_id = '00000000-0000-0000-0001-000000002001' and location_id = :'hloc' and policy_day_local = :'hday';
\echo '== idempotency lookup'
explain (analyze, buffers, costs off) select * from rewards.visits where user_id = '00000000-0000-0000-0001-000000002001' and idempotency_key = 'heavy-none';
\echo '== derived balances for the heavy user'
explain (analyze, buffers, costs off) select * from rewards.user_balances('00000000-0000-0000-0001-000000002001');
\echo '== user-day counter read'
explain (analyze, buffers, costs off) select spendable from rewards.reward_counters_user_day where user_id = '00000000-0000-0000-0001-000000000100' and issuance_day_utc = '2026-01-10';
\echo '== global-day counter read'
explain (analyze, buffers, costs off) select spendable from rewards.reward_counters_global_day where issuance_day_utc = '2026-01-10';
\o /dev/null

-- Assert the planner uses the intended indexes at this scale (text of the plan, not a timing).
create function pg_temp.plan_of(q text) returns text language plpgsql as $$
declare r record; t text := '';
begin for r in execute 'explain (costs off) ' || q loop t := t || r."QUERY PLAN" || E'\n'; end loop; return t; end $$;
select pg_temp.ok(pg_temp.plan_of($$select count(*) from rewards.visits where user_id = '00000000-0000-0000-0001-000000002001' and location_id = '00000000-0000-0000-0002-000000000010' and policy_day_local = '2026-01-10'$$) ~ 'Index',
                  'the ordinal count uses an index at 60,000+ visits');
select pg_temp.ok(pg_temp.plan_of($$select * from rewards.visits where user_id = '00000000-0000-0000-0001-000000002001' and idempotency_key = 'x'$$) ~ 'Index',
                  'the idempotency lookup uses the unique index');
select pg_temp.ok(pg_temp.plan_of($$select spendable from rewards.reward_counters_user_day where user_id = '00000000-0000-0000-0001-000000000100' and issuance_day_utc = '2026-01-10'$$) ~ 'Index',
                  'the user-day counter read uses its primary key');

-- Latency of the full recording path on this data (many users, fresh days): record the distribution; assert only a generous bound.
create temp table _lat (ms double precision);
create function pg_temp.measure(n integer) returns void language plpgsql as $$
declare i integer; t0 timestamptz; u uuid; l uuid; lt float8;
begin
  for i in 1..n loop
    u := ('00000000-0000-0000-0001-' || lpad((1 + (i * 7) % 2000)::text, 12, '0'))::uuid;
    l := ('00000000-0000-0000-0002-' || lpad((1 + (i * 11) % 60)::text, 12, '0'))::uuid;
    select latitude into lt from public.locations where id = l;
    perform pg_temp.as_user(u);
    t0 := clock_timestamp();
    perform rewards.record_visit_at(timestamptz '2027-06-01 15:00:00+00' + (i || ' hours')::interval, l, lt, -100, 'measure-key-' || lpad(i::text, 8, '0'), null);
    insert into _lat values (extract(epoch from clock_timestamp() - t0) * 1000);
  end loop;
end $$;
select pg_temp.measure(300);
\o
select 'record_visit_at over 300 calls on the bulk data: min ' || round(min(ms)::numeric, 2) || ' ms, median ' || round((percentile_cont(0.5) within group (order by ms))::numeric, 2)
       || ' ms, p95 ' || round((percentile_cont(0.95) within group (order by ms))::numeric, 2) || ' ms, max ' || round(max(ms)::numeric, 2) || ' ms' as latency from _lat;
\o /dev/null
select pg_temp.ok((select percentile_cont(0.95) within group (order by ms) from _lat) < 250, 'p95 latency of record_visit_at stays under a generous 250 ms on 60,000 visits (measured values are in the evidence log)');
select pg_temp.ok((select count(*) from rewards.visits where idempotency_key like 'measure-key-%') = 300, 'all 300 measured calls were recorded');

-- Invalid inputs are bounded by validation, not by data size (a few probes on the large data set).
select pg_temp.fails($$select rewards.record_visit_at(now(), '00000000-0000-0000-0002-000000000001', 20.01, -100, 'x', null)$$, '22023', 'a too-short key is still refused with data loaded');
select pg_temp.finish();
