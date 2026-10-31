-- P3 account deletion: the ONE purge function, extended. Account-scoped opaque chains, retained-chain severing, queue deletion, guards.
\i :ROOT/supabase/tests/rewards/p3_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(5001) as a1 \gset
select pg_temp.mkadmin(5002) as a2 \gset
select pg_temp.defn('first_stop', 1, 'qualifying_awards', 1);
select pg_temp.defn('explorer', 1, 'distinct_locations', 5, 'calendar_month');
select pg_temp.mkloc(48.01) as la \gset
select pg_temp.mkloc(48.02) as lb \gset
select pg_temp.mkloc(48.03) as lc \gset
select pg_temp.mkloc(48.04) as ld \gset
select pg_temp.mkloc(48.05) as le \gset
select pg_temp.mkuser(5101) as ua \gset
select pg_temp.mkuser(5102) as ub \gset
-- both accounts hold the SAME key and period; only A gets a revoke
select pg_temp.dv(:'ua', :'la', '2026-08-01', 'p5');
select pg_temp.dv(:'ua', :'lb', '2026-08-02', 'p5');
select pg_temp.dv(:'ua', :'lc', '2026-08-03', 'p5');
select pg_temp.dv(:'ua', :'ld', '2026-08-04', 'p5');
select pg_temp.dv(:'ua', :'le', '2026-08-05', 'p5') as va5 \gset
select pg_temp.dv(:'ub', :'la', '2026-08-01', 'p5');
select pg_temp.dv(:'ub', :'lb', '2026-08-02', 'p5');
select pg_temp.dv(:'ub', :'lc', '2026-08-03', 'p5');
select pg_temp.dv(:'ub', :'ld', '2026-08-04', 'p5');
select pg_temp.dv(:'ub', :'le', '2026-08-05', 'p5');
select pg_temp.finalize_as(:'a2', pg_temp.recommend_as(:'a1', :'va5')) as fin \gset
select pg_temp.ok(pg_temp.last_ev(:'ua', 'explorer', '2026-08') = 'revoke#2' and pg_temp.last_ev(:'ub', 'explorer', '2026-08') = 'award#1', 'setup: A has award+revoke, B only an award, same key and period');
select chain_id as ca from rewards.achievement_chains where user_id = :'ua' and achievement_key = 'explorer' \gset
select chain_id as cb from rewards.achievement_chains where user_id = :'ub' and achievement_key = 'explorer' \gset
select pg_temp.ok(:'ca' <> :'cb', 'the two chains have different opaque ids (no cross-user key/period matching)');
select (select jsonb_agg(to_jsonb(e) order by seq) from rewards.achievement_events e where chain_id = :'ca'::uuid) as ev_before \gset
insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope) values (:'ua', 'test', array['explorer|2026-08']);
select pg_temp.ok((select count(*) from rewards.achievement_chains where user_id = :'ua') = 2, 'setup: A has two chains (First Stop award-only, Explorer with a revoke)');

-- ============================================================ guards (by current_user and the auth.uid subject; nothing else works)
select pg_temp.setf('ua', :'ua'::uuid) \gset
select pg_temp.claims(:'ua', 'aal1');
select pg_temp.fails($$update rewards.achievement_chains set user_id = null where user_id = pg_temp.f('ua')$$, '42501', 'a superuser cannot sever a chain (only the purge owner may)');
select pg_temp.fails($$select set_config('rewards.purge', 'on', false); delete from rewards.achievement_events$$, '42501', 'a session flag changes nothing');
select pg_temp.claims(null, null);
select pg_temp.fails_as('reward_purge_owner', :'ub'::uuid, 'aal1', format($$update rewards.achievement_chains set user_id = null where chain_id = %L::uuid$$, :'ca'), '42501', 'purge owner with ANOTHER subject cannot sever A''s chain');
select pg_temp.fails_as('reward_purge_owner', null, null, format($$update rewards.achievement_chains set user_id = null where chain_id = %L::uuid$$, :'ca'), '42501', 'purge owner with NO subject cannot sever');
select pg_temp.fails_as('reward_purge_owner', :'ua'::uuid, 'aal1', format($$delete from rewards.achievement_chains where chain_id = %L::uuid$$, :'ca'), '42501', 'the purge owner cannot delete a chain that has a revoke (retained evidence)');
select pg_temp.fails_as('reward_purge_owner', :'ua'::uuid, 'aal1', format($$delete from rewards.achievement_events where chain_id = %L::uuid$$, :'ca'), '42501', 'the purge owner cannot delete the events of a retained chain');
select pg_temp.fails_as('reward_purge_owner', :'ua'::uuid, 'aal1', format($$update rewards.achievement_events set qualifying_value = 0 where chain_id = %L::uuid$$, :'ca'), '42501', 'the purge owner has no UPDATE on events at all');
select pg_temp.fails_as('reward_purge_owner', :'ua'::uuid, 'aal1', format($$update rewards.achievement_chains set user_id = null, period_key = 'x' where chain_id = %L::uuid$$, :'ca'), '42501', 'severing with any other changed column is refused');
select pg_temp.fails_as('reward_purge_owner', :'ua'::uuid, 'aal1', format($$update rewards.achievement_chains set user_id = %L::uuid where chain_id = %L::uuid$$, :'ub', :'ca'), '42501', 'a chain cannot be re-pointed at another account');
select chain_id as cf from rewards.achievement_chains where user_id = :'ua' and achievement_key = 'first_stop' \gset
select pg_temp.fails_as('reward_purge_owner', :'ua'::uuid, 'aal1', format($$update rewards.achievement_chains set user_id = null where chain_id = %L::uuid$$, :'cf'), '42501', 'a chain WITHOUT a revoke cannot be severed (it must be deleted instead)');
select pg_temp.fails_as('reward_purge_owner', :'ub'::uuid, 'aal1', format($$delete from rewards.achievement_events where chain_id = %L::uuid$$, :'cf'), '42501', 'purge owner with ANOTHER subject cannot delete A''s events');
select pg_temp.fails_as('reward_purge_owner', :'ua'::uuid, 'aal1', $$insert into rewards.achievement_chains (user_id, achievement_key, period_key) values (null, 'x', 'y')$$, '42501', 'the purge owner has no INSERT on chains');
select pg_temp.fails_as('reward_writer_owner', :'ua'::uuid, 'aal1', format($$update rewards.achievement_chains set user_id = null where chain_id = %L::uuid$$, :'ca'), '42501', 'the writer cannot sever or edit a chain');
select pg_temp.fails_as('reward_writer_owner', :'ua'::uuid, 'aal1', $$delete from rewards.achievement_events$$, '42501', 'the writer cannot delete events');
select pg_temp.fails_as('authenticated', :'ua'::uuid, 'aal1', $$select count(*) from rewards.achievement_chains$$, '42501', 'a client has no table access (schema is not exposed)');
select pg_temp.fails_as('service_role', :'ua'::uuid, 'aal1', $$select count(*) from rewards.achievement_events$$, '42501', 'service_role has no table access either');

-- ============================================================ the real purge for A, through the existing deletion path
select pg_temp.as_role('authenticated', :'ua'::uuid, 'aal1', $$select public.delete_my_account('DELETE')::text$$) as r \gset
select pg_temp.ok(not exists (select 1 from auth.users where id = :'ua'::uuid), 'A''s account is deleted');
select pg_temp.ok(not exists (select 1 from rewards.achievement_chains where user_id = :'ua'::uuid) and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
                  'no chain or queue row still references the deleted account');
select pg_temp.ok((select count(*) from rewards.achievement_chains where chain_id = :'cf'::uuid) = 0 and (select count(*) from rewards.achievement_events where chain_id = :'cf'::uuid) = 0,
                  'A''s award-only chain and its events were DELETED');
select pg_temp.ok((select user_id is null and achievement_key = 'explorer' and period_key = '2026-08' from rewards.achievement_chains where chain_id = :'ca'::uuid), 'A''s retained chain is SEVERED (user_id NULL), chain_id/key/period unchanged');
select pg_temp.ok((select jsonb_agg(to_jsonb(e) order by seq) from rewards.achievement_events e where chain_id = :'ca'::uuid) = :'ev_before'::jsonb, 'every event of the retained chain is byte-for-byte unchanged (award, then revoke with its reversal and decision)');
select pg_temp.ok((select count(*) from rewards.achievement_events e join rewards.reward_ledger l on l.id = e.basis_entry_id join rewards.reward_decisions d on d.id = e.decision_id where e.chain_id = :'ca'::uuid and e.event = 'revoke') = 1,
                  'the retained revoke still resolves to its reversal ledger entry and decision (kept together)');
select pg_temp.ok((select count(*) from rewards.achievement_chains where chain_id = :'cb'::uuid and user_id = :'ub'::uuid) = 1 and (select count(*) from rewards.achievement_events where chain_id = :'cb'::uuid) = 1,
                  'B''s chain for the SAME key and period is untouched by A''s purge');
select (select count(*) from rewards.achievement_events) as ne, (select count(*) from rewards.achievement_chains) as nc \gset
select pg_temp.claims(:'ua', 'aal1');
select rewards.purge_my_reward_data() as again \gset
select pg_temp.claims(null, null);
select pg_temp.ok((select count(*) from rewards.achievement_events) = :'ne'::int and (select count(*) from rewards.achievement_chains) = :'nc'::int, 'a repeated purge for A is a no-op: severed chains match no account');

-- ============================================================ B's deletion, and the severed chain stays out of every later account's reach
select pg_temp.as_role('authenticated', :'ub'::uuid, 'aal1', $$select public.delete_my_account('DELETE')::text$$) as r2 \gset
select pg_temp.ok((select count(*) from rewards.achievement_chains where chain_id = :'cb'::uuid) = 0 and (select count(*) from rewards.achievement_events where chain_id = :'cb'::uuid) = 0, 'B''s chain and events are deleted');
select pg_temp.ok((select count(*) from rewards.achievement_chains where chain_id = :'ca'::uuid and user_id is null) = 1, 'the severed chain remains, matched by no one');
select pg_temp.ok(not exists (select 1 from rewards.achievement_chains c where c.user_id is not null and not exists (select 1 from auth.users u where u.id = c.user_id)), 'no chain references a deleted account');
-- a deleted/unknown subject never recreates user-linked state
select rewards.evaluate_achievements(:'ua'::uuid, array['explorer|2026-08', 'first_stop|lifetime'], null);
select pg_temp.ok((select count(*) from rewards.achievement_chains where user_id = :'ua'::uuid) = 0 and not exists (select 1 from rewards.achievement_eval_queue where user_id = :'ua'::uuid),
                  'evaluating a deleted subject creates no chain, event or queue row');

select pg_temp.finish();
