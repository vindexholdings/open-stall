-- F1: every admin entry point opens with the existing gate INSIDE the function (admin_users row, enabled, aal2). No client metadata, no service role.
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.mkadmin(8) as ad \gset
select pg_temp.mkadmin(7) as ad2 \gset
select pg_temp.mkadmin(6, true) as dis \gset
select pg_temp.submit(:'u1'::uuid, pg_temp.key(1)) ->> 'id' as i1 \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_create_issue(%L, ''Canonical map pin problem'', ''The map pin does not follow dragging.'')::text', :'i1'))::jsonb ->> 'issue_id' as iss \gset
select pg_temp.adm(:'ad'::uuid, format('select public.admin_feedback_draft_save(%L, ''Map pin does not follow dragging'', ''bug'', ''The pin does not follow the finger when the map is dragged.'')::text', :'iss')) as dr \gset

create temp table _calls (n text, q text);
insert into _calls values
 ('admin_feedback_list', 'select public.admin_feedback_list()'),
 ('admin_feedback_get', format('select public.admin_feedback_get(%L)', :'i1')),
 ('admin_feedback_candidates', format('select public.admin_feedback_candidates(%L)', :'i1')),
 ('admin_feedback_set_status', format('select public.admin_feedback_set_status(%L, ''reviewing'')', :'i1')),
 ('admin_feedback_create_issue', format('select public.admin_feedback_create_issue(%L, ''Another canonical title'', ''Another canonical summary text'')', :'i1')),
 ('admin_feedback_link_duplicate', format('select public.admin_feedback_link_duplicate(%L, %L)', :'i1', :'iss')),
 ('admin_feedback_issue_get', format('select public.admin_feedback_issue_get(%L)', :'iss')),
 ('admin_feedback_draft_save', format('select public.admin_feedback_draft_save(%L, ''A second draft title'', ''bug'', ''A second problem statement text'')', :'iss')),
 ('admin_feedback_draft_approve', format('select public.admin_feedback_draft_approve(%L, 1, %L)', :'iss', :'dr'::jsonb ->> 'hash')),
 ('admin_feedback_export_preview', format('select public.admin_feedback_export_preview(%L)', :'iss'));
select pg_temp.ok((select count(*) = 10 from _calls), 'ten admin entry points are covered');
select pg_temp.setf('ad', :'ad'), pg_temp.setf('u1', :'u1'), pg_temp.setf('dis', :'dis');
do $$
declare c record; ad uuid := pg_temp.f('ad')::uuid; u1 uuid := pg_temp.f('u1')::uuid; dis uuid := pg_temp.f('dis')::uuid;
begin
  for c in select * from _calls loop
    perform pg_temp.fails_as('anon', null, null, c.q, '42501', c.n || ': anon refused (no EXECUTE)');
    perform pg_temp.fails_as('authenticated', null, null, c.q, '28000', c.n || ': signed out refused');
    perform pg_temp.fails_as('authenticated', u1, 'aal2', c.q, '42501', c.n || ': a non-admin (even with aal2) refused');
    perform pg_temp.fails_as('authenticated', ad, 'aal1', c.q, '42501', c.n || ': an administrator without MFA (aal1) refused');
    perform pg_temp.fails_as('authenticated', dis, 'aal2', c.q, '42501', c.n || ': a DISABLED administrator refused');
    perform pg_temp.fails_as('service_role', null, null, c.q, '42501,28000', c.n || ': service_role has no shortcut');
  end loop;
end $$;
-- admin-looking client metadata is not authority
create function pg_temp.as_meta(sub uuid, q text) returns text language plpgsql as $$
declare res text;
begin
  perform set_config('request.jwt.claim.sub', sub::text, false);
  perform set_config('request.jwt.claims', jsonb_build_object('sub', sub, 'aal', 'aal2', 'role', 'admin', 'is_admin', true, 'app_metadata', jsonb_build_object('role', 'admin', 'admin', true), 'user_metadata', jsonb_build_object('admin', true))::text, false);
  execute 'set local role authenticated';
  begin execute q into res; exception when others then execute 'reset role'; perform pg_temp.claims(null, null); raise; end;
  execute 'reset role'; perform pg_temp.claims(null, null); return res;
end $$;
do $$ declare st text; begin
  begin perform pg_temp.as_meta(pg_temp.f('u1')::uuid, 'select public.admin_feedback_list()'); st := 'allowed';
  exception when others then get stacked diagnostics st = returned_sqlstate; end;
  perform pg_temp.ok(st = '42501', 'a non-admin whose token claims admin metadata and aal2 is still refused [' || st || ']');
end $$;
-- a real administrator with aal2 is served
select pg_temp.adm(:'ad2'::uuid, 'select public.admin_feedback_list()::text')::jsonb as ql \gset
select pg_temp.ok(jsonb_array_length(:'ql'::jsonb -> 'items') = 1, 'an enabled administrator with aal2 can list the queue');
-- the queue never exposes the submitter
select pg_temp.ok(not (:'ql'::text ~* 'user_id|email|fb1@') and (select array_agg(k order by k) from jsonb_object_keys(:'ql'::jsonb -> 'items' -> 0) k) = array['created_at', 'id', 'kind', 'linked', 'own', 'screen', 'status', 'title'], 'the queue returns exactly the safe fields and never the submitter');
select pg_temp.adm(:'ad2'::uuid, format('select public.admin_feedback_get(%L)::text', :'i1'))::jsonb as ag \gset
select pg_temp.ok(not (:'ag'::text ~* 'user_id|email|fb1@' ) and (:'ag'::jsonb ->> 'own') = 'false', 'the admin detail never exposes the submitter');
-- bounds
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', 'select public.admin_feedback_list(null, null, 0)', '22023', 'admin page size 0 refused');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', 'select public.admin_feedback_list(null, null, 51)', '22023', 'admin page size 51 refused (bounded)');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', 'select public.admin_feedback_list(''nonsense'', null, 5)', '22023', 'an unknown status filter is refused');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', 'select public.admin_feedback_list(null, ''bad cursor'', 5)', '22023', 'a malformed admin cursor is refused');
-- self-adjudication: an administrator's OWN feedback is decided by ANOTHER administrator
select pg_temp.submit(:'ad'::uuid, pg_temp.key(50), 'Admin own problem report', 'An administrator describes their own problem with the app here.') ->> 'id' as own \gset
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_set_status(%L, ''reviewing'')', :'own'), '42501', 'an administrator cannot set the status of their own feedback');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_create_issue(%L, ''Own problem issue'', ''An issue built from my own feedback'')', :'own'), '42501', 'an administrator cannot create an issue from their own feedback');
select pg_temp.fails_as('authenticated', :'ad'::uuid, 'aal2', format('select public.admin_feedback_link_duplicate(%L, %L)', :'own', :'iss'), '42501', 'an administrator cannot link their own feedback');
select pg_temp.ok((pg_temp.adm(:'ad2'::uuid, format('select public.admin_feedback_set_status(%L, ''reviewing'')::text', :'own'))::jsonb ->> 'status') = 'reviewing', 'another administrator can decide on it');
select pg_temp.adm(:'ad'::uuid, 'select public.admin_feedback_list()::text')::jsonb as al \gset
select pg_temp.ok((select count(*) = 1 from jsonb_array_elements(:'al'::jsonb -> 'items') v where (v ->> 'own') = 'true'), 'the queue marks the administrator''s own item as own (for the UI), without any identity');
select pg_temp.finish();
