-- F1 corrections (Work 6c918a2): exact-retry fingerprint keeps field positions; duplicate-candidate work is bounded; the approver can read the exact text
-- before approving; a later link revokes publication eligibility.
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.mkuser(2) as u2 \gset
select pg_temp.mkuser(3) as u3 \gset
select pg_temp.mkadmin(8) as ad \gset
select pg_temp.mkadmin(7) as ad2 \gset
select pg_temp.mkadmin(6) as ad3 \gset
select pg_temp.mkadmin(5) as ad4 \gset

-- ===== 4. retry fingerprint: the same text moved between optional fields is DIFFERENT content
create function pg_temp.sub12(u uuid, k text, ex text, ac text, st text, fr text default null, im text default null, ver text default null, pf text default null) returns text language plpgsql as $$
begin
  return pg_temp.as_role('authenticated', u, 'aal1', format('select public.submit_feedback(%L, ''bug'', ''map'', ''Fingerprint title'', ''Fingerprint description text'', %L, %L, %L, %L, %L, %L, %L)::text', k, ex, ac, st, fr, im, ver, pf));
end $$;
select pg_temp.sub12(:'u1'::uuid, pg_temp.key(1), 'The map stays here', null, null) as _ \gset
select count(*) as n0 from feedback.items \gset
select pg_temp.ok((pg_temp.sub12(:'u1'::uuid, pg_temp.key(1), 'The map stays here', null, null)::jsonb ->> 'replayed') = 'true', 'an exact retry (same key, same fields) is a replay');
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(1), null, ''The map stays here'', null)', '22023', 'expected moved to actual under the same key is refused');
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(1), null, null, ''The map stays here'')', '22023', 'expected moved to steps under the same key is refused');
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(1), null, null, null)', '22023', 'expected removed under the same key is refused');
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(1), ''The map stays here'', ''More text here'', null)', '22023', 'an added actual under the same key is refused');
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(1), ''The map stays here'', null, null, ''often'')', '22023', 'an added frequency under the same key is refused');
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(1), ''The map stays here'', null, null, null, ''minor'')', '22023', 'an added impact under the same key is refused');
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(1), ''The map stays here'', null, null, null, null, ''1.2'')', '22023', 'an added app version under the same key is refused');
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(1), ''The map stays here'', null, null, null, null, null, ''web'')', '22023', 'an added platform under the same key is refused');
select pg_temp.ok((pg_temp.sub12(:'u1'::uuid, pg_temp.key(1), '  The map stays here  ', '   ', '')::jsonb ->> 'replayed') = 'true', 'blank and padded optional fields normalize like absent ones (client/server aligned): still a replay');
select pg_temp.ok((select count(*) from feedback.items) = :n0, 'none of the refused retries stored anything');
-- values that differ only by which field holds them, across two optional text fields, with both sides set
select pg_temp.sub12(:'u1'::uuid, pg_temp.key(2), 'alpha text here', 'beta text here', null) as _ \gset
select pg_temp.fails('select pg_temp.sub12(' || quote_literal(:'u1') || '::uuid, pg_temp.key(2), ''beta text here'', ''alpha text here'', null)', '22023', 'swapping expected and actual under the same key is refused');

-- ===== 5. bounded duplicate-candidate search
insert into feedback.items (user_id, idempotency_key, content_hash, kind, screen, title, description, tokens, created_at)
select :'u2'::uuid, 'bulk-' || lpad(g::text, 20, '0'), 'h' || g, 'bug', case when g % 2 = 0 then 'map' else 'list' end,
       'Filler problem number ' || g, 'Synthetic bulk row for the scan budget test.', feedback.tokens('Filler problem number ' || g), now() - (g || ' seconds')::interval
  from generate_series(1, 3000) g;
-- the target and one near-twin, both recent; one twin far in the past (outside the 200-row window)
select pg_temp.submit(:'u1'::uuid, pg_temp.key(20), 'Pin jumps when zooming', 'The pin jumps when zooming here on the map screen.', 'bug', 'map') ->> 'id' as t \gset
select pg_temp.submit(:'u1'::uuid, pg_temp.key(21), 'Zooming makes pin jumps', 'Another report that the pin jumps when zooming the map.', 'bug', 'map') ->> 'id' as twin \gset
insert into feedback.items (user_id, idempotency_key, content_hash, kind, screen, title, description, tokens, created_at)
  values (:'u2'::uuid, 'old-twin-' || lpad('1', 20, '0'), 'hold', 'bug', 'map', 'Old pin jumps when zooming', 'Ancient twin outside the pool window.', feedback.tokens('Old pin jumps when zooming'), now() - interval '90 days');
analyze feedback.items;
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_candidates(%L, 10)::text', :'t'))::jsonb as cc \gset
select pg_temp.ok((:'cc'::jsonb ->> 'searched')::int = 200, 'candidate search compares at most 200 items however many exist (searched = 200 of 1500+ on the screen)');
select pg_temp.ok((:'cc'::jsonb ->> 'complete') = 'false', 'a busy screen reports the search as incomplete (truthful)');
select pg_temp.ok((select count(*) from jsonb_array_elements(:'cc'::jsonb -> 'candidates') e where e ->> 'id' = :'twin') = 1, 'the recent near-twin is found inside the window');
select pg_temp.ok(not exists (select 1 from jsonb_array_elements(:'cc'::jsonb -> 'candidates') e where e ->> 'title' like 'Old pin%'), 'the twin outside the window is NOT claimed (the limit is documented, not hidden)');
-- the pool query's executed work, measured: rows read from the table including rows removed by the filter (not just rows returned)
create function pg_temp.pool_work(scr text) returns integer language plpgsql as $$
declare pj jsonb;
begin
  execute format('explain (analyze, format json) select i.id from feedback.items i where i.screen = %L and i.id <> gen_random_uuid() order by i.screen, i.created_at desc, i.id desc limit 200', scr) into pj;
  return (select coalesce(sum((m[1])::int), 0) from regexp_matches(pj::text, '"(?:Actual Rows|Rows Removed by Filter)": ([0-9]+)', 'g') m) - 200;
end $$;
select pg_temp.ok(exists (select 1 from pg_indexes where schemaname = 'feedback' and indexname = 'feedback_items_screen_idx'), 'the (screen, created_at desc, id desc) index exists');
select pg_temp.ok(pg_temp.pool_work('map') <= 400, 'a common screen (half of 3000 rows): the pool reads at most about 2x the pool size, never the table');
-- a RARE screen among many other rows, with fresh statistics and then with deliberately STALE statistics (rows added after the last analyze)
insert into feedback.items (user_id, idempotency_key, content_hash, kind, screen, title, description, tokens, created_at)
select :'u2'::uuid, 'rare-' || lpad(g::text, 20, '0'), 'r' || g, 'bug', 'report', 'Rare screen row ' || g, 'Synthetic row for the rare screen budget test.', feedback.tokens('Rare screen row ' || g), now() - interval '200 days' - (g || ' seconds')::interval
  from generate_series(1, 5) g;
analyze feedback.items;
select pg_temp.ok(pg_temp.pool_work('report') <= 400, 'a rare screen with fresh statistics: the pool reads at most a few hundred rows');
insert into feedback.items (user_id, idempotency_key, content_hash, kind, screen, title, description, tokens, created_at)
select :'u2'::uuid, 'stale-' || lpad(g::text, 20, '0'), 's' || g, 'bug', 'nearby', 'Stale stats row ' || g, 'Synthetic row added after the last analyze.', feedback.tokens('Stale stats row ' || g), now() - (g || ' seconds')::interval
  from generate_series(1, 20000) g;
select pg_temp.ok(pg_temp.pool_work('report') <= 400, 'a rare screen with STALE statistics (20000 unseen rows added): the pool still reads at most a few hundred rows');

-- ===== 2. the approver reads the exact private text before approving
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_create_issue(%L, ''Pin jumps when zooming'', ''The map pin moves unexpectedly while zooming the map.'')::text', :'t'))::jsonb ->> 'issue_id' as iss \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_draft_save(%L, ''Pin jumps when zooming'', ''bug'', ''The pin jumps when zooming on the map screen'', ''Open the map and zoom in'', null, ''web'', ''1.2'', ''The pin stays put'')::text', :'iss'))::jsonb as ds \gset
select pg_temp.adm(:'ad2'::uuid, format('select public.admin_feedback_issue_get(%L)::text', :'iss'))::jsonb as ig \gset
select pg_temp.ok((:'ig'::jsonb #>> '{latest_draft,title}') = :'ds'::jsonb ->> 'title' and (:'ig'::jsonb #>> '{latest_draft,body}') = :'ds'::jsonb ->> 'body', 'before approval the reviewer reads the exact latest title and body');
select pg_temp.ok((:'ig'::jsonb #>> '{latest_draft,approved}') = 'false' and (:'ig'::jsonb #>> '{latest_draft,hash}') = :'ds'::jsonb ->> 'hash', 'the hash shown is the hash of the text shown, and it is not approved yet');
select pg_temp.ok(not (:'ig'::text ~* 'user_id|fb[0-9]+@|raw description|here on the map screen'), 'the private review read carries no submitter identity and none of the raw submission text');
select pg_temp.fails_as('anon', null, null, format('select public.admin_feedback_issue_get(%L)', :'iss'), '42501', 'anonymous cannot read the draft');
select pg_temp.fails_as('authenticated', :'u1'::uuid, 'aal2', format('select public.admin_feedback_issue_get(%L)', :'iss'), '42501', 'a non-administrator cannot read the draft');
select pg_temp.fails_as('authenticated', :'ad2'::uuid, 'aal1', format('select public.admin_feedback_issue_get(%L)', :'iss'), '42501', 'an administrator without a verified second factor cannot read the draft');

-- ===== 3. a later link revokes eligibility (sequential)
select pg_temp.adm(:'ad2'::uuid, format('select public.admin_feedback_draft_approve(%L, 1, %L)::text', :'iss', :'ds'::jsonb ->> 'hash')) as _ \gset
select pg_temp.ok((pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_export_preview(%L)::text', :'iss'))::jsonb ->> 'title') = 'Pin jumps when zooming', 'an approved, unchanged publication exports its preview');
-- the approver's own feedback is linked afterwards by a third administrator
select pg_temp.submit(:'ad2'::uuid, pg_temp.key(30), 'Pin jumps while zooming now', 'The approving administrator also saw the pin jump while zooming.', 'bug', 'map') ->> 'id' as own \gset
select pg_temp.adm(:'ad3'::uuid, format('select public.admin_feedback_link_duplicate(%L, %L)::text', :'own', :'iss')) as _ \gset
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_export_preview(%L)', :'iss'), '55000', 'after linking the approver''s own feedback the old approval no longer exports');
select pg_temp.fails_as('authenticated', :'ad2'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 1, %L)', :'iss', :'ds'::jsonb ->> 'hash'), '55000,42501', 'the version cannot simply be approved again');
-- immutable history: the old approval row is untouched; a NEW version needs a NEW independent approval
select pg_temp.ok((select approved_by from feedback.drafts where issue_id = :'iss'::uuid and version = 1) = :'ad2'::uuid, 'the earlier approval stays in history unchanged');
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_draft_save(%L, ''Pin jumps when zooming'', ''bug'', ''The pin jumps when zooming on the map screen'', ''Open the map and zoom in'', null, ''web'', ''1.2'', ''The pin stays put'')::text', :'iss'))::jsonb as ds2 \gset
select pg_temp.fails_as('authenticated', :'ad2'::uuid, 'aal2', format('select public.admin_feedback_draft_approve(%L, 2, %L)', :'iss', :'ds2'::jsonb ->> 'hash'), '42501', 'the approver whose own feedback is linked cannot approve the new version');
select pg_temp.adm(:'ad4'::uuid, format('select public.admin_feedback_draft_approve(%L, 2, %L)::text', :'iss', :'ds2'::jsonb ->> 'hash')) as _ \gset
select pg_temp.ok((pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_export_preview(%L)::text', :'iss'))::jsonb ->> 'version') = '2', 'an independent approval of the new version exports it');
-- linking ANY item afterwards revokes again (the published set changed after approval)
select pg_temp.submit(:'u3'::uuid, pg_temp.key(31), 'Pin jumps zooming once more', 'Another user reports that the pin jumps while zooming.', 'bug', 'map') ->> 'id' as more \gset
select pg_temp.adm(:'ad3'::uuid, format('select public.admin_feedback_link_duplicate(%L, %L)::text', :'more', :'iss')) as _ \gset
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_export_preview(%L)', :'iss'), '55000', 'linking any item after approval revokes eligibility until a fresh approval');
select pg_temp.finish();
