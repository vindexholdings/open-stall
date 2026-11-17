-- Shared helpers for OS-APP-FEEDBACK tests (psql session scope; throwaway cluster only; synthetic data only).
\set ON_ERROR_STOP on
\o /dev/null
create temp table _t (ok boolean not null, name text not null);
create function pg_temp.ok(c boolean, name text) returns void language plpgsql as $$
begin
  insert into _t values (coalesce(c, false), name);
  if c is true then raise notice 'ok - %', name; else raise notice 'not ok - %', name; end if;
end $$;
create function pg_temp.fails(q text, code text, name text) returns void language plpgsql as $$
declare st text;
begin
  begin
    execute q;
    perform pg_temp.ok(false, name || ' (expected failure ' || coalesce(code, 'any') || ' but succeeded)');
    return;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
  end;
  perform pg_temp.ok(code is null or st = any (string_to_array(code, ',')), name || ' [' || st || ']');
end $$;
create function pg_temp.finish() returns void language plpgsql as $$
declare n integer; bad integer;
begin
  select count(*), count(*) filter (where not ok) into n, bad from _t;
  raise notice 'checks: % passed, % failed', n - bad, bad;
  if bad > 0 then raise exception '% check(s) failed', bad; end if;
end $$;
create function pg_temp.mkuser(n integer) returns uuid language plpgsql as $$
declare u uuid := ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
begin insert into auth.users (id, email) values (u, 'fb' || n || '@test.invalid') on conflict do nothing; return u; end $$;
create function pg_temp.mkadmin(n integer, disabled boolean default false) returns uuid language plpgsql as $$
declare u uuid := pg_temp.mkuser(n);
begin
  insert into public.admin_users (user_id, disabled_at) values (u, case when disabled then now() else null end) on conflict do nothing;
  return u;
end $$;
create function pg_temp.claims(sub uuid, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub::text, ''), false);
  perform set_config('request.jwt.claims', case when sub is null and aal is null then '' else jsonb_build_object('sub', sub, 'aal', aal)::text end, false);
end $$;
-- Runs q as a REAL database role with the given claims (the way the API gateway sets them); resets on every path.
create function pg_temp.as_role(r text, sub uuid, aal text, q text) returns text language plpgsql as $$
declare res text;
begin
  perform pg_temp.claims(sub, aal);
  execute format('set local role %I', r);
  begin
    execute q into res;
  exception when others then
    execute 'reset role';
    perform pg_temp.claims(null, null);
    raise;
  end;
  execute 'reset role';
  perform pg_temp.claims(null, null);
  return res;
end $$;
create function pg_temp.fails_as(r text, sub uuid, aal text, q text, code text, name text) returns void language plpgsql as $$
declare st text; did boolean := false;
begin
  begin
    perform pg_temp.as_role(r, sub, aal, q);
    did := true;
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
  end;
  if did then perform pg_temp.ok(false, name || ' (expected failure ' || coalesce(code, 'any') || ' but succeeded)'); return; end if;
  perform pg_temp.ok(code is null or st = any (string_to_array(code, ',')), name || ' [' || st || ']');
end $$;
create temp table _f (k text primary key, v text);
create function pg_temp.setf(k text, v text) returns text language sql as $$ insert into _f values (k, v) on conflict (k) do update set v = excluded.v returning v $$;
create function pg_temp.f(k text) returns text language sql as $$ select v from _f where _f.k = f.k $$;
-- Real caller paths. Submit: authenticated, no MFA needed. Admin: authenticated with aal2 (the gate is INSIDE each function).
create function pg_temp.submit(u uuid, key text, title text default 'The map pin does not move', descr text default 'When I drag the map the pin stays in place for a while.',
                               kind text default 'bug', screen text default 'map') returns jsonb language sql as $$
  select pg_temp.as_role('authenticated', u, 'aal1', format('select public.submit_feedback(%L, %L, %L, %L, %L)::text', key, kind, screen, title, descr))::jsonb
$$;
create function pg_temp.adm(a uuid, q text) returns text language sql as $$ select pg_temp.as_role('authenticated', a, 'aal2', q) $$;
create function pg_temp.key(n integer) returns text language sql as $$ select 'fb-key-' || lpad(n::text, 12, '0') $$;
