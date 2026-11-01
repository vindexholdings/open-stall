-- Shared P3 helpers: synthetic catalog fixtures and real role paths. Throwaway cluster only. No catalog row exists outside tests.
\i :ROOT/supabase/tests/rewards/p2_helpers.sql
-- Inserts one SYNTHETIC definition version (the test harness is the only code that ever inserts definitions).
create function pg_temp.defn(k text, v integer, m text, th integer, wr text default 'none', eff date default date '2026-01-01',
                             ws date default null, we date default null) returns void language sql as $$
  insert into rewards.achievement_definitions (achievement_key, version, metric, threshold, window_rule, window_starts_on, window_ends_on,
                                               effective_from_date, copy)
  values (k, v, m, th, wr, ws, we, eff, 'synthetic test definition')
$$;
-- Runs q as a real role (no JWT subject) and returns its text result.
create function pg_temp.ev_count(u uuid, k text, p text) returns integer language sql as $$
  select count(*)::integer from rewards.achievement_events e join rewards.achievement_chains c using (chain_id)
   where c.user_id = u and c.achievement_key = k and c.period_key = p
$$;
-- One first-of-the-day check-in at local noon (America/Denver) on the given date; returns the visit id.
create function pg_temp.dv(u uuid, l uuid, d text, tag text) returns uuid language sql as $$
  select pg_temp.vid((d || ' 18:00:00+00')::timestamptz, u, l, 'p3-' || tag || '-' || replace(d, '-', '') || '-' || substr(l::text, 1, 8))
$$;
-- 'event' of the latest event of a chain, or 'none'.
create function pg_temp.last_ev(u uuid, k text, p text) returns text language sql as $$
  select coalesce((select e.event || '#' || e.seq from rewards.achievement_events e join rewards.achievement_chains c using (chain_id)
    where c.user_id = u and c.achievement_key = k and c.period_key = p order by e.seq desc limit 1), 'none')
$$;
create function pg_temp.prog(u uuid, k text, p text) returns jsonb language sql as $$
  select i from jsonb_array_elements(pg_temp.as_role('authenticated', u, 'aal1', 'select public.get_my_progress(null, 50)::text')::jsonb -> 'items') i
   where i ->> 'achievement' = k and i ->> 'period' = p
$$;
-- Bulk synthetic standing awards (triggers disabled for the SEED ONLY): nloc locations x ndays consecutive local days, one lifetime award each.
create function pg_temp.seed_awards(u uuid, nloc integer, ndays integer, start_day date) returns void language plpgsql as $$
declare locs uuid[]; pol bigint; sh bigint;
begin
  select array_agg(id) into locs from (select id from public.locations order by id limit nloc) s;
  select id into pol from rewards.reward_policy_versions order by effective_from limit 1;
  select max(id) into sh from rewards.reward_settings_history;
  set local session_replication_role = replica;
  with d as (select (start_day + g)::date as day, g from generate_series(0, ndays - 1) g),
       l as (select locs[n] as loc, n from generate_series(1, nloc) n),
       v as (select gen_random_uuid() as id, l.loc, d.day, 'seed-' || left(u::text, 8) || '-' || l.n || '-' || d.g as key from d cross join l),
       iv as (insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone,
                  policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
              select id, u, loc, key, (day || ' 18:00:00+00')::timestamptz, pol, sh, 'America/Denver', day, day, 1, 'within_50', 'location_cap', 'awarded' from v returning id, location_id, policy_day_local)
  insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
    select 'award', id, u, location_id, policy_day_local, pol, 'lifetime', 5, 'first_visit_of_local_day' from iv;
  set local session_replication_role = origin;
end $$;
-- Bulk synthetic REVERSAL rows (triggers disabled for the SEED ONLY): reverses the n oldest lifetime awards of the account.
create function pg_temp.seed_reversals(u uuid, n integer) returns void language plpgsql as $$
begin
  set local session_replication_role = replica;
  insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reverses_entry_id, reward_decision_id)
    select 'reversal', a.visit_id, a.user_id, a.location_id, a.policy_day_local, a.policy_version_id, 'lifetime', -a.amount, 'fraud_reversal', a.id, gen_random_uuid()
      from (select * from rewards.reward_ledger where user_id = u and kind = 'lifetime' and entry_type = 'award' order by policy_day_local, id limit n) a;
  set local session_replication_role = origin;
end $$;
-- Real work on the ledger so far in THIS transaction, measured by PostgreSQL (not by the engine's own counter): heap tuples read
-- (seq_tup_read + idx_tup_fetch) plus index scans started (idx_scan: one per reversal-existence probe, index-only).
create function pg_temp.ledger_reads() returns bigint language sql as $$
  select coalesce(sum(seq_tup_read + idx_tup_fetch + idx_scan), 0)::bigint from pg_stat_xact_user_tables where relname = 'reward_ledger'
$$;
-- Repair until the account's queue row is gone (admin, aal2), at most 30 calls; returns the number of calls.
create function pg_temp.drain(adm uuid, u uuid) returns integer language plpgsql as $$
declare i integer := 0;
begin
  while exists (select 1 from rewards.achievement_eval_queue where user_id = u) and i < 30 loop
    i := i + 1;
    perform pg_temp.as_role('authenticated', adm, 'aal2', 'select public.repair_achievements(5)::text');
  end loop;
  return i;
end $$;
