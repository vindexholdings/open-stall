-- F1: duplicate CANDIDATE hints and manual canonical linking. The original is never overwritten; one canonical link per item; no cross-user leak.
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.mkuser(2) as u2 \gset
select pg_temp.mkuser(3) as u3 \gset
select pg_temp.mkadmin(8) as ad \gset
select pg_temp.mkadmin(7) as ad2 \gset
select pg_temp.submit(:'u1'::uuid, pg_temp.key(1), 'Map pin jumps when zooming in', 'The pin jumps away when I zoom in on the map screen.') ->> 'id' as a \gset
select pg_temp.submit(:'u2'::uuid, pg_temp.key(2), 'Pin jumps on map zooming', 'When zooming the map the pin jumps around by itself every time.') ->> 'id' as b \gset
select pg_temp.submit(:'u3'::uuid, pg_temp.key(3), 'Settings page lacks a back button', 'There is no way back from the settings page here.', 'usability', 'settings') ->> 'id' as c \gset
select pg_temp.submit(:'u3'::uuid, pg_temp.key(4), 'Map pin jumps when zooming in', 'Same words but another screen: the list view pin is wrong.', 'bug', 'list') ->> 'id' as d \gset

-- candidates: same screen and two shared normalized title tokens; never across screens; never an automatic merge
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_candidates(%L)::text', :'a'))::jsonb as ca \gset
select pg_temp.ok(jsonb_array_length(:'ca'::jsonb -> 'candidates') = 1 and (:'ca'::jsonb -> 'candidates' -> 0 ->> 'id') = :'b', 'the similar item on the same screen is a candidate');
select pg_temp.ok(not (:'ca'::text ~* 'user_id|email') and (select array_agg(k order by k) from jsonb_object_keys(:'ca'::jsonb -> 'candidates' -> 0) k) = array['id', 'issue_id', 'kind', 'status', 'title'], 'a candidate carries no submitter identity');
select pg_temp.ok((select status from feedback.items where id = :'b'::uuid) = 'received' and not exists (select 1 from feedback.item_links), 'nothing was linked or merged automatically');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_candidates(%L, 11)', :'a'), '22023', 'the candidate page size is bounded');

-- create the canonical issue from A (sanitized words by the reviewer), then link B
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_create_issue(%L, ''Pin at person@example.org'', ''The pin jumps away when zooming'')', :'a'), '22023', 'an issue title with an e-mail address is refused (fail closed)');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_create_issue(%L, ''Pin'', ''The pin jumps away when zooming'')', :'a'), '22023', 'a too-short issue title is refused');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_create_issue(%L, ''Pin jumps on zoom'', ''See <b>here</b> for the pin problem'')', :'a'), '22023', 'markup in the issue summary is refused');
select pg_temp.ok(not exists (select 1 from feedback.issues), 'the refused issues stored nothing');
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_create_issue(%L, ''Map pin jumps when zooming'', ''The map pin moves unexpectedly while the map is zoomed.'')::text', :'a'))::jsonb ->> 'issue_id' as iss \gset
select pg_temp.ok((select role = 'origin' from feedback.item_links where item_id = :'a'::uuid), 'the founding item is the origin of the issue');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_create_issue(%L, ''Another issue for it'', ''A second issue for the same item'')', :'a'), '23505', 'an item already linked cannot found another issue');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_link_duplicate(%L, %L)', :'a', :'iss'), '23505', 'the origin cannot also be linked as a duplicate');
select pg_temp.adm(:'ad2'::uuid, format('select public.admin_feedback_link_duplicate(%L, %L, ''same pin problem'')::text', :'b', :'iss'));
select pg_temp.ok((select status = 'duplicate' from feedback.items where id = :'b'::uuid) and (select role = 'duplicate' and linked_by = :'ad2'::uuid from feedback.item_links where item_id = :'b'::uuid), 'the duplicate is linked with provenance and its status is duplicate');
select pg_temp.ok((select title = 'Pin jumps on map zooming' and description like 'When zooming the map%' from feedback.items where id = :'b'::uuid)
              and (select title = 'Map pin jumps when zooming in' and status = 'received' from feedback.items where id = :'a'::uuid), 'both ORIGINAL reports are untouched (only B''s status changed)');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_link_duplicate(%L, %L)', :'b', :'iss'), '23505', 'an item can be linked once only');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_link_duplicate(%L, %L)', :'c', gen_random_uuid()), 'P0002', 'linking to a missing issue is refused');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_link_duplicate(%L, %L, ''a note with person@example.org'')', :'c', :'iss'), '22023', 'a link note with an e-mail address is refused');
select pg_temp.ok((select status = 'received' from feedback.items where id = :'c'::uuid) and not exists (select 1 from feedback.item_links where item_id = :'c'::uuid), 'the refused link changed nothing');
-- a duplicate is shown to its candidates list with its issue, an unrelated screen is not
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_candidates(%L)::text', :'a'))::jsonb as cb \gset
select pg_temp.ok((:'cb'::jsonb -> 'candidates' -> 0 ->> 'issue_id') = :'iss', 'candidates show the existing issue of a linked item');
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_issue_get(%L)::text', :'iss'))::jsonb as ig \gset
select pg_temp.ok((:'ig'::jsonb ->> 'items') = '2' and not (:'ig'::text ~* 'user_id|email|fb[0-9]@'), 'the issue lists how many items it covers, with no identities');
-- issues are immutable and carry no submitter or raw text
select pg_temp.fails('update feedback.issues set title = ''Changed canonical title''', '42501', 'an issue cannot be edited');
select pg_temp.fails('delete from feedback.issues', '42501', 'an issue cannot be deleted');
select pg_temp.ok((select count(*) = 0 from information_schema.columns where table_schema = 'feedback' and table_name = 'issues' and column_name in ('user_id', 'email', 'description', 'steps')), 'the issues table has no submitter or raw-text column');
-- the other users' content never reaches a submitter through the linking
select pg_temp.as_role('authenticated', :'u1'::uuid, 'aal1', 'select public.list_my_feedback()::text')::jsonb as l1 \gset
select pg_temp.ok(not (:'l1'::text ~* 'Pin jumps on map zooming|every time'), 'user one sees nothing of user two''s duplicate');
select pg_temp.finish();
