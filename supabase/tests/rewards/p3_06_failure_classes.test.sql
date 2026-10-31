-- P3 failure classes. Recoverable (55P03 under the bounded lock_timeout is proven in p3_07; private OSA01 here): the visit, both reward
-- kinds, the clearance and the reversal are PRESERVED and a dirty queue row COMMITS with them. Everything else propagates and aborts the whole
-- transaction. Injection is a test-only trigger created inside this disposable clone; nothing in rewards-wip raises these.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(7001) as a1 \gset
select pg_temp.mkadmin(7002) as a2 \gset
select pg_temp.defn('first_stop', 1, 'qualifying_awards', 1);
select pg_temp.defn('explorer', 1, 'distinct_locations', 5, 'calendar_month');
create function public.p3test_inject() returns trigger language plpgsql as $$
declare c text := current_setting('p3test.code', true);
begin
  if c is not null and c <> '' then raise exception 'injected %', c using errcode = c; end if;
  return new;
end $$;
create trigger p3test_inject before insert on rewards.achievement_events for each row execute function public.p3test_inject();
select pg_temp.mkloc(50.01) as la \gset
select pg_temp.mkloc(50.02) as lb \gset
select pg_temp.mkloc(50.03) as lc \gset
select pg_temp.mkloc(50.04) as ld \gset
select pg_temp.mkloc(50.05) as le \gset
select pg_temp.mkuser(7101) as u \gset
select pg_temp.setf('u', :'u'::uuid) \gset

-- ============================================================ propagating classes abort the WHOLE transaction (no visit, no award, no event, no queue row)
create function pg_temp.inject_visit(code text, key text) returns text language plpgsql as $$
begin
  perform set_config('p3test.code', code, false);
  perform pg_temp.visit_at('2026-08-03 18:00:00+00', pg_temp.f('u'), (select id from public.locations where latitude = 50.01), key);
  return 'ok';
end $$;
select pg_temp.fails($$select pg_temp.inject_visit('42501', 'p3-prop-0000000000000001')$$, '42501', 'injected 42501 (privilege) propagates out of the visit');
select pg_temp.fails($$select pg_temp.inject_visit('23505', 'p3-prop-0000000000000002')$$, '23505', 'injected class 23 (integrity) propagates');
select pg_temp.fails($$select pg_temp.inject_visit('XX000', 'p3-prop-0000000000000003')$$, 'XX000', 'injected class XX (internal/corruption) propagates');
select pg_temp.fails($$select pg_temp.inject_visit('OSA02', 'p3-prop-0000000000000004')$$, 'OSA02', 'injected OSA02 (identity/authorization mismatch) propagates');
select pg_temp.fails($$select pg_temp.inject_visit('40001', 'p3-prop-0000000000000005')$$, '40001', 'injected 40001 (serialization) propagates');
select pg_temp.fails($$select pg_temp.inject_visit('40P01', 'p3-prop-0000000000000006')$$, '40P01', 'injected 40P01 (deadlock) propagates');
-- 57014 (cancel/timeout) cannot be injected by RAISE and observed from a PL/pgSQL handler (WHEN OTHERS never catches it); it is exercised with a real
-- statement_timeout and a real pg_cancel_backend in p3_07_cancel_lock_races.sh.
select pg_temp.fails($$select pg_temp.inject_visit('RW040', 'p3-prop-0000000000000008')$$, 'RW040', 'an unlisted custom integrity code propagates (no catch-all handler)');
select set_config('p3test.code', '', false);
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'u'::uuid) = 0 and (select count(*) from rewards.reward_ledger where user_id = :'u'::uuid) = 0
              and (select count(*) from rewards.achievement_events) = 0 and (select count(*) from rewards.achievement_eval_queue) = 0,
                  'every propagating failure left NOTHING: no visit, no ledger row, no event, no queue row');

-- ============================================================ OSA01 is recoverable on the VISIT path: reward committed, dirty queue committed
select set_config('p3test.code', 'OSA01', false);
select pg_temp.visit_at('2026-08-03 18:00:00+00', :'u', :'la', 'p3-rec-0000000000000001') as rv \gset
select set_config('p3test.code', '', false);
select pg_temp.ok((:'rv'::jsonb ->> 'lifetime_outcome') = 'awarded' and (:'rv'::jsonb ->> 'spendable_outcome') = 'awarded', 'a recoverable achievement failure still commits the visit and BOTH reward kinds');
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'u'::uuid and entry_type = 'award') = 2, 'both ledger awards exist');
select pg_temp.ok((select count(*) from rewards.achievement_events) = 0, 'the failed savepoint rolled back its event writes before the queue write');
select pg_temp.ok((select last_sqlstate = 'OSA01' and attempts = 1 and reason = 'visit' and dirty_scope @> array['first_stop|lifetime', 'explorer|2026-08'] from rewards.achievement_eval_queue where user_id = :'u'::uuid),
                  'a committed dirty queue row records the unevaluated chains (union of scope) and the SQLSTATE');
-- the queue scope is UNIONED and never overwritten
select set_config('p3test.code', 'OSA01', false);
select pg_temp.dv(:'u', :'lb', '2026-09-04', 'rec2');
select set_config('p3test.code', '', false);
select pg_temp.ok((select dirty_scope @> array['first_stop|lifetime', 'explorer|2026-08', 'explorer|2026-09'] and attempts = 2 from rewards.achievement_eval_queue where user_id = :'u'::uuid), 'a second failure UNIONS its scope into the same row (August kept, September added), attempts 2');
-- a mixed scope: the valid chain is rolled back together with the bad one, both are retained for repair
select rewards.ach_run(:'u', array['first_stop|lifetime', 'ghost_key|lifetime'], null, 'forged');
select pg_temp.ok((select count(*) from rewards.achievement_events) = 0 and (select dirty_scope @> array['ghost_key|lifetime'] from rewards.achievement_eval_queue where user_id = :'u'::uuid),
                  'a forged scope entry (unknown key) is a recoverable OSA01: nothing partial is written, the whole scope is retained');
select pg_temp.fails($$select rewards.evaluate_achievements(pg_temp.f('u'), array['not a valid entry'], null)$$, 'OSA01', 'a malformed scope entry is rejected with OSA01');
select pg_temp.fails($$select rewards.evaluate_achievements(null, array['first_stop|lifetime'], null)$$, '22023', 'a missing subject is rejected');

-- ============================================================ repair resolves the queue (admin-gated, mechanical)
select pg_temp.fails_as('authenticated', :'u'::uuid, 'aal2', $$select public.repair_achievements(5)::text$$, '42501', 'a non-admin cannot repair');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal1', $$select public.repair_achievements(5)::text$$, '42501', 'an admin without aal2 cannot repair');
select pg_temp.fails_as('anon', null, null, $$select public.repair_achievements(5)::text$$, '42501', 'anon cannot repair');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', $$select public.repair_achievements(0)::text$$, '22023', 'p_limit 0 is rejected');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', $$select public.repair_achievements(-3)::text$$, '22023', 'a negative p_limit is rejected');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', $$select public.repair_achievements(null)::text$$, '22023', 'a NULL p_limit is rejected');
-- the forged ghost entry would keep failing: remove it from the scope the way a real catalog fix would, by giving it a definition
select pg_temp.defn('ghost_key', 1, 'qualifying_awards', 1);
select pg_temp.as_role('authenticated', :'a1'::uuid, 'aal2', $$select public.repair_achievements(1000)::text$$) as rep \gset
select pg_temp.ok((:'rep'::jsonb ->> 'processed')::int = 1 and (:'rep'::jsonb ->> 'skipped_locked')::int = 0, 'a p_limit above 20 is clamped (documented): one queued user processed');
select pg_temp.ok(not exists (select 1 from rewards.achievement_eval_queue) and pg_temp.last_ev(:'u', 'first_stop', 'lifetime') = 'award#1' and pg_temp.last_ev(:'u', 'ghost_key', 'lifetime') = 'award#1',
                  'repair evaluated the retained scope and CLEARED the queue (no event was ever fabricated before it)');
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'u'::uuid) = 4, 'repair changed no ledger data');

-- ============================================================ recoverable failure on CLEARANCE: awards still commit; the badge catches up by repair
select pg_temp.mkuser(7102) as uc \gset
select pg_temp.dv(:'uc', :'la', '2026-07-01', 'cl');
select pg_temp.dv(:'uc', :'lb', '2026-07-02', 'cl');
select pg_temp.dv(:'uc', :'lc', '2026-07-03', 'cl');
select pg_temp.dv(:'uc', :'ld', '2026-07-04', 'cl');
select pg_temp.hold_as(:'a1', :'uc') as h \gset
select pg_temp.dv(:'uc', :'le', '2026-07-30', 'cl') as vh \gset
select set_config('p3test.code', 'OSA01', false);
select pg_temp.clear_as(:'a2', :'uc') as cl \gset
select set_config('p3test.code', '', false);
select pg_temp.ok((:'cl'::jsonb ->> 'visits_cleared')::int = 1 and (:'cl'::jsonb ->> 'lifetime_awarded')::int = 5 and pg_temp.clr(:'vh'::uuid) = 'awarded|awarded', 'the clearance (visit award, clearance record, hold cleared) committed despite the achievement failure');
select pg_temp.ok(pg_temp.last_ev(:'uc', 'explorer', '2026-07') = 'none' and (select dirty_scope @> array['explorer|2026-07'] from rewards.achievement_eval_queue where user_id = :'uc'::uuid), 'the badge is not yet awarded; the July chain is queued dirty');
select pg_temp.as_role('authenticated', :'a1'::uuid, 'aal2', $$select public.repair_achievements(20)::text$$);
select pg_temp.ok(pg_temp.last_ev(:'uc', 'explorer', '2026-07') = 'award#1' and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'uc'::uuid), 'repair awards the July badge and clears the queue');

-- ============================================================ recoverable failure on REVERSAL: reversal commits; stale badge is never shown as earned
select pg_temp.mkuser(7103) as ur \gset
select pg_temp.dv(:'ur', :'la', '2026-06-01', 'rv');
select pg_temp.dv(:'ur', :'lb', '2026-06-02', 'rv');
select pg_temp.dv(:'ur', :'lc', '2026-06-03', 'rv');
select pg_temp.dv(:'ur', :'ld', '2026-06-04', 'rv');
select pg_temp.dv(:'ur', :'le', '2026-06-05', 'rv') as vre \gset
select pg_temp.ok(pg_temp.last_ev(:'ur', 'explorer', '2026-06') = 'award#1', 'setup: June Explorer earned');
select set_config('p3test.code', 'OSA01', false);
select pg_temp.finalize_as(:'a2', pg_temp.recommend_as(:'a1', :'vre')) as fr \gset
select set_config('p3test.code', '', false);
select pg_temp.ok((:'fr'::jsonb ->> 'reversed_lifetime')::int = 5 and (select count(*) from rewards.reward_ledger where user_id = :'ur'::uuid and entry_type = 'reversal') = 2, 'the reversal (both kinds) committed despite the achievement failure');
select pg_temp.ok(pg_temp.last_ev(:'ur', 'explorer', '2026-06') = 'award#1' and (select dirty_scope @> array['explorer|2026-06'] from rewards.achievement_eval_queue where user_id = :'ur'::uuid), 'the badge still shows its old award event; the chain is queued dirty');
-- while the failure persists, the read cannot repair: the entry is reported unavailable (never zero, never earned)
select set_config('p3test.code', 'OSA01', false);
select pg_temp.ok((pg_temp.prog(:'ur', 'explorer', '2026-06') ->> 'state') = 'unavailable' and (pg_temp.prog(:'ur', 'explorer', '2026-06') ->> 'value') is null,
                  'a pending, unrepairable chain is reported as unavailable with no number (never earned, never a zero)');
select set_config('p3test.code', '', false);
-- the next successful read repairs ONLY the caller's own row (user lock first) and reports the truth
select pg_temp.ok((pg_temp.prog(:'ur', 'explorer', '2026-06') ->> 'state') = 'removed', 'once repairable, the read-repair appends the revoke and the badge reads removed (not earned)');
select pg_temp.ok(pg_temp.last_ev(:'ur', 'explorer', '2026-06') = 'revoke#2' and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ur'::uuid), 'the revoke is in the log and the caller''s queue row is cleared');

select pg_temp.finish();
