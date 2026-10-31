-- P3: a NEW overflow episode while a full re-scan is in progress must not lose older work behind the re-scan cursor (Work's review of 6537a09).
-- Real fixture: a partial re-scan advances past 2026-07; a late award dated 2025-11 fails its hook (recoverable) and is queued; then more than 500
-- valid dirty entries arrive and the cap DROPS the 2025-11 entries (they sort last among the older ones). The re-scan must rewind and finish exactly.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
create function public.p3test_inject() returns trigger language plpgsql as $$
declare c text := current_setting('p3test.code', true);
begin
  if c is not null and c <> '' then raise exception 'injected %', c using errcode = c; end if;
  return new;
end $$;
create trigger p3test_inject before insert on rewards.achievement_events for each row execute function public.p3test_inject();
select pg_temp.mkloc(53.01) as la \gset
select pg_temp.mkuser(10101) as u \gset
select pg_temp.setf('u', :'u'::uuid) \gset
-- six months of real awards, written BEFORE the catalog exists (no hook runs, no event yet)
select pg_temp.dv(:'u', :'la', d, 'rw') from unnest(array['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05']) d;
select pg_temp.defn('ox' || lpad(g::text, 2, '0'), 1, 'distinct_locations', 1, 'calendar_month', date '2019-01-01') from generate_series(1, 10) g;

-- A. overflow episode 1: 510 old dirty windows -> capped at 500 + overflow; drain the dirty part
select rewards.ach_enqueue(:'u'::uuid, (select array_agg('ox' || lpad(k::text, 2, '0') || '|' || to_char(date '2019-01-01' + (m || ' months')::interval, 'YYYY-MM')) from generate_series(1, 10) k, generate_series(0, 50) m), 'ep1', null, 0);
select pg_temp.ok((select overflow and cardinality(dirty_scope) = 500 and rescan_cursor is null from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'episode 1: 510 dirty windows capped at 500, overflow set, no cursor yet');
select rewards.ach_process_queue(:'u'::uuid) from generate_series(1, 10);
select pg_temp.ok((select cardinality(dirty_scope) = 0 and overflow and rescan_cursor is null from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'the dirty part drained; the overflow flag keeps the row (a re-scan is still owed)');
-- B. a PARTIAL re-scan: 60 real candidate windows, one page of 50
select rewards.ach_process_queue(:'u'::uuid);
select pg_temp.ok((select overflow and rescan_cursor = 'ox10|2026-07' from rewards.achievement_eval_queue where user_id = :'u'::uuid) and (select count(*) from rewards.achievement_chains where user_id = :'u'::uuid) = 50,
                  'one re-scan page evaluated 50 windows (2026-03 to 2026-07) and left the cursor at ox10|2026-07');
-- C. a late award BEHIND the cursor: its hook fails recoverably, so its 10 chains are queued dirty
select set_config('p3test.code', 'OSA01', false);
select pg_temp.dv(:'u', :'la', '2025-11-20', 'rw');
select set_config('p3test.code', '', false);
select pg_temp.ok((select dirty_scope @> array['ox01|2025-11', 'ox10|2025-11'] and rescan_cursor = 'ox10|2026-07' from rewards.achievement_eval_queue where user_id = :'u'::uuid) and pg_temp.last_ev(:'u', 'ox01', '2025-11') = 'none',
                  'the late 2025-11 award is committed, its chains are queued dirty, nothing is evaluated yet, and the cursor still sits past 2026-07');
-- D. overflow episode 2: 600 more valid dirty entries; the union (610) is capped at 500 and the dropped 110 INCLUDE the 2025-11 entries
select rewards.ach_enqueue(:'u'::uuid, (select array_agg('ox' || lpad(k::text, 2, '0') || '|' || to_char(date '2019-01-01' + (m || ' months')::interval, 'YYYY-MM')) from generate_series(1, 10) k, generate_series(0, 59) m), 'ep2', null, 0);
select pg_temp.ok((select cardinality(dirty_scope) = 500 and not (dirty_scope @> array['ox01|2025-11']) from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'episode 2: the cap kept 500 and DROPPED the 2025-11 entries (they sort after the older windows)');
select pg_temp.ok((select rescan_cursor is null and overflow from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'the new truncation REWOUND the re-scan cursor (a stale cursor would hide the dropped windows)');
-- E. drain in bounded steps: every required transition happens, the row is deleted only after the full pass
create temp table _n (i integer);
do $$
declare i integer := 0; uid uuid := pg_temp.f('u');
begin
  while exists (select 1 from rewards.achievement_eval_queue where user_id = uid) and i < 80 loop
    i := i + 1;
    perform rewards.ach_process_queue(uid);
  end loop;
  insert into _n values (i);
end $$;
select i as nstep from _n \gset
select pg_temp.ok(:'nstep'::int >= 12 and :'nstep'::int < 80, 'drained in ' || :'nstep' || ' bounded steps (10 dirty + the full re-scan pages), then the row was deleted');
select pg_temp.ok((select count(*) from rewards.achievement_chains c join rewards.achievement_events e using (chain_id) where c.user_id = :'u'::uuid and c.period_key = '2025-11' and e.event = 'award') = 10,
                  'all ten 2025-11 chains (the entries the cap dropped) were awarded by the rewound re-scan');
select pg_temp.ok((select count(*) from rewards.achievement_chains where user_id = :'u'::uuid and period_key in ('2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08')) = 60
              and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'every 2026 chain exists as well and no queue row remains');
select pg_temp.finish();
