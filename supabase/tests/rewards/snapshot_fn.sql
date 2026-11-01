-- Defines pg_temp.snap(): a deterministic snapshot of the pre-existing public/auth objects, used to prove P1 changes none of them.
create function pg_temp.snap() returns table (kind text, name text, owner text, acl text, extra text) language sql as $$
  select 'table', c.oid::regclass::text, pg_get_userbyid(c.relowner),
         coalesce(c.relacl, acldefault(case when c.relkind = 'S' then 'S'::"char" else 'r'::"char" end, c.relowner))::text,
         c.relrowsecurity::text || ':' || c.relforcerowsecurity::text
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('public', 'auth') and c.relkind in ('r', 'p', 'v', 'm', 'S')
  union all
  select 'function', p.oid::regprocedure::text, pg_get_userbyid(p.proowner),
         coalesce(p.proacl, acldefault('f', p.proowner))::text,
         md5(p.prosrc) || ':' || p.prosecdef::text || ':' || coalesce(p.proconfig::text, '')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'auth') and p.proname <> 'record_visit'
      and p.prokind in ('f', 'p')
  union all
  select 'schema', n.nspname::text, pg_get_userbyid(n.nspowner), coalesce(n.nspacl, acldefault('n', n.nspowner))::text, ''
    from pg_namespace n where n.nspname in ('public', 'auth')
$$;
