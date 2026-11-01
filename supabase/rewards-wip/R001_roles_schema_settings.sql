-- P1 (rewards, local core). SOURCE ONLY: this directory is outside supabase/migrations/ on purpose and is applied
-- only by scripts/test-db-rewards.sh to a throwaway local PostgreSQL 16. Nothing here may be applied to a hosted or
-- production database; moving a file into supabase/migrations/ is a separate, explicitly approved step.
--
-- R001: writer role, private schema, single-row settings (rewards DISABLED, budget UNSET) with append-only history.

-- ---------------------------------------------------------------- writer role (owns only the SECURITY DEFINER functions)
create role reward_writer_owner nologin noinherit nobypassrls nosuperuser nocreatedb nocreaterole noreplication;
-- Lets the migration role hand ownership of the writer functions to the writer (no-op for a superuser).
grant reward_writer_owner to current_user;

-- ---------------------------------------------------------------- private schema (never exposed through the API)
create schema rewards;
revoke all on schema rewards from public;
grant usage on schema rewards to reward_writer_owner;
-- The writer calls auth.uid() to learn the session identity; it gets nothing else in the auth schema.
grant usage on schema auth to reward_writer_owner;

-- ---------------------------------------------------------------- append-only / immutability guards (shared)
-- SECURITY INVOKER with a fixed search_path; the decision uses current_user, never a client-settable value.
create function rewards.guard_append_only() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'rewards.% is append-only (% refused for %)', tg_table_name, tg_op, current_user using errcode = '42501';
end $$;

create function rewards.guard_truncate() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'rewards.% cannot be truncated (refused for %)', tg_table_name, current_user using errcode = '42501';
end $$;

-- ---------------------------------------------------------------- settings: the single place the switch and budget live
-- rewards_enabled defaults to false and the budget to NULL (= unset = nothing is issued). Neither is a policy-version
-- column. This file seeds the disabled/unset row; no function in rewards-wip may change it (scripts/check-rewards-boundary.mjs).
create table rewards.reward_settings_history (
  id bigint generated always as identity primary key,
  rewards_enabled boolean not null,
  global_budget_utc_day integer check (global_budget_utc_day is null or global_budget_utc_day >= 0),
  recorded_at timestamptz not null default clock_timestamp()
);

create table rewards.reward_settings (
  id boolean primary key default true check (id),
  rewards_enabled boolean not null default false,
  global_budget_utc_day integer check (global_budget_utc_day is null or global_budget_utc_day >= 0),
  history_id bigint not null references rewards.reward_settings_history (id),
  updated_at timestamptz not null default clock_timestamp()
);

-- Every settings change appends a history row and points the live row at it, so each visit can record exactly
-- which settings it used and a change affects only visits accepted after it.
create function rewards.settings_history_trigger() returns trigger
language plpgsql set search_path = '' as $$
declare hid bigint;
begin
  insert into rewards.reward_settings_history (rewards_enabled, global_budget_utc_day)
    values (new.rewards_enabled, new.global_budget_utc_day) returning id into hid;
  new.history_id := hid;
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger reward_settings_history_row before insert or update on rewards.reward_settings
  for each row execute function rewards.settings_history_trigger();

create trigger reward_settings_history_append_only before update or delete on rewards.reward_settings_history
  for each row execute function rewards.guard_append_only();
create trigger reward_settings_history_no_truncate before truncate on rewards.reward_settings_history
  for each statement execute function rewards.guard_truncate();

create function rewards.guard_settings_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'rewards.reward_settings is a single permanent row (% refused for %)', tg_op, current_user using errcode = '42501';
end $$;
create trigger reward_settings_no_delete before delete on rewards.reward_settings
  for each row execute function rewards.guard_settings_delete();
create trigger reward_settings_no_truncate before truncate on rewards.reward_settings
  for each statement execute function rewards.guard_truncate();

insert into rewards.reward_settings (id, rewards_enabled, global_budget_utc_day) values (true, false, null);

alter table rewards.reward_settings enable row level security;
alter table rewards.reward_settings force row level security;
alter table rewards.reward_settings_history enable row level security;
alter table rewards.reward_settings_history force row level security;
revoke all on rewards.reward_settings, rewards.reward_settings_history from public, anon, authenticated, service_role;
grant select on rewards.reward_settings, rewards.reward_settings_history to reward_writer_owner;
create policy writer_reads_settings on rewards.reward_settings for select to reward_writer_owner using (true);
create policy writer_reads_settings_history on rewards.reward_settings_history for select to reward_writer_owner using (true);
