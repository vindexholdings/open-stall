-- R003: visits, the append-only ledger (disjoint lifetime and spendable awards) and the gross-issuance counters.

-- ---------------------------------------------------------------- visits
-- One row per accepted visit. The client coordinates are checked against 150 m by record_visit and DISCARDED: only a
-- coarse distance bucket and an optional accuracy bucket are kept. No device identifier of any kind is stored.
create table rewards.visits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  idempotency_key text not null check (idempotency_key ~ '^[A-Za-z0-9_-]{16,64}$'),
  occurred_at timestamptz not null,
  policy_version_id bigint not null references rewards.reward_policy_versions (id),
  settings_history_id bigint not null references rewards.reward_settings_history (id),
  time_zone text,
  policy_day_local date,
  issuance_day_utc date not null,
  ordinal integer check (ordinal is null or ordinal >= 1),
  distance_bucket text not null check (distance_bucket in ('within_50', 'within_100', 'within_150')),
  accuracy_bucket text check (accuracy_bucket is null or accuracy_bucket in ('within_25', 'within_50', 'over_50')),
  spendable_outcome text not null check (spendable_outcome in
    ('awarded', 'location_cap', 'user_day_cap', 'budget_exhausted', 'budget_unset', 'rewards_disabled', 'held', 'no_valid_time_zone')),
  lifetime_outcome text not null check (lifetime_outcome in
    ('awarded', 'not_first_daily', 'rewards_disabled', 'held', 'no_valid_time_zone')),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, idempotency_key),
  -- A location without a valid zone is recorded but gets no day, no ordinal and no award; otherwise all three exist.
  check (
    (time_zone is null and policy_day_local is null and ordinal is null
       and spendable_outcome = 'no_valid_time_zone' and lifetime_outcome = 'no_valid_time_zone')
    or
    (time_zone is not null and policy_day_local is not null and ordinal is not null
       and spendable_outcome <> 'no_valid_time_zone' and lifetime_outcome <> 'no_valid_time_zone')
  )
);
create index visits_user_location_day_idx on rewards.visits (user_id, location_id, policy_day_local);
create index visits_user_idx on rewards.visits (user_id, occurred_at desc);

-- MUTABLE:visits_append_only begin
create trigger visits_append_only before update or delete on rewards.visits
  for each row execute function rewards.guard_append_only();
-- MUTABLE:visits_append_only end
create trigger visits_no_truncate before truncate on rewards.visits
  for each statement execute function rewards.guard_truncate();

-- ---------------------------------------------------------------- ledger
-- Awards only in P1. The reversal columns exist so the P2 interface is fixed (see VIP_REWARDS_PLAN.md section 4), but
-- ledger_insert_guard refuses any reversal row until P2 is separately authorized.
create table rewards.reward_ledger (
  id uuid primary key default gen_random_uuid(),
  entry_type text not null check (entry_type in ('award', 'reversal')),
  visit_id uuid not null references rewards.visits (id) on delete restrict deferrable initially deferred,
  user_id uuid not null references auth.users (id) on delete restrict,
  location_id uuid not null references public.locations (id) on delete restrict,
  policy_day_local date not null,
  policy_version_id bigint not null references rewards.reward_policy_versions (id),
  kind text not null check (kind in ('spendable', 'lifetime')),
  amount integer not null,
  reason text not null check (char_length(reason) between 1 and 64),
  reverses_entry_id uuid references rewards.reward_ledger (id) on delete restrict,
  moderation_decision_id uuid references public.moderation_decisions (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (entry_type = 'award' and amount > 0 and reverses_entry_id is null and moderation_decision_id is null)
    or
    (entry_type = 'reversal' and amount < 0 and reverses_entry_id is not null and moderation_decision_id is not null)
  )
);
-- Awards and (later) reversals are idempotent separately.
-- MUTABLE:award_unique_index begin
create unique index reward_ledger_one_award_per_visit_kind on rewards.reward_ledger (visit_id, kind) where entry_type = 'award';
-- MUTABLE:award_unique_index end
create unique index reward_ledger_one_reversal_per_entry on rewards.reward_ledger (reverses_entry_id) where reverses_entry_id is not null;
-- Exactly one lifetime award per user/location/local day, even under races.
-- MUTABLE:lifetime_unique_index begin
create unique index reward_ledger_one_lifetime_per_user_location_day
  on rewards.reward_ledger (user_id, location_id, policy_day_local) where kind = 'lifetime' and entry_type = 'award';
-- MUTABLE:lifetime_unique_index end
create index reward_ledger_user_kind_idx on rewards.reward_ledger (user_id, kind);

-- MUTABLE:ledger_append_only begin
create trigger reward_ledger_append_only before update or delete on rewards.reward_ledger
  for each row execute function rewards.guard_append_only();
-- MUTABLE:ledger_append_only end
-- MUTABLE:truncate_guard begin
create trigger reward_ledger_no_truncate before truncate on rewards.reward_ledger
  for each statement execute function rewards.guard_truncate();
-- MUTABLE:truncate_guard end

-- Defense in depth for the production safety gate, independent of the pure evaluation: no award row can be written
-- while rewards are disabled, and no spendable award while the global budget is unset. P1 writes awards only.
create function rewards.ledger_insert_guard() returns trigger
language plpgsql set search_path = '' as $$
declare s record;
begin
  if new.entry_type <> 'award' then
    raise exception 'reversals are not part of P1' using errcode = '0A000';
  end if;
  -- MUTABLE:ledger_safety_gate begin
  select rewards_enabled, global_budget_utc_day into s from rewards.reward_settings;
  if s.rewards_enabled is not true then
    raise exception 'rewards are disabled: no award can be written' using errcode = 'RW010';
  end if;
  if new.kind = 'spendable' and s.global_budget_utc_day is null then
    raise exception 'the global budget is unset: no spendable award can be written' using errcode = 'RW011';
  end if;
  -- MUTABLE:ledger_safety_gate end
  return new;
end $$;
create trigger reward_ledger_insert_guard before insert on rewards.reward_ledger
  for each row execute function rewards.ledger_insert_guard();

-- A visit and its ledger rows must agree at commit: an `awarded` outcome has exactly its ledger row and a ledger row
-- exists only for an `awarded` outcome. Checked deferred, because the ledger rows are written before the visit row.
-- SECURITY DEFINER (owned by the writer, see R004) is REQUIRED here: a deferred trigger runs at COMMIT as the session's
-- current role, which for a client call is `authenticated` and has no access to this schema. (Found by the two-session tests.)
create function rewards.check_visit_ledger_consistency() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v rewards.visits%rowtype; vid uuid; n_s integer; n_l integer;
begin
  if tg_table_name = 'visits' then vid := new.id; else vid := new.visit_id; end if;
  select * into v from rewards.visits where id = vid;
  if v.id is null then
    raise exception 'ledger rows without a visit' using errcode = '23503';
  end if;
  select count(*) filter (where kind = 'spendable'), count(*) filter (where kind = 'lifetime')
    into n_s, n_l from rewards.reward_ledger where visit_id = vid and entry_type = 'award';
  if (v.spendable_outcome = 'awarded') <> (n_s = 1) or n_s > 1 or (v.lifetime_outcome = 'awarded') <> (n_l = 1) or n_l > 1 then
    raise exception 'visit outcomes and ledger awards disagree for visit %', vid using errcode = '23514';
  end if;
  return null;
end $$;
-- MUTABLE:deferred_consistency begin
create constraint trigger visits_ledger_consistent_v after insert on rewards.visits
  deferrable initially deferred for each row execute function rewards.check_visit_ledger_consistency();
create constraint trigger visits_ledger_consistent_l after insert on rewards.reward_ledger
  deferrable initially deferred for each row execute function rewards.check_visit_ledger_consistency();
-- MUTABLE:deferred_consistency end

-- ---------------------------------------------------------------- gross-issuance counters
-- SPENDABLE issuance only (no lifetime field, no reversal field). A counter never decreases and is never deleted in P1.
create table rewards.reward_counters_user_day (
  user_id uuid not null references auth.users (id) on delete restrict,
  issuance_day_utc date not null,
  spendable integer not null check (spendable >= 0),
  primary key (user_id, issuance_day_utc)
);
create table rewards.reward_counters_global_day (
  issuance_day_utc date primary key,
  spendable integer not null check (spendable >= 0)
);

create function rewards.guard_counter_monotonic() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'rewards.% rows are never deleted in P1', tg_table_name using errcode = '42501';
  end if;
  -- MUTABLE:counter_monotonic begin
  if new.spendable < old.spendable then
    raise exception 'rewards.% counts gross issuance and never decreases', tg_table_name using errcode = '42501';
  end if;
  -- MUTABLE:counter_monotonic end
  if new.issuance_day_utc <> old.issuance_day_utc then
    raise exception 'rewards.% keys are immutable', tg_table_name using errcode = '42501';
  end if;
  if tg_table_name = 'reward_counters_user_day' then
    if to_jsonb(new) ->> 'user_id' <> to_jsonb(old) ->> 'user_id' then
      raise exception 'rewards.% keys are immutable', tg_table_name using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
create trigger reward_counters_user_day_guard before update or delete on rewards.reward_counters_user_day
  for each row execute function rewards.guard_counter_monotonic();
create trigger reward_counters_global_day_guard before update or delete on rewards.reward_counters_global_day
  for each row execute function rewards.guard_counter_monotonic();
create trigger reward_counters_user_day_no_truncate before truncate on rewards.reward_counters_user_day
  for each statement execute function rewards.guard_truncate();
create trigger reward_counters_global_day_no_truncate before truncate on rewards.reward_counters_global_day
  for each statement execute function rewards.guard_truncate();

-- ---------------------------------------------------------------- privileges, RLS (enabled AND forced), explicit policies
alter table rewards.visits enable row level security;
alter table rewards.visits force row level security;
alter table rewards.reward_ledger enable row level security;
alter table rewards.reward_ledger force row level security;
alter table rewards.reward_counters_user_day enable row level security;
alter table rewards.reward_counters_user_day force row level security;
alter table rewards.reward_counters_global_day enable row level security;
alter table rewards.reward_counters_global_day force row level security;

revoke all on rewards.visits, rewards.reward_ledger, rewards.reward_counters_user_day, rewards.reward_counters_global_day
  from public, anon, authenticated, service_role;
grant select, insert on rewards.visits to reward_writer_owner;
grant select, insert on rewards.reward_ledger to reward_writer_owner;
grant select, insert, update on rewards.reward_counters_user_day, rewards.reward_counters_global_day to reward_writer_owner;

create policy writer_reads_visits on rewards.visits for select to reward_writer_owner using (true);
create policy writer_inserts_visits on rewards.visits for insert to reward_writer_owner with check (true);
create policy writer_reads_ledger on rewards.reward_ledger for select to reward_writer_owner using (true);
create policy writer_inserts_ledger on rewards.reward_ledger for insert to reward_writer_owner with check (true);
create policy writer_reads_user_counters on rewards.reward_counters_user_day for select to reward_writer_owner using (true);
create policy writer_inserts_user_counters on rewards.reward_counters_user_day for insert to reward_writer_owner with check (true);
create policy writer_updates_user_counters on rewards.reward_counters_user_day for update to reward_writer_owner using (true) with check (true);
create policy writer_reads_global_counters on rewards.reward_counters_global_day for select to reward_writer_owner using (true);
create policy writer_inserts_global_counters on rewards.reward_counters_global_day for insert to reward_writer_owner with check (true);
create policy writer_updates_global_counters on rewards.reward_counters_global_day for update to reward_writer_owner using (true) with check (true);
