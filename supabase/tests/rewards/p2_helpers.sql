-- Shared P2 helpers: real caller paths (role + JWT claims), admin fixtures. Throwaway cluster only.
\i :ROOT/supabase/tests/rewards/helpers.sql
create function pg_temp.mkadmin(n integer, disabled boolean default false) returns uuid language plpgsql as $$
declare u uuid := pg_temp.mkuser(n);
begin
  insert into public.admin_users (user_id, disabled_at) values (u, case when disabled then now() else null end) on conflict do nothing;
  return u;
end $$;
-- Sets the caller identity exactly as the API gateway does: subject and aal in the JWT claims (no role change).
create function pg_temp.claims(sub uuid, aal text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(sub::text, ''), false);
  perform set_config('request.jwt.claims', case when sub is null and aal is null then '' else jsonb_build_object('sub', sub, 'aal', aal)::text end, false);
end $$;
-- Runs q as a REAL database role with the given claims; resets the role afterwards on every path. Returns the text result of q.
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
-- Like fails(), but the statement runs as a real role with claims.
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
-- A visit as the real recorder with an explicit server time; returns the visit id.
create function pg_temp.vid(at timestamptz, u uuid, l uuid, key text) returns uuid language sql as $$
  select (pg_temp.visit_at(at, u, l, key)->>'visit_id')::uuid
$$;
-- Named fixtures for DO blocks (psql variables are not interpolated inside dollar-quoted bodies).
create temp table _f (k text primary key, v uuid);
create function pg_temp.setf(k text, v uuid) returns uuid language sql as $$ insert into _f values (k, v) on conflict (k) do update set v = excluded.v returning v $$;
create function pg_temp.f(k text) returns uuid language sql as $$ select v from _f where _f.k = f.k $$;
-- The four admin RPCs through the real authenticated/aal2 path.
create function pg_temp.hold_as(adm uuid, u uuid) returns text language sql as $$
  select pg_temp.as_role('authenticated', adm, 'aal2', format('select public.admin_reward_hold_user(%L::uuid, %L)::text', u, 'hold for test'))
$$;
create function pg_temp.clear_as(adm uuid, u uuid) returns jsonb language sql as $$
  select pg_temp.as_role('authenticated', adm, 'aal2', format('select public.admin_reward_clear_hold(%L::uuid, %L)::text', u, 'clear for test'))::jsonb
$$;
create function pg_temp.recommend_as(adm uuid, v uuid) returns uuid language sql as $$
  select pg_temp.as_role('authenticated', adm, 'aal2', format('select public.admin_reward_recommend_reversal(%L::uuid, %L)::text', v, 'recommend for test'))::uuid
$$;
create function pg_temp.finalize_as(adm uuid, rec uuid) returns jsonb language sql as $$
  select pg_temp.as_role('authenticated', adm, 'aal2', format('select public.admin_reward_finalize_reversal(%L::uuid, %L)::text', rec, 'finalize for test'))::jsonb
$$;
create function pg_temp.clr(v uuid) returns text language sql as $$
  select spendable_outcome || '|' || lifetime_outcome from rewards.visit_clearances where visit_id = v
$$;
