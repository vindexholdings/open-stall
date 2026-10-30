\i :ROOT/supabase/tests/rewards/helpers.sql
select pg_temp.ok(to_regclass('rewards.reward_holds') is not null, 'p2 build present');
select pg_temp.finish();
