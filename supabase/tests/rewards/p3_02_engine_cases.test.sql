-- P3 engine: the worked cases of ACHIEVEMENTS_PLAN sections 3, 4 and 7, run through the REAL visit, clearance and reversal paths.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(4001) as a1 \gset
select pg_temp.mkadmin(4002) as a2 \gset
select pg_temp.defn('first_stop', 1, 'qualifying_awards', 1);
select pg_temp.defn('regular', 1, 'lifetime_points_total', 50);
select pg_temp.defn('explorer', 1, 'distinct_locations', 5, 'calendar_month');
select pg_temp.defn('steady', 1, 'distinct_active_days', 8, 'calendar_month');
select pg_temp.defn('days3', 1, 'distinct_active_days', 3, 'calendar_month');
select pg_temp.mkloc(47.01) as la \gset
select pg_temp.mkloc(47.02) as lb \gset
select pg_temp.mkloc(47.03) as lc \gset
select pg_temp.mkloc(47.04) as ld \gset
select pg_temp.mkloc(47.05) as le \gset
select pg_temp.mkloc(47.06) as lf \gset

-- ============================================================ case 1: five days at ONE restroom
select pg_temp.mkuser(4101) as u1 \gset
select pg_temp.dv(:'u1', :'la', '2026-08-0' || g, 'c1') from generate_series(1, 5) g;
select pg_temp.ok(pg_temp.last_ev(:'u1', 'first_stop', 'lifetime') = 'award#1', 'five days at one place: First Stop is earned (qualifying_awards >= 1)');
select pg_temp.ok(pg_temp.last_ev(:'u1', 'regular', 'lifetime') = 'none' and rewards.ach_metric_value(:'u1', 'lifetime_points_total', null, null) = 25, 'Regular is 25 of 50: no award');
select pg_temp.ok(pg_temp.last_ev(:'u1', 'explorer', '2026-08') = 'none' and rewards.ach_metric_value(:'u1', 'distinct_locations', date '2026-08-01', date '2026-08-31') = 1, 'Explorer is 1 of 5 (distinct locations, not check-ins): no award');
select pg_temp.ok(rewards.ach_metric_value(:'u1', 'distinct_active_days', date '2026-08-01', date '2026-08-31') = 5 and pg_temp.last_ev(:'u1', 'steady', '2026-08') = 'none', 'Steady Month is 5 of 8 active days: no award');
select pg_temp.ok(rewards.ach_metric_value(:'u1', 'qualifying_awards', null, null) = 5, 'qualifying_awards counts the five check-ins');
select pg_temp.ok((select array_agg(achievement_key order by achievement_key) from rewards.achievement_chains where user_id = :'u1') = array['days3', 'first_stop'],
                  'only achievements that were really earned have a chain (days3 at 3 of 3 dates, First Stop); nothing is fabricated for the others');
select to_char((clock_timestamp() at time zone 'UTC')::date, 'YYYY-MM') as curp \gset
select pg_temp.ok((pg_temp.prog(:'u1', 'explorer', :'curp') ->> 'state') = 'in_progress' and (pg_temp.prog(:'u1', 'explorer', :'curp') ->> 'value') = '0'
                  and (pg_temp.prog(:'u1', 'explorer', :'curp') ->> 'threshold') = '5', 'progress for the CURRENT window is a real, server-computed 0 of 5 (never a placeholder)');
select pg_temp.ok(pg_temp.prog(:'u1', 'explorer', '2026-08') is null, 'a past window with no event is not listed (no fabricated history)');

-- ============================================================ case 2: five different places, five different days
select pg_temp.mkuser(4102) as u2 \gset
select pg_temp.dv(:'u2', :'la', '2026-08-01', 'c2');
select pg_temp.dv(:'u2', :'lb', '2026-08-02', 'c2');
select pg_temp.dv(:'u2', :'lc', '2026-08-03', 'c2');
select pg_temp.dv(:'u2', :'ld', '2026-08-04', 'c2');
select pg_temp.ok(pg_temp.last_ev(:'u2', 'explorer', '2026-08') = 'none', 'four places: Explorer not yet earned');
select pg_temp.dv(:'u2', :'le', '2026-08-05', 'c2');
select pg_temp.ok(pg_temp.last_ev(:'u2', 'explorer', '2026-08') = 'award#1', 'five places: Explorer is awarded (award event 1)');
select pg_temp.ok((select qualifying_value || '/' || threshold || '/' || version || '/' || reason from rewards.achievement_events e join rewards.achievement_chains c using (chain_id)
                    where c.user_id = :'u2' and c.achievement_key = 'explorer') = '5/5/1/first_award' and
                  (select basis_entry_id is null and decision_id is null from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u2' and c.achievement_key = 'explorer'),
                  'the award stores numeric snapshots only (no ledger or decision ids)');
select pg_temp.ok(pg_temp.last_ev(:'u2', 'steady', '2026-08') = 'none' and rewards.ach_metric_value(:'u2', 'lifetime_points_total', null, null) = 25, 'Steady 5 of 8 and Regular 25 of 50 as in the plan');
-- replay appends nothing
select rewards.evaluate_achievements(:'u2', rewards.ach_scope_for_day(date '2026-08-05'), null);
select pg_temp.ok((select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u2' and c.achievement_key = 'explorer') = 1, 'replaying the evaluation appends nothing');

-- ============================================================ case 3: reversal of a NON-last award at a place that has another
select pg_temp.mkuser(4103) as u3 \gset
select pg_temp.dv(:'u3', :'la', '2026-08-01', 'c3') as v_a1 \gset
select pg_temp.dv(:'u3', :'la', '2026-08-02', 'c3');
select pg_temp.dv(:'u3', :'lb', '2026-08-03', 'c3');
select pg_temp.dv(:'u3', :'lc', '2026-08-04', 'c3');
select pg_temp.dv(:'u3', :'ld', '2026-08-05', 'c3');
select pg_temp.dv(:'u3', :'le', '2026-08-06', 'c3') as v_e \gset
select pg_temp.ok(pg_temp.last_ev(:'u3', 'explorer', '2026-08') = 'award#1' and rewards.ach_metric_value(:'u3', 'distinct_locations', date '2026-08-01', date '2026-08-31') = 5, 'setup: six awards, five places, Explorer earned');
select pg_temp.finalize_as(:'a2', pg_temp.recommend_as(:'a1', :'v_a1')) as f1 \gset
select pg_temp.ok(pg_temp.last_ev(:'u3', 'explorer', '2026-08') = 'award#1' and rewards.ach_metric_value(:'u3', 'distinct_locations', date '2026-08-01', date '2026-08-31') = 5
                  and rewards.ach_metric_value(:'u3', 'qualifying_awards', null, null) = 5 and rewards.ach_metric_value(:'u3', 'lifetime_points_total', null, null) = 25,
                  'reversing one of two awards at a place keeps 5 places (no revoke); awards 5, points 25');

-- ============================================================ case 4: reversal of the LAST standing award at a place, then re-earn
select pg_temp.finalize_as(:'a2', pg_temp.recommend_as(:'a1', :'v_e')) as f2 \gset
select pg_temp.ok(pg_temp.last_ev(:'u3', 'explorer', '2026-08') = 'revoke#2' and rewards.ach_metric_value(:'u3', 'distinct_locations', date '2026-08-01', date '2026-08-31') = 4,
                  'reversing the last standing award at a place drops to 4 places: a revoke event (seq 2)');
select pg_temp.ok((select e.basis_entry_id = r.id and e.decision_id = (:'f2'::jsonb ->> 'decision_id')::uuid and r.entry_type = 'reversal' and r.kind = 'lifetime' and r.reward_decision_id = e.decision_id
                     from rewards.achievement_events e join rewards.achievement_chains c using (chain_id)
                     join rewards.reward_ledger r on r.id = e.basis_entry_id where c.user_id = :'u3' and c.achievement_key = 'explorer' and e.seq = 2),
                  'the revoke references the lifetime reversal entry and its P2 final decision (rewards.reward_decisions)');
select pg_temp.ok((select event from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u3' and c.achievement_key = 'explorer' and e.seq = 1) = 'award', 'the original award event is untouched');
select pg_temp.dv(:'u3', :'lf', '2026-08-20', 'c3');
select pg_temp.ok(pg_temp.last_ev(:'u3', 'explorer', '2026-08') = 'award#3' and
                  (select reason from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u3' and c.achievement_key = 'explorer' and e.seq = 3) = 're_earn',
                  'a new award at a fifth place inside the window re-earns the badge (award seq 3, re_earn)');
select rewards.evaluate_achievements(:'u3', rewards.ach_scope_for_day(date '2026-08-20'), null);
select pg_temp.ok((select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u3' and c.achievement_key = 'explorer') = 3, 'replaying after the re-earn appends nothing (still 3 events)');

-- ============================================================ case 5: reversal on a shared date
select pg_temp.mkuser(4104) as u4 \gset
select pg_temp.dv(:'u4', :'la', '2026-08-10', 'c5') as v_s1 \gset
select pg_temp.dv(:'u4', :'lb', '2026-08-10', 'c5');
select pg_temp.dv(:'u4', :'lc', '2026-08-11', 'c5');
select pg_temp.ok(pg_temp.last_ev(:'u4', 'days3', '2026-08') = 'none' and rewards.ach_metric_value(:'u4', 'distinct_active_days', date '2026-08-01', date '2026-08-31') = 2, 'setup: 3 awards on 2 dates');
select pg_temp.dv(:'u4', :'ld', '2026-08-12', 'c5');
select pg_temp.ok(pg_temp.last_ev(:'u4', 'days3', '2026-08') = 'award#1', 'a third distinct date earns days3');
select pg_temp.finalize_as(:'a2', pg_temp.recommend_as(:'a1', :'v_s1'));
select pg_temp.ok(rewards.ach_metric_value(:'u4', 'distinct_active_days', date '2026-08-01', date '2026-08-31') = 3 and pg_temp.last_ev(:'u4', 'days3', '2026-08') = 'award#1',
                  'reversing one of two awards on a shared date leaves distinct_active_days unchanged (no revoke)');

-- ============================================================ case 6: held visit cleared later, attributed to its ORIGINAL local date
select pg_temp.mkuser(4105) as u5 \gset
select pg_temp.dv(:'u5', :'la', '2026-07-01', 'c6');
select pg_temp.dv(:'u5', :'lb', '2026-07-02', 'c6');
select pg_temp.dv(:'u5', :'lc', '2026-07-03', 'c6');
select pg_temp.dv(:'u5', :'ld', '2026-07-04', 'c6');
select pg_temp.hold_as(:'a1', :'u5') as h \gset
select pg_temp.dv(:'u5', :'le', '2026-07-30', 'c6') as v_held \gset
select pg_temp.ok((select spendable_outcome from rewards.visits where id = :'v_held'::uuid) = 'held' and pg_temp.last_ev(:'u5', 'explorer', '2026-07') = 'none',
                  'the fifth place was held: no award, no event (a held visit contributes nothing)');
select pg_temp.clear_as(:'a2', :'u5') as cl \gset
select pg_temp.ok(pg_temp.last_ev(:'u5', 'explorer', '2026-07') = 'award#1', 'clearing the hold awards July Explorer in the clearance transaction, attributed to July 30');
select pg_temp.ok((pg_temp.prog(:'u5', 'explorer', '2026-07') ->> 'state') = 'earned' and (pg_temp.prog(:'u5', 'explorer', '2026-07') ->> 'earned_late') = 'true', 'progress shows it earned late for the closed window');
select pg_temp.ok(pg_temp.last_ev(:'u5', 'explorer', '2026-08') = 'none' and rewards.ach_metric_value(:'u5', 'distinct_locations', date '2026-08-01', date '2026-08-31') = 0, 'the August window is unaffected');

select pg_temp.finish();
