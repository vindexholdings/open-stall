-- R004: pure evaluation and the single reward-capable recording path, record_visit.

-- ---------------------------------------------------------------- pure evaluation (no table access, no now())
-- Inputs are values the caller gathered under the section 4a locks; the result is the two INDEPENDENT outcomes.
-- There is no interval input anywhere: no cooldown, no same-location time rule.
create function rewards.evaluate_visit(
  p_spendable_per_visit integer,
  p_lifetime_first_daily integer,
  p_max_rewarded_per_location_day integer,
  p_max_spendable_per_user_utc_day integer,
  p_ordinal integer,
  p_user_spendable_issued integer,
  p_global_spendable_issued integer,
  p_rewards_enabled boolean,
  p_global_budget integer,
  p_hold boolean
) returns table (spendable_outcome text, lifetime_outcome text, spendable_points integer, lifetime_points integer)
language plpgsql immutable set search_path = '' as $$
begin
  if p_ordinal is null or p_ordinal < 1 or p_user_spendable_issued is null or p_user_spendable_issued < 0
     or p_global_spendable_issued is null or p_global_spendable_issued < 0
     or p_spendable_per_visit is null or p_spendable_per_visit <= 0 or p_lifetime_first_daily is null or p_lifetime_first_daily < 0
     or p_max_rewarded_per_location_day is null or p_max_rewarded_per_location_day <= 0
     or p_max_spendable_per_user_utc_day is null or p_max_spendable_per_user_utc_day <= 0
     or p_rewards_enabled is null or p_hold is null or (p_global_budget is not null and p_global_budget < 0) then
    raise exception 'invalid evaluation input' using errcode = '22023';
  end if;

  -- A held visit keeps its slot and earns nothing yet (holds themselves are P2).
  if p_hold then
    return query select 'held'::text, 'held'::text, 0, 0;
    return;
  end if;

  -- Production safety gate: checked FIRST, before any award decision.
  -- MUTABLE:evaluate_gate begin
  if not p_rewards_enabled then
    return query select 'rewards_disabled'::text, 'rewards_disabled'::text, 0, 0;
    return;
  end if;
  if p_global_budget is null then
    return query select 'budget_unset'::text, 'rewards_disabled'::text, 0, 0;
    return;
  end if;
  -- MUTABLE:evaluate_gate end

  -- Lifetime: first visit of the local day only, independent of every spendable cap and of the budget.
  lifetime_outcome := case when p_ordinal = 1 then 'awarded' else 'not_first_daily' end;
  lifetime_points := case when p_ordinal = 1 then p_lifetime_first_daily else 0 end;
  if lifetime_points = 0 and lifetime_outcome = 'awarded' then
    lifetime_outcome := 'not_first_daily';
  end if;

  -- Spendable: location slots, then the user's UTC-day cap, then the global budget. All-or-nothing, never partial.
  spendable_points := 0;
  if p_ordinal > p_max_rewarded_per_location_day then
    spendable_outcome := 'location_cap';
  elsif p_user_spendable_issued + p_spendable_per_visit > p_max_spendable_per_user_utc_day then
    spendable_outcome := 'user_day_cap';
  elsif p_global_spendable_issued + p_spendable_per_visit > p_global_budget then
    spendable_outcome := 'budget_exhausted';
  else
    spendable_outcome := 'awarded';
    spendable_points := p_spendable_per_visit;
  end if;
  return next;
end $$;

-- ---------------------------------------------------------------- the recording path
-- NEW server path; legacy public.check_in and its 12-hour / 10-per-day behavior are untouched. There is no replacement
-- refusal threshold here. The client sends only the location, its coordinates (checked against 150 m, then discarded),
-- an optional accuracy and an idempotency key; it can never send an amount, a day, a count or an outcome.
-- The recording logic takes the server time as an argument so that day boundaries, DST and policy transitions can be tested
-- deterministically. It is INTERNAL (no client privilege at all); the only public entry point, public.record_visit, always
-- passes clock_timestamp(), so a client can never choose the time.
create function rewards.record_visit_at(
  p_at timestamptz,
  p_location uuid,
  p_lat double precision,
  p_lng double precision,
  p_idempotency_key text,
  p_accuracy_m double precision
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t0 timestamptz;
  utc_day date;
  local_day date;
  lc record;
  zone text;
  st record;
  pol record;
  existing rewards.visits%rowtype;
  dist_bucket text;
  acc_bucket text;
  ord integer;
  user_issued integer;
  global_issued integer;
  ev record;
  v_id uuid := gen_random_uuid();
  s_out text;
  l_out text;
  s_pts integer := 0;
  l_pts integer := 0;
  got integer;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_at is null then raise exception 'server time required' using errcode = '22023'; end if;
  if p_location is null or p_lat is null or p_lng is null
     or p_lat <> p_lat or p_lng <> p_lng                                   -- NaN
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_accuracy_m is not null and (p_accuracy_m <> p_accuracy_m or p_accuracy_m <= 0 or p_accuracy_m > 100000) then
    raise exception 'invalid accuracy' using errcode = '22023';
  end if;

  t0 := p_at;
  utc_day := (t0 at time zone 'UTC')::date;

  -- Lock order is fixed: 0 policy (immutable rows, no lock), 1 user, 2 user+location+local day, 3 user-day counter, 4 global counter.
  -- MUTABLE:lock_user begin
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || uid::text, 0));
  -- MUTABLE:lock_user end

  -- Idempotent replay: the same key returns the same visit and never awards twice.
  select * into existing from rewards.visits where user_id = uid and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.location_id <> p_location then
      raise exception 'idempotency key already used for another restroom' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'visit_id', existing.id, 'replayed', true,
      'spendable_outcome', existing.spendable_outcome, 'lifetime_outcome', existing.lifetime_outcome,
      'spendable_points', coalesce((select sum(amount) from rewards.reward_ledger where visit_id = existing.id and kind = 'spendable' and entry_type = 'award'), 0),
      'lifetime_points', coalesce((select sum(amount) from rewards.reward_ledger where visit_id = existing.id and kind = 'lifetime' and entry_type = 'award'), 0));
  end if;

  -- The writer cannot read public.locations; this narrow read-only helper reports only availability and a coarse bucket.
  select * into lc from rewards.location_check(p_location, p_lat, p_lng);
  if lc.available is not true then
    raise exception 'location not available' using errcode = '22023';
  end if;
  if lc.distance_bucket is null then
    raise exception 'too far from the restroom' using errcode = '22023';
  end if;
  dist_bucket := lc.distance_bucket;
  acc_bucket := case when p_accuracy_m is null then null when p_accuracy_m <= 25 then 'within_25'
                     when p_accuracy_m <= 50 then 'within_50' else 'over_50' end;

  select * into st from rewards.reward_settings;
  -- Policy version in effect at server time; versions are immutable and prospective.
  select * into pol from rewards.reward_policy_versions where effective_from <= t0 order by effective_from desc limit 1;
  if pol.id is null then raise exception 'no policy version in effect' using errcode = 'RW020'; end if;

  select z.time_zone into zone from rewards.reward_location_zones z where z.location_id = p_location;
  if not rewards.is_valid_time_zone(zone) then
    -- Fails closed: recorded, no day, no ordinal, no award.
    insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id,
        time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, accuracy_bucket, spendable_outcome, lifetime_outcome)
      values (v_id, uid, p_location, p_idempotency_key, t0, pol.id, st.history_id,
        null, null, utc_day, null, dist_bucket, acc_bucket, 'no_valid_time_zone', 'no_valid_time_zone');
    return jsonb_build_object('visit_id', v_id, 'replayed', false, 'spendable_outcome', 'no_valid_time_zone',
      'lifetime_outcome', 'no_valid_time_zone', 'spendable_points', 0, 'lifetime_points', 0);
  end if;
  local_day := (t0 at time zone zone)::date;

  -- MUTABLE:lock_user_location_day begin
  perform pg_advisory_xact_lock(hashtextextended('rewards:uld:' || uid::text || ':' || p_location::text || ':' || local_day::text, 0));
  -- MUTABLE:lock_user_location_day end

  -- Canonical ordinal: the count of ACCEPTED visits by this user at this location on this local day, plus one.
  -- A cap-blocked or disabled visit still occupies its slot. No interval is ever computed.
  select count(*) + 1 into ord from rewards.visits
    where user_id = uid and location_id = p_location and policy_day_local = local_day;

  select coalesce((select spendable from rewards.reward_counters_user_day where user_id = uid and issuance_day_utc = utc_day), 0)
    into user_issued;
  select coalesce((select spendable from rewards.reward_counters_global_day where issuance_day_utc = utc_day), 0)
    into global_issued;

  select * into ev from rewards.evaluate_visit(pol.spendable_per_visit, pol.lifetime_first_daily, pol.max_rewarded_per_location_day,
    pol.max_spendable_per_user_utc_day, ord, user_issued, global_issued, st.rewards_enabled, st.global_budget_utc_day, false);
  s_out := ev.spendable_outcome;
  l_out := ev.lifetime_outcome;

  -- Block L: the lifetime award. It touches no spendable counter and has no designed failure of its own, so it needs no handler:
  -- any error here aborts the whole visit. It is written BEFORE block S so that a failed S can never remove it.
  if l_out = 'awarded' then
    insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
      values ('award', v_id, uid, p_location, local_day, pol.id, 'lifetime', ev.lifetime_points, 'first_visit_of_local_day');
    l_pts := ev.lifetime_points;
  end if;

  -- Block S: the spendable award in a SEPARATE inner block (its own savepoint). A user-cap or budget failure rolls back ONLY
  -- this block (the counter increments and any spendable row) and never removes the lifetime award above. Only the two
  -- designed private SQLSTATEs are handled; every other error aborts the whole visit so a retry with the same key succeeds.
  if s_out = 'awarded' then
    begin
      -- order 3: the user's UTC-day counter (atomic conditional increment; no row returned means the cap is reached)
      insert into rewards.reward_counters_user_day (user_id, issuance_day_utc, spendable)
        select uid, utc_day, pol.spendable_per_visit where pol.spendable_per_visit <= pol.max_spendable_per_user_utc_day
        on conflict (user_id, issuance_day_utc) do update
          set spendable = rewards.reward_counters_user_day.spendable + pol.spendable_per_visit
          where rewards.reward_counters_user_day.spendable + pol.spendable_per_visit <= pol.max_spendable_per_user_utc_day;
      get diagnostics got = row_count;
      if got = 0 then raise exception 'user day cap reached' using errcode = 'RW001'; end if;

      -- order 4 (LAST, the hottest row): the global counter, same conditional increment against the budget
      -- MUTABLE:global_conditional begin
      insert into rewards.reward_counters_global_day (issuance_day_utc, spendable)
        select utc_day, pol.spendable_per_visit where pol.spendable_per_visit <= st.global_budget_utc_day
        on conflict (issuance_day_utc) do update
          set spendable = rewards.reward_counters_global_day.spendable + pol.spendable_per_visit
          where rewards.reward_counters_global_day.spendable + pol.spendable_per_visit <= st.global_budget_utc_day;
      get diagnostics got = row_count;
      if got = 0 then raise exception 'global budget exhausted' using errcode = 'RW002'; end if;
      -- MUTABLE:global_conditional end

      insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
        values ('award', v_id, uid, p_location, local_day, pol.id, 'spendable', ev.spendable_points, 'rewarded_visit');
      s_pts := ev.spendable_points;
    -- MUTABLE:block_isolation begin
    exception
      when sqlstate 'RW001' then s_out := 'user_day_cap';
      when sqlstate 'RW002' then s_out := 'budget_exhausted';
    -- MUTABLE:block_isolation end
    end;
  end if;

  insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id,
      time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, accuracy_bucket, spendable_outcome, lifetime_outcome)
    values (v_id, uid, p_location, p_idempotency_key, t0, pol.id, st.history_id,
      zone, local_day, utc_day, ord, dist_bucket, acc_bucket, s_out, l_out);

  return jsonb_build_object('visit_id', v_id, 'replayed', false, 'spendable_outcome', s_out, 'lifetime_outcome', l_out,
    'spendable_points', s_pts, 'lifetime_points', l_pts);
end $$;

-- Internal read helper for reconciliation and tests: balances are DERIVED from the ledger, never stored.
create function rewards.user_balances(p_user uuid)
returns table (spendable bigint, lifetime bigint)
language sql stable set search_path = '' as $$
  select coalesce(sum(amount) filter (where kind = 'spendable'), 0)::bigint,
         coalesce(sum(amount) filter (where kind = 'lifetime'), 0)::bigint
  from rewards.reward_ledger where user_id = p_user
$$;

-- ---------------------------------------------------------------- narrow read-only location helper
-- Owned by the migration role (the only place that reads public.locations for rewards). It returns availability and a coarse
-- distance bucket, never coordinates; a bucket of NULL means farther than 150 m (the same rule check_in applies).
create function rewards.location_check(p_location uuid, p_lat double precision, p_lng double precision)
returns table (available boolean, distance_bucket text)
language plpgsql stable security definer set search_path = '' as $$
declare l record; d double precision;
begin
  select x.status, x.restroom_evidence, x.restroom_verified, x.latitude, x.longitude into l
    from public.locations x where x.id = p_location;
  if l.latitude is null or not public.is_publicly_displayable(l.status, l.restroom_evidence, l.restroom_verified) then
    available := false; distance_bucket := null; return next; return;
  end if;
  d := public.distance_m(p_lat, p_lng, l.latitude, l.longitude);
  available := true;
  distance_bucket := case when d <= 50 then 'within_50' when d <= 100 then 'within_100' when d <= 150 then 'within_150' else null end;
  return next;
end $$;

-- ---------------------------------------------------------------- ownership and privileges (enumerated, not inferred)
-- Nothing in the rewards schema or the new public function is reachable by PUBLIC, anon or service_role. authenticated gets
-- EXECUTE on public.record_visit and nothing else. The writer owns ONLY the two record_visit functions; it gets CREATE on the two
-- schemas for the ownership transfers and loses it again immediately.
revoke all on function rewards.guard_append_only(), rewards.guard_truncate(), rewards.guard_settings_delete(),
  rewards.settings_history_trigger(), rewards.policy_versions_prospective(), rewards.ledger_insert_guard(),
  rewards.check_visit_ledger_consistency(), rewards.guard_counter_monotonic(), rewards.is_valid_time_zone(text),
  rewards.evaluate_visit(integer, integer, integer, integer, integer, integer, integer, boolean, integer, boolean),
  rewards.location_check(uuid, double precision, double precision), rewards.user_balances(uuid)
  from public, anon, authenticated, service_role;
grant execute on function rewards.is_valid_time_zone(text),
  rewards.evaluate_visit(integer, integer, integer, integer, integer, integer, integer, boolean, integer, boolean),
  rewards.location_check(uuid, double precision, double precision)
  to reward_writer_owner;

-- The ONE public RPC: a thin wrapper that supplies the server clock.
create function public.record_visit(
  p_location uuid,
  p_lat double precision,
  p_lng double precision,
  p_idempotency_key text,
  p_accuracy_m double precision default null
) returns jsonb
language sql security definer set search_path = '' as $$
  select rewards.record_visit_at(clock_timestamp(), p_location, p_lat, p_lng, p_idempotency_key, p_accuracy_m)
$$;

revoke all on function rewards.record_visit_at(timestamptz, uuid, double precision, double precision, text, double precision)
  from public, anon, authenticated, service_role;
revoke all on function public.record_visit(uuid, double precision, double precision, text, double precision)
  from public, anon, authenticated, service_role;
grant create on schema rewards to reward_writer_owner;
grant create on schema public to reward_writer_owner;
alter function rewards.record_visit_at(timestamptz, uuid, double precision, double precision, text, double precision) owner to reward_writer_owner;
alter function public.record_visit(uuid, double precision, double precision, text, double precision) owner to reward_writer_owner;
revoke create on schema rewards from reward_writer_owner;
revoke create on schema public from reward_writer_owner;
grant execute on function public.record_visit(uuid, double precision, double precision, text, double precision) to authenticated;
