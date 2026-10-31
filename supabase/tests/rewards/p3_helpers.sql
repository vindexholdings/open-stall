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
