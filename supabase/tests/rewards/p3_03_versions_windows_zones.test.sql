-- P3: one shared version selector (lifetime vs windowed), threshold changes, prospective award dates, and local-date windows
-- across DST and zones. Definitions that must apply "later" are inserted AFTER the visits and driven through the evaluator with an
-- explicit date, because the hooks always evaluate at the real current date.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(6001) as a1 \gset
select pg_temp.mkadmin(6002) as a2 \gset
select pg_temp.mkloc(49.01) as la \gset
select pg_temp.mkloc(49.02, 'America/New_York') as ln \gset
select now() as t0 \gset
select (clock_timestamp() at time zone 'UTC')::date as tod \gset

-- ============================================================ lifetime: an awarded chain stands under its recorded version; a revoked one adopts the latest
select pg_temp.mkuser(6101) as u \gset
select pg_temp.dv(:'u', :'la', to_char(date '2026-08-01' + g, 'YYYY-MM-DD'), 'v1') from generate_series(0, 9) g;       -- 10 awards = 50 points
select pg_temp.defn('regular', 1, 'lifetime_points_total', 50);
select pg_temp.defn('regular', 2, 'lifetime_points_total', 60, 'none', :'tod'::date);   -- in effect from today: later hooks see it
select rewards.evaluate_achievements(:'u', array['regular|lifetime'], null, date '2026-10-01');
select pg_temp.ok(pg_temp.last_ev(:'u', 'regular', 'lifetime') = 'award#1' and (select version from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u' and c.achievement_key = 'regular') = 1,
                  'awarded under v1 (threshold 50)');
select rewards.evaluate_achievements(:'u', array['regular|lifetime'], null, :'tod'::date);
select pg_temp.ok(pg_temp.last_ev(:'u', 'regular', 'lifetime') = 'award#1' and (rewards.ach_select_version(:'u', 'regular', 'lifetime', :'tod'::date)).version = 1,
                  'v2 (threshold 60) taking effect later does not touch an awarded chain: still v1, no revoke, no duplicate');
select (select id from rewards.reward_ledger where user_id = :'u' and kind = 'lifetime' and entry_type = 'award' order by policy_day_local limit 1) as lid \gset
select pg_temp.finalize_as(:'a2', pg_temp.recommend_as(:'a1', (select visit_id from rewards.reward_ledger where id = :'lid'::uuid))) as f \gset
-- the reversal's own hook already evaluated at the real date (v1 in effect then): the chain is revoked under v1
select pg_temp.ok(pg_temp.last_ev(:'u', 'regular', 'lifetime') = 'revoke#2' and (select version from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u' and c.achievement_key = 'regular' and e.seq = 2) = 1,
                  'a reversal to 45 points revokes under the version recorded on the award (v1)');
select pg_temp.ok((rewards.ach_select_version(:'u', 'regular', 'lifetime', :'tod'::date)).version = 2 and (rewards.ach_select_version(:'u', 'regular', 'lifetime', date '2026-10-01')).version = 1,
                  'a revoked chain is selected PROSPECTIVELY: v2 once it is in effect, v1 before');
select pg_temp.dv(:'u', :'la', '2026-08-20', 'v1');            -- 50 points again; the hook evaluates at the real date, where v2 (60) is in effect
select pg_temp.ok(pg_temp.last_ev(:'u', 'regular', 'lifetime') = 'revoke#2', 'back at 50 points the revoked chain is judged under the in-effect v2 (60): not re-awarded');
select pg_temp.dv(:'u', :'la', '2026-08-21', 'v1');            -- 55
select pg_temp.ok(pg_temp.last_ev(:'u', 'regular', 'lifetime') = 'revoke#2' and (pg_temp.prog(:'u', 'regular', 'lifetime') ->> 'value') = '55' and (pg_temp.prog(:'u', 'regular', 'lifetime') ->> 'threshold') = '60'
                  and (pg_temp.prog(:'u', 'regular', 'lifetime') ->> 'state') = 'removed',
                  'at 55 progress reads 55 of 60 under v2 and is NOT earned (state removed, the climb back is shown), by the same selector as the evaluator');
select pg_temp.dv(:'u', :'la', '2026-08-22', 'v1');            -- 60
select pg_temp.ok(rewards.ach_metric_value(:'u', 'lifetime_points_total', null, null) = 60, 'setup: 60 standing lifetime points');
select pg_temp.ok(pg_temp.last_ev(:'u', 'regular', 'lifetime') = 'award#3'
              and (select e.version || '/' || e.reason || '/' || e.threshold from rewards.achievement_events e join rewards.achievement_chains c using (chain_id)
                    where c.user_id = :'u' and c.achievement_key = 'regular' and e.seq = 3) = '2/re_earn/60',
                  'at 60 the chain is re-earned under v2 (threshold 60), not under the version it was revoked under');
select rewards.evaluate_achievements(:'u', array['regular|lifetime'], null, date '2091-01-01');
select pg_temp.ok((select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'u' and c.achievement_key = 'regular') = 3, 'replay appends nothing');

-- lowering a threshold is prospective: awarded at the evaluation that sees it, never backdated
select pg_temp.mkuser(6102) as ul \gset
select pg_temp.dv(:'ul', :'la', to_char(date '2026-08-01' + g, 'YYYY-MM-DD'), 'v2') from generate_series(0, 4) g;       -- 25 points
select pg_temp.defn('lowering', 1, 'lifetime_points_total', 100);
select pg_temp.defn('lowering', 2, 'lifetime_points_total', 20, 'none', :'tod'::date);
select rewards.evaluate_achievements(:'ul', array['lowering|lifetime'], null, date '2026-10-01');
select pg_temp.ok(pg_temp.last_ev(:'ul', 'lowering', 'lifetime') = 'none', 'at 25 points under v1 (100) nothing is awarded');
select clock_timestamp() as tev \gset
select rewards.evaluate_achievements(:'ul', array['lowering|lifetime'], null, :'tod'::date);
select pg_temp.ok(pg_temp.last_ev(:'ul', 'lowering', 'lifetime') = 'award#1' and (select e.version = 2 and e.created_at >= :'tev'::timestamptz from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'ul' and c.achievement_key = 'lowering'),
                  'a lowered threshold awards at the evaluation that sees it (created now, never backdated), under v2');

-- ============================================================ windowed: the version is fixed by the window start
select pg_temp.defn('expl2', 1, 'distinct_locations', 5, 'calendar_month');
select pg_temp.defn('expl2', 2, 'distinct_locations', 6, 'calendar_month', date '2026-09-15');
select pg_temp.ok((rewards.ach_select_version(null, 'expl2', '2026-08', date '2026-10-01')).version = 1
              and (rewards.ach_select_version(null, 'expl2', '2026-09', date '2026-10-01')).version = 1
              and (rewards.ach_select_version(null, 'expl2', '2026-10', date '2026-10-01')).version = 2
              and (rewards.ach_select_version(null, 'expl2', '2026-09', date '2090-01-01')).version = 1,
                  'v2 effective 2026-09-15 never takes effect inside the open September window; October uses v2; a closed window is never re-judged');
select pg_temp.mkloc(49.11) as w1 \gset
select pg_temp.mkloc(49.12) as w2 \gset
select pg_temp.mkloc(49.13) as w3 \gset
select pg_temp.mkloc(49.14) as w4 \gset
select pg_temp.mkloc(49.15) as w5 \gset
select pg_temp.mkuser(6103) as uw \gset
select pg_temp.dv(:'uw', :'w1', '2026-09-01', 'w');
select pg_temp.dv(:'uw', :'w2', '2026-09-02', 'w');
select pg_temp.dv(:'uw', :'w3', '2026-09-03', 'w');
select pg_temp.dv(:'uw', :'w4', '2026-09-04', 'w');
select pg_temp.dv(:'uw', :'w5', '2026-09-20', 'w');                  -- AFTER v2's date, still inside the September window
select pg_temp.ok(pg_temp.last_ev(:'uw', 'expl2', '2026-09') = 'award#1' and (select version from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'uw' and c.achievement_key = 'expl2' and c.period_key = '2026-09') = 1,
                  'five places in September is awarded under v1 (threshold 5) even though v2 (6) became effective on 09-15');
select pg_temp.dv(:'uw', :'w1', '2026-10-01', 'w');
select pg_temp.dv(:'uw', :'w2', '2026-10-02', 'w');
select pg_temp.dv(:'uw', :'w3', '2026-10-03', 'w');
select pg_temp.dv(:'uw', :'w4', '2026-10-04', 'w');
select pg_temp.dv(:'uw', :'w5', '2026-10-05', 'w');
select pg_temp.ok(pg_temp.last_ev(:'uw', 'expl2', '2026-10') = 'none', 'five places in October is NOT enough: October uses v2 (6), and nothing is awarded silently');
select pg_temp.dv(:'uw', :'la', '2026-10-06', 'w');
select pg_temp.ok(pg_temp.last_ev(:'uw', 'expl2', '2026-10') = 'award#1' and (select version from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = :'uw' and c.achievement_key = 'expl2' and c.period_key = '2026-10') = 2,
                  'a sixth place awards October under v2');

-- ============================================================ local-date windows: month boundary, DST days, a second zone, a fixed season
select pg_temp.defn('any_local', 1, 'qualifying_awards', 1, 'calendar_month');
select pg_temp.mkuser(6104) as ud \gset
select pg_temp.vid('2026-11-01 05:59:59+00', :'ud', :'la', 'p3-zone-0000000000000001');      -- 23:59:59 MDT on Oct 31
select pg_temp.ok(pg_temp.last_ev(:'ud', 'any_local', '2026-10') = 'award#1' and pg_temp.last_ev(:'ud', 'any_local', '2026-11') = 'none', 'the last second of October (America/Denver) counts for October, though the UTC date is November 1');
select pg_temp.vid('2026-11-01 06:00:00+00', :'ud', :'la', 'p3-zone-0000000000000002');      -- 00:00:00 MDT on Nov 1
select pg_temp.ok(pg_temp.last_ev(:'ud', 'any_local', '2026-11') = 'award#1', 'the first second of November (Denver) counts for November');
select pg_temp.vid('2026-11-01 07:30:00+00', :'ud', :'la', 'p3-zone-0000000000000003');      -- 01:30 MDT, the repeated hour's first pass
select pg_temp.ok(rewards.ach_metric_value(:'ud', 'qualifying_awards', date '2026-11-01', date '2026-11-30') = 1, 'DST fall-back day: several visits on one local date award once');
select pg_temp.vid('2027-03-14 06:59:59+00', :'ud', :'la', 'p3-zone-0000000000000004');                -- 23:59:59 MST on Mar 13
select pg_temp.vid('2027-03-14 09:00:00+00', :'ud', :'la', 'p3-zone-0000000000000005');                -- 03:00 MDT on Mar 14 (spring forward)
select pg_temp.ok(pg_temp.last_ev(:'ud', 'any_local', '2027-03') = 'award#1' and rewards.ach_metric_value(:'ud', 'qualifying_awards', date '2027-03-13', date '2027-03-13') = 1
              and rewards.ach_metric_value(:'ud', 'qualifying_awards', date '2027-03-14', date '2027-03-14') = 1, 'spring-forward: 23:59:59 on Mar 13 and 03:00 on Mar 14 are two different local dates');
select pg_temp.mkuser(6105) as un \gset
select pg_temp.vid('2026-11-01 04:30:00+00', :'un', :'ln', 'p3-zone-0000000000000006');                -- 00:30 EDT on Nov 1 in New York
select pg_temp.vid('2026-11-01 04:30:00+00', :'ud', :'la', 'p3-zone-0000000000000007');                -- the same instant is Oct 31 22:30 in Denver (already awarded that day)
select pg_temp.ok(pg_temp.last_ev(:'un', 'any_local', '2026-11') = 'award#1' and pg_temp.last_ev(:'un', 'any_local', '2026-10') = 'none', 'a second zone: the same instant is November in New York, October in Denver (window follows the location''s zone)');

select pg_temp.defn('winter', 1, 'distinct_locations', 2, 'fixed', date '2026-12-01', date '2026-12-01', date '2027-02-28');
select pg_temp.mkuser(6106) as us \gset
select pg_temp.vid('2026-12-01 07:00:00+00', :'us', :'la', 'p3-season-000000000001');
select pg_temp.vid('2027-02-28 18:00:00+00', :'us', :'w1', 'p3-season-000000000002');
select pg_temp.ok(pg_temp.last_ev(:'us', 'winter', '2026-12-01') = 'award#1', 'a fixed season counts two places on its first and last local day');
select pg_temp.mkuser(6107) as us2 \gset
select pg_temp.vid('2026-11-30 18:00:00+00', :'us2', :'la', 'p3-season-000000000003');
select pg_temp.vid('2027-02-28 18:00:00+00', :'us2', :'w1', 'p3-season-000000000004');
select pg_temp.vid('2027-03-01 07:00:00+00', :'us2', :'w2', 'p3-season-000000000005');
select pg_temp.ok(pg_temp.last_ev(:'us2', 'winter', '2026-12-01') = 'none', 'visits the day before and the day after the season do not count (only one place inside it)');

select pg_temp.finish();
