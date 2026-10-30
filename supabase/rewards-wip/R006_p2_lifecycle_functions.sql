-- R006: P2 lifecycle functions. Reversal, hold/clear, award_held_visit, the narrow purge, reconciliation, expiry, and the
-- replacement internal recorder and ledger guards. Lock order everywhere (a subset, in order, per operation):
--   0 policy (immutable rows, no lock) -> 1 user advisory -> 2 user/location/local-day advisory -> 3 user-day counter -> 4 global counter.

-- ---------------------------------------------------------------- ledger insert guard: awards as in P1, plus validated reversals and cleared-hold awards
create or replace function rewards.ledger_insert_guard() returns trigger
language plpgsql set search_path = '' as $$
declare s record; o rewards.reward_ledger%rowtype; d rewards.reward_decisions%rowtype; v rewards.visits%rowtype;
begin
  if new.entry_type = 'award' then
    select rewards_enabled, global_budget_utc_day into s from rewards.reward_settings;
    if s.rewards_enabled is not true then
      raise exception 'rewards are disabled: no award can be written' using errcode = 'RW010';
    end if;
    if s.global_budget_utc_day is null then
      raise exception 'the global budget is unset: no award of either kind can be written' using errcode = 'RW011';
    end if;
    if new.reward_decision_id is not null then
      -- an award written at hold clearance: only for a held visit of the cleared account, under a clear_hold decision
      select * into d from rewards.reward_decisions where id = new.reward_decision_id;
      select * into v from rewards.visits where id = new.visit_id;
      -- MUTABLE:p2_cleared_award begin
      if d.decision_type is distinct from 'clear_hold' or d.subject_user_id is distinct from new.user_id
         or v.id is null or v.spendable_outcome <> 'held' then
        raise exception 'a cleared-hold award needs a clear_hold decision for the same account and a held visit' using errcode = '23514';
      end if;
      -- MUTABLE:p2_cleared_award end
    elsif new.reason = 'cleared_hold_award' then
      raise exception 'a cleared-hold award needs its decision' using errcode = '23514';
    end if;
    return new;
  end if;
  -- Reversal: validate the original award (the user and user/location/day advisory locks, which every writer of these rows takes, serialize it); copy every identifying field; the amount is exactly the negated original.
  -- Reversals are allowed while rewards are disabled (they only ever undo an issued award).
  select * into o from rewards.reward_ledger where id = new.reverses_entry_id;
  select * into d from rewards.reward_decisions where id = new.reward_decision_id;
  -- MUTABLE:p2_reversal_match begin
  if o.id is null or o.entry_type <> 'award'
     or new.visit_id <> o.visit_id or new.user_id is distinct from o.user_id or new.location_id <> o.location_id
     or new.policy_day_local <> o.policy_day_local or new.policy_version_id <> o.policy_version_id
     or new.kind <> o.kind or new.amount <> -o.amount then
    raise exception 'a reversal must copy its original award exactly and negate its amount' using errcode = '23514';
  end if;
  -- MUTABLE:p2_reversal_match end
  -- MUTABLE:p2_reversal_decision begin
  if d.id is null or d.decision_type <> 'final_reversal' or d.visit_id <> o.visit_id or d.subject_user_id is distinct from o.user_id then
    raise exception 'a reversal needs the final decision for the same visit and account' using errcode = '23514';
  end if;
  -- MUTABLE:p2_reversal_decision end
  return new;
end $$;

-- ---------------------------------------------------------------- visit/ledger consistency, now clearance-aware
create or replace function rewards.check_visit_ledger_consistency() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v rewards.visits%rowtype; c rewards.visit_clearances%rowtype; vid uuid; n_s integer; n_l integer; s_eff text; l_eff text;
begin
  if tg_table_name = 'visits' then vid := new.id;
  elsif tg_table_name = 'visit_clearances' then vid := new.visit_id;
  else vid := new.visit_id; end if;
  select * into v from rewards.visits where id = vid;
  if v.id is null then
    raise exception 'ledger rows without a visit' using errcode = '23503';
  end if;
  select * into c from rewards.visit_clearances where visit_id = vid;
  if c.visit_id is not null and (v.spendable_outcome <> 'held' or v.lifetime_outcome <> 'held') then
    raise exception 'only a held visit can have a clearance' using errcode = '23514';
  end if;
  s_eff := coalesce(c.spendable_outcome, v.spendable_outcome);
  l_eff := coalesce(c.lifetime_outcome, v.lifetime_outcome);
  select count(*) filter (where kind = 'spendable'), count(*) filter (where kind = 'lifetime')
    into n_s, n_l from rewards.reward_ledger where visit_id = vid and entry_type = 'award';
  if (s_eff = 'awarded') <> (n_s = 1) or n_s > 1 or (l_eff = 'awarded') <> (n_l = 1) or n_l > 1 then
    raise exception 'visit outcomes and ledger awards disagree for visit %', vid using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger visits_ledger_consistent_c after insert on rewards.visit_clearances
  deferrable initially deferred for each row execute function rewards.check_visit_ledger_consistency();
grant select on rewards.visit_clearances to reward_writer_owner;

-- ---------------------------------------------------------------- replacement internal recorder: identical to P1 except that an active hold records the visit as held
-- (a held visit keeps its slot, reserves no capacity and awards nothing). Server time is still only ever supplied by public.record_visit.
create or replace function rewards.record_visit_at(
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
  on_hold boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_at is null then raise exception 'server time required' using errcode = '22023'; end if;
  if p_location is null or p_lat is null or p_lng is null
     or p_lat <> p_lat or p_lng <> p_lng
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

  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || uid::text, 0));

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
  select * into pol from rewards.reward_policy_versions where effective_from <= t0 order by effective_from desc limit 1;
  if pol.id is null then raise exception 'no policy version in effect' using errcode = 'RW020'; end if;

  select z.time_zone into zone from rewards.reward_location_zones z where z.location_id = p_location;
  if not rewards.is_valid_time_zone(zone) then
    insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id,
        time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, accuracy_bucket, spendable_outcome, lifetime_outcome)
      values (v_id, uid, p_location, p_idempotency_key, t0, pol.id, st.history_id,
        null, null, utc_day, null, dist_bucket, acc_bucket, 'no_valid_time_zone', 'no_valid_time_zone');
    return jsonb_build_object('visit_id', v_id, 'replayed', false, 'spendable_outcome', 'no_valid_time_zone',
      'lifetime_outcome', 'no_valid_time_zone', 'spendable_points', 0, 'lifetime_points', 0);
  end if;
  local_day := (t0 at time zone zone)::date;

  perform pg_advisory_xact_lock(hashtextextended('rewards:uld:' || uid::text || ':' || p_location::text || ':' || local_day::text, 0));

  select count(*) + 1 into ord from rewards.visits
    where user_id = uid and location_id = p_location and policy_day_local = local_day;

  -- Read under the user lock, which hold placement and clearance also take, so a hold and a visit are strictly ordered.
  -- MUTABLE:p2_hold_read begin
  select exists (select 1 from rewards.reward_holds h where h.user_id = uid and h.cleared_at is null) into on_hold;
  -- MUTABLE:p2_hold_read end

  select coalesce((select spendable from rewards.reward_counters_user_day where user_id = uid and issuance_day_utc = utc_day), 0)
    into user_issued;
  select coalesce((select spendable from rewards.reward_counters_global_day where issuance_day_utc = utc_day), 0)
    into global_issued;

  select * into ev from rewards.evaluate_visit(pol.spendable_per_visit, pol.lifetime_first_daily, pol.max_rewarded_per_location_day,
    pol.max_spendable_per_user_utc_day, ord, user_issued, global_issued, st.rewards_enabled, st.global_budget_utc_day, on_hold);
  s_out := ev.spendable_outcome;
  l_out := ev.lifetime_outcome;

  if l_out = 'awarded' then
    insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
      values ('award', v_id, uid, p_location, local_day, pol.id, 'lifetime', ev.lifetime_points, 'first_visit_of_local_day');
    l_pts := ev.lifetime_points;
  end if;

  if s_out = 'awarded' then
    begin
      insert into rewards.reward_counters_user_day (user_id, issuance_day_utc, spendable)
        select uid, utc_day, pol.spendable_per_visit where pol.spendable_per_visit <= pol.max_spendable_per_user_utc_day
        on conflict (user_id, issuance_day_utc) do update
          set spendable = rewards.reward_counters_user_day.spendable + pol.spendable_per_visit
          where rewards.reward_counters_user_day.spendable + pol.spendable_per_visit <= pol.max_spendable_per_user_utc_day;
      get diagnostics got = row_count;
      if got = 0 then raise exception 'user day cap reached' using errcode = 'RW001'; end if;

      insert into rewards.reward_counters_global_day (issuance_day_utc, spendable)
        select utc_day, pol.spendable_per_visit where pol.spendable_per_visit <= st.global_budget_utc_day
        on conflict (issuance_day_utc) do update
          set spendable = rewards.reward_counters_global_day.spendable + pol.spendable_per_visit
          where rewards.reward_counters_global_day.spendable + pol.spendable_per_visit <= st.global_budget_utc_day;
      get diagnostics got = row_count;
      if got = 0 then raise exception 'global budget exhausted' using errcode = 'RW002'; end if;

      insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
        values ('award', v_id, uid, p_location, local_day, pol.id, 'spendable', ev.spendable_points, 'rewarded_visit');
      s_pts := ev.spendable_points;
    exception
      when sqlstate 'RW001' then s_out := 'user_day_cap';
      when sqlstate 'RW002' then s_out := 'budget_exhausted';
    end;
  end if;

  insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id,
      time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, accuracy_bucket, spendable_outcome, lifetime_outcome)
    values (v_id, uid, p_location, p_idempotency_key, t0, pol.id, st.history_id,
      zone, local_day, utc_day, ord, dist_bucket, acc_bucket, s_out, l_out);

  return jsonb_build_object('visit_id', v_id, 'replayed', false, 'spendable_outcome', s_out, 'lifetime_outcome', l_out,
    'spendable_points', s_pts, 'lifetime_points', l_pts);
end $$;
grant select on rewards.reward_holds to reward_writer_owner;

-- ---------------------------------------------------------------- award_held_visit (internal): the clearance award, from the FROZEN original day
-- Uses the visit's own policy version, local day, UTC day and ordinal; only the remaining capacity of THAT day; the current
-- enabled/budget gate (both award kinds); never today's policy. Creates its own savepoint-isolated spendable block like P1.
create function rewards.award_held_visit(p_visit uuid, p_decision uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v rewards.visits%rowtype; pol rewards.reward_policy_versions%rowtype; st record; ev record;
  user_issued integer; global_issued integer; got integer;
  s_out text; l_out text; s_pts integer := 0; l_pts integer := 0;
begin
  select * into v from rewards.visits where id = p_visit;
  if v.id is null or v.user_id is null then raise exception 'visit not found or severed' using errcode = 'RW030'; end if;
  if v.spendable_outcome <> 'held' or exists (select 1 from rewards.visit_clearances where visit_id = p_visit) then
    raise exception 'visit is not an unresolved held visit' using errcode = 'RW033';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || v.user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('rewards:uld:' || v.user_id::text || ':' || v.location_id::text || ':' || v.policy_day_local::text, 0));
  select * into pol from rewards.reward_policy_versions where id = v.policy_version_id;
  select rewards_enabled, global_budget_utc_day into st from rewards.reward_settings;
  select coalesce((select spendable from rewards.reward_counters_user_day where user_id = v.user_id and issuance_day_utc = v.issuance_day_utc), 0) into user_issued;
  select coalesce((select spendable from rewards.reward_counters_global_day where issuance_day_utc = v.issuance_day_utc), 0) into global_issued;
  select * into ev from rewards.evaluate_visit(pol.spendable_per_visit, pol.lifetime_first_daily, pol.max_rewarded_per_location_day,
    pol.max_spendable_per_user_utc_day, v.ordinal, user_issued, global_issued, st.rewards_enabled, st.global_budget_utc_day, false);
  s_out := ev.spendable_outcome; l_out := ev.lifetime_outcome;

  if l_out = 'awarded' then
    insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reward_decision_id)
      values ('award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'lifetime', ev.lifetime_points, 'cleared_hold_award', p_decision);
    l_pts := ev.lifetime_points;
  end if;
  if s_out = 'awarded' then
    begin
      insert into rewards.reward_counters_user_day (user_id, issuance_day_utc, spendable)
        select v.user_id, v.issuance_day_utc, pol.spendable_per_visit where pol.spendable_per_visit <= pol.max_spendable_per_user_utc_day
        on conflict (user_id, issuance_day_utc) do update
          set spendable = rewards.reward_counters_user_day.spendable + pol.spendable_per_visit
          where rewards.reward_counters_user_day.spendable + pol.spendable_per_visit <= pol.max_spendable_per_user_utc_day;
      get diagnostics got = row_count;
      if got = 0 then raise exception 'user day cap reached' using errcode = 'RW001'; end if;
      insert into rewards.reward_counters_global_day (issuance_day_utc, spendable)
        select v.issuance_day_utc, pol.spendable_per_visit where pol.spendable_per_visit <= st.global_budget_utc_day
        on conflict (issuance_day_utc) do update
          set spendable = rewards.reward_counters_global_day.spendable + pol.spendable_per_visit
          where rewards.reward_counters_global_day.spendable + pol.spendable_per_visit <= st.global_budget_utc_day;
      get diagnostics got = row_count;
      if got = 0 then raise exception 'global budget exhausted' using errcode = 'RW002'; end if;
      insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reward_decision_id)
        values ('award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'spendable', ev.spendable_points, 'cleared_hold_award', p_decision);
      s_pts := ev.spendable_points;
    exception
      when sqlstate 'RW001' then s_out := 'user_day_cap';
      when sqlstate 'RW002' then s_out := 'budget_exhausted';
    end;
  end if;
  insert into rewards.visit_clearances (visit_id, decision_id, spendable_outcome, lifetime_outcome) values (v.id, p_decision, s_out, l_out);
  return jsonb_build_object('visit_id', v.id, 'spendable_outcome', s_out, 'lifetime_outcome', l_out, 'spendable_points', s_pts, 'lifetime_points', l_pts);
end $$;

-- ---------------------------------------------------------------- admin RPCs (public wrappers; each checks identity, enabled admin and aal2 INSIDE)
-- Owned by the writer, which holds EXECUTE on public.require_admin() and nothing else of the admin schema. No client membership
-- and no direct admin_users access exist anywhere in this file.
create function public.admin_reward_hold_user(p_user uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); did uuid;
begin
  if p_user is null then raise exception 'account required' using errcode = '22023'; end if;
  if p_user = a then raise exception 'administrators cannot adjudicate their own account' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || p_user::text, 0));
  if exists (select 1 from rewards.reward_holds where user_id = p_user and cleared_at is null) then
    raise exception 'the account already has an active hold' using errcode = 'RW031';
  end if;
  insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, reason) values ('hold_user', a, p_user, p_reason) returning id into did;
  insert into rewards.reward_holds (user_id, hold_decision_id) values (p_user, did);
  return did;
end $$;

create function public.admin_reward_clear_hold(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); did uuid; h rewards.reward_holds%rowtype; hv record; r jsonb; n integer := 0; s bigint := 0; l bigint := 0;
begin
  if p_user is null then raise exception 'account required' using errcode = '22023'; end if;
  if p_user = a then raise exception 'administrators cannot adjudicate their own account' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || p_user::text, 0));
  select * into h from rewards.reward_holds where user_id = p_user and cleared_at is null for update;
  if h.id is null then raise exception 'the account has no active hold' using errcode = 'RW032'; end if;
  insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, reason) values ('clear_hold', a, p_user, p_reason) returning id into did;
  update rewards.reward_holds set cleared_decision_id = did, cleared_at = clock_timestamp() where id = h.id;
  -- held visits in a deterministic order, each from its own frozen day
  for hv in select id from rewards.visits
            where user_id = p_user and spendable_outcome = 'held'
              and not exists (select 1 from rewards.visit_clearances c where c.visit_id = visits.id)
            order by location_id, policy_day_local, ordinal, id loop
    r := rewards.award_held_visit(hv.id, did);
    n := n + 1; s := s + (r ->> 'spendable_points')::int; l := l + (r ->> 'lifetime_points')::int;
  end loop;
  return jsonb_build_object('decision_id', did, 'visits_cleared', n, 'spendable_awarded', s, 'lifetime_awarded', l);
end $$;

create function public.admin_reward_recommend_reversal(p_visit uuid, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); u uuid; did uuid;
begin
  select user_id into u from rewards.visits where id = p_visit;
  if u is null then raise exception 'visit not found or its account was deleted' using errcode = 'RW030'; end if;
  if u = a then raise exception 'administrators cannot adjudicate their own account' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || u::text, 0));
  if (select user_id from rewards.visits where id = p_visit) is distinct from u then
    raise exception 'visit not found or its account was deleted' using errcode = 'RW030';
  end if;
  if not exists (select 1 from rewards.reward_ledger a where a.visit_id = p_visit and a.entry_type = 'award'
                   and not exists (select 1 from rewards.reward_ledger r where r.reverses_entry_id = a.id)) then
    raise exception 'the visit has no unreversed award' using errcode = 'RW034';
  end if;
  insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, visit_id, reason)
    values ('recommend_reversal', a, u, p_visit, p_reason) returning id into did;
  return did;
end $$;

create function public.admin_reward_finalize_reversal(p_recommendation uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); rec rewards.reward_decisions%rowtype; fin rewards.reward_decisions%rowtype; o record; did uuid;
        n integer := 0; s bigint := 0; l bigint := 0;
begin
  select * into rec from rewards.reward_decisions where id = p_recommendation and decision_type = 'recommend_reversal';
  if rec.id is null then raise exception 'recommendation not found' using errcode = 'RW035'; end if;
  if rec.subject_user_id is null then raise exception 'the account was deleted' using errcode = 'RW030'; end if;
  if rec.subject_user_id = a then raise exception 'administrators cannot adjudicate their own account' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || rec.subject_user_id::text, 0));
  -- re-read under the lock: the account may have been deleted (severed) while this call waited
  select * into rec from rewards.reward_decisions where id = p_recommendation;
  if rec.subject_user_id is null then raise exception 'the account was deleted' using errcode = 'RW030'; end if;
  -- retry/race: an existing final decision returns the identical result
  select * into fin from rewards.reward_decisions where recommendation_id = p_recommendation and decision_type = 'final_reversal';
  if fin.id is not null then
    select count(*), coalesce(sum(-amount) filter (where kind = 'spendable'), 0), coalesce(sum(-amount) filter (where kind = 'lifetime'), 0)
      into n, s, l from rewards.reward_ledger where reward_decision_id = fin.id and entry_type = 'reversal';
    return jsonb_build_object('decision_id', fin.id, 'replayed', true, 'reversed_entries', n, 'reversed_spendable', s, 'reversed_lifetime', l);
  end if;
  if not exists (select 1 from rewards.reward_ledger a where a.visit_id = rec.visit_id and a.entry_type = 'award'
                   and not exists (select 1 from rewards.reward_ledger r where r.reverses_entry_id = a.id)) then
    raise exception 'the visit has no unreversed award' using errcode = 'RW034';
  end if;
  insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, visit_id, recommendation_id, reason)
    values ('final_reversal', a, rec.subject_user_id, rec.visit_id, rec.id, p_reason) returning id into did;
  for o in select a.id, a.visit_id, a.user_id, a.location_id, a.policy_day_local, a.policy_version_id, a.kind, a.amount from rewards.reward_ledger a
           where a.visit_id = rec.visit_id and a.entry_type = 'award'
             and not exists (select 1 from rewards.reward_ledger r where r.reverses_entry_id = a.id)
           order by a.location_id, a.policy_day_local, a.id loop
    perform pg_advisory_xact_lock(hashtextextended('rewards:uld:' || o.user_id::text || ':' || o.location_id::text || ':' || o.policy_day_local::text, 0));
    insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason,
        reverses_entry_id, reward_decision_id)
      values ('reversal', o.visit_id, o.user_id, o.location_id, o.policy_day_local, o.policy_version_id, o.kind, -o.amount, 'fraud_reversal', o.id, did);
    n := n + 1;
    if o.kind = 'spendable' then s := s + o.amount; else l := l + o.amount; end if;
  end loop;
  return jsonb_build_object('decision_id', did, 'replayed', false, 'reversed_entries', n, 'reversed_spendable', s, 'reversed_lifetime', l);
end $$;

-- ---------------------------------------------------------------- reconciliation (internal; gross issuance never decrements)
create function rewards.reconciliation_report() returns table (
  gross_spendable_counter bigint, ledger_award_spendable bigint, deleted_spendable bigint, drift_spendable bigint,
  reversed_spendable bigint, outstanding_spendable bigint,
  ledger_award_lifetime bigint, deleted_lifetime bigint, reversed_lifetime bigint, outstanding_lifetime bigint)
language sql stable set search_path = '' as $$
  with c as (select coalesce(sum(spendable), 0)::bigint as g from rewards.reward_counters_global_day),
       l as (select coalesce(sum(amount) filter (where entry_type = 'award' and kind = 'spendable'), 0)::bigint as a_s,
                    coalesce(sum(-amount) filter (where entry_type = 'reversal' and kind = 'spendable'), 0)::bigint as r_s,
                    coalesce(sum(amount) filter (where entry_type = 'award' and kind = 'lifetime'), 0)::bigint as a_l,
                    coalesce(sum(-amount) filter (where entry_type = 'reversal' and kind = 'lifetime'), 0)::bigint as r_l
             from rewards.reward_ledger),
       d as (select coalesce(sum(deleted_spendable), 0)::bigint as s, coalesce(sum(deleted_lifetime), 0)::bigint as l
             from rewards.reward_deleted_aggregate_month)
  select c.g, l.a_s, d.s, c.g - l.a_s - d.s, l.r_s, l.a_s - l.r_s, l.a_l, d.l, l.r_l, l.a_l - l.r_l from c, l, d
$$;

-- ---------------------------------------------------------------- approved provisional retention: cleared holds expire 90 days after clearance
-- The guard on reward_holds is the rule; this function only asks for it. Nothing schedules it (no new service).
create function rewards.expire_cleared_holds() returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  delete from rewards.reward_holds where cleared_at is not null and cleared_at <= clock_timestamp() - interval '90 days';
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------- the ONE purge authority (owner reward_purge_owner)
-- Subject = auth.uid() (never a parameter, never a GUC flag). Lock the deterministic row sets first, partition, then act only on
-- what DELETE ... RETURNING removed: unmoderated visits and their awards are deleted and counted in the month-keyed anonymous
-- aggregate; retained evidence (held, decided, cleared or reversed visits with all their ledger rows) is KEPT TOGETHER and only
-- severed from the account. Nothing is inserted into visits or the ledger.
create function rewards.purge_my_reward_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); keep uuid[]; n_l bigint := 0; n_v bigint := 0; n_c bigint; n_sv bigint; n_sl bigint; n_sd bigint; n_sh bigint;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || uid::text, 0));
  perform 1 from rewards.visits where user_id = uid order by id for update;
  perform 1 from rewards.reward_ledger where user_id = uid order by id for update;
  select coalesce(array_agg(v.id order by v.id), '{}') into keep from rewards.visits v where v.user_id = uid and rewards.visit_is_retained(v.id);

  with gone as (
    delete from rewards.reward_ledger l using rewards.visits v
      where l.user_id = uid and l.visit_id = v.id and v.id <> all (keep)
      returning date_trunc('month', v.issuance_day_utc)::date as m, l.kind, l.amount),
  agg as (
    select m, coalesce(sum(amount) filter (where kind = 'spendable'), 0) as s, coalesce(sum(amount) filter (where kind = 'lifetime'), 0) as l
    from gone group by m),
  up as (
    insert into rewards.reward_deleted_aggregate_month (month_utc, deleted_spendable, deleted_lifetime)
      select m, s, l from agg
      on conflict (month_utc) do update set deleted_spendable = rewards.reward_deleted_aggregate_month.deleted_spendable + excluded.deleted_spendable,
        deleted_lifetime = rewards.reward_deleted_aggregate_month.deleted_lifetime + excluded.deleted_lifetime
      returning 1)
  select (select count(*) from gone) into n_l;

  with gone as (
    delete from rewards.visits v where v.user_id = uid and v.id <> all (keep)
      returning date_trunc('month', v.issuance_day_utc)::date as m),
  agg as (select m, count(*) as n from gone group by m),
  up as (
    insert into rewards.reward_deleted_aggregate_month (month_utc, deleted_visits)
      select m, n from agg
      on conflict (month_utc) do update set deleted_visits = rewards.reward_deleted_aggregate_month.deleted_visits + excluded.deleted_visits
      returning 1)
  select (select count(*) from gone) into n_v;

  update rewards.reward_ledger set user_id = null where user_id = uid;                       get diagnostics n_sl = row_count;
  update rewards.visits set user_id = null, idempotency_key = null, accuracy_bucket = null, distance_bucket = null where user_id = uid;
                                                                                              get diagnostics n_sv = row_count;
  update rewards.reward_decisions set subject_user_id = null where subject_user_id = uid;    get diagnostics n_sd = row_count;
  update rewards.reward_holds set user_id = null where user_id = uid;                        get diagnostics n_sh = row_count;
  delete from rewards.reward_counters_user_day where user_id = uid;                          get diagnostics n_c = row_count;
  return jsonb_build_object('deleted_ledger_rows', n_l, 'deleted_visits', n_v, 'severed_visits', n_sv, 'severed_ledger_rows', n_sl,
    'severed_decisions', n_sd, 'severed_holds', n_sh, 'deleted_user_counters', n_c);
end $$;

-- ---------------------------------------------------------------- replacement public.delete_my_account (baseline: moderation_core.sql, all non-rewards behavior unchanged)
create or replace function public.delete_my_account(p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'confirmation required' using errcode = '22023'; end if;
  if exists (select 1 from public.admin_users a where a.user_id = uid and a.disabled_at is null) then
    raise exception 'administrator accounts must be disabled by the owner before deletion' using errcode = '42501';
  end if;
  delete from public.submissions s
    where s.user_id = uid and s.status = 'pending' and s.held_at is null
      and not exists (select 1 from public.moderation_decisions d where d.submission_id = s.id);
  delete from public.reports where user_id = uid and status = 'open';
  perform rewards.purge_my_reward_data();
  delete from auth.users where id = uid;
end;
$$;

-- ---------------------------------------------------------------- ownership and privileges (enumerated, not inferred)
revoke all on function rewards.award_held_visit(uuid, uuid), rewards.reconciliation_report(), rewards.expire_cleared_holds(),
  rewards.purge_my_reward_data()
  from public, anon, authenticated, service_role;
revoke all on function public.admin_reward_hold_user(uuid, text), public.admin_reward_clear_hold(uuid, text),
  public.admin_reward_recommend_reversal(uuid, text), public.admin_reward_finalize_reversal(uuid, text)
  from public, anon, authenticated, service_role;

grant create on schema rewards to reward_writer_owner, reward_purge_owner;
grant create on schema public to reward_writer_owner;
alter function rewards.award_held_visit(uuid, uuid) owner to reward_writer_owner;
alter function rewards.reconciliation_report() owner to reward_writer_owner;
alter function rewards.expire_cleared_holds() owner to reward_writer_owner;
alter function public.admin_reward_hold_user(uuid, text) owner to reward_writer_owner;
alter function public.admin_reward_clear_hold(uuid, text) owner to reward_writer_owner;
alter function public.admin_reward_recommend_reversal(uuid, text) owner to reward_writer_owner;
alter function public.admin_reward_finalize_reversal(uuid, text) owner to reward_writer_owner;
alter function rewards.purge_my_reward_data() owner to reward_purge_owner;
revoke create on schema rewards from reward_writer_owner, reward_purge_owner;
revoke create on schema public from reward_writer_owner;

-- The writer (only) may call the existing admin gate; require_admin stays revoked from every client role.
grant execute on function public.require_admin() to reward_writer_owner;
grant execute on function rewards.award_held_visit(uuid, uuid) to reward_writer_owner;
grant execute on function public.admin_reward_hold_user(uuid, text), public.admin_reward_clear_hold(uuid, text),
  public.admin_reward_recommend_reversal(uuid, text), public.admin_reward_finalize_reversal(uuid, text) to authenticated;

-- The purge function is executable only by the owner of public.delete_my_account (the existing account-deletion path).
do $$
declare o name;
begin
  select pg_get_userbyid(p.proowner) into strict o from pg_proc p where p.oid = 'public.delete_my_account(text)'::regprocedure;
  execute format('grant usage on schema rewards to %I', o);
  execute format('grant execute on function rewards.purge_my_reward_data() to %I', o);
end $$;
