-- P1 test 2 and 10: a fresh database is disabled and unset; nothing is issued; clients cannot change settings.
\i :ROOT/supabase/tests/rewards/helpers.sql

select pg_temp.mkuser(1) as u1 \gset
select pg_temp.mkloc(40.0) as l1 \gset

select pg_temp.ok((select rewards_enabled from rewards.reward_settings) = false, 'fresh settings: rewards_enabled = false');
select pg_temp.ok((select global_budget_utc_day from rewards.reward_settings) is null, 'fresh settings: global budget is NULL (unset)');
select pg_temp.ok((select count(*) from rewards.reward_settings) = 1, 'exactly one settings row');
select pg_temp.ok((select count(*) from rewards.reward_settings_history) = 1, 'the seed row appended one history row');
select pg_temp.ok((select count(*) from rewards.reward_ledger) = 0 and (select count(*) from rewards.visits) = 0
                  and (select count(*) from rewards.reward_counters_user_day) = 0 and (select count(*) from rewards.reward_counters_global_day) = 0,
                  'fresh cluster: ledger, visits and counters are empty');
select pg_temp.ok((select count(*) from rewards.reward_policy_versions) = 1
                  and (select (spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day)::text
                         from rewards.reward_policy_versions) = '(5,5,4,60)', 'seed policy is 5/5/4/60');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'rewards' and column_name ~* 'cooldown|interval|latitude|longitude|lat$|lng$|device|fingerprint|ip_addr'),
                  'no cooldown, coordinate or device-identifier column exists in the rewards schema');

-- Disabled: a visit is recorded and both outcomes are rewards_disabled; nothing is issued.
select pg_temp.visit_at('2026-10-20 15:00:00+00', :'u1', :'l1', 'disabled-key-0000001') as r \gset
select pg_temp.ok((:'r'::jsonb)->>'spendable_outcome' = 'rewards_disabled' and (:'r'::jsonb)->>'lifetime_outcome' = 'rewards_disabled',
                  'disabled: both outcomes are rewards_disabled');
select pg_temp.ok((select count(*) from rewards.visits) = 1, 'disabled: the visit is still recorded');
select pg_temp.ok((select ordinal from rewards.visits) = 1, 'disabled: the visit keeps its ordinal slot');
select pg_temp.ok((select count(*) from rewards.reward_ledger) = 0 and (select count(*) from rewards.reward_counters_user_day) = 0
                  and (select count(*) from rewards.reward_counters_global_day) = 0, 'disabled: no ledger row and no counter change');

-- Enabled with the budget still unset: spendable budget_unset, lifetime rewards_disabled, nothing issued.
select pg_temp.set_settings(true, null);
select pg_temp.visit_at('2026-10-20 15:01:00+00', :'u1', :'l1', 'unset-key-000000001') as r \gset
select pg_temp.ok((:'r'::jsonb)->>'spendable_outcome' = 'budget_unset' and (:'r'::jsonb)->>'lifetime_outcome' = 'rewards_disabled',
                  'enabled with unset budget: budget_unset / rewards_disabled');
select pg_temp.ok((select count(*) from rewards.reward_ledger) = 0, 'enabled with unset budget: nothing is issued');
select pg_temp.ok((select ordinal from rewards.visits where idempotency_key = 'unset-key-000000001') = 2, 'the second visit that day is ordinal 2 even though nothing was issued');
select pg_temp.set_settings(false, null);

-- Each settings change appended history, and each visit recorded the settings row it used.
select pg_temp.ok((select count(*) from rewards.reward_settings_history) = 3, 'two changes appended two history rows');
select pg_temp.ok((select count(distinct settings_history_id) from rewards.visits) = 2, 'visits record the settings history row in force');

-- Defense in depth: even a direct write as the writer role is refused while disabled or while the budget is unset.
select pg_temp.set_settings(false, null);
select pg_temp.fails($$set role reward_writer_owner;
  insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'lifetime', 5, 'x' from rewards.visits v limit 1$$,
  'RW010', 'ledger insert is refused while rewards are disabled');
reset role;
select pg_temp.set_settings(true, null);
select pg_temp.fails($$set role reward_writer_owner;
  insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'spendable', 5, 'x' from rewards.visits v limit 1$$,
  'RW011', 'spendable ledger insert is refused while the budget is unset');
reset role;
select pg_temp.set_settings(false, null);

-- Clients cannot change settings, policy or anything else (every client role is refused with 42501).
select pg_temp.fails('set role authenticated; update rewards.reward_settings set rewards_enabled = true', '42501', 'authenticated cannot enable rewards');
reset role;
select pg_temp.fails('set role anon; update rewards.reward_settings set global_budget_utc_day = 1000000', '42501', 'anon cannot set a budget');
reset role;
select pg_temp.fails('set role service_role; update rewards.reward_settings set rewards_enabled = true', '42501', 'service_role cannot enable rewards');
reset role;
select pg_temp.fails('set role reward_writer_owner; update rewards.reward_settings set rewards_enabled = true', '42501', 'the writer role cannot enable rewards');
reset role;
select pg_temp.fails('delete from rewards.reward_settings', '42501', 'the settings row cannot be deleted');
select pg_temp.fails('truncate rewards.reward_settings', '42501', 'settings cannot be truncated');
select pg_temp.ok((select rewards_enabled from rewards.reward_settings) = false, 'settings are still disabled after all refusals');

-- The unreachable-by-clients public function: anonymous callers cannot execute it at all.
select pg_temp.fails($$set role anon; select public.record_visit('00000000-0000-0000-0000-000000000000', 0, 0, 'anon-key-0000000001')$$, '42501', 'anon cannot execute record_visit');
reset role;
select pg_temp.as_user(null);
select pg_temp.fails($$set role authenticated; select public.record_visit('00000000-0000-0000-0000-000000000000', 0, 0, 'no-identity-0000001')$$, '28000', 'record_visit needs a signed-in identity');
reset role;
select pg_temp.finish();
