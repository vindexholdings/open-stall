-- P1 correction (Work d38b5df, item 1): the independent ledger safety gate covers BOTH award kinds. The guard is exercised DIRECTLY as
-- the writer role (not through record_visit), with a complete, otherwise valid visit + award set, so no unrelated unique, FK,
-- check or deferred-consistency rule can stand in for the refusal: the guard's own SQLSTATEs (RW010, RW011) are the only
-- accepted refusals, and the very same rows are shown to commit in the states that allow them.
\i :ROOT/supabase/tests/rewards/helpers.sql

-- try_award(kind): as reward_writer_owner, insert a valid visit and ONE ledger award of that kind (fresh user and location every
-- call), force every deferred constraint to run, and report 'ok' (everything valid, rolled back by design) or the SQLSTATE.
create function pg_temp.try_award(kind text) returns text language plpgsql as $$
declare
  n integer := nextval('pg_temp.seq');
  u uuid := pg_temp.mkuser(7000 + n);
  l uuid := pg_temp.mkloc(10 + n / 100.0);
  v uuid := gen_random_uuid();
  pv bigint := (select id from rewards.reward_policy_versions order by effective_from limit 1);
  sh bigint := (select history_id from rewards.reward_settings);
  st text;
begin
  execute 'set role reward_writer_owner';
  begin
    insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone,
                                policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
      values (v, u, l, 'gate-matrix-key-' || lpad(n::text, 8, '0'), timestamptz '2026-11-10 15:00:00+00', pv, sh, 'America/Denver',
              date '2026-11-10', date '2026-11-10', 1, 'within_50',
              case kind when 'spendable' then 'awarded' else 'user_day_cap' end,
              case kind when 'lifetime' then 'awarded' else 'not_first_daily' end);
    insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
      values ('award', v, u, l, date '2026-11-10', pv, kind, 5, 'gate-matrix');
    execute 'set constraints all immediate';
    raise exception 'probe-complete' using errcode = 'RW999';
  exception when others then
    get stacked diagnostics st = returned_sqlstate;
  end;
  execute 'reset role';
  return case when st = 'RW999' then 'ok' else st end;
end $$;
create temp sequence seq;
create temp table _m (state text, kind text, got text, want text);
create function pg_temp.row(state text, en boolean, budget integer) returns void language plpgsql as $$
declare k text; want text;
begin
  perform pg_temp.set_settings(en, budget);
  foreach k in array array['lifetime', 'spendable'] loop
    want := case when not en then 'RW010' when budget is null then 'RW011' else 'ok' end;
    insert into _m values (state, k, pg_temp.try_award(k), want);
  end loop;
end $$;
select pg_temp.row('disabled, budget unset', false, null);
select pg_temp.row('disabled, budget configured', false, 1000);
select pg_temp.row('enabled, budget unset', true, null);
select pg_temp.row('enabled, budget configured', true, 1000);
select pg_temp.set_settings(false, null);
\o
select state, kind, want as expected, got from _m order by state, kind;
\o /dev/null
select pg_temp.ok((select got from _m where state = 'disabled, budget unset' and kind = 'lifetime') = 'RW010', 'disabled / unset: a direct LIFETIME award is refused by the gate (RW010)');
select pg_temp.ok((select got from _m where state = 'disabled, budget unset' and kind = 'spendable') = 'RW010', 'disabled / unset: a direct SPENDABLE award is refused by the gate (RW010)');
select pg_temp.ok((select got from _m where state = 'disabled, budget configured' and kind = 'lifetime') = 'RW010' and (select got from _m where state = 'disabled, budget configured' and kind = 'spendable') = 'RW010',
                  'disabled with a configured budget: both kinds refused (RW010)');
select pg_temp.ok((select got from _m where state = 'enabled, budget unset' and kind = 'lifetime') = 'RW011', 'enabled / budget UNSET: a direct LIFETIME award is refused by the gate (RW011)');
select pg_temp.ok((select got from _m where state = 'enabled, budget unset' and kind = 'spendable') = 'RW011', 'enabled / budget UNSET: a direct SPENDABLE award is refused by the gate (RW011)');
select pg_temp.ok((select got from _m where state = 'enabled, budget configured' and kind = 'lifetime') = 'ok' and (select got from _m where state = 'enabled, budget configured' and kind = 'spendable') = 'ok',
                  'enabled / budget configured: the SAME otherwise valid rows pass every rule, so the refusals above came only from the gate');
select pg_temp.ok(not exists (select 1 from _m where got is distinct from want), 'the whole matrix matches the expectation (4 states x 2 kinds)');

-- A complete valid writer transaction COMMITS where the gate allows it (enabled, budget configured), for each kind.
select pg_temp.set_settings(true, 1000);
select pg_temp.mkuser(7901) as ucl \gset
select pg_temp.mkloc(30.01) as lcl \gset
select pg_temp.mkuser(7902) as usp \gset
select pg_temp.mkloc(30.02) as lsp \gset
select id as pv from rewards.reward_policy_versions order by effective_from limit 1 \gset
select history_id as sh from rewards.reward_settings \gset
begin;
set role reward_writer_owner;
insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
  values ('00000000-0000-0000-0000-00000000a001', :'ucl', :'lcl', 'gate-commit-lifetime-01', '2026-11-11 15:00:00+00', :pv, :sh, 'America/Denver', '2026-11-11', '2026-11-11', 1, 'within_50', 'user_day_cap', 'awarded');
insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  values ('award', '00000000-0000-0000-0000-00000000a001', :'ucl', :'lcl', '2026-11-11', :pv, 'lifetime', 5, 'gate-commit');
reset role;
commit;
begin;
set role reward_writer_owner;
insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
  values ('00000000-0000-0000-0000-00000000a002', :'usp', :'lsp', 'gate-commit-spendable-1', '2026-11-11 15:00:00+00', :pv, :sh, 'America/Denver', '2026-11-11', '2026-11-11', 2, 'within_50', 'awarded', 'not_first_daily');
insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  values ('award', '00000000-0000-0000-0000-00000000a002', :'usp', :'lsp', '2026-11-11', :pv, 'spendable', 5, 'gate-commit');
reset role;
commit;
select pg_temp.ok((select count(*) from rewards.reward_ledger where reason = 'gate-commit') = 2, 'enabled / budget configured: a complete valid writer transaction commits for a lifetime award AND for a spendable award');

-- The configured-but-EXHAUSTED budget is a different case: lifetime stays independent (it is not blocked), spendable is blocked by the counter.
select pg_temp.set_settings(true, 10);
insert into rewards.reward_counters_global_day values ('2026-11-12', 10);
select pg_temp.mkuser(7903) as uex \gset
select pg_temp.mkloc(30.03) as lex \gset
select pg_temp.oc(pg_temp.visit_at('2026-11-12 15:00:00+00', :'uex', :'lex', 'gate-exhausted-0000001')) as ex1 \gset
select pg_temp.ok(:'ex1' = 'budget_exhausted|awarded|0|5', 'enabled / configured but EXHAUSTED: through record_visit the lifetime award is still issued and the spendable award is not');
select pg_temp.ok((select count(*) filter (where kind = 'lifetime') || '/' || count(*) filter (where kind = 'spendable') from rewards.reward_ledger where user_id = :'uex') = '1/0',
                  'exhausted budget: exactly one lifetime row and no spendable row');
select pg_temp.ok((select got from (select pg_temp.try_award('lifetime') as got) x) = 'ok', 'exhausted budget: a direct lifetime award is NOT refused by the gate (independence of lifetime from the spendable budget)');
select pg_temp.ok((select spendable from rewards.reward_counters_global_day where issuance_day_utc = '2026-11-12') = 10, 'the exhausted counter never moved');

-- And through the public recorder with the budget UNSET and rewards enabled: nothing of either kind is issued.
select pg_temp.set_settings(true, null);
select pg_temp.mkuser(7904) as uun \gset
select pg_temp.mkloc(30.04) as lun \gset
select pg_temp.oc(pg_temp.visit_at('2026-11-13 15:00:00+00', :'uun', :'lun', 'gate-unset-00000000001')) as un1 \gset
select pg_temp.ok(:'un1' = 'budget_unset|rewards_disabled|0|0', 'enabled / unset through record_visit: budget_unset and nothing issued (either kind)');
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'uun') = 0, 'and no ledger row exists');
select pg_temp.set_settings(false, null);
select pg_temp.finish();
