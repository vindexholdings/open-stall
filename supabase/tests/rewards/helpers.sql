-- Shared helpers for P1 rewards tests (psql session scope; throwaway cluster only).
\set ON_ERROR_STOP on
-- Result rows of the assertion helpers are noise; notices (ok / not ok) and errors still print. Use \o to show evidence output.
\o /dev/null
create temp table _t (ok boolean not null, name text not null);
create function pg_temp.ok(c boolean, name text) returns void language plpgsql as $$
begin
  insert into _t values (coalesce(c, false), name);
  if c is true then raise notice 'ok - %', name; else raise notice 'not ok - %', name; end if;
end $$;
-- Runs sql and asserts it fails with one of the given comma-separated SQLSTATEs (any failure when code is NULL).
create function pg_temp.fails(q text, code text, name text) returns void language plpgsql as $$
declare st text; msg text;
begin
  begin
    execute q;
    perform pg_temp.ok(false, name || ' (expected failure ' || coalesce(code, 'any') || ' but succeeded)');
    return;
  exception when others then
    get stacked diagnostics st = returned_sqlstate, msg = message_text;
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
-- Fixture builders.
create function pg_temp.mkuser(n integer) returns uuid language plpgsql as $$
declare u uuid := ('00000000-0000-0000-0000-' || lpad(n::text, 12, '0'))::uuid;
begin insert into auth.users (id, email) values (u, 'rw' || n || '@test.invalid') on conflict do nothing; return u; end $$;
create function pg_temp.mkloc(lat float8, zone text default 'America/Denver') returns uuid language plpgsql as $$
declare l uuid;
begin
  insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
    values ('RW loc ' || lat, lat, -100, 'verified', 'explicit', true, now()) returning id into l;
  if zone is not null then insert into rewards.reward_location_zones (location_id, time_zone) values (l, zone); end if;
  return l;
end $$;
create function pg_temp.as_user(u uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(u::text, ''), false)
$$;
-- The caller is the real client path: the internal recorder with an explicit server time.
create function pg_temp.visit_at(at timestamptz, u uuid, l uuid, key text, lat float8 default null, acc float8 default null) returns jsonb
language plpgsql as $$
declare lt float8; r jsonb;
begin
  perform pg_temp.as_user(u);
  select latitude into lt from public.locations where id = l;
  select rewards.record_visit_at(at, l, coalesce(lat, lt), -100, key, acc) into r;
  return r;
end $$;
-- Test-only enabling fixture. Rewards are DISABLED and the budget UNSET everywhere else, including every migration.
create function pg_temp.enable_rewards(budget integer) returns void language sql as $$
  update rewards.reward_settings set rewards_enabled = true, global_budget_utc_day = budget
$$;
create function pg_temp.set_settings(en boolean, budget integer) returns void language sql as $$
  update rewards.reward_settings set rewards_enabled = en, global_budget_utc_day = budget
$$;
-- 'spendable_outcome|lifetime_outcome|spendable_points|lifetime_points' for a record_visit result.
create function pg_temp.oc(r jsonb) returns text language sql as $$
  select (r->>'spendable_outcome') || '|' || (r->>'lifetime_outcome') || '|' || (r->>'spendable_points') || '|' || (r->>'lifetime_points')
$$;
create function pg_temp.vo(at timestamptz, u uuid, l uuid, key text) returns text language sql as $$
  select pg_temp.oc(pg_temp.visit_at(at, u, l, key))
$$;
-- Like fails(), but forces deferred constraints inside the block so a deferred consistency failure is caught here.
create function pg_temp.fails_c(q text, code text, name text) returns void language plpgsql as $$
declare st text;
begin
  begin
    execute q;
    execute 'set constraints all immediate';
    perform pg_temp.ok(false, name || ' (expected failure ' || coalesce(code, 'any') || ' but succeeded)');
    raise exception 'rollback-probe' using errcode = 'RW999';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
    if st = 'RW999' then return; end if;
  end;
  perform pg_temp.ok(code is null or st = any (string_to_array(code, ',')), name || ' [' || st || ']');
end $$;
