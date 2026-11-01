-- P3 bounded work: queue scope UNION/cap/overflow, 50-chain evaluation and repair pages, retained backlog, the bounded full re-scan, and the
-- paged, caller-scoped progress read. Maximums released by Work: 20 users/repair, 50 chains/user/evaluation, 500 dirty chains, 50/page.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(8001) as a1 \gset
select pg_temp.mkloc(51.01) as la \gset
select pg_temp.mkuser(8101) as u \gset
select pg_temp.mkuser(8102) as uo \gset
-- visits FIRST (no catalog yet, so the hooks do nothing): six months of history for u, one visit for another account
select pg_temp.dv(:'u', :'la', d, 'bk') from unnest(array['2026-03-05', '2026-04-05', '2026-05-05', '2026-06-05', '2026-07-05', '2026-08-05']) d;
select pg_temp.dv(:'uo', :'la', '2026-08-05', 'bk');
select pg_temp.defn('bk' || lpad(g::text, 2, '0'), 1, 'qualifying_awards', 1, 'calendar_month', date '2019-01-01') from generate_series(1, 10) g;
select pg_temp.ok((select count(*) from rewards.achievement_definitions) = 10 and (select count(*) from rewards.achievement_events) = 0, 'setup: ten monthly keys defined after the visits; no event yet');

-- ============================================================ evaluation is bounded at 50 chains per call, oldest window first
select (select array_agg('bk' || lpad(k::text, 2, '0') || '|' || to_char(date '2021-01-01' + (m || ' months')::interval, 'YYYY-MM') order by m, k)
          from generate_series(1, 10) k, generate_series(0, 11) m) as scope120 \gset
select rewards.evaluate_achievements(:'u', :'scope120'::text[], null) as ev \gset
select pg_temp.ok((:'ev'::jsonb ->> 'processed')::int = 50 and jsonb_array_length(:'ev'::jsonb -> 'remaining') = 70, 'one evaluation call processes at most 50 chains and returns the other 70 as remaining (oldest windows first)');
select pg_temp.ok((:'ev'::jsonb -> 'remaining') = to_jsonb((:'scope120'::text[])[51:120]) and (select count(*) from rewards.achievement_chains where user_id = :'u'::uuid) = 0,
                  'the remaining 70 are EXACTLY entries 51 to 120 of the sorted scope, in order (nothing lost, nothing reordered, nothing evaluated early)');

-- ============================================================ queue: scope is UNIONED, deduplicated and capped at 500 with an overflow flag
select rewards.ach_enqueue(:'u', array['bk01|2020-01', 'bk02|2020-01'], 'test', null, 1);
select rewards.ach_enqueue(:'u', array['bk02|2020-01', 'bk03|2020-01'], 'test', 'OSA01', 1);
select pg_temp.ok((select dirty_scope = array['bk01|2020-01', 'bk02|2020-01', 'bk03|2020-01'] and attempts = 2 and last_sqlstate = 'OSA01' and not overflow from rewards.achievement_eval_queue where user_id = :'u'::uuid),
                  'two enqueues UNION (duplicate collapsed, nothing overwritten), attempts add up, SQLSTATE kept');
select (select array_agg('bk' || lpad(k::text, 2, '0') || '|' || to_char(date '2021-01-01' + (m || ' months')::interval, 'YYYY-MM') order by m, k)
          from generate_series(1, 10) k, generate_series(0, 59) m) as scope600 \gset
select rewards.ach_enqueue(:'u', :'scope600'::text[], 'big', null, 1);
select pg_temp.ok((select cardinality(dirty_scope) = 500 and overflow from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'more than 500 dirty chains: capped at 500 and the OVERFLOW flag is set (a bounded full re-scan follows)');
select pg_temp.ok((select dirty_scope[1] = 'bk01|2020-01' from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'the oldest windows were kept (the earlier entries were not overwritten)');
select pg_temp.fails_as('reward_writer_owner', null, null, $$update rewards.achievement_eval_queue set dirty_scope = array(select 'k|' || g from generate_series(1, 501) g)$$, '23514', 'the database itself refuses a scope above 500');

-- ============================================================ repair pages through the backlog, retaining unfinished work
select attempts as att0, first_failed_at as ff0 from rewards.achievement_eval_queue where user_id = :'u'::uuid \gset
select rewards.ach_process_queue(:'u');
select pg_temp.ok((select cardinality(dirty_scope) = 450 and attempts = :'att0'::int + 1 and first_failed_at = :'ff0'::timestamptz and last_attempt_at is not null from rewards.achievement_eval_queue where user_id = :'u'::uuid),
                  'one step processes 50 and RETAINS the remaining 450 (row kept, attempts + 1, first_failed_at preserved)');
select rewards.ach_process_queue(:'u') from generate_series(1, 9);
select pg_temp.ok((select cardinality(dirty_scope) = 0 and overflow from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'after ten steps the dirty scope is empty, but the overflow flag KEEPS the row (work is not complete)');
select pg_temp.ok((select count(*) from rewards.achievement_events) = 0, 'processing windows with no qualifying awards appended nothing and created no chain');
-- the bounded full re-scan: six months x ten keys = 60 candidates = two pages (50 then 10)
select pg_temp.ok((select count(*) from rewards.ach_candidate_chains(:'u')) = 60, 'the re-scan candidate set is exactly the real windows: six months x ten keys');
select rewards.ach_process_queue(:'u');
select pg_temp.ok((select overflow and rescan_cursor is not null from rewards.achievement_eval_queue where user_id = :'u'::uuid) and (select count(*) from rewards.achievement_chains where user_id = :'u'::uuid) = 50,
                  'first re-scan page: 50 chains evaluated, cursor saved, row retained');
select rewards.ach_process_queue(:'u');
select pg_temp.ok(not exists (select 1 from rewards.achievement_eval_queue where user_id = :'u'::uuid) and (select count(*) from rewards.achievement_chains where user_id = :'u'::uuid) = 60,
                  'second page finishes the re-scan: 60 chains, the queue row is deleted only now');
select pg_temp.ok(not exists (select 1 from rewards.achievement_chains where user_id = :'uo'::uuid), 'another account was never touched');

-- ============================================================ progress: caller-scoped, paged, validated
select pg_temp.as_role('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress(null, 50)::text$$)::jsonb as p1 \gset
select pg_temp.ok((:'p1'::jsonb ->> 'state') = 'ready' and jsonb_array_length(:'p1'::jsonb -> 'items') = 50 and (:'p1'::jsonb ->> 'next_cursor') is not null, 'a page of at most 50 chains with a cursor for the rest');
select (:'p1'::jsonb ->> 'next_cursor') as cur \gset
select pg_temp.as_role('authenticated', :'u'::uuid, 'aal1', format($$select public.get_my_progress(%L, 50)::text$$, :'cur'))::jsonb as p2 \gset
select pg_temp.ok(jsonb_array_length(:'p2'::jsonb -> 'items') = 20 and (:'p2'::jsonb ->> 'next_cursor') is null, 'the second page holds the remaining 20 (70 entries = 60 earned chains + the ten current-window entries) and ends the cursor');
select pg_temp.ok((select count(*) = count(distinct (i ->> 'achievement') || '|' || (i ->> 'period')) from (select jsonb_array_elements(:'p1'::jsonb -> 'items') i union all select jsonb_array_elements(:'p2'::jsonb -> 'items')) s),
                  'no entry appears on two pages');
select pg_temp.ok((select count(*) from jsonb_array_elements(:'p1'::jsonb -> 'items') i where (i ->> 'period') like '2026-0%' and (i ->> 'state') = 'earned') >= 40, 'earned chains from the real history are listed with state earned');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(:'p1'::jsonb -> 'items') i where i::text like '%chain_id%' or i::text like '%user%' or i::text like '%decision%'), 'the progress payload exposes no chain, user or decision identifier');
select pg_temp.fails_as('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress('DROP TABLE x', 20)::text$$, '22023', 'a malformed cursor is rejected');
select pg_temp.fails_as('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress('', 20)::text$$, '22023', 'an empty cursor is rejected');
select pg_temp.fails_as('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress('BK01|2026-08', 20)::text$$, '22023', 'a forged upper-case cursor is rejected');
select pg_temp.fails_as('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress(null, 0)::text$$, '22023', 'page size 0 is rejected');
select pg_temp.fails_as('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress(null, 51)::text$$, '22023', 'page size 51 is rejected');
select pg_temp.fails_as('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress(null, null)::text$$, '22023', 'a NULL page size is rejected');
select pg_temp.fails_as('authenticated', null, null, $$select public.get_my_progress()::text$$, '28000', 'a signed-out caller gets 28000');
select pg_temp.fails_as('anon', null, null, $$select public.get_my_progress()::text$$, '42501', 'anon has no EXECUTE');
select pg_temp.fails_as('service_role', :'u'::uuid, 'aal1', $$select public.get_my_progress()::text$$, '42501', 'service_role has no EXECUTE');
select pg_temp.ok(not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'get_my_progress' and exists (select 1 from unnest(p.proargnames) n where n ~* 'user|subject|account')),
                  'get_my_progress has no user or subject parameter: identity comes from auth.uid() only');
-- a forged cursor can only position inside the CALLER's own list: the other account's single chain never appears
select pg_temp.as_role('authenticated', :'uo'::uuid, 'aal1', $$select public.get_my_progress('bk01|2026-08', 50)::text$$)::jsonb as po \gset
select pg_temp.ok(jsonb_array_length(:'po'::jsonb -> 'items') >= 1 and not exists (select 1 from jsonb_array_elements(:'po'::jsonb -> 'items') i where (i ->> 'period') in ('2026-03', '2026-04', '2026-05', '2026-06', '2026-07')),
                  'another account sees only its own chains whatever cursor it sends');

-- ============================================================ disabled / unset gates expose no live numbers
select pg_temp.set_settings(false, 1000000);
select pg_temp.ok((pg_temp.as_role('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress()::text$$)::jsonb) = '{"state": "disabled", "items": [], "next_cursor": null}'::jsonb, 'rewards disabled: state disabled, no items, no numbers');
select pg_temp.set_settings(true, null);
select pg_temp.ok((pg_temp.as_role('authenticated', :'u'::uuid, 'aal1', $$select public.get_my_progress()::text$$)::jsonb) = '{"state": "disabled", "items": [], "next_cursor": null}'::jsonb, 'budget unset: state disabled, no items, no numbers');
select pg_temp.set_settings(true, 1000000);
select pg_temp.finish();
