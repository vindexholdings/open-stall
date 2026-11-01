-- F1: a submitter sees ONLY their own items, safe fields and a plain outcome; never notes, reviewers, issues or other people's content.
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.mkuser(2) as u2 \gset
select pg_temp.mkadmin(9) as ad \gset
select pg_temp.submit(:'u1'::uuid, pg_temp.key(1), 'First problem of user one', 'The first problem description of user one here.') ->> 'id' as i1 \gset
select pg_temp.submit(:'u2'::uuid, pg_temp.key(2), 'Secret title of user two', 'Private description of user two that user one must never see.') ->> 'id' as i2 \gset

-- own list and own read
select pg_temp.as_role('authenticated', :'u1'::uuid, 'aal1', 'select public.list_my_feedback()::text')::jsonb as l1 \gset
select pg_temp.ok(jsonb_array_length(:'l1'::jsonb -> 'items') = 1 and (:'l1'::jsonb -> 'items' -> 0 ->> 'id') = :'i1', 'a user lists only their own items');
select pg_temp.ok(not (:'l1'::text ~* 'Secret title|Private description|user two') and (:'l1'::jsonb -> 'items' -> 0 ->> 'outcome') = 'We received this.', 'no other person''s content appears, and the outcome sentence is shown');
select pg_temp.ok((select array_agg(k order by k) from jsonb_object_keys(:'l1'::jsonb -> 'items' -> 0) k) = array['created_at', 'id', 'kind', 'outcome', 'screen', 'status', 'title', 'updated_at'], 'the list exposes exactly the safe fields');
select pg_temp.as_role('authenticated', :'u1'::uuid, 'aal1', format('select public.get_my_feedback(%L)::text', :'i1'))::jsonb as g1 \gset
select pg_temp.ok(not (:'g1'::jsonb ? 'user_id') and not (:'g1'::text ~* 'actor|note|admin|issue|reviewer'), 'the own item view has no owner id, actor, note, admin or issue field');
-- another person's id and a missing id are indistinguishable
select pg_temp.fails_as('authenticated', :'u1'::uuid, 'aal1', format('select public.get_my_feedback(%L)', :'i2'), 'P0002', 'reading another person''s item: not found');
select pg_temp.fails_as('authenticated', :'u1'::uuid, 'aal1', format('select public.get_my_feedback(%L)', gen_random_uuid()), 'P0002', 'reading a missing id: the same not found');
select pg_temp.fails_as('authenticated', null, null, 'select public.list_my_feedback()', '28000', 'listing signed out: refused');
select pg_temp.fails_as('anon', null, null, 'select public.list_my_feedback()', '42501', 'anon cannot execute the list');
-- bounds and cursors
select pg_temp.fails_as('authenticated', :'u1'::uuid, 'aal1', 'select public.list_my_feedback(null, 0)', '22023', 'page size 0 is refused');
select pg_temp.fails_as('authenticated', :'u1'::uuid, 'aal1', 'select public.list_my_feedback(null, 21)', '22023', 'page size 21 is refused (bounded)');
select pg_temp.fails_as('authenticated', :'u1'::uuid, 'aal1', 'select public.list_my_feedback(''not a cursor'', 5)', '22023', 'a malformed cursor is refused');
select pg_temp.mkuser(3) as u3 \gset
do $$
declare i integer; u uuid := pg_temp.mkuser(3);
begin
  set local session_replication_role = replica;
  for i in 1..25 loop insert into feedback.items (user_id, idempotency_key, content_hash, kind, screen, title, description, created_at)
    values (u, 'page-seed-' || lpad(i::text, 8, '0') || '-pad', 'h' || i, 'bug', 'map', 'Paging seed ' || lpad(i::text, 2, '0'), 'Paging seed description ' || i, clock_timestamp() - make_interval(mins => 100 - i)); end loop;
  set local session_replication_role = origin;
end $$;
select pg_temp.as_role('authenticated', :'u3'::uuid, 'aal1', 'select public.list_my_feedback(null, 20)::text')::jsonb as p1 \gset
select pg_temp.ok(jsonb_array_length(:'p1'::jsonb -> 'items') = 20 and (:'p1'::jsonb ->> 'next_cursor') is not null and (:'p1'::jsonb -> 'items' -> 0 ->> 'title') = 'Paging seed 25', 'page one has 20 newest first and a cursor');
select pg_temp.as_role('authenticated', :'u3'::uuid, 'aal1', format('select public.list_my_feedback(%L, 20)::text', :'p1'::jsonb ->> 'next_cursor'))::jsonb as p2 \gset
select pg_temp.ok(jsonb_array_length(:'p2'::jsonb -> 'items') = 5 and (:'p2'::jsonb ->> 'next_cursor') is null and (:'p2'::jsonb -> 'items' -> 4 ->> 'title') = 'Paging seed 01', 'page two has the remaining 5 and no cursor');
select pg_temp.ok((select count(distinct v ->> 'id') = 25 from (select jsonb_array_elements(:'p1'::jsonb -> 'items') v union all select jsonb_array_elements(:'p2'::jsonb -> 'items')) s), 'the pages together cover all 25 items without overlap');

-- status changes are visible as a plain outcome, but the internal note, actor and issue stay private
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_set_status(%L, ''reviewing'', ''INTERNAL-NOTE-do-not-show'')::text', :'i1'));
select pg_temp.as_role('authenticated', :'u1'::uuid, 'aal1', format('select public.get_my_feedback(%L)::text', :'i1'))::jsonb as g2 \gset
select pg_temp.ok((:'g2'::jsonb ->> 'status') = 'reviewing' and (:'g2'::jsonb ->> 'outcome') = 'A person is looking at this.', 'the own view shows the new status and its plain sentence');
select pg_temp.ok(not (:'g2'::text ~ 'INTERNAL-NOTE') and (select array_agg(k order by k) from jsonb_object_keys(:'g2'::jsonb -> 'timeline' -> 0) k) = array['at', 'status'], 'the internal note and the actor never reach the submitter; the timeline has only status and time');
select pg_temp.as_role('authenticated', :'u1'::uuid, 'aal1', 'select public.list_my_feedback()::text')::jsonb as l2 \gset
select pg_temp.ok(not (:'l2'::text ~ 'INTERNAL-NOTE'), 'the list never carries the internal note');
-- a duplicate shows only a plain sentence: nothing about the canonical issue or the other reporters
select pg_temp.submit(:'u2'::uuid, pg_temp.key(3), 'First problem again from two', 'The same first problem described by user two again.') ->> 'id' as i3 \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_create_issue(%L, ''Canonical first problem'', ''The first problem seen by several people.'')::text', :'i1'))::jsonb ->> 'issue_id' as iss \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_link_duplicate(%L, %L, ''linked with INTERNAL-LINK-NOTE'')::text', :'i3', :'iss'));
select pg_temp.as_role('authenticated', :'u2'::uuid, 'aal1', format('select public.get_my_feedback(%L)::text', :'i3'))::jsonb as g3 \gset
select pg_temp.ok((:'g3'::jsonb ->> 'status') = 'duplicate' and (:'g3'::jsonb ->> 'outcome') = 'This was already reported and is being tracked.'
                  and not (:'g3'::text ~* 'Canonical|several people|INTERNAL-LINK-NOTE|first problem of user one') and not (:'g3'::text like '%' || :'iss' || '%'), 'a duplicate shows only the plain sentence: no canonical issue text or id, no other reporter content, no note');
-- no direct table access for any client role
select pg_temp.fails_as('authenticated', :'u1'::uuid, 'aal1', 'select * from feedback.items', '42501', 'authenticated cannot read the table directly');
select pg_temp.fails_as('anon', null, null, 'select * from feedback.items', '42501', 'anon cannot read the table directly');
select pg_temp.fails_as('service_role', null, null, 'select * from feedback.items', '42501', 'service_role has no direct table access either');
select pg_temp.finish();
