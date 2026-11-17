-- F1: server-controlled status transitions, append-only provenance, immutable content.
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.mkadmin(8) as ad \gset
select pg_temp.submit(:'u1'::uuid, pg_temp.key(1)) ->> 'id' as i1 \gset

-- the full transition table is exactly the allowed set
select pg_temp.ok((select count(*) = 13 from (select a, b from unnest(array['received','reviewing','planned','in_progress','resolved','closed','duplicate']) a,
                                                             unnest(array['received','reviewing','planned','in_progress','resolved','closed','duplicate']) b where feedback.transition_ok(a, b)) s), 'exactly 13 transitions are allowed');
select pg_temp.ok(not feedback.transition_ok('received', 'resolved') and not feedback.transition_ok('closed', 'planned') and not feedback.transition_ok('duplicate', 'reviewing') and not feedback.transition_ok('received', 'closed'), 'skipping reviewing, reopening into planned and leaving duplicate are refused');
-- a client caller cannot invent a status or skip the order
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_set_status(%L, ''resolved'')', :'i1'), '22023', 'received -> resolved is refused');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_set_status(%L, ''nonsense'')', :'i1'), '22023', 'an unknown status is refused');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_set_status(%L, ''duplicate'')', :'i1'), '22023', 'duplicate can only be set by linking');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_set_status(%L, ''reviewing'', ''see https://example.org'')', :'i1'), '22023', 'a note with a link is refused');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_set_status(%L, ''reviewing'')', gen_random_uuid()), 'P0002', 'an unknown item is not found');
-- a valid chain, with provenance
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_set_status(%L, ''reviewing'', ''looking into it'')::text', :'i1'));
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_set_status(%L, ''planned'')::text', :'i1'));
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_set_status(%L, ''in_progress'')::text', :'i1'));
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_set_status(%L, ''resolved'')::text', :'i1'));
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_set_status(%L, ''closed'')::text', :'i1'));
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_set_status(%L, ''reviewing'', ''reopened'')::text', :'i1'));
select pg_temp.ok((select array_agg(to_status order by id) from feedback.status_history where item_id = :'i1'::uuid) = array['received','reviewing','planned','in_progress','resolved','closed','reviewing'], 'the history records every step in order');
select pg_temp.ok((select count(*) = 6 from feedback.status_history where item_id = :'i1'::uuid and actor_kind = 'admin' and actor_id = :'ad'::uuid), 'each administrator step records who made it');
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_get(%L)::text', :'i1'))::jsonb as ag \gset
select pg_temp.ok((select count(*) = 2 from jsonb_array_elements(:'ag'::jsonb -> 'history') h where (h ->> 'note') in ('looking into it', 'reopened')), 'the administrator sees the internal notes');

-- append-only provenance and immutable content, even for the superuser (guards decide, not privileges)
select pg_temp.fails('update feedback.status_history set to_status = ''closed''', '42501', 'history rows cannot be updated');
select pg_temp.fails('delete from feedback.status_history', '42501', 'history rows cannot be deleted directly');
select pg_temp.fails('truncate feedback.status_history', '42501', 'history cannot be truncated');
select pg_temp.fails('update feedback.items set title = ''Changed title text''', '42501', 'item content cannot be edited');
select pg_temp.fails('update feedback.items set user_id = gen_random_uuid()', '42501', 'the owner cannot be reassigned');
select pg_temp.fails('update feedback.items set status = ''received'' where status = ''reviewing''', '22023', 'a direct backwards status change is refused by the table guard too');
select pg_temp.fails('delete from feedback.items', '42501', 'items cannot be deleted directly');
select pg_temp.fails('truncate feedback.items', '42501,0A000', 'items cannot be truncated (refused by the guard or by the foreign keys that reference the table)');
create function pg_temp.as_owner(q text) returns void language plpgsql as $$ begin set local role feedback_owner; begin execute q; exception when others then reset role; raise; end; reset role; end $$;
select pg_temp.fails('select pg_temp.as_owner($q$update feedback.items set title = ''Changed by owner''$q$)', '42501', 'even the owner role has no privilege to edit content (column grants)');
select pg_temp.fails('select pg_temp.as_owner($q$delete from feedback.status_history$q$)', '42501', 'even the owner role cannot delete history outside an account deletion');
select pg_temp.ok((select title = 'The map pin does not move' from feedback.items where id = :'i1'::uuid), 'the original text was never altered by any of this');
-- concurrency-safe single decision is covered in f1_09; here: a decision on a stale view fails cleanly
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_set_status(%L, ''reviewing'')', :'i1'), '22023', 'repeating the same status (stale view) is refused, not silently applied twice');
select pg_temp.finish();
