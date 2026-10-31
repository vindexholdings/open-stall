-- P3: the three REAL hooks (visit, clearance, reversal) on an account whose lifetime history exceeds one call's budget (6,000 awards). The oversized chain
-- must never be lost: its unfinished work is persisted atomically even when no queue row existed, no partial number or event appears meanwhile, and repair
-- (no further visit) completes it EXACTLY in bounded steps. (Work's review f930574: the hook used to read only `remaining` and drop the rest.)
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(12001) as ar \gset
select pg_temp.mkadmin(12002) as a1 \gset
select pg_temp.mkadmin(12003) as a2 \gset
select pg_temp.mkloc(55.01) as l1 \gset
select pg_temp.mkloc(55.02) as l2 \gset
select pg_temp.mkloc(55.03) as l3 \gset
select pg_temp.mkloc(55.04) as l4 \gset
select pg_temp.mkloc(55.05) as l5 \gset
select pg_temp.mkloc(55.06) as l6 \gset
select pg_temp.mkuser(12101) as ua \gset
select pg_temp.mkuser(12102) as ub \gset
select pg_temp.mkuser(12103) as uc \gset
select pg_temp.setf('ar', :'ar'::uuid) \gset
-- 6,000 awards each (30,000 points), written BEFORE the catalog exists; the threshold 30,005 is reached exactly by ONE more real award
select pg_temp.seed_awards(:'ua'::uuid, 6, 1000, date '2024-01-01');
select pg_temp.seed_awards(:'ub'::uuid, 6, 1000, date '2024-01-01');
select pg_temp.seed_awards(:'uc'::uuid, 6, 1000, date '2024-01-01');
select pg_temp.defn('bigpts', 1, 'lifetime_points_total', 30005, 'none', date '2019-01-01');

-- ============================================================ H1: a real VISIT
select pg_temp.dv(:'ua', :'l1', '2026-10-15', 'h1') as va \gset
select pg_temp.ok((select lifetime_outcome = 'awarded' from rewards.visits where id = :'va'::uuid), 'H1: the real visit is awarded (30,005 points, exactly the threshold)');
select pg_temp.ok((select dirty_scope = array['bigpts|lifetime'] and reason = 'bounded' from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
                  'H1: the oversized chain was NOT lost: a queue row was created by the hook although none existed before');
select pg_temp.ok(pg_temp.last_ev(:'ua', 'bigpts', 'lifetime') = 'none' and (select pass = 'days' from rewards.achievement_calc_state where user_id = :'ua'::uuid and window_key = '|'),
                  'H1: no partial event, and the resumable calculation was started');
select pg_temp.ok((pg_temp.prog(:'ua', 'bigpts', 'lifetime') ->> 'state') = 'unavailable' and (pg_temp.prog(:'ua', 'bigpts', 'lifetime') ->> 'value') is null,
                  'H1: while pending, progress shows unavailable and NO number');
select pg_temp.drain(:'ar', :'ua') as n1 \gset
select pg_temp.ok(:'n1'::int between 1 and 12 and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ua'::uuid), 'H1: repair alone (no further visit) drained the queue in ' || :'n1' || ' bounded repair calls');
select pg_temp.ok(pg_temp.last_ev(:'ua', 'bigpts', 'lifetime') = 'award#1' and (select qualifying_value = 30005 and threshold = 30005 from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'ua'::uuid and c.achievement_key = 'bigpts'),
                  'H1: the final award is exact (30,005 of 30,005)');

-- ============================================================ H2: a real CLEARANCE
select pg_temp.hold_as(:'a1', :'ub') as hb \gset
select pg_temp.dv(:'ub', :'l1', '2026-10-15', 'h2') as vb \gset
select pg_temp.ok((select spendable_outcome = 'held' from rewards.visits where id = :'vb'::uuid) and pg_temp.last_ev(:'ub', 'bigpts', 'lifetime') = 'none' and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
                  'H2: the held visit awards nothing and queues nothing');
select pg_temp.clear_as(:'a2', :'ub') as cb \gset
select pg_temp.ok((:'cb'::jsonb ->> 'lifetime_awarded')::int = 5 and (select dirty_scope = array['bigpts|lifetime'] from rewards.achievement_eval_queue where user_id = :'ub'::uuid) and pg_temp.last_ev(:'ub', 'bigpts', 'lifetime') = 'none',
                  'H2: the clearance committed its award and its hook persisted the oversized chain as pending work (no queue existed before), with no partial event');
select pg_temp.drain(:'ar', :'ub') as n2 \gset
select pg_temp.ok(not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ub'::uuid) and pg_temp.last_ev(:'ub', 'bigpts', 'lifetime') = 'award#1'
              and (select qualifying_value = 30005 from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'ub'::uuid and c.achievement_key = 'bigpts'),
                  'H2: repair completed the chain exactly (30,005) and cleaned the queue');

-- ============================================================ H3: a real REVERSAL (revoke on an oversized history)
select pg_temp.dv(:'uc', :'l1', '2026-10-15', 'h3') as vc \gset
select pg_temp.drain(:'ar', :'uc') as n3a \gset
select pg_temp.ok(pg_temp.last_ev(:'uc', 'bigpts', 'lifetime') = 'award#1', 'H3: setup: the chain is earned at 30,005');
select pg_temp.finalize_as(:'a2', pg_temp.recommend_as(:'a1', :'vc')) as fc \gset
select pg_temp.ok((:'fc'::jsonb ->> 'reversed_lifetime')::int = 5 and pg_temp.last_ev(:'uc', 'bigpts', 'lifetime') = 'award#1'
              and (select dirty_scope = array['bigpts|lifetime'] from rewards.achievement_eval_queue where user_id = :'uc'::uuid) and not exists (select 1 from rewards.achievement_calc_state where user_id = :'uc'::uuid and pass = 'done'),
                  'H3: the reversal committed; its hook invalidated the stale exact state and persisted the oversized chain; the old award event still stands (not yet judged)');
select pg_temp.ok((pg_temp.prog(:'uc', 'bigpts', 'lifetime') ->> 'state') = 'unavailable', 'H3: meanwhile progress never shows the stale badge as earned (unavailable, no number)');
select pg_temp.drain(:'ar', :'uc') as n3 \gset
select pg_temp.ok(not exists (select 1 from rewards.achievement_eval_queue where user_id = :'uc'::uuid) and pg_temp.last_ev(:'uc', 'bigpts', 'lifetime') = 'revoke#2'
              and (select qualifying_value = 30000 and basis_entry_id is not null and decision_id = (:'fc'::jsonb ->> 'decision_id')::uuid from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'uc'::uuid and c.achievement_key = 'bigpts' and e.seq = 2),
                  'H3: repair appended the exact revoke (30,000 below 30,005) citing the reversal entry and its final decision, and cleaned the queue');
select pg_temp.ok((select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.achievement_key = 'bigpts') = 4,
                  'no duplicate or phantom events: exactly four in total (one award each for accounts 1 and 2, an award and a revoke for account 3)');
select pg_temp.finish();
