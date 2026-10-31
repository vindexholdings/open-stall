-- P3: INDEPENDENT measurement of real work (index tuples read on the ledger, from pg_stat_xact_user_indexes, not the engine's self-reported counter),
-- the one-request budget of get_my_progress, adversarial heavily-reversed histories, the capped repair batch, invalidation of saved exact state, and
-- rollback of a calculation step. Work model (stated, and what the assertions enforce): a call reads at most budget (5,000) raw award rows plus one
-- sentinel, plus per raw row at most one unique-index reversal probe (one index scan and, for a reversed row, one heap tuple), plus a constant number of
-- catalog/chain/queue lookups: at most 3 x 5,001 + a few hundred in total for a call, and a request shares ONE such budget.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(13001) as ar \gset
select pg_temp.mkloc(56 + g / 100.0) from generate_series(1, 8) g;
select pg_temp.defn('lt' || lpad(g::text, 2, '0'), 1, 'lifetime_points_total', 5 * g * 50, 'none', date '2019-01-01') from generate_series(1, 50) g;
-- a second window that is ALSO over budget: a fixed season covering almost the whole history (after the lifetime window has used the request's budget, it must
-- not be probed again)
select pg_temp.defn('aspanwin', 1, 'distinct_locations', 1, 'fixed', date '2019-01-01', date '2024-01-01', date '2099-12-31');
select pg_temp.mkuser(13101) as u \gset
select pg_temp.seed_awards(:'u'::uuid, 6, 1000, date '2024-01-01');

-- ============================================================ (a) ONE request budget in get_my_progress, measured independently
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'u', true);
select public.get_my_progress(null, 50) as p1 \gset
select pg_temp.ledger_reads() as r1 \gset
select pg_temp.ok((:'r1'::bigint - :'r0'::bigint) <= 5001 + 600, 'progress, 50 lifetime chains plus a second over-budget window (a fixed season) on a 6,000-award user, NO queue and no saved state: ' || (:'r1'::bigint - :'r0'::bigint) || ' ledger tuples+scans in the whole call = ONE charged sentinel probe (the earlier shape read 50 x 5,001 raw rows; the bound for an all-over-budget request is 5,001 + 600, because an over-budget probe is not followed by reversal probes)');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(:'p1'::jsonb -> 'items') i where ((i ->> 'achievement') like 'lt%' or (i ->> 'achievement') = 'aspanwin') and (i ->> 'state') <> 'unavailable') and exists (select 1 from jsonb_array_elements(:'p1'::jsonb -> 'items') i where (i ->> 'achievement') = 'aspanwin'),
                  'every over-budget chain (fifty lifetime chains AND the second over-budget window, the fixed season) was reported unavailable with no partial number');
commit;
-- the second call includes read-repair: ONE shared budget for repair AND display
begin;
select pg_temp.ledger_reads() as r2 \gset
select set_config('request.jwt.claim.sub', :'u', true);
select public.get_my_progress(null, 50) as p2 \gset
select pg_temp.ledger_reads() as r3 \gset
select pg_temp.ok((:'r3'::bigint - :'r2'::bigint) <= 5001 + 600, 'progress WITH read-repair: ' || (:'r3'::bigint - :'r2'::bigint) || ' tuples+scans in the whole call (repair and display share ONE budget; a separate display budget would read about 10,000)');
commit;
-- the shared budget, isolated: the queue holds ONLY the season window, so read-repair spends the request's budget on it while the display still has
-- NON-pending over-budget lifetime chains to show (a separate display budget would probe the lifetime window again)
select pg_temp.mkuser(13140) as up \gset
select pg_temp.seed_awards(:'up'::uuid, 6, 1000, date '2024-01-01');
select rewards.ach_enqueue(:'up'::uuid, array['aspanwin|2024-01-01'], 'seed', null, 0);
begin;
select pg_temp.ledger_reads() as rs0 \gset
select set_config('request.jwt.claim.sub', :'up', true);
select public.get_my_progress(null, 50) as ps \gset
select pg_temp.ledger_reads() as rs1 \gset
select pg_temp.ok((:'rs1'::bigint - :'rs0'::bigint) <= 5001 + 600, 'read-repair of the season window AND a display of non-pending over-budget lifetime chains in ONE request: ' || (:'rs1'::bigint - :'rs0'::bigint) || ' tuples+scans = one shared budget (a separate display budget would add about 5,001 more)');
select pg_temp.ok(exists (select 1 from jsonb_array_elements(:'ps'::jsonb -> 'items') i where (i ->> 'achievement') = 'lt01' and (i ->> 'state') = 'unavailable'), 'the non-pending lifetime chains are reported unavailable once the shared budget is spent (no partial number)');
commit;
-- the evaluator: fifty lifetime chains
begin;
select pg_temp.ledger_reads() as r4 \gset
select rewards.evaluate_achievements(:'u'::uuid, (select array_agg('lt' || lpad(g::text, 2, '0') || '|lifetime') from generate_series(1, 50) g), null) as ev \gset
select pg_temp.ledger_reads() as r5 \gset
select pg_temp.ok((:'r5'::bigint - :'r4'::bigint) <= 2 * 5001 + 600, 'evaluator, 50 lifetime chains on the same user: ' || (:'r5'::bigint - :'r4'::bigint) || ' index tuples read (one shared window, one charged sentinel probe)');
commit;
select pg_temp.setf('ar', :'ar'::uuid) \gset
-- progress is paged (50 per page): the 51st entry (lt50) is on page 2 and was not queued by page 1, so queue it the way a hook or page 2 would
select rewards.ach_enqueue(:'u'::uuid, array['lt50|lifetime'], 'seed', null, 0);
select pg_temp.drain(:'ar'::uuid, :'u'::uuid) as nd \gset
select pg_temp.ok(not exists (select 1 from rewards.achievement_eval_queue where user_id = :'u'::uuid) and (select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u'::uuid and c.achievement_key like 'lt%') = 50,
                  'repair then completed all 50 lifetime chains exactly (thresholds 250..12,500 vs 30,000 points) in ' || :'nd' || ' bounded calls');

-- ============================================================ (b) adversarial HEAVILY REVERSED history: 8,000 raw awards, 7,900 reversed, 100 standing
select pg_temp.mkuser(13102) as ur \gset
select pg_temp.setf('ur', :'ur'::uuid) \gset
select pg_temp.seed_awards(:'ur'::uuid, 8, 1000, date '2024-01-01');
select pg_temp.seed_reversals(:'ur'::uuid, 7900);
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'ur'::uuid and entry_type = 'award') = 8000 and (select count(*) from rewards.reward_ledger where user_id = :'ur'::uuid and entry_type = 'reversal') = 7900, 'setup: 8,000 raw awards, 7,900 reversed');
create temp table _ref as
  select coalesce(sum(a.amount), 0)::int as pts, count(*)::int as aw, count(distinct a.policy_day_local)::int as dy, count(distinct a.location_id)::int as lc
    from rewards.reward_ledger a where a.user_id = :'ur'::uuid and a.entry_type = 'award' and a.kind = 'lifetime' and not exists (select 1 from rewards.reward_ledger x where x.reverses_entry_id = a.id);
select pg_temp.ok((select aw = 100 and pts = 500 from _ref), 'setup: the reference standing set is exactly 100 awards (500 points)');
-- (the table is deliberately NOT analyzed: with stale statistics an unpinned planner reads the whole history; the functions pin ordered index scans)
-- a plain window read sees 8,000 RAW rows even though only 100 stand: the bound counts RAW rows, so it is over budget, not hidden behind the standing filter
select rewards.ach_metrics(:'ur'::uuid, null, null, 5000) ->> 'over' as is_over \gset
select pg_temp.ok(:'is_over' = 'true', 'the bounded probe counts RAW candidate rows: 8,000 raw rows exceed the budget although only 100 stand');
create temp table _rev (n integer, reads bigint, done boolean);
do $$
declare i integer := 0; uid uuid := pg_temp.f('ur'); r jsonb; r0 bigint; ck text := '|';
begin
  perform rewards.ach_calc_start(uid, ck);
  loop
    i := i + 1; r0 := pg_temp.ledger_reads();
    r := rewards.ach_calc_step(uid, ck, null, null, 5000);
    insert into _rev values (i, pg_temp.ledger_reads() - r0, (r ->> 'done')::boolean);
    exit when (r ->> 'done')::boolean or i > 20;
  end loop;
end $$;
select pg_temp.ok((select count(*) from _rev) = 4 and (select max(reads) from _rev) <= 3 * 5000 + 600, 'heavily reversed history: exact completion in ' || (select count(*) from _rev) || ' bounded steps, the most index tuples read in one step was ' || (select max(reads) from _rev) || ' (<= 3 x 5,000 + 600: per raw row at most one raw tuple, one reversal-probe scan and one probe heap tuple)');
select pg_temp.ok((select s.points = r.pts and s.awards = r.aw and s.days = r.dy and s.locs = r.lc and s.pass = 'done' from rewards.achievement_calc_state s, _ref r where s.user_id = :'ur'::uuid and s.window_key = '|'),
                  'the exact result equals the reference over the 100 STANDING awards only (500 points, ' || (select dy from _ref) || ' days, ' || (select lc from _ref) || ' locations)');
\o
\echo '==== EVIDENCE: one days-pass step of the exact calculation on the heavily reversed user (EXPLAIN ANALYZE, BUFFERS): 5,000 raw rows, one reversal probe each'
explain (analyze, buffers, costs off, timing off, summary on)
  with raw as materialized (select l.id, l.amount, l.location_id, l.policy_day_local from rewards.reward_ledger l
     where l.user_id = :'ur'::uuid and l.kind = 'lifetime' and l.entry_type = 'award' order by l.policy_day_local, l.id limit 5000)
  select count(*) from raw r where not exists (select 1 from rewards.reward_ledger x where x.reverses_entry_id = r.id);
\o /dev/null

-- ============================================================ (c) the repair BATCH is capped (each user step <= 5,001 rows; the batch stops at 20,000)
select pg_temp.mkuser(13110 + g) from generate_series(1, 7) g;
select pg_temp.seed_awards(('00000000-0000-0000-0000-' || lpad((13110 + g)::text, 12, '0'))::uuid, 6, 1000, date '2024-01-01') from generate_series(1, 7) g;
insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope, first_failed_at)
  select ('00000000-0000-0000-0000-' || lpad((13110 + g)::text, 12, '0'))::uuid, 'seed', array['lt01|lifetime'], now() - (g || ' minutes')::interval from generate_series(1, 7) g;
begin;
select pg_temp.ledger_reads() as rb0 \gset
select pg_temp.as_role('authenticated', :'ar'::uuid, 'aal2', 'select public.repair_achievements(20)::text')::jsonb as rep \gset
select pg_temp.ledger_reads() as rb1 \gset
select pg_temp.ok((:'rep'::jsonb ->> 'scanned')::int <= 25001 and (:'rep'::jsonb ->> 'processed')::int < 7 and (:'rep'::jsonb ->> 'queue_remaining')::int >= 3,
                  'one public repair call over 7 oversized accounts stopped at the batch cap: processed ' || (:'rep'::jsonb ->> 'processed') || ' of 7, counter ' || (:'rep'::jsonb ->> 'scanned') || ' <= 25,001; the rest stay queued');
select pg_temp.ok((:'rb1'::bigint - :'rb0'::bigint) <= 2 * 25001 + 3000, 'the batch really read ' || (:'rb1'::bigint - :'rb0'::bigint) || ' ledger index tuples (<= 2 x 25,001 + 3,000): measured independently of the counter');
commit;
select pg_temp.drain(:'ar'::uuid, ('00000000-0000-0000-0000-' || lpad((13111)::text, 12, '0'))::uuid) as dummy2 \gset
select count(*) as left_q from rewards.achievement_eval_queue \gset
select pg_temp.as_role('authenticated', :'ar'::uuid, 'aal2', 'select public.repair_achievements(20)::text') as rp2 \gset
select pg_temp.as_role('authenticated', :'ar'::uuid, 'aal2', 'select public.repair_achievements(20)::text') as rp3 \gset
select pg_temp.as_role('authenticated', :'ar'::uuid, 'aal2', 'select public.repair_achievements(20)::text') as rp4 \gset
create temp table _q (n integer);
do $$
declare i integer := 0;
begin
  while exists (select 1 from rewards.achievement_eval_queue) and i < 60 loop
    i := i + 1;
    perform pg_temp.as_role('authenticated', pg_temp.f('ar'), 'aal2', 'select public.repair_achievements(20)::text');
  end loop;
  insert into _q values (i);
end $$;
select pg_temp.ok(not exists (select 1 from rewards.achievement_eval_queue) and (select count(*) from rewards.achievement_chains where achievement_key = 'lt01' and user_id in (select ('00000000-0000-0000-0000-' || lpad((13110 + g)::text, 12, '0'))::uuid from generate_series(1, 7) g)) = 7,
                  'repeated bounded batches eventually complete every account exactly (all 7 have their lt01 chain, the queue is empty)');

-- ============================================================ (d) a relevant change INVALIDATES saved exact state (no stale exact number survives)
select pg_temp.mkuser(13120) as ui \gset
select pg_temp.seed_awards(:'ui'::uuid, 6, 1000, date '2024-01-01');
select pg_temp.defn('hugepts', 1, 'lifetime_points_total', 99999999, 'none', date '2019-01-01');
select rewards.ach_enqueue(:'ui'::uuid, array['hugepts|lifetime'], 'seed', null, 0);
select pg_temp.drain(:'ar'::uuid, :'ui'::uuid) as dummy3 \gset
select pg_temp.ok((select pass = 'done' and points = 30000 from rewards.achievement_calc_state where user_id = :'ui'::uuid and window_key = '|'), 'setup: a finished exact state holds 30,000 points');
select pg_temp.dv(:'ui', (select id from public.locations order by id limit 1), '2026-10-20', 'inv');
select pg_temp.ok(not exists (select 1 from rewards.achievement_calc_state where user_id = :'ui'::uuid and pass = 'done'), 'a real award invalidated the saved exact state in the same transaction (the stale 30,000 cannot be reused)');
select pg_temp.drain(:'ar'::uuid, :'ui'::uuid) as dummy4 \gset
select pg_temp.ok((select pass = 'done' and points = 30005 from rewards.achievement_calc_state where user_id = :'ui'::uuid and window_key = '|'), 'the recomputation is exact on the new history: 30,005');

-- ============================================================ (e) rollback and cross-user denial
select pg_temp.mkuser(13130) as uk \gset
select pg_temp.setf('uk', :'uk'::uuid) \gset
select pg_temp.seed_awards(:'uk'::uuid, 6, 1000, date '2024-01-01');
select rewards.ach_calc_start(:'uk'::uuid, '|');
select rewards.ach_calc_step(:'uk'::uuid, '|', null, null, 5000);
select steps as st0, cursor_id as cur0 from rewards.achievement_calc_state where user_id = :'uk'::uuid and window_key = '|' \gset
create function pg_temp.step_then_fail() returns void language plpgsql as $$
begin
  perform rewards.ach_calc_step(pg_temp.f('uk'), '|', null, null, 5000);
  raise exception 'forced failure after a calculation step' using errcode = 'RW999';
end $$;
select pg_temp.fails('select pg_temp.step_then_fail()', 'RW999', 'a FORCED error (RW999, a synthetic failure, not a real cancellation; real pg_cancel_backend is proven in p3_14) after a calculation step aborts the enclosing transaction');
select pg_temp.ok((select steps = :'st0'::int and cursor_id = :'cur0'::uuid from rewards.achievement_calc_state where user_id = :'uk'::uuid and window_key = '|'), 'the rolled-back step left the saved state exactly as it was (cursor and counters), so a retry cannot double count');
select pg_temp.mkuser(13131) as uz \gset
insert into rewards.achievement_calc_state (user_id, window_key, pass) values (:'uz', '|', 'days');
select pg_temp.fails_as('reward_purge_owner', :'uk'::uuid, 'aal1', format($$delete from rewards.achievement_calc_state where user_id = %L::uuid$$, :'uz'), '42501', 'the purge role with the subject of ANOTHER account cannot delete a calculation state');
select pg_temp.ok((select count(*) from rewards.achievement_calc_state where user_id = :'uz'::uuid) = 1, 'the other account''s state is still there');
select pg_temp.finish();
