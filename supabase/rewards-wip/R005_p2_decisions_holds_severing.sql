-- P2 (rewards lifecycle, local, disposable PostgreSQL 16 only). SOURCE ONLY, same rules as R001-R004.
-- R001-R004 stay byte-for-byte as accepted in P1; every P2 change to a P1 object is made here, additively.
--
-- R005: purge role, immutable reward decisions, holds, hold clearances, the anonymous deleted-aggregate table, the nullable
-- identity columns that make severing possible, and every guard that decides who may change what (all keyed on current_user).

-- ---------------------------------------------------------------- purge role (owns exactly ONE function, see R006)
create role reward_purge_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;
grant reward_purge_owner to current_user;
grant usage on schema rewards to reward_purge_owner;
grant usage on schema auth to reward_purge_owner;   -- auth.uid() only

-- ---------------------------------------------------------------- reward decisions (immutable audit; not exposed)
-- Same identity/MFA/audit pattern as public.moderation_decisions, kept in the private schema because public.moderation_log
-- accepts only submission/report/location targets and P2 must not change existing moderation tables.
create table rewards.reward_decisions (
  id uuid primary key default gen_random_uuid(),
  decision_type text not null check (decision_type in ('hold_user', 'clear_hold', 'recommend_reversal', 'final_reversal')),
  admin_id uuid not null references auth.users (id) on delete restrict,
  -- NULL only after the subject deleted their account (identity severing); the row itself is permanent audit.
  subject_user_id uuid references auth.users (id) on delete restrict,
  visit_id uuid references rewards.visits (id) on delete restrict,
  recommendation_id uuid references rewards.reward_decisions (id) on delete restrict,
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  created_at timestamptz not null default clock_timestamp(),
  constraint reward_decisions_shape check (
    (decision_type in ('hold_user', 'clear_hold') and visit_id is null and recommendation_id is null)
    or (decision_type = 'recommend_reversal' and visit_id is not null and recommendation_id is null)
    or (decision_type = 'final_reversal' and visit_id is not null and recommendation_id is not null)
  ),
  -- Nobody adjudicates their own account.
  constraint reward_decisions_no_self_adjudication check (subject_user_id is null or subject_user_id <> admin_id)
);
create unique index reward_decisions_one_final_per_recommendation on rewards.reward_decisions (recommendation_id)
  where decision_type = 'final_reversal';
create index reward_decisions_visit_idx on rewards.reward_decisions (visit_id) where visit_id is not null;
create index reward_decisions_subject_idx on rewards.reward_decisions (subject_user_id) where subject_user_id is not null;

-- ---------------------------------------------------------------- holds (a per-account flag; creates no capacity reservation)
create table rewards.reward_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete restrict,
  hold_decision_id uuid not null unique references rewards.reward_decisions (id) on delete restrict,
  placed_at timestamptz not null default clock_timestamp(),
  cleared_decision_id uuid unique references rewards.reward_decisions (id) on delete restrict,
  cleared_at timestamptz,
  check ((cleared_decision_id is null) = (cleared_at is null))
);
-- At most one active hold per account.
create unique index reward_holds_one_active_per_user on rewards.reward_holds (user_id) where cleared_at is null and user_id is not null;
create index reward_holds_user_idx on rewards.reward_holds (user_id) where user_id is not null;

-- ---------------------------------------------------------------- hold clearances (the immutable outcome of one held visit)
-- visits is append-only, so a held visit keeps outcome 'held' forever; its award (or refusal) at clearance is recorded here.
create table rewards.visit_clearances (
  visit_id uuid primary key references rewards.visits (id) on delete restrict,
  decision_id uuid not null references rewards.reward_decisions (id) on delete restrict,
  spendable_outcome text not null check (spendable_outcome in
    ('awarded', 'location_cap', 'user_day_cap', 'budget_exhausted', 'budget_unset', 'rewards_disabled')),
  lifetime_outcome text not null check (lifetime_outcome in ('awarded', 'not_first_daily', 'rewards_disabled')),
  created_at timestamptz not null default clock_timestamp()
);

-- ---------------------------------------------------------------- anonymous deleted aggregate (month-keyed, no identity)
-- Receives ONLY what an account purge actually removed (DELETE ... RETURNING). Never receives a retained row.
create table rewards.reward_deleted_aggregate_month (
  month_utc date primary key check (month_utc = date_trunc('month', month_utc)::date),
  deleted_visits bigint not null default 0 check (deleted_visits >= 0),
  deleted_spendable bigint not null default 0 check (deleted_spendable >= 0),
  deleted_lifetime bigint not null default 0 check (deleted_lifetime >= 0)
);

-- ---------------------------------------------------------------- P1 tables: nullable identity columns and the reversal shape
alter table rewards.visits
  alter column user_id drop not null,
  alter column idempotency_key drop not null,
  alter column distance_bucket drop not null;
alter table rewards.visits add constraint visits_severed_together check (
  (user_id is not null and idempotency_key is not null and distance_bucket is not null)
  or (user_id is null and idempotency_key is null and distance_bucket is null and accuracy_bucket is null));
alter table rewards.reward_ledger alter column user_id drop not null;
alter table rewards.reward_ledger add column reward_decision_id uuid references rewards.reward_decisions (id) on delete restrict;
do $$
declare c record;
begin
  for c in select conname from pg_constraint
           where conrelid = 'rewards.reward_ledger'::regclass and contype = 'c'
             and pg_get_constraintdef(oid) like '%reverses_entry_id IS NOT NULL%' loop
    execute format('alter table rewards.reward_ledger drop constraint %I', c.conname);
  end loop;
end $$;
-- The P1 foreign key to public.moderation_decisions made TRUNCATE on that existing table fail earlier (0A000 instead of its own 55000
-- append-only guard). Rewards never use that column (the check below keeps it NULL), so the dependency is dropped and the existing
-- moderation behavior is restored exactly.
do $$
declare c record;
begin
  for c in select conname from pg_constraint where conrelid = 'rewards.reward_ledger'::regclass and contype = 'f'
             and confrelid = 'public.moderation_decisions'::regclass loop
    execute format('alter table rewards.reward_ledger drop constraint %I', c.conname);
  end loop;
end $$;
alter table rewards.reward_ledger add constraint reward_ledger_entry_shape check (
  (entry_type = 'award' and amount > 0 and reverses_entry_id is null and moderation_decision_id is null
     and ((reward_decision_id is null) or reason = 'cleared_hold_award'))
  or
  (entry_type = 'reversal' and amount < 0 and reverses_entry_id is not null and moderation_decision_id is null
     and reward_decision_id is not null and reason = 'fraud_reversal'));
-- exactly one pair of columns identifies a moderated reversal; the legacy moderation_decision_id column is never used for rewards.

-- ---------------------------------------------------------------- the retained-evidence predicate (invoker; used by guards and purge)
-- A visit is retained evidence when it was ever held, has a recorded decision, a clearance, or a reversal on any of its entries.
-- Retained visits and their ledger rows are kept TOGETHER and only severed from the account on deletion.
create function rewards.visit_is_retained(p_visit uuid) returns boolean
language sql stable set search_path = '' as $$
  select exists (select 1 from rewards.visits v where v.id = p_visit and 'held' in (v.spendable_outcome, v.lifetime_outcome))
      or exists (select 1 from rewards.reward_decisions d where d.visit_id = p_visit)
      or exists (select 1 from rewards.visit_clearances c where c.visit_id = p_visit)
      or exists (select 1 from rewards.reward_ledger l where l.visit_id = p_visit and l.entry_type = 'reversal')
$$;

-- ---------------------------------------------------------------- guards (SECURITY INVOKER, decided by current_user)
-- Replace the P1 blanket append-only triggers on visits and ledger. Everything is still refused for every role except the
-- purge owner, and the purge owner may do only the two narrow things below, each re-validated here.
drop trigger visits_append_only on rewards.visits;
drop trigger reward_ledger_append_only on rewards.reward_ledger;

create function rewards.guard_visits_change() returns trigger
language plpgsql set search_path = '' as $$
declare sever text[] := array['user_id', 'idempotency_key', 'accuracy_bucket', 'distance_bucket'];
begin
  -- MUTABLE:p2_visits_guard begin
  if current_user = 'reward_purge_owner' and auth.uid() is not null and old.user_id is not distinct from auth.uid() then
    if tg_op = 'DELETE' then
      -- only unmoderated visits of the subject; retained evidence is never deleted
      if rewards.visit_is_retained(old.id) then
        raise exception 'rewards.visits: retained evidence cannot be deleted' using errcode = '42501';
      end if;
      return old;
    end if;
    -- UPDATE: validated nulling of exactly the approved identity/signal/idempotency columns, nothing else changes
    if new.user_id is not null or new.idempotency_key is not null or new.accuracy_bucket is not null or new.distance_bucket is not null
       or (to_jsonb(new) - sever) <> (to_jsonb(old) - sever) then
      raise exception 'rewards.visits: only severing of identity, signal and idempotency columns is allowed' using errcode = '42501';
    end if;
    return new;
  end if;
  -- MUTABLE:p2_visits_guard end
  raise exception 'rewards.visits is append-only (% refused for %)', tg_op, current_user using errcode = '42501';
end $$;
create trigger visits_append_only before update or delete on rewards.visits
  for each row execute function rewards.guard_visits_change();

create function rewards.guard_ledger_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- MUTABLE:p2_ledger_guard begin
  if current_user = 'reward_purge_owner' and auth.uid() is not null and old.user_id is not distinct from auth.uid() then
    if tg_op = 'DELETE' then
      if old.entry_type <> 'award' or rewards.visit_is_retained(old.visit_id) then
        raise exception 'rewards.reward_ledger: retained evidence cannot be deleted' using errcode = '42501';
      end if;
      return old;
    end if;
    if new.user_id is not null or (to_jsonb(new) - 'user_id') <> (to_jsonb(old) - 'user_id') then
      raise exception 'rewards.reward_ledger: only severing user_id is allowed' using errcode = '42501';
    end if;
    return new;
  end if;
  -- MUTABLE:p2_ledger_guard end
  raise exception 'rewards.reward_ledger is append-only (% refused for %)', tg_op, current_user using errcode = '42501';
end $$;
create trigger reward_ledger_append_only before update or delete on rewards.reward_ledger
  for each row execute function rewards.guard_ledger_change();

create function rewards.guard_decisions_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_user = 'reward_purge_owner' and auth.uid() is not null
     and old.subject_user_id is not distinct from auth.uid() and new.subject_user_id is null
     and (to_jsonb(new) - 'subject_user_id') = (to_jsonb(old) - 'subject_user_id') then
    return new;
  end if;
  raise exception 'rewards.reward_decisions is append-only (% refused for %)', tg_op, current_user using errcode = '42501';
end $$;
create trigger reward_decisions_append_only before update or delete on rewards.reward_decisions
  for each row execute function rewards.guard_decisions_change();

-- Hold rows: the writer may clear an active hold exactly once; the purge owner may sever the account; and ONLY a hold cleared
-- more than 90 days ago (the approved provisional retention rule) may be deleted, by anyone. There is no other deletion path.
create function rewards.guard_holds_change() returns trigger
language plpgsql set search_path = '' as $$
declare d rewards.reward_decisions%rowtype;
begin
  if tg_op = 'DELETE' then
    -- MUTABLE:p2_hold_expiry begin
    if old.cleared_at is not null and old.cleared_at <= clock_timestamp() - interval '90 days' then
      return old;
    end if;
    -- MUTABLE:p2_hold_expiry end
    raise exception 'rewards.reward_holds: only a hold cleared more than 90 days ago may be deleted' using errcode = '42501';
  end if;
  if current_user = 'reward_purge_owner' and auth.uid() is not null and old.user_id is not distinct from auth.uid()
     and new.user_id is null and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
    return new;
  end if;
  if current_user = 'reward_writer_owner' and old.cleared_at is null and new.cleared_decision_id is not null and new.cleared_at is not null
     and (to_jsonb(new) - array['cleared_decision_id', 'cleared_at']) = (to_jsonb(old) - array['cleared_decision_id', 'cleared_at']) then
    select * into d from rewards.reward_decisions where id = new.cleared_decision_id;
    if d.decision_type = 'clear_hold' and d.subject_user_id is not distinct from old.user_id then return new; end if;
  end if;
  raise exception 'rewards.reward_holds is append-only except one valid clearance (% refused for %)', tg_op, current_user using errcode = '42501';
end $$;
create trigger reward_holds_guard before update or delete on rewards.reward_holds
  for each row execute function rewards.guard_holds_change();

create trigger visit_clearances_append_only before update or delete on rewards.visit_clearances
  for each row execute function rewards.guard_append_only();

create function rewards.guard_aggregate_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and current_user = 'reward_purge_owner' and new.month_utc = old.month_utc
     and new.deleted_visits >= old.deleted_visits and new.deleted_spendable >= old.deleted_spendable
     and new.deleted_lifetime >= old.deleted_lifetime then
    return new;
  end if;
  raise exception 'rewards.reward_deleted_aggregate_month only grows (% refused for %)', tg_op, current_user using errcode = '42501';
end $$;
create trigger reward_deleted_aggregate_guard before update or delete on rewards.reward_deleted_aggregate_month
  for each row execute function rewards.guard_aggregate_change();

-- Counters: gross issuance still never decreases and the global counter is never deleted. The only new capability is deleting a
-- DELETED account's own per-user rows, by the purge owner, for the auth.uid subject.
create or replace function rewards.guard_counter_monotonic() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'reward_counters_user_day' and current_user = 'reward_purge_owner' and auth.uid() is not null
       and (to_jsonb(old) ->> 'user_id')::uuid = auth.uid() then
      return old;
    end if;
    raise exception 'rewards.% rows are never deleted (refused for %)', tg_table_name, current_user using errcode = '42501';
  end if;
  if new.spendable < old.spendable then
    raise exception 'rewards.% counts gross issuance and never decreases', tg_table_name using errcode = '42501';
  end if;
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

-- ---------------------------------------------------------------- decision-chain validation (independent admin for finals)
create function rewards.decisions_validate() returns trigger
language plpgsql set search_path = '' as $$
declare r rewards.reward_decisions%rowtype; v rewards.visits%rowtype;
begin
  if new.decision_type = 'recommend_reversal' then
    select * into v from rewards.visits where id = new.visit_id;
    if v.id is null or v.user_id is null or new.subject_user_id is distinct from v.user_id then
      raise exception 'a reversal recommendation must name the visit and its own account' using errcode = '23514';
    end if;
  elsif new.decision_type = 'final_reversal' then
    select * into r from rewards.reward_decisions where id = new.recommendation_id;
    -- MUTABLE:p2_independent_admin begin
    if r.id is null or r.decision_type <> 'recommend_reversal' or r.visit_id is distinct from new.visit_id
       or r.subject_user_id is distinct from new.subject_user_id or r.admin_id = new.admin_id then
      raise exception 'a final reversal needs a matching recommendation by a DIFFERENT administrator' using errcode = '23514';
    end if;
    -- MUTABLE:p2_independent_admin end
  elsif new.subject_user_id is null then
    raise exception 'a hold decision must name its account' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger reward_decisions_validate before insert on rewards.reward_decisions
  for each row execute function rewards.decisions_validate();

-- ---------------------------------------------------------------- truncate guards, RLS (enabled AND forced), explicit privileges and policies
create trigger reward_decisions_no_truncate before truncate on rewards.reward_decisions for each statement execute function rewards.guard_truncate();
create trigger reward_holds_no_truncate before truncate on rewards.reward_holds for each statement execute function rewards.guard_truncate();
create trigger visit_clearances_no_truncate before truncate on rewards.visit_clearances for each statement execute function rewards.guard_truncate();
create trigger reward_deleted_aggregate_no_truncate before truncate on rewards.reward_deleted_aggregate_month for each statement execute function rewards.guard_truncate();

alter table rewards.reward_decisions enable row level security;
alter table rewards.reward_decisions force row level security;
alter table rewards.reward_holds enable row level security;
alter table rewards.reward_holds force row level security;
alter table rewards.visit_clearances enable row level security;
alter table rewards.visit_clearances force row level security;
alter table rewards.reward_deleted_aggregate_month enable row level security;
alter table rewards.reward_deleted_aggregate_month force row level security;

revoke all on rewards.reward_decisions, rewards.reward_holds, rewards.visit_clearances, rewards.reward_deleted_aggregate_month
  from public, anon, authenticated, service_role;

-- writer: records decisions, holds, clearances, ledger rows; reads the aggregate for reconciliation
grant select, insert on rewards.reward_decisions, rewards.visit_clearances to reward_writer_owner;
grant select, insert, delete on rewards.reward_holds to reward_writer_owner;
grant update (cleared_decision_id, cleared_at) on rewards.reward_holds to reward_writer_owner;
grant select on rewards.reward_deleted_aggregate_month to reward_writer_owner;
-- purge owner: the narrowest set the purge function needs (no INSERT into visits or the ledger)
grant select on rewards.visits, rewards.reward_ledger, rewards.reward_decisions, rewards.reward_holds, rewards.visit_clearances,
  rewards.reward_counters_user_day to reward_purge_owner;
grant delete on rewards.visits, rewards.reward_ledger, rewards.reward_counters_user_day to reward_purge_owner;
grant update (user_id, idempotency_key, accuracy_bucket, distance_bucket) on rewards.visits to reward_purge_owner;
grant update (user_id) on rewards.reward_ledger, rewards.reward_holds to reward_purge_owner;
grant update (subject_user_id) on rewards.reward_decisions to reward_purge_owner;
grant select, insert, update on rewards.reward_deleted_aggregate_month to reward_purge_owner;

create policy writer_reads_decisions on rewards.reward_decisions for select to reward_writer_owner using (true);
create policy writer_inserts_decisions on rewards.reward_decisions for insert to reward_writer_owner with check (true);
create policy writer_reads_holds on rewards.reward_holds for select to reward_writer_owner using (true);
create policy writer_inserts_holds on rewards.reward_holds for insert to reward_writer_owner with check (true);
create policy writer_updates_holds on rewards.reward_holds for update to reward_writer_owner using (true) with check (true);
create policy writer_deletes_holds on rewards.reward_holds for delete to reward_writer_owner using (true);
create policy writer_reads_clearances on rewards.visit_clearances for select to reward_writer_owner using (true);
create policy writer_inserts_clearances on rewards.visit_clearances for insert to reward_writer_owner with check (true);
create policy writer_reads_aggregate on rewards.reward_deleted_aggregate_month for select to reward_writer_owner using (true);

create policy purge_reads_visits on rewards.visits for select to reward_purge_owner using (true);
create policy purge_updates_visits on rewards.visits for update to reward_purge_owner using (true) with check (true);
create policy purge_deletes_visits on rewards.visits for delete to reward_purge_owner using (true);
create policy purge_reads_ledger on rewards.reward_ledger for select to reward_purge_owner using (true);
create policy purge_updates_ledger on rewards.reward_ledger for update to reward_purge_owner using (true) with check (true);
create policy purge_deletes_ledger on rewards.reward_ledger for delete to reward_purge_owner using (true);
create policy purge_reads_decisions on rewards.reward_decisions for select to reward_purge_owner using (true);
create policy purge_updates_decisions on rewards.reward_decisions for update to reward_purge_owner using (true) with check (true);
create policy purge_reads_holds on rewards.reward_holds for select to reward_purge_owner using (true);
create policy purge_updates_holds on rewards.reward_holds for update to reward_purge_owner using (true) with check (true);
create policy purge_reads_clearances on rewards.visit_clearances for select to reward_purge_owner using (true);
create policy purge_reads_user_counters on rewards.reward_counters_user_day for select to reward_purge_owner using (true);
create policy purge_deletes_user_counters on rewards.reward_counters_user_day for delete to reward_purge_owner using (true);
create policy purge_reads_aggregate on rewards.reward_deleted_aggregate_month for select to reward_purge_owner using (true);
create policy purge_inserts_aggregate on rewards.reward_deleted_aggregate_month for insert to reward_purge_owner with check (true);
create policy purge_updates_aggregate on rewards.reward_deleted_aggregate_month for update to reward_purge_owner using (true) with check (true);

revoke all on function rewards.visit_is_retained(uuid), rewards.guard_visits_change(), rewards.guard_ledger_change(),
  rewards.guard_decisions_change(), rewards.guard_holds_change(), rewards.guard_aggregate_change(), rewards.decisions_validate()
  from public, anon, authenticated, service_role;
grant execute on function rewards.visit_is_retained(uuid) to reward_writer_owner, reward_purge_owner;
