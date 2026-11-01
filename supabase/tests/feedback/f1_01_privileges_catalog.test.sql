-- F1: exact ownership / ACL / RLS / default-privilege inventory and an executed refusal matrix for every client role.
\i :ROOT/supabase/tests/feedback/helpers.sql
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.setf('u1', :'u1');

-- the owner role
select pg_temp.ok((select not rolcanlogin and not rolinherit and not rolbypassrls and not rolsuper and not rolcreatedb and not rolcreaterole and not rolreplication from pg_roles where rolname = 'feedback_owner'),
                  'feedback_owner: NOLOGIN, NOINHERIT, NOBYPASSRLS, not a superuser, cannot create databases or roles, no replication');
select pg_temp.ok(not pg_has_role('anon', 'feedback_owner', 'member') and not pg_has_role('authenticated', 'feedback_owner', 'member') and not pg_has_role('service_role', 'feedback_owner', 'member'), 'no client role is a member of feedback_owner');
-- the schema
select pg_temp.ok(not has_schema_privilege('anon', 'feedback', 'usage') and not has_schema_privilege('authenticated', 'feedback', 'usage') and not has_schema_privilege('service_role', 'feedback', 'usage')
              and not has_schema_privilege('anon', 'feedback', 'create') and not has_schema_privilege('authenticated', 'feedback', 'create') and has_schema_privilege('feedback_owner', 'feedback', 'usage'), 'schema feedback: only feedback_owner can use it; no client role can use or create in it');
-- tables: exactly five, owned by feedback_owner, row security enabled AND forced
select pg_temp.ok((select array_agg(c.relname::text order by c.relname) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'feedback' and c.relkind in ('r', 'p', 'v', 'm', 'f'))
                  = array['drafts', 'issues', 'item_links', 'items', 'publication_events', 'publications', 'status_history'], 'exactly seven tables exist in the feedback schema (no view, no foreign table)');
select pg_temp.ok((select bool_and(pg_get_userbyid(c.relowner) = 'feedback_owner' and c.relrowsecurity and c.relforcerowsecurity) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'feedback' and c.relkind = 'r'),
                  'every table is owned by feedback_owner with row security enabled and FORCED');
select pg_temp.ok((select count(*) = 21 from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'feedback')
              and not exists (select 1 from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'feedback'
                                and not (p.polroles = array[(select oid from pg_roles where rolname = 'feedback_owner')])), 'exactly 21 policies, every one for feedback_owner only');
select pg_temp.ok(not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) a where n.nspname = 'feedback' and c.relkind = 'r'
                                and (a.grantee = 0 or a.grantee <> (select oid from pg_roles where rolname = 'feedback_owner') and a.grantee <> c.relowner)), 'no table is granted to PUBLIC or to any role other than the owner');
select pg_temp.ok((select array_agg(a.attname::text order by a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'feedback' and c.relname = 'items' and a.attacl is not null and exists (select 1 from aclexplode(a.attacl) x where x.privilege_type = 'UPDATE')) = array['status', 'updated_at'], 'items: UPDATE is granted on the status and updated_at columns only (content and owner are not updatable)');
select pg_temp.ok((select array_agg(a.attname::text order by a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'feedback' and c.relname = 'drafts' and a.attacl is not null and exists (select 1 from aclexplode(a.attacl) x where x.privilege_type = 'UPDATE')) = array['approved_at', 'approved_by', 'approved_hash', 'approved_links'], 'drafts: UPDATE is granted on the approval columns only');
-- functions in the private schema: nothing executable by a client role
select pg_temp.ok((select array_agg(p.proname::text order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'feedback')
                  = array['export_block', 'guard_append_only', 'guard_drafts', 'guard_issues', 'guard_item_links', 'guard_items', 'guard_publications', 'guard_truncate', 'link_set', 'nz', 'outcome', 'page_cursor', 'pub_body', 'pub_expected_hash', 'pub_guard_actor', 'pub_json', 'pub_marker', 'pub_transition_ok', 'safe_public_text', 'sha', 'text_ok', 'tokens', 'transition_ok'], 'exactly 23 functions exist in the feedback schema');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace, unnest(array['anon', 'authenticated', 'service_role']) r where n.nspname = 'feedback' and has_function_privilege(r, p.oid, 'execute')), 'no client role can execute anything in the feedback schema');
-- the public entry points
create temp table _pub as select p.oid, p.proname, p.prosecdef, pg_get_userbyid(p.proowner) as owner, p.proconfig, p.prosrc
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname in ('submit_feedback', 'list_my_feedback', 'get_my_feedback') or p.proname like 'admin\_feedback\_%');
select pg_temp.ok((select count(*) = 17 from _pub), 'exactly 17 public feedback entry points (3 submitter + 14 administrator)');
select pg_temp.ok((select bool_and(prosecdef and owner = 'feedback_owner' and proconfig @> array['search_path=""']) from _pub), 'every entry point is SECURITY DEFINER, owned by feedback_owner, with an empty search_path');
select pg_temp.ok((select bool_and(has_function_privilege('authenticated', oid, 'execute') and not has_function_privilege('anon', oid, 'execute') and not has_function_privilege('service_role', oid, 'execute')
                                   and not has_function_privilege('public', oid, 'execute')) from _pub), 'every entry point: EXECUTE for authenticated only (not anon, service_role or PUBLIC)');
select pg_temp.ok((select bool_and(prosrc like '%public.require_admin()%') from _pub where proname like 'admin\_feedback\_%'), 'every administrator entry point calls the existing gate public.require_admin() in its own body');
select pg_temp.ok((select bool_and(prosrc like '%auth.uid()%') from _pub where proname in ('submit_feedback', 'list_my_feedback', 'get_my_feedback')), 'every submitter entry point derives the caller from auth.uid()');
select pg_temp.ok(not exists (select 1 from _pub, pg_get_function_arguments(oid) a where a ~* '(user_id|p_user|owner|subject)'), 'no entry point takes a user id, owner or subject parameter');
-- default privileges and untouched neighbours
select pg_temp.ok(not exists (select 1 from pg_default_acl d where d.defaclrole = (select oid from pg_roles where rolname = 'feedback_owner') or d.defaclnamespace = (select oid from pg_namespace where nspname = 'feedback')), 'no default privilege is defined for or in the feedback schema');
select pg_temp.ok((select prosrc not like '%feedback%' from pg_proc where oid = 'public.delete_my_account(text)'::regprocedure), 'the existing account-deletion function is unchanged (the cascade does the work)');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prosrc ~ 'feedback\.' and p.proname not in (select proname from _pub)), 'no other public function references the feedback schema (restroom reports and corrections are untouched)');
select pg_temp.ok(has_function_privilege('feedback_owner', 'public.require_admin()', 'execute') and not has_function_privilege('authenticated', 'public.require_admin()', 'execute'), 'only the owner may call the admin gate; it stays revoked from clients');

-- executed refusal matrix: every client role x every table x every verb
create temp table _m (role text, tbl text, verb text, refused boolean);
do $$
declare r text; t text; v text; q text; refused boolean; st text; u uuid := pg_temp.f('u1')::uuid;
begin
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    foreach t in array array['issues', 'items', 'status_history', 'item_links', 'drafts', 'publications', 'publication_events'] loop
      foreach v in array array['select', 'insert', 'update', 'delete', 'truncate'] loop
        q := case v when 'select' then format('select * from feedback.%I', t) when 'insert' then format('insert into feedback.%I default values', t)
                    when 'update' then format('update feedback.%I set created_at = now()', t) when 'delete' then format('delete from feedback.%I', t) else format('truncate feedback.%I', t) end;
        refused := false;
        begin perform pg_temp.as_role(r, u, 'aal1', q);
        exception when others then get stacked diagnostics st = returned_sqlstate; refused := st = '42501'; end;
        insert into _m values (r, t, v, refused);
      end loop;
    end loop;
  end loop;
end $$;
select pg_temp.setf('u1', :'u1');
select pg_temp.ok((select count(*) = 105 and bool_and(refused) from _m), 'executed matrix: 105 of 105 direct statements (3 roles x 7 tables x 5 verbs) are refused with 42501');
select pg_temp.finish();
