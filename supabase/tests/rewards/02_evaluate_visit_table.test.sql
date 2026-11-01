-- P1 test 1: table-driven pure evaluation (every row of VIP_REWARDS_PLAN.md 11.3), independence of lifetime from the spendable cap.
\i :ROOT/supabase/tests/rewards/helpers.sql

-- ev(ordinal, user_issued, global_issued, enabled, budget, hold) with the approved policy 5 / 5 / 4 / 60.
create function pg_temp.ev(ord integer, uiss integer, giss integer, en boolean, budget integer, hold boolean default false) returns text
language sql as $$
  select spendable_outcome || '|' || lifetime_outcome || '|' || spendable_points || '|' || lifetime_points
  from rewards.evaluate_visit(5, 5, 4, 60, ord, uiss, giss, en, budget, hold)
$$;
create temp table _cases (name text, got text, want text);
insert into _cases values
 ('1st visit, caps free',                          pg_temp.ev(1, 0, 0, true, 1000000),    'awarded|awarded|5|5'),
 ('2nd visit',                                     pg_temp.ev(2, 5, 5, true, 1000000),    'awarded|not_first_daily|5|0'),
 ('3rd visit',                                     pg_temp.ev(3, 10, 10, true, 1000000),  'awarded|not_first_daily|5|0'),
 ('4th visit',                                     pg_temp.ev(4, 15, 15, true, 1000000),  'awarded|not_first_daily|5|0'),
 ('5th visit is recorded only (location cap)',     pg_temp.ev(5, 20, 20, true, 1000000),  'location_cap|not_first_daily|0|0'),
 ('6th visit',                                     pg_temp.ev(6, 20, 20, true, 1000000),  'location_cap|not_first_daily|0|0'),
 ('20th visit',                                    pg_temp.ev(20, 20, 20, true, 1000000), 'location_cap|not_first_daily|0|0'),
 ('1st visit, user at 60: lifetime still earned',  pg_temp.ev(1, 60, 60, true, 1000000),  'user_day_cap|awarded|0|5'),
 ('3rd visit, user at 60',                         pg_temp.ev(3, 60, 60, true, 1000000),  'user_day_cap|not_first_daily|0|0'),
 ('user at 55: the last 5 fit exactly',            pg_temp.ev(1, 55, 55, true, 1000000),  'awarded|awarded|5|5'),
 ('user at 58: no partial grant',                  pg_temp.ev(1, 58, 58, true, 1000000),  'user_day_cap|awarded|0|5'),
 ('user at 56: no partial grant',                  pg_temp.ev(2, 56, 56, true, 1000000),  'user_day_cap|not_first_daily|0|0'),
 ('budget exhausted, 1st visit: lifetime earned',  pg_temp.ev(1, 0, 100, true, 100),      'budget_exhausted|awarded|0|5'),
 ('budget exhausted, 2nd visit',                   pg_temp.ev(2, 5, 100, true, 100),      'budget_exhausted|not_first_daily|0|0'),
 ('budget 95 of 100 used: the last 5 fit',         pg_temp.ev(1, 0, 95, true, 100),       'awarded|awarded|5|5'),
 ('budget 96 of 100 used: no partial grant',       pg_temp.ev(1, 0, 96, true, 100),       'budget_exhausted|awarded|0|5'),
 ('budget 0 is a real, exhausted budget',          pg_temp.ev(1, 0, 0, true, 0),          'budget_exhausted|awarded|0|5'),
 ('enabled but budget unset: nothing issued',      pg_temp.ev(1, 0, 0, true, null),       'budget_unset|rewards_disabled|0|0'),
 ('disabled, budget set: nothing issued',          pg_temp.ev(1, 0, 0, false, 1000000),   'rewards_disabled|rewards_disabled|0|0'),
 ('disabled, budget unset: nothing issued',        pg_temp.ev(1, 0, 0, false, null),      'rewards_disabled|rewards_disabled|0|0'),
 ('held visit keeps its slot, earns nothing yet',  pg_temp.ev(1, 0, 0, true, 1000000, true), 'held|held|0|0'),
 ('location cap wins over user cap',               pg_temp.ev(5, 60, 0, true, 1000000),   'location_cap|not_first_daily|0|0'),
 ('user cap wins over an exhausted budget',        pg_temp.ev(2, 60, 100, true, 100),     'user_day_cap|not_first_daily|0|0'),
 ('lifetime independent of BOTH caps',             pg_temp.ev(1, 60, 100, true, 100),     'user_day_cap|awarded|0|5');
select pg_temp.ok(got = want, name || ' -> ' || want) from _cases;

-- The policy is read from the arguments: a different version changes the result, with no hidden constant.
select pg_temp.ok((select spendable_outcome || '|' || lifetime_outcome || '|' || spendable_points || '|' || lifetime_points
                   from rewards.evaluate_visit(7, 9, 2, 14, 3, 7, 0, true, 100, false)) = 'location_cap|not_first_daily|0|0', 'a policy with 2 slots caps the 3rd visit');
select pg_temp.ok((select spendable_outcome || '|' || lifetime_outcome || '|' || spendable_points || '|' || lifetime_points
                   from rewards.evaluate_visit(7, 9, 2, 14, 1, 7, 0, true, 100, false)) = 'awarded|awarded|7|9', 'policy values drive the amounts');
select pg_temp.ok((select spendable_outcome || '|' || lifetime_outcome from rewards.evaluate_visit(7, 9, 2, 14, 1, 8, 0, true, 100, false)) = 'user_day_cap|awarded',
                  'a non-dividing policy is refused as capped, never partially granted (8 + 7 > 14)');

-- Invalid input is rejected, never guessed.
select pg_temp.fails('select * from rewards.evaluate_visit(5,5,4,60, 0, 0,0, true, 10, false)', '22023', 'ordinal 0 is invalid');
select pg_temp.fails('select * from rewards.evaluate_visit(5,5,4,60, null, 0,0, true, 10, false)', '22023', 'NULL ordinal is invalid');
select pg_temp.fails('select * from rewards.evaluate_visit(5,5,4,60, 1, -1,0, true, 10, false)', '22023', 'negative user issuance is invalid');
select pg_temp.fails('select * from rewards.evaluate_visit(5,5,4,60, 1, 0,-1, true, 10, false)', '22023', 'negative global issuance is invalid');
select pg_temp.fails('select * from rewards.evaluate_visit(5,5,4,60, 1, 0,0, true, -5, false)', '22023', 'negative budget is invalid');
select pg_temp.fails('select * from rewards.evaluate_visit(0,5,4,60, 1, 0,0, true, 10, false)', '22023', 'zero points per visit is invalid');
select pg_temp.fails('select * from rewards.evaluate_visit(5,5,4,60, 1, 0,0, null, 10, false)', '22023', 'NULL switch is invalid');

-- Purity and "no cooldown": the pure function is IMMUTABLE, reads no table, has no clock and no interval anywhere.
select pg_temp.ok((select provolatile from pg_proc where oid = 'rewards.evaluate_visit(integer,integer,integer,integer,integer,integer,integer,boolean,integer,boolean)'::regprocedure) = 'i',
                  'evaluate_visit is IMMUTABLE');
select pg_temp.ok((select regexp_replace(prosrc, '--[^\n]*', '', 'g') !~* '(now\(|clock_timestamp|current_timestamp|statement_timestamp|transaction_timestamp|\mfrom\M|\mjoin\M|interval|rewards\.)'
                   from pg_proc where oid = 'rewards.evaluate_visit(integer,integer,integer,integer,integer,integer,integer,boolean,integer,boolean)'::regprocedure),
                  'evaluate_visit source has no clock, no table access and no interval');
select pg_temp.ok(not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                              where n.nspname = 'rewards' and (p.proargtypes::oid[] && array['interval'::regtype::oid]
                                 or p.prorettype = 'interval'::regtype)), 'no rewards function takes or returns an interval');
select pg_temp.ok(not exists (select 1 from information_schema.columns where table_schema = 'rewards' and data_type = 'interval'),
                  'no rewards column is an interval (no cooldown parameter can exist)');
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname in ('rewards', 'public') and p.prosrc ~* 'when\s+others') = 0, 'no rewards or public function uses "when others"');
select pg_temp.ok((select regexp_replace(prosrc, '--[^\n]*', '', 'g') !~* '(interval|age\(|date_part|extract\s*\(\s*epoch)'
                   from pg_proc where oid = 'rewards.record_visit_at(timestamptz,uuid,double precision,double precision,text,double precision)'::regprocedure),
                  'record_visit_at computes no interval or elapsed time between visits');
select pg_temp.finish();
