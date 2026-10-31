-- P1 test 5: expected cap handling versus unexpected failure, and the SQLSTATE hypotheses of section 6. A test-only trigger
-- injects an error into the spendable ledger insert (it lives in this throwaway database only).
\i :ROOT/supabase/tests/rewards/helpers.sql
select pg_temp.enable_rewards(1000000);

create function public.zz_inject() returns trigger language plpgsql as $$
declare code text := nullif(current_setting('test.inject', true), '');
begin
  if code is not null and new.kind = 'spendable' then
    raise exception 'injected %', code using errcode = code;
  end if;
  return new;
end $$;
create trigger zz_inject before insert on rewards.reward_ledger for each row execute function public.zz_inject();

-- ---------------------------------------------------------------- unexpected errors abort the WHOLE visit
create function pg_temp.attempt(at timestamptz, u uuid, l uuid, key text, code text) returns text language plpgsql as $$
declare st text;
begin
  perform set_config('test.inject', coalesce(code, ''), false);
  begin
    perform pg_temp.visit_at(at, u, l, key);
    perform set_config('test.inject', '', false);
    return 'ok';
  exception
    when query_canceled then   -- WHEN OTHERS never matches QUERY_CANCELED, so the probe must name it
      perform set_config('test.inject', '', false);
      return '57014';
    when others then
      get stacked diagnostics st = returned_sqlstate;
      perform set_config('test.inject', '', false);
      return st;
  end;
end $$;
select pg_temp.mkloc(33.0) as l \gset
create temp table _resid (label text, st text, visits bigint, ledger bigint, ucnt bigint, gcnt bigint);
do $$
declare c text; u uuid; n integer := 0; l uuid; st text;
begin
  select id into l from public.locations where name = 'RW loc 33';
  foreach c in array array['XX000', '23514', '23505', '40001', '40P01', '42501', '55P03', '57014', '22023', 'P0001'] loop
    n := n + 1;
    u := pg_temp.mkuser(600 + n);
    st := pg_temp.attempt('2026-10-28 15:00:00+00', u, l, 'inject-' || lpad(n::text, 12, '0'), c);
    insert into _resid values (c, st, (select count(*) from rewards.visits where user_id = u), (select count(*) from rewards.reward_ledger where user_id = u),
      (select count(*) from rewards.reward_counters_user_day where user_id = u), 0);
  end loop;
end $$;
select pg_temp.ok((select count(*) from _resid where label = st) = 10, 'every injected unexpected SQLSTATE (class XX, 23, 40, 42, 55, 57, 22, P0) propagates out of record_visit unchanged');
select pg_temp.ok((select count(*) from _resid where visits = 0 and ledger = 0 and ucnt = 0) = 10,
                  'each unexpected failure left NO visit, NO ledger row (not even the lifetime award written before the spendable block) and NO counter row');
select pg_temp.ok((select count(*) from rewards.reward_counters_global_day) = 0, 'no global counter row was created by any aborted visit');
-- A retry with the same key after the fault clears succeeds and awards normally.
select pg_temp.visit_at('2026-10-28 15:01:00+00', ('00000000-0000-0000-0000-' || lpad('601', 12, '0'))::uuid, :'l', 'inject-000000000001') as r \gset
select pg_temp.ok(pg_temp.oc(:'r'::jsonb) = 'awarded|awarded|5|5' and (:'r'::jsonb)->>'replayed' = 'false', 'a retry with the same idempotency key succeeds after an aborted attempt');

-- ---------------------------------------------------------------- the two DESIGNED codes are handled inside block S only
select coalesce((select spendable from rewards.reward_counters_global_day where issuance_day_utc = '2026-10-28'), 0) as g_before \gset
select pg_temp.mkuser(701) as ua \gset
select pg_temp.mkuser(702) as ub \gset
select pg_temp.attempt('2026-10-28 16:00:00+00', :'ua', :'l', 'designed-000000000001', 'RW001') as ra \gset
select pg_temp.ok(:'ra' = 'ok', 'the designed user-cap code RW001 is handled (the visit commits)');
select pg_temp.ok((select spendable_outcome || '|' || lifetime_outcome from rewards.visits where user_id = :'ua') = 'user_day_cap|awarded', 'RW001 inside the spendable block gives user_day_cap and keeps the lifetime award');
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'ua' and kind = 'lifetime') = 1 and (select count(*) from rewards.reward_ledger where user_id = :'ua' and kind = 'spendable') = 0,
                  'exactly one lifetime row and no spendable row remain');
select pg_temp.ok((select count(*) from rewards.reward_counters_user_day where user_id = :'ua') = 0
                  and coalesce((select spendable from rewards.reward_counters_global_day where issuance_day_utc = '2026-10-28'), 0) = :'g_before'::int,
                  'the spendable block rolled back its user and global counter increments completely');
select pg_temp.attempt('2026-10-28 16:00:00+00', :'ub', :'l', 'designed-000000000002', 'RW002') as rb \gset
select pg_temp.ok((select spendable_outcome || '|' || lifetime_outcome from rewards.visits where user_id = :'ub') = 'budget_exhausted|awarded', 'RW002 inside the spendable block gives budget_exhausted and keeps the lifetime award');
select pg_temp.ok((select count(*) from rewards.reward_counters_user_day where user_id = :'ub') = 0
                  and coalesce((select spendable from rewards.reward_counters_global_day where issuance_day_utc = '2026-10-28'), 0) = :'g_before'::int, 'and again no counter residue');

-- ---------------------------------------------------------------- section 6 hypotheses on real PostgreSQL 16 (single-session part)
-- A handler naming ONE condition catches only that condition; everything else propagates. (The real lock timeout and the real
-- cancellation are exercised with two sessions in 09_concurrency.sh.)
create function pg_temp.named_handler(code text) returns text language plpgsql as $$
begin
  begin
    raise exception 'probe' using errcode = code;
  exception when lock_not_available then return 'caught';
  end;
  return 'no error';
exception when query_canceled then return 'propagated'; when others then return 'propagated';
end $$;
select pg_temp.ok(pg_temp.named_handler('55P03') = 'caught', '55P03 is caught inside a block whose handler names lock_not_available');
select pg_temp.ok(not exists (select 1 from unnest(array['57014', '42501', '23505', '23514', '40001', '40P01', 'XX000', '22023']) c where pg_temp.named_handler(c) <> 'propagated'),
                  '57014, 42501, class 23, 40001, 40P01, class XX and 22023 are NOT caught by a named lock_not_available handler: they propagate');
-- Why handlers never use "when others": it would swallow real faults (shown for 23505, 42501, XX000). QUERY_CANCELED is the one condition OTHERS never matches.
create function pg_temp.others_handler(code text) returns text language plpgsql as $$
begin
  begin
    raise exception 'probe' using errcode = code;
  exception when others then return 'swallowed';
  end;
  return 'no error';
end $$;
select pg_temp.ok(pg_temp.others_handler('23505') = 'swallowed' and pg_temp.others_handler('42501') = 'swallowed' and pg_temp.others_handler('XX000') = 'swallowed',
                  'WHEN OTHERS would silently swallow 23505, 42501 and XX000, which is why no rewards function uses it');
select pg_temp.ok(pg_temp.others_handler('55P03') = 'swallowed', 'WHEN OTHERS would also swallow a lock timeout');
create function pg_temp.others_vs_cancel() returns text language plpgsql as $$
begin
  begin
    perform pg_temp.others_handler('57014');
  exception when query_canceled then return 'propagated';
  end;
  return 'swallowed';
end $$;
select pg_temp.ok(pg_temp.others_vs_cancel() = 'propagated', 'QUERY_CANCELED (57014) is the one condition a WHEN OTHERS handler does not catch: a cancellation always propagates');
select pg_temp.ok((select regexp_replace(prosrc, '--[^\n]*', '', 'g') ~* 'sqlstate ''RW001''' and regexp_replace(prosrc, '--[^\n]*', '', 'g') ~* 'sqlstate ''RW002'''
                          and regexp_replace(prosrc, '--[^\n]*', '', 'g') !~* 'when\s+(others|lock_not_available|query_canceled|unique_violation)'
                   from pg_proc where proname = 'record_visit_at'), 'record_visit_at handles exactly the two designed private codes and nothing broader');
select pg_temp.finish();
