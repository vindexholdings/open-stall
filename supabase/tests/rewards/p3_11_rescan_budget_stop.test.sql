-- P3: a full re-scan page that STOPS on the call budget must resume exactly at the first unprocessed entry (the cursor is the last entry PROCESSED,
-- never the end of the page). Catalog: ONE monthly key and three lifetime keys, so a single page holds 36 monthly windows (3,285 awards read) followed by
-- lifetime chains that do not fit the rest of the budget.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkloc(54.01) as la \gset
select pg_temp.mkloc(54.02) as lb \gset
select pg_temp.mkloc(54.03) as lc \gset
select pg_temp.mkuser(11101) as u \gset
select pg_temp.setf('u', :'u'::uuid) \gset
select pg_temp.seed_awards(:'u'::uuid, 3, 1095, date '2023-11-01');
select pg_temp.defn('mkx', 1, 'qualifying_awards', 1, 'calendar_month', date '2019-01-01');
select pg_temp.defn('lp1', 1, 'lifetime_points_total', 5, 'none', date '2019-01-01');
select pg_temp.defn('lp2', 1, 'lifetime_points_total', 100, 'none', date '2019-01-01');
select pg_temp.defn('lp3', 1, 'lifetime_points_total', 1000, 'none', date '2019-01-01');
-- overflow: 501 valid dirty windows of the monthly key (2019-01 onwards), capped at 500
select rewards.ach_enqueue(:'u'::uuid, (select array_agg('mkx|' || to_char(date '2019-01-01' + (m || ' months')::interval, 'YYYY-MM')) from generate_series(0, 500) m), 'seed', null, 0);
select pg_temp.ok((select overflow and cardinality(dirty_scope) = 500 from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'setup: 501 dirty windows, capped at 500 with the overflow flag');
select rewards.ach_process_queue(:'u'::uuid) from generate_series(1, 10);
select pg_temp.ok((select cardinality(dirty_scope) = 0 and overflow and rescan_cursor is null from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'the dirty windows drained; the re-scan is still owed');
select pg_temp.ok((select count(*) from rewards.achievement_chains where user_id = :'u'::uuid and achievement_key = 'mkx') = 36 and (select count(*) from rewards.achievement_chains where user_id = :'u'::uuid and achievement_key like 'lp%') = 0,
                  'the 36 real monthly windows were awarded by the dirty drain; no lifetime chain exists yet');
-- the re-scan page: 36 monthly windows + 3 lifetime chains (39 entries): the lifetime scan does not fit, so the page STOPS
select rewards.ach_process_queue(:'u'::uuid);
select pg_temp.ok((select overflow and rescan_cursor = 'mkx|2026-10' from rewards.achievement_eval_queue where user_id = :'u'::uuid) and (select count(*) from rewards.achievement_chains where user_id = :'u'::uuid and achievement_key like 'lp%') = 0,
                  'the page stopped on the budget: the cursor is the last PROCESSED entry (mkx|2026-10), not the end of the page, and no lifetime chain was evaluated yet');
select rewards.ach_process_queue(:'u'::uuid);
select pg_temp.ok(not exists (select 1 from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'the next step resumes at the first unprocessed entry, finishes the re-scan, and only then is the row deleted');
select pg_temp.ok((select count(*) from rewards.achievement_chains c join rewards.achievement_events e using (chain_id) where c.user_id = :'u'::uuid and c.achievement_key like 'lp%' and e.event = 'award') = 3,
                  'all three lifetime chains were awarded exactly (none skipped by the budget stop)');
select pg_temp.finish();
