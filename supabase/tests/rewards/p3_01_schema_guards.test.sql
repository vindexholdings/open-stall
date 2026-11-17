-- P3 schema, constraints and guards (R007) on the P3 build: definitions are immutable and versioned; events are append-only; chains and
-- the queue change only through the exact narrow paths. Disposable cluster only.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.ok(to_regclass('rewards.achievement_definitions') is not null and to_regclass('rewards.achievement_chains') is not null
  and to_regclass('rewards.achievement_events') is not null and to_regclass('rewards.achievement_eval_queue') is not null, 'the four P3 tables exist');
select pg_temp.ok((select count(*) from rewards.achievement_definitions) = 0, 'no catalog row exists after the build (nothing is seeded)');

-- definitions: versioning and immutability (even the owner cannot edit or delete)
select pg_temp.defn('reg_pts', 1, 'lifetime_points_total', 50);
select pg_temp.ok((select count(*) from rewards.achievement_definitions) = 1, 'a synthetic definition inserts');
select pg_temp.fails($q$ select pg_temp.defn('reg_pts', 1, 'lifetime_points_total', 60) $q$, '23514,23505', 'a duplicate (key, version) is refused (version rule first, primary key as backstop)');
select pg_temp.fails($q$ select pg_temp.defn('reg_pts', 3, 'lifetime_points_total', 60) $q$, '23514', 'a version number cannot skip');
select pg_temp.fails($q$ select pg_temp.defn('reg_pts', 2, 'lifetime_points_total', 60, 'none', date '2025-01-01') $q$, '23514', 'a new version cannot take effect before the previous one');
select pg_temp.fails($q$ select pg_temp.defn('fresh_key', 2, 'lifetime_points_total', 60) $q$, '23514', 'the first version of a key must be 1');
select pg_temp.fails($q$ select pg_temp.defn('days_all', 1, 'distinct_active_days', 5) $q$, '23514', 'distinct active days requires a window');
select pg_temp.fails($q$ select pg_temp.defn('bad_fixed', 1, 'distinct_locations', 5, 'fixed') $q$, '23514', 'a fixed window requires both dates');
select pg_temp.fails($q$ select pg_temp.defn('bad_range', 1, 'distinct_locations', 5, 'fixed', date '2026-01-01', date '2026-03-01', date '2026-01-01') $q$, '23514', 'a window cannot end before it starts');
select pg_temp.fails($q$ select pg_temp.defn('BadKey', 1, 'distinct_locations', 5) $q$, '23514', 'a key must be lowercase snake case');
select pg_temp.fails($q$ select pg_temp.defn('zero_th', 1, 'distinct_locations', 0) $q$, '23514', 'a threshold must be positive');
select pg_temp.fails($q$ update rewards.achievement_definitions set threshold = 1 $q$, '42501', 'a definition cannot be updated (owner included)');
select pg_temp.fails($q$ delete from rewards.achievement_definitions $q$, '42501', 'a definition cannot be deleted (owner included)');
select pg_temp.fails($q$ truncate rewards.achievement_definitions $q$, '42501,55000', 'definitions cannot be truncated');
select pg_temp.defn('reg_pts', 2, 'lifetime_points_total', 60, 'none', date '2026-06-01');
select pg_temp.ok((select max(version) from rewards.achievement_definitions where achievement_key = 'reg_pts') = 2, 'the next version inserts');

-- chains and events: shape constraints
select pg_temp.mkuser(1) as u1 \gset
select pg_temp.setf('u1', :'u1'::uuid) \gset
insert into rewards.achievement_chains (chain_id, user_id, achievement_key, period_key) values ('00000000-0000-4000-8000-000000000001', :'u1', 'reg_pts', 'lifetime');
select pg_temp.fails($q$ insert into rewards.achievement_chains (user_id, achievement_key, period_key) select pg_temp.f('u1'), 'reg_pts', 'lifetime' $q$, '23505', 'one chain per user, key and period');
select pg_temp.fails($q$ insert into rewards.achievement_events (chain_id, seq, event, version, reason, qualifying_value, threshold)
  values ('00000000-0000-4000-8000-000000000001', 1, 'revoke', 1, 'reversal', 1, 50) $q$, '23514', 'a revoke without ledger and decision provenance is refused');
select pg_temp.fails($q$ insert into rewards.achievement_events (chain_id, seq, event, version, reason, qualifying_value, threshold)
  values ('00000000-0000-4000-8000-000000000001', 1, 'award', 1, 'reversal', 1, 50) $q$, '23514', 'an award cannot carry the reversal reason');
select pg_temp.fails($q$ insert into rewards.achievement_events (chain_id, seq, event, version, reason, qualifying_value, threshold)
  values ('00000000-0000-4000-8000-0000000000ff', 1, 'award', 1, 'first_award', 1, 50) $q$, '23503', 'an event needs an existing chain');
insert into rewards.achievement_events (chain_id, seq, event, version, reason, qualifying_value, threshold)
  values ('00000000-0000-4000-8000-000000000001', 1, 'award', 1, 'first_award', 50, 50);
select pg_temp.fails($q$ insert into rewards.achievement_events (chain_id, seq, event, version, reason, qualifying_value, threshold)
  values ('00000000-0000-4000-8000-000000000001', 1, 'award', 1, 're_earn', 50, 50) $q$, '23505', 'unique (chain, seq) is the sequence backstop');
select pg_temp.fails($q$ update rewards.achievement_events set qualifying_value = 1 $q$, '42501', 'an event cannot be updated (owner included)');
select pg_temp.fails($q$ delete from rewards.achievement_events $q$, '42501', 'an event cannot be deleted by the owner');
select pg_temp.fails($q$ truncate rewards.achievement_events $q$, '42501,55000', 'events cannot be truncated');
select pg_temp.fails($q$ truncate rewards.achievement_chains $q$, '42501,55000,0A000', 'chains cannot be truncated (the foreign key from events also blocks it)');
select pg_temp.fails($q$ truncate rewards.achievement_eval_queue $q$, '42501,55000', 'the queue cannot be truncated');
select pg_temp.fails($q$ update rewards.achievement_chains set achievement_key = 'x' $q$, '42501', 'a chain cannot be edited by the owner');
select pg_temp.fails($q$ delete from rewards.achievement_chains $q$, '42501', 'a chain cannot be deleted by the owner');

-- queue shape
insert into rewards.achievement_eval_queue (user_id, reason) values (:'u1', 'test');
select pg_temp.fails($q$ insert into rewards.achievement_eval_queue (user_id, reason) select pg_temp.f('u1'), 'dup' $q$, '23505', 'one queue row per user');
select pg_temp.fails_as('reward_writer_owner', null, null, $q$ update rewards.achievement_eval_queue set last_sqlstate = 'bad' $q$, '23514', 'a SQLSTATE must be five characters');
-- the private calculation state: window key shape, pass values, non-negative counters, at most 50 rows per account, writer-only mutation
insert into rewards.achievement_calc_state (user_id, window_key, pass) values (:'u1', '2026-08-01|2026-08-31', 'days');
select pg_temp.fails($q$ insert into rewards.achievement_calc_state (user_id, window_key, pass) select pg_temp.f('u1'), 'k', 'bogus' $q$, '23514', 'a calculation pass must be days, locs or done');
select pg_temp.fails($q$ insert into rewards.achievement_calc_state (user_id, window_key, pass, points) select pg_temp.f('u1'), 'k2', 'days', -1 $q$, '23514', 'calculation counters cannot be negative');
select pg_temp.fails($q$ insert into rewards.achievement_calc_state (user_id, window_key, pass) select pg_temp.f('u1'), '2026-08-01|2026-08-31', 'days' $q$, '23505', 'one calculation state per account and window');
insert into rewards.achievement_calc_state (user_id, window_key, pass) select :'u1', 'w' || g, 'days' from generate_series(1, 49) g;
select pg_temp.fails($q$ insert into rewards.achievement_calc_state (user_id, window_key, pass) select pg_temp.f('u1'), 'w50', 'days' $q$, '23514', 'the 51st calculation state for an account is refused (at most 50)');
select pg_temp.fails($q$ update rewards.achievement_calc_state set steps = 9 $q$, '42501', 'the owner path cannot update calculation state (only the writer)');
select pg_temp.fails($q$ delete from rewards.achievement_calc_state $q$, '42501', 'the owner path cannot delete calculation state (only the writer and the purge role)');
select pg_temp.fails($q$ truncate rewards.achievement_calc_state $q$, '42501,55000', 'calculation state cannot be truncated');
select pg_temp.fails_as('reward_writer_owner', null, null, $q$ update rewards.achievement_calc_state set window_key = 'moved' $q$, '42501', 'even the writer cannot change the identity of a calculation state');
select pg_temp.fails_as('reward_purge_owner', null, null, $q$ delete from rewards.achievement_calc_state $q$, '42501', 'the purge role deletes only the subject account''s state (no subject claim: refused)');
select pg_temp.fails_as('reward_writer_owner', null, null, $q$ update rewards.achievement_eval_queue set dirty_scope = (select array_agg('k|' || g) from generate_series(1, 501) g) $q$, '23514', 'dirty scope is capped at 500');
select pg_temp.fails($q$ delete from rewards.achievement_eval_queue $q$, '42501', 'the postgres owner path cannot delete queue rows (only the writer and purge roles)');
select pg_temp.ok((select count(*) from rewards.achievement_eval_queue) = 1, 'the queue row remains');

select pg_temp.finish();
