-- P3 (Work's 26e0bd0): USER-ONLY liveness. After read-repair computed a window and cleared its scope, the display must not scan the SAME window again and
-- re-queue it: repeated authenticated public.get_my_progress calls alone (no new visit, NO administrator repair) must empty the queue and show exact values.
-- Mechanism under test: an exact result that fit the budget is saved as a finished calculation state (valid until a real award/clearance/reversal or purge),
-- so the next read of the window is free in repair AND in display. Whole-RPC work is measured by PostgreSQL's own counters. Account: 4,900 raw awards
-- (5 locations x 980 days), several windows: the lifetime window consumes almost the whole 5,000 budget, a fixed season window (500 rows) stays pending.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkloc(57 + g / 100.0) from generate_series(1, 5) g;
select pg_temp.defn('lt1', 1, 'lifetime_points_total', 100, 'none', date '2019-01-01');
select pg_temp.defn('lt2', 1, 'lifetime_points_total', 1000000, 'none', date '2019-01-01');
select pg_temp.defn('sea', 1, 'qualifying_awards', 10, 'fixed', date '2019-01-01', date '2024-01-01', date '2024-04-09');
select pg_temp.mkuser(15101) as ua \gset
select pg_temp.seed_awards(:'ua'::uuid, 5, 980, date '2024-01-01');
select rewards.ach_enqueue(:'ua'::uuid, array['lt1|lifetime', 'lt2|lifetime', 'sea|2024-01-01'], 'seed', null, 0);
-- the exact references
create temp table _ref as
  select coalesce(sum(amount), 0)::int as pts, count(*)::int as aw from rewards.reward_ledger where user_id = :'ua'::uuid and entry_type = 'award' and kind = 'lifetime';
select pg_temp.ok((select pts = 24500 and aw = 4900 from _ref), 'setup: 4,900 raw standing awards, 24,500 points');
create temp table _calls (who text, n integer, reads bigint, q integer, unavail integer, items jsonb);

-- (a) repeated PUBLIC progress calls only (separate transactions): queue [lt1, lt2, ss] converges, each whole call bounded
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ua', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('a', 1, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ua', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('a', 2, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ua', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('a', 3, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ua', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('a', 4, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ua', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('a', 5, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ua', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('a', 6, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
select pg_temp.ok((select max(reads) <= (3 * 5001 + 600) from _calls where who = 'a'), 'every whole RPC read at most one logical request of work (max ' || (select max(reads) from _calls where who = 'a') || ' tuples+scans)');
select pg_temp.ok((select q = 0 and unavail = 0 from _calls where who = 'a' and n = 3), 'within 3 calls of public progress ONLY (no visit, no admin repair): the queue is empty and nothing is unavailable');
select pg_temp.ok((select q = 0 and unavail = 0 and items = (select items from _calls where who = 'a' and n = 3) from _calls where who = 'a' and n = 6), 'further reads stay stable: same exact items, queue stays empty (no re-queue loop on unchanged history)');
select pg_temp.ok((select (i ->> 'state') = 'earned' and (i ->> 'value')::int = (select pts from _ref) from _calls c, jsonb_array_elements(c.items) i where c.who = 'a' and c.n = 6 and i ->> 'achievement' = 'lt1'), 'lt1 shows earned with the EXACT value (24,500)');
select pg_temp.ok((select (i ->> 'state') = 'in_progress' and (i ->> 'value')::int = (select pts from _ref) from _calls c, jsonb_array_elements(c.items) i where c.who = 'a' and c.n = 6 and i ->> 'achievement' = 'lt2'), 'lt2 (never reachable) shows in_progress with the exact value');
select pg_temp.ok((select (i ->> 'state') = 'earned' and (i ->> 'value')::int = 500 from _calls c, jsonb_array_elements(c.items) i where c.who = 'a' and c.n = 6 and i ->> 'achievement' = 'sea'), 'the season window (pending, consumed after the lifetime window used most of the budget) shows earned with its exact value (500 awards)');
select pg_temp.ok(pg_temp.ev_count(:'ua'::uuid, 'lt1', 'lifetime') = 1 and pg_temp.ev_count(:'ua'::uuid, 'sea', '2024-01-01') = 1 and pg_temp.ev_count(:'ua'::uuid, 'lt2', 'lifetime') = 0, 'exactly one award event per eligible chain (no double award across the repeated reads), none for the unreachable one');
select pg_temp.ok((select count(*) from rewards.achievement_calc_state where user_id = :'ua'::uuid) <= 50 and not exists (select 1 from rewards.achievement_calc_state where user_id = :'ua'::uuid and pass <> 'done'), 'the saved state is finished rows only, at most 50 per account');

-- (b) display-first: NO queue, chains already awarded, no saved state. The display spends the lifetime window, the season window is left unaffordable and
-- queued; the second call completes it with the saved lifetime state read for free. The display's own saving matters here (two calls, not three).
select pg_temp.mkuser(15102) as uc \gset
select pg_temp.seed_awards(:'uc'::uuid, 5, 980, date '2024-01-01');
select (rewards.evaluate_achievements(:'uc'::uuid, array['sea|2024-01-01', 'lt1|lifetime', 'lt2|lifetime'], null)) ->> 'remaining' as rem1 \gset
select (rewards.evaluate_achievements(:'uc'::uuid, array['lt1|lifetime', 'lt2|lifetime'], null)) ->> 'remaining' as rem2 \gset
select rewards.ach_calc_invalidate(:'uc'::uuid);
select pg_temp.ok(pg_temp.ev_count(:'uc'::uuid, 'lt1', 'lifetime') = 1 and pg_temp.ev_count(:'uc'::uuid, 'sea', '2024-01-01') = 1 and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'uc'::uuid)
              and not exists (select 1 from rewards.achievement_calc_state where user_id = :'uc'::uuid), 'setup: awards exist, no queue row, no saved state');
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'uc', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('c', 1, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'uc'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'uc', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('c', 2, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'uc'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'uc', true);
select public.get_my_progress(null, 50) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('c', 3, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'uc'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
select pg_temp.ok((select max(reads) <= (3 * 5001 + 600) from _calls where who = 'c'), 'display-first requests are bounded too (max ' || (select max(reads) from _calls where who = 'c') || ')');
select pg_temp.ok((select q = 0 and unavail = 0 from _calls where who = 'c' and n = 2), 'display-first: converged in TWO calls with no admin repair (the display saves the window it computed)');
select pg_temp.ok((select q = 0 and unavail = 0 and items = (select items from _calls where who = 'c' and n = 2) from _calls where who = 'c' and n = 3), 'display-first: stable afterwards');

-- (c) PAGED reads, page size 1 (order: lt1, lt2, ss): rounds of three page calls converge with nothing lost or endlessly re-queued
select pg_temp.mkuser(15103) as ub \gset
select pg_temp.seed_awards(:'ub'::uuid, 5, 980, date '2024-01-01');
select rewards.ach_enqueue(:'ub'::uuid, array['lt1|lifetime', 'lt2|lifetime', 'sea|2024-01-01'], 'seed', null, 0);
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress(null, 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 1, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress('lt1|lifetime', 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 2, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress('lt2|lifetime', 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 3, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress(null, 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 4, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress('lt1|lifetime', 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 5, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress('lt2|lifetime', 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 6, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress(null, 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 7, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress('lt1|lifetime', 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 8, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress('lt2|lifetime', 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 9, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress(null, 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 10, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress('lt1|lifetime', 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 11, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
begin;
select pg_temp.ledger_reads() as r0 \gset
select set_config('request.jwt.claim.sub', :'ub', true);
select public.get_my_progress('lt2|lifetime', 1) as p \gset
select pg_temp.ledger_reads() as r1 \gset
insert into _calls values ('b', 12, :'r1'::bigint - :'r0'::bigint, (select count(*) from rewards.achievement_eval_queue where user_id = :'ub'::uuid),
  (select count(*) from jsonb_array_elements(:'p'::jsonb -> 'items') x where x ->> 'state' = 'unavailable'), :'p'::jsonb -> 'items');
commit;
select pg_temp.ok((select max(reads) <= (3 * 5001 + 600) from _calls where who = 'b'), 'every page call is bounded (max ' || (select max(reads) from _calls where who = 'b') || ')');
select pg_temp.ok((select q = 0 from _calls where who = 'b' and n = 12), 'paged: the queue is empty after at most four rounds of page reads (no admin repair)');
select pg_temp.ok((select count(*) = 3 and bool_and(i ->> 'state' <> 'unavailable') from _calls c, jsonb_array_elements(c.items) i where c.who = 'b' and c.n between 10 and 12 and i ->> 'achievement' in ('lt1', 'lt2', 'sea')), 'paged: the last round shows lt1, lt2 and ss, none unavailable');
select pg_temp.ok(pg_temp.ev_count(:'ub'::uuid, 'lt1', 'lifetime') = 1 and pg_temp.ev_count(:'ub'::uuid, 'sea', '2024-01-01') = 1, 'paged: exactly one award per eligible chain');
-- (d) a real later award invalidates the saved state: nothing stale is read afterwards
select pg_temp.ok((select count(*) from rewards.achievement_calc_state where user_id = :'ub'::uuid) >= 1, 'saved state exists before the change');
select rewards.ach_calc_invalidate(:'ub'::uuid);
select pg_temp.ok((select count(*) from rewards.achievement_calc_state where user_id = :'ub'::uuid) = 0, 'invalidation deletes every saved state of the account');
select pg_temp.finish();
