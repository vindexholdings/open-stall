-- F1: account deletion through the EXISTING path removes that account's raw feedback and linkage; reviewer work product survives with no identifier; no dangling link.
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as ua \gset
select pg_temp.mkuser(2) as ub \gset
select pg_temp.mkuser(3) as uc \gset
select pg_temp.mkadmin(8) as ad \gset
select pg_temp.submit(:'ua'::uuid, pg_temp.key(1), 'Map pin jumps when zooming', 'User A describes the pin jump when zooming the map.') ->> 'id' as a1 \gset
select pg_temp.submit(:'ua'::uuid, pg_temp.key(2), 'Settings back button missing', 'User A also says settings has no back button here.', 'usability', 'settings') ->> 'id' as a2 \gset
select pg_temp.submit(:'ub'::uuid, pg_temp.key(3), 'Pin jumps on map zooming', 'User B says the pin jumps around when zooming the map.') ->> 'id' as b1 \gset
select pg_temp.submit(:'uc'::uuid, pg_temp.key(4), 'Unrelated suggestion for favorites', 'User C suggests sorting favorites by distance here.', 'suggestion', 'favorites') ->> 'id' as c1 \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_set_status(%L, ''reviewing'', ''note on a2'')::text', :'a2'));
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_create_issue(%L, ''Map pin jumps when zooming'', ''The map pin moves while the map is zoomed.'')::text', :'a1'))::jsonb ->> 'issue_id' as iss \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_link_duplicate(%L, %L)::text', :'b1', :'iss'));
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_draft_save(%L, ''Map pin jumps when zooming'', ''bug'', ''The map pin moves while the map is zoomed in.'')::text', :'iss'));
select pg_temp.ok((select count(*) from feedback.items) = 4 and (select count(*) from feedback.item_links) = 2, 'setup: four items, two links');

-- delete account A through the real path (as the user, through the SECURITY DEFINER function)
select pg_temp.as_role('authenticated', :'ua'::uuid, 'aal1', 'select public.delete_my_account(''DELETE'')::text');
select pg_temp.ok(not exists (select 1 from auth.users where id = :'ua'::uuid), 'account A is gone');
select pg_temp.ok(not exists (select 1 from feedback.items where user_id = :'ua'::uuid) and not exists (select 1 from feedback.items where id in (:'a1'::uuid, :'a2'::uuid)), 'all of A''s raw feedback was removed');
select pg_temp.ok(not exists (select 1 from feedback.status_history where item_id in (:'a1'::uuid, :'a2'::uuid)), 'A''s status history was removed');
select pg_temp.ok(not exists (select 1 from feedback.item_links where item_id in (:'a1'::uuid, :'a2'::uuid)), 'A''s link rows were removed');
-- others are untouched, with no dangling references
select pg_temp.ok((select count(*) = 2 from feedback.items) and exists (select 1 from feedback.items where id = :'b1'::uuid and status = 'duplicate') and exists (select 1 from feedback.items where id = :'c1'::uuid), 'B''s and C''s feedback is untouched');
select pg_temp.ok(exists (select 1 from feedback.item_links where item_id = :'b1'::uuid and issue_id = :'iss'::uuid), 'B''s link to the canonical issue is intact');
select pg_temp.ok((select count(*) = 1 from feedback.issues where id = :'iss'::uuid) and (select count(*) = 1 from feedback.drafts where issue_id = :'iss'::uuid), 'the reviewers'' issue and draft survive');
select pg_temp.ok(not exists (select 1 from feedback.item_links l left join feedback.items i on i.id = l.item_id where i.id is null)
              and not exists (select 1 from feedback.items i left join auth.users u on u.id = i.user_id where u.id is null)
              and not exists (select 1 from feedback.status_history h left join feedback.items i on i.id = h.item_id where i.id is null), 'no dangling link, owner or history row remains');
select pg_temp.ok((select count(*) = 0 from feedback.issues where title ~* 'User A' or summary ~* 'User A') and not exists (select 1 from feedback.drafts where body ~* 'User A'), 'the surviving reviewer text carries no raw submitted wording');
-- B can still read their own status; nothing of A leaks to B
select pg_temp.as_role('authenticated', :'ub'::uuid, 'aal1', 'select public.list_my_feedback()::text')::jsonb as lb \gset
select pg_temp.ok(jsonb_array_length(:'lb'::jsonb -> 'items') = 1 and not (:'lb'::text ~* 'User A|Settings back'), 'B still reads only their own item after A''s deletion');
-- administrators cannot be deleted through this path (the existing rule is unchanged)
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', 'select public.delete_my_account(''DELETE'')', '42501', 'an administrator account cannot be deleted by this path (existing rule)');
-- a second user's deletion also works (cascade is not a one-off)
select pg_temp.as_role('authenticated', :'uc'::uuid, 'aal1', 'select public.delete_my_account(''DELETE'')::text');
select pg_temp.ok(not exists (select 1 from feedback.items where id = :'c1'::uuid) and (select count(*) = 1 from feedback.items), 'C''s deletion removed C''s feedback only');
select pg_temp.finish();
