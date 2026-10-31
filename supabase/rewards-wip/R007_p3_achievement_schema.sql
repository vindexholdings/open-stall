-- R007 (P3, additive): achievement definitions, account-scoped chains, append-only events and the repair queue.
-- Schema, guards, RLS and privileges ONLY. The evaluation engine, hooks, progress read, repair and the purge extension are R008+.
-- No catalog row is seeded here: rewards stay disabled and no achievement exists until content is separately approved.
-- Tests insert SYNTHETIC definitions inside their own throwaway clone only (supabase/tests/rewards/p3_helpers.sql).

-- ---------------------------------------------------------------- immutable versioned definitions
create table rewards.achievement_definitions (
  achievement_key text not null check (achievement_key ~ '^[a-z][a-z0-9_]{2,47}$'),
  version integer not null check (version >= 1),
  metric text not null check (metric in ('lifetime_points_total', 'distinct_locations', 'qualifying_awards', 'distinct_active_days')),
  threshold integer not null check (threshold >= 1),
  window_rule text not null check (window_rule in ('none', 'calendar_month', 'fixed')),
  window_starts_on date,
  window_ends_on date,
  effective_from_date date not null,
  copy text not null check (char_length(copy) between 1 and 200),
  created_at timestamptz not null default clock_timestamp(),
  primary key (achievement_key, version),
  check ((window_rule = 'fixed') = (window_starts_on is not null and window_ends_on is not null)),
  check (window_ends_on is null or window_ends_on >= window_starts_on),
  -- distinct active days only makes sense inside a window (plan section 3)
  check (window_rule <> 'none' or metric <> 'distinct_active_days')
);

-- ---------------------------------------------------------------- account-scoped chains with an opaque identity
-- chain_id is random and never derived from a user id. user_id becomes NULL when a retained chain is severed on account deletion;
-- Postgres treats NULLs as distinct, so severed chains never collide with anyone's unique (user, key, period).
create table rewards.achievement_chains (
  chain_id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete restrict,
  achievement_key text not null,
  period_key text not null check (char_length(period_key) between 1 and 40),
  created_at timestamptz not null default clock_timestamp(),
  unique (user_id, achievement_key, period_key)
);
-- Supports the bounded reads of the engine: a window is an index RANGE of the user's standing awards, and distinct months are enumerated by
-- loose index probes, so a call's cost follows the rows it is allowed to touch (the per-call budget), not the length of the ledger.
create index reward_ledger_standing_day_idx on rewards.reward_ledger (user_id, policy_day_local)
  where kind = 'lifetime' and entry_type = 'award';
create index achievement_chains_user_idx on rewards.achievement_chains (user_id) where user_id is not null;

-- ---------------------------------------------------------------- append-only events (no user_id of their own)
create table rewards.achievement_events (
  chain_id uuid not null references rewards.achievement_chains (chain_id) on delete restrict,
  seq integer not null check (seq >= 1),
  event text not null check (event in ('award', 'revoke')),
  version integer not null check (version >= 1),
  reason text not null check (reason in ('first_award', 're_earn', 'reversal')),
  qualifying_value integer not null,
  threshold integer not null check (threshold >= 1),
  -- ONLY revoke events carry ledger/decision provenance; award events store numeric snapshots and no personal history ids.
  basis_entry_id uuid references rewards.reward_ledger (id) on delete restrict,
  decision_id uuid references rewards.reward_decisions (id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  primary key (chain_id, seq),
  check (
    (event = 'award' and reason in ('first_award', 're_earn') and basis_entry_id is null and decision_id is null)
    or
    (event = 'revoke' and reason = 'reversal' and basis_entry_id is not null and decision_id is not null)
  )
);

-- ---------------------------------------------------------------- the repair queue (user-linked operational data; always deleted on purge)
-- dirty_scope holds 'key|period_key' strings: the chains left unevaluated. Scope is UNIONED, capped at 500; overflow means a bounded
-- full re-scan driven by rescan_cursor. Unfinished work is never dropped; the row is deleted only when nothing remains.
create table rewards.achievement_eval_queue (
  user_id uuid primary key references auth.users (id) on delete restrict,
  reason text not null check (char_length(reason) between 1 and 64),
  dirty_scope text[] not null default '{}' check (cardinality(dirty_scope) <= 500),
  overflow boolean not null default false,
  rescan_cursor text,
  -- chains whose OWN window/history exceeds the per-call row budget: never evaluated partially, kept pending (reported unavailable)
  deferred text[] not null default '{}' check (cardinality(deferred) <= 500),
  attempts integer not null default 0 check (attempts >= 0),
  last_sqlstate text check (last_sqlstate is null or last_sqlstate ~ '^[0-9A-Z]{5}$'),
  first_failed_at timestamptz not null default clock_timestamp(),
  last_attempt_at timestamptz
);
create index achievement_eval_queue_fair_idx on rewards.achievement_eval_queue (last_attempt_at nulls first, first_failed_at);

-- ---------------------------------------------------------------- guards (invoker security, fixed search_path, decide on current_user only)
-- Definitions are immutable for every role, the owner included: a change is a new version row.
create function rewards.guard_achievement_definitions() returns trigger
language plpgsql set search_path = '' as $$
declare prev rewards.achievement_definitions%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'rewards.achievement_definitions is immutable (% refused for %)', tg_op, current_user using errcode = '42501';
  end if;
  select * into prev from rewards.achievement_definitions where achievement_key = new.achievement_key order by version desc limit 1;
  if prev.version is not null and (new.version <> prev.version + 1 or new.effective_from_date < prev.effective_from_date) then
    raise exception 'a new definition version must be the next number and no earlier than the previous one' using errcode = '23514';
  end if;
  -- A logical key keeps ONE window rule for ever (identity and historical windows never change): a different rule needs a different key.
  -- MUTABLE:p3_rule_invariant begin
  if prev.version is not null and new.window_rule <> prev.window_rule then
    raise exception 'a key keeps one window rule; a different window type needs a separate logical key' using errcode = '23514';
  end if;
  -- MUTABLE:p3_rule_invariant end
  if prev.version is null and new.version <> 1 then
    raise exception 'the first definition version must be 1' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger achievement_definitions_guard before insert or update or delete on rewards.achievement_definitions
  for each row execute function rewards.guard_achievement_definitions();

-- Events: never updated. Deleted only by the purge role, for the subject account's own chain, and only when the chain has no revoke.
create function rewards.guard_achievement_events() returns trigger
language plpgsql set search_path = '' as $$
declare c rewards.achievement_chains%rowtype;
begin
  -- MUTABLE:p3_events_guard begin
  if tg_op = 'DELETE' and current_user = 'reward_purge_owner' and auth.uid() is not null then
    select * into c from rewards.achievement_chains where chain_id = old.chain_id;
    if c.chain_id is not null and c.user_id is not distinct from auth.uid()
       and not exists (select 1 from rewards.achievement_events e where e.chain_id = old.chain_id and e.event = 'revoke') then
      return old;
    end if;
  end if;
  -- MUTABLE:p3_events_guard end
  raise exception 'rewards.achievement_events is append-only (% refused for %)', tg_op, current_user using errcode = '42501';
end $$;
create trigger achievement_events_guard before update or delete on rewards.achievement_events
  for each row execute function rewards.guard_achievement_events();

-- Chains: the identity columns never change. The purge role may DELETE its own subject's chain only when it has no revoke event,
-- or sever (user_id non-NULL -> NULL, nothing else changed) its own subject's chain only when it HAS a revoke event.
create function rewards.guard_achievement_chains() returns trigger
language plpgsql set search_path = '' as $$
declare has_revoke boolean;
begin
  if current_user = 'reward_purge_owner' and auth.uid() is not null and old.user_id is not distinct from auth.uid() then
    select exists (select 1 from rewards.achievement_events e where e.chain_id = old.chain_id and e.event = 'revoke') into has_revoke;
    -- MUTABLE:p3_chains_guard begin
    if tg_op = 'DELETE' then
      if not has_revoke then return old; end if;
      raise exception 'rewards.achievement_chains: a chain with a revoke event is retained evidence' using errcode = '42501';
    end if;
    if has_revoke and new.user_id is null and (to_jsonb(new) - 'user_id') = (to_jsonb(old) - 'user_id') then
      return new;
    end if;
    -- MUTABLE:p3_chains_guard end
  end if;
  raise exception 'rewards.achievement_chains refuses % for %', tg_op, current_user using errcode = '42501';
end $$;
create trigger achievement_chains_guard before update or delete on rewards.achievement_chains
  for each row execute function rewards.guard_achievement_chains();

-- Queue: operational data. The writer owns it; the purge role may delete the subject's row; nobody else may change it.
create function rewards.guard_achievement_queue() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_user = 'reward_purge_owner' and auth.uid() is not null and old.user_id = auth.uid() then
    return old;
  end if;
  if current_user = 'reward_writer_owner' then
    if tg_op = 'DELETE' then return old; end if;
    if tg_op = 'UPDATE' and new.user_id is not distinct from old.user_id then return new; end if;
  end if;
  raise exception 'rewards.achievement_eval_queue refuses % for %', tg_op, current_user using errcode = '42501';
end $$;
create trigger achievement_eval_queue_guard before update or delete on rewards.achievement_eval_queue
  for each row execute function rewards.guard_achievement_queue();

create trigger achievement_definitions_no_truncate before truncate on rewards.achievement_definitions for each statement execute function rewards.guard_truncate();
create trigger achievement_chains_no_truncate before truncate on rewards.achievement_chains for each statement execute function rewards.guard_truncate();
create trigger achievement_events_no_truncate before truncate on rewards.achievement_events for each statement execute function rewards.guard_truncate();
create trigger achievement_eval_queue_no_truncate before truncate on rewards.achievement_eval_queue for each statement execute function rewards.guard_truncate();

-- ---------------------------------------------------------------- RLS (enabled and FORCED) and explicit per-role policies
alter table rewards.achievement_definitions enable row level security;
alter table rewards.achievement_definitions force row level security;
alter table rewards.achievement_chains enable row level security;
alter table rewards.achievement_chains force row level security;
alter table rewards.achievement_events enable row level security;
alter table rewards.achievement_events force row level security;
alter table rewards.achievement_eval_queue enable row level security;
alter table rewards.achievement_eval_queue force row level security;

revoke all on rewards.achievement_definitions, rewards.achievement_chains, rewards.achievement_events, rewards.achievement_eval_queue
  from public, anon, authenticated, service_role;

-- writer: reads the catalog; creates chains and events (never updates or deletes them); owns the operational queue
grant select on rewards.achievement_definitions to reward_writer_owner;
grant select, insert on rewards.achievement_chains, rewards.achievement_events to reward_writer_owner;
grant select, insert, update, delete on rewards.achievement_eval_queue to reward_writer_owner;
-- purge: the narrowest set (no INSERT anywhere, no UPDATE of events, chain UPDATE limited to user_id)
grant select, delete on rewards.achievement_chains, rewards.achievement_events, rewards.achievement_eval_queue to reward_purge_owner;
grant update (user_id) on rewards.achievement_chains to reward_purge_owner;

create policy writer_reads_definitions on rewards.achievement_definitions for select to reward_writer_owner using (true);
create policy writer_reads_chains on rewards.achievement_chains for select to reward_writer_owner using (true);
create policy writer_inserts_chains on rewards.achievement_chains for insert to reward_writer_owner with check (true);
create policy writer_reads_events on rewards.achievement_events for select to reward_writer_owner using (true);
create policy writer_inserts_events on rewards.achievement_events for insert to reward_writer_owner with check (true);
create policy writer_reads_queue on rewards.achievement_eval_queue for select to reward_writer_owner using (true);
create policy writer_inserts_queue on rewards.achievement_eval_queue for insert to reward_writer_owner with check (true);
create policy writer_updates_queue on rewards.achievement_eval_queue for update to reward_writer_owner using (true) with check (true);
create policy writer_deletes_queue on rewards.achievement_eval_queue for delete to reward_writer_owner using (true);
create policy purge_reads_chains on rewards.achievement_chains for select to reward_purge_owner using (true);
create policy purge_updates_chains on rewards.achievement_chains for update to reward_purge_owner using (true) with check (true);
create policy purge_deletes_chains on rewards.achievement_chains for delete to reward_purge_owner using (true);
create policy purge_reads_events on rewards.achievement_events for select to reward_purge_owner using (true);
create policy purge_deletes_events on rewards.achievement_events for delete to reward_purge_owner using (true);
create policy purge_reads_queue on rewards.achievement_eval_queue for select to reward_purge_owner using (true);
create policy purge_deletes_queue on rewards.achievement_eval_queue for delete to reward_purge_owner using (true);

revoke all on function rewards.guard_achievement_definitions(), rewards.guard_achievement_events(),
  rewards.guard_achievement_chains(), rewards.guard_achievement_queue() from public, anon, authenticated, service_role;
