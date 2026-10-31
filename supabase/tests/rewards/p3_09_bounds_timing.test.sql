-- P3 bounds with MEASURED evidence (a hypothesis until measured): one user with ~3,300 lifetime awards over 36 months, 2,000 users with 30 days each
-- (60,000 awards), and a 500-chain backlog. The data is bulk-seeded with triggers disabled (session_replication_role = replica) for the
-- SEED ONLY: this measures the evaluator's READ cost and the repair loop, not insert cost, and it proves nothing about the write guards (other files do).
-- Wall-clock bounds below are generous CI guards against regression, not performance claims. The WHOLE-CALL row accounting (rows read per evaluator call,
-- caching, budget stops, deferral, exact resumable completion) is asserted from the evaluator's own `scanned` counter in the second half of this file.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(9010) as a1 \gset
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
select pg_temp.ok(:'scanned_big'::int = 3285, 'the SIMPLIFIED standalone read plan (not a whole engine call) examines ' || :'scanned_big' || ' ledger rows for the 3,285-award user; the whole-call bound is measured in the second half of this file');

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
-- a 109-chain backlog (not a 500-chain one): bounded steps
select pg_temp.mkuser(9002) as ub2 \gset
select rewards.ach_enqueue(:'ub'::uuid, (select array_agg(e) from (select e from unnest(:'scope109'::text[]) e) s), 'seed', null, 0);
select pg_temp.timed_ms(format($q$select rewards.ach_process_queue(%L::uuid) from generate_series(1, 3)$q$, :'ub')) as msq \gset
select pg_temp.ok(:'msq'::numeric < 6000 and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ub'::uuid), 'a 109-chain backlog (this is a SIMPLE timing of three bounded steps; the exact whole-call accounting follows) drained in ' || round(:'msq'::numeric) || ' ms, then the queue row was deleted');

-- ============================================================ WHOLE-CALL accounting (the evaluator's own counter): budget 5,000 standing awards per call
-- (1) fifty lifetime definitions on the 3,285-award user: ONE scan is shared (cached per window), not fifty
select pg_temp.defn('lt' || lpad(g::text, 2, '0'), 1, 'lifetime_points_total', 5 * g * 50, 'none', date '2019-01-01') from generate_series(1, 50) g;
select rewards.evaluate_achievements(:'ub'::uuid, (select array_agg('lt' || lpad(g::text, 2, '0') || '|lifetime') from generate_series(1, 50) g), null) as r50 \gset
select pg_temp.ok((:'r50'::jsonb ->> 'processed')::int = 50 and (:'r50'::jsonb ->> 'scanned')::int = 3285 and jsonb_array_length(:'r50'::jsonb -> 'remaining') = 0,
                  'fifty lifetime definitions on the 3,285-award user: all 50 chains evaluated in ONE call that read the history ONCE (scanned ' || (:'r50'::jsonb ->> 'scanned') || ', not 50 x 3,285)');
select pg_temp.ok((select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'ub'::uuid and c.achievement_key like 'lt%') = 50,
                  'thresholds 250..12,500 vs 16,425 lifetime points: all 50 lifetime chains are earned (exact)');
-- (2) a window set plus the lifetime history does not fit one call: the call stops at the budget and RETURNS the rest, exactly
select (select array_agg(e order by e) from (select 'b_cnt|' || to_char(date '2023-11-01' + (m || ' months')::interval, 'YYYY-MM') as e from generate_series(0, 35) m union all select 'b_pts|lifetime') s) as sc37 \gset
select rewards.evaluate_achievements(:'ub'::uuid, :'sc37'::text[], null) as rb \gset
select pg_temp.ok((:'rb'::jsonb ->> 'scanned')::int = 3285 + 1716 and (:'rb'::jsonb -> 'remaining') = '["b_pts|lifetime"]'::jsonb and (:'rb'::jsonb ->> 'processed')::int = 36,
                  '36 monthly windows read 3,285 awards; the lifetime probe reads the 1,716 rows left in the budget (sentinel included) and is CHARGED, so the call reports scanned ' || (:'rb'::jsonb ->> 'scanned') || ' = budget + the sentinel, and returns exactly the lifetime chain as remaining');
select rewards.evaluate_achievements(:'ub'::uuid, '{b_pts|lifetime}', null) as rc \gset
select pg_temp.ok((:'rc'::jsonb ->> 'scanned')::int = 3285 and (:'rc'::jsonb -> 'remaining') = '[]'::jsonb and (select count(*) from rewards.achievement_chains where user_id = :'ub'::uuid and achievement_key = 'b_pts') = 1,
                  'the resumed call finishes the remaining chain exactly (fresh budget)');
-- (3) the exact resumable drain through the queue and the bounded full re-scan: a second big user, 13 monthly keys, 624 old dirty windows
select pg_temp.mkuser(9003) as ub3 \gset
select pg_temp.setf('ub3', :'ub3'::uuid) \gset
select pg_temp.seed_awards(:'ub3'::uuid, 3, 1095, date '2023-11-01');
select pg_temp.defn('ox' || lpad(g::text, 2, '0'), 1, 'distinct_locations', 2, 'calendar_month', date '2019-01-01') from generate_series(1, 10) g;
select rewards.ach_enqueue(:'ub3'::uuid, (select array_agg(k || '|' || to_char(date '2019-01-01' + (m || ' months')::interval, 'YYYY-MM'))
   from unnest(array['b_loc','b_days','b_cnt'] || (select array_agg('ox' || lpad(g::text, 2, '0')) from generate_series(1, 10) g)) k, generate_series(0, 47) m), 'seed', null, 0);
select pg_temp.ok((select overflow and cardinality(dirty_scope) = 500 from rewards.achievement_eval_queue where user_id = :'ub3'::uuid), 'setup: 624 old dirty windows, capped at 500 with the overflow flag');
create temp table _steps (i integer);
do $$
declare i integer := 0; uid uuid := pg_temp.f('ub3');
begin
  while exists (select 1 from rewards.achievement_eval_queue where user_id = uid) and i < 80 loop
    i := i + 1;
    perform rewards.ach_process_queue(uid);
  end loop;
  insert into _steps values (i);
end $$;
select i as nsteps from _steps \gset
select pg_temp.ok(:'nsteps'::int > 10 and :'nsteps'::int < 80 and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ub3'::uuid),
                  'the backlog drained in ' || :'nsteps' || ' bounded steps (10 for the 500 dirty entries, the rest the paged re-scan with budget stops) and the queue row was deleted only at the end');
create temp table _mis (entry text, should boolean, awarded boolean);
do $$
declare uid uuid := pg_temp.f('ub3'); c text; k text; per text; rule text; ws date; we date; d rewards.achievement_definitions%rowtype; v integer; a boolean;
begin
  for c in select x from rewards.ach_candidate_chains(uid) x loop
    k := split_part(c, '|', 1); per := split_part(c, '|', 2); rule := rewards.ach_rule(k); ws := rewards.ach_window_start(rule, per);
    d := rewards.ach_select_version(uid, k, per, rewards.ach_today());
    we := case rule when 'calendar_month' then ((ws + interval '1 month')::date - 1) when 'fixed' then d.window_ends_on else null end;
    v := rewards.ach_metric_value(uid, d.metric, ws, we);
    select coalesce((select e.event = 'award' from rewards.achievement_events e join rewards.achievement_chains ch using (chain_id)
                      where ch.user_id = uid and ch.achievement_key = k and ch.period_key = per order by e.seq desc limit 1), false) into a;
    insert into _mis values (c, v >= d.threshold, a);
  end loop;
end $$;
select pg_temp.ok((select count(*) from _mis) >= 200 and not exists (select 1 from _mis where should <> awarded), 'EXACT completion: for all ' || (select count(*) from _mis) || ' candidate chains the final award state equals the reference eligibility computed from the ledger (no chain skipped by a budget stop, none approximated)');
select pg_temp.ok((select count(*) from _mis where awarded) > 100, 'many chains were really awarded by the drain (so the exactness check is not vacuous)');
-- (4) a user whose lifetime history exceeds the WHOLE budget (6,006 awards): the chain is completed EXACTLY by resumable bounded steps (no permanent deferral)
select pg_temp.mkuser(9004) as ub4 \gset
select pg_temp.setf('ub4', :'ub4'::uuid) \gset
select pg_temp.mkloc(52.04) as l4 \gset
select pg_temp.mkloc(52.05) as l5 \gset
select pg_temp.mkloc(52.06) as l6 \gset
select pg_temp.mkloc(52.07) as l7 \gset
select pg_temp.seed_awards(:'ub4'::uuid, 7, 858, date '2024-01-01');   -- 6,006 awards: both chunk boundaries (row 5,000) fall INSIDE a day and INSIDE a location
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'ub4'::uuid) = 6006, 'setup: 6,006 standing awards for one user');
select pg_temp.set_settings(true, 1000000);
-- FIRST progress call (no queue, no state yet): the budget is enforced inside progress itself and the over-budget outcome is cached, so fifty lifetime
-- chains cost ONE probe, not fifty; nothing partial is shown
select pg_temp.ok((pg_temp.prog(:'ub4', 'lt01', 'lifetime') ->> 'state') = 'unavailable' and (pg_temp.prog(:'ub4', 'lt01', 'lifetime') ->> 'value') is null,
                  'progress on the 6,006-award user: a lifetime chain is unavailable (never a partial number)');
select rewards.ach_enqueue(:'ub4'::uuid, array['b_cnt|2026-07', 'b_pts|lifetime'], 'seed', null, 0);
create temp table _st4 (n integer, sc integer, dirty integer, st text);
do $$
declare i integer := 0; uid uuid := pg_temp.f('ub4'); r jsonb;
begin
  while exists (select 1 from rewards.achievement_eval_queue where user_id = uid) and i < 40 loop
    i := i + 1;
    r := rewards.ach_process_queue(uid);
    insert into _st4 values (i, (r ->> 'scanned')::integer, (select cardinality(dirty_scope) from rewards.achievement_eval_queue where user_id = uid),
                             (select pass from rewards.achievement_calc_state where user_id = uid and window_key = '|'));
  end loop;
end $$;
select pg_temp.ok((select max(sc) from _st4) <= 5001 and (select count(*) from _st4) between 2 and 12, 'bounded steps: ' || (select count(*) from _st4) || ' steps, none read more than 5,001 raw rows (max ' || (select max(sc) from _st4) || ')');
select pg_temp.ok((select steps = 4 and pass = 'done' from rewards.achievement_calc_state where user_id = :'ub4'::uuid and window_key = '|'), 'the saved state advanced through exactly four bounded steps (days pass 5,000 + 1,006 rows, locations pass 5,000 + 1,006 rows): resumed, never restarted');
select pg_temp.ok(not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ub4'::uuid) and pg_temp.last_ev(:'ub4', 'b_pts', 'lifetime') = 'award#1'
              and (select qualifying_value = 30030 from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'ub4'::uuid and c.achievement_key = 'b_pts'),
                  'the over-budget lifetime chain COMPLETED exactly (30,030 points = 6,006 x 5), the queue row was deleted only then');
select pg_temp.ok((select points = 30030 and awards = 6006 and days = 858 and locs = 7 and pass = 'done' from rewards.achievement_calc_state where user_id = :'ub4'::uuid and window_key = '|'),
                  'the exact accumulated state (points, awards, DISTINCT days by day transitions, DISTINCT locations by location transitions) equals the truth: 30,030 / 6,006 / 858 / 7');
select pg_temp.ok(rewards.ach_metric_value(:'ub4'::uuid, 'distinct_locations', null, null) = 7 and rewards.ach_metric_value(:'ub4'::uuid, 'distinct_active_days', null, null) = 858,
                  'the unbudgeted reference metrics agree');
select pg_temp.ok((pg_temp.prog(:'ub4', 'b_pts', 'lifetime') ->> 'state') = 'earned' and (pg_temp.prog(:'ub4', 'b_pts', 'lifetime') ->> 'value') = '30030',
                  'progress now shows the exact number from the finished calculation (no rescan)');

select pg_temp.timed_ms(format($q$select rewards.ach_candidate_chains(%L::uuid)$q$, :'ub')) as mscand \gset
select pg_temp.ok(:'mscand'::numeric < 2000, 'candidate enumeration for the big user (distinct months by loose index probes) took ' || round(:'mscand'::numeric) || ' ms (< 2 s)');
-- (5) measurements behind the technical proposal to Work (the 5,000-row bound is a hypothesis; these are the observed costs of an UNBUDGETED exact read)
select pg_temp.timed_ms(format($q$select rewards.ach_metrics(%L::uuid, null, null, 2147483000)$q$, :'ub')) as ms_3285 \gset
select pg_temp.timed_ms(format($q$select rewards.ach_metrics(%L::uuid, null, null, 2147483000)$q$, :'ub4')) as ms_6000 \gset
select pg_temp.ok(:'ms_3285'::numeric < 2000 and :'ms_6000'::numeric < 2000,
                  'measured, unbudgeted exact lifetime read: ' || round(:'ms_3285'::numeric, 1) || ' ms for 3,285 standing awards and ' || round(:'ms_6000'::numeric, 1) || ' ms for 6,006 (the budget is a safety bound chosen by Work, not a measured cost limit)');
select pg_temp.finish();
