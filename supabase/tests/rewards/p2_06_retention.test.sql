-- P2 test 6: cleared-hold retention (approved provisional 90 days after clearance) and NO other deletion path; confirmed-fraud audit
-- retention is unresolved owner policy, so nothing expires or is purged for it.
\i :ROOT/supabase/tests/rewards/p2_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(6001) as a1 \gset
select pg_temp.mkuser(6101) as u1 \gset
select pg_temp.mkuser(6102) as u2 \gset
select pg_temp.mkuser(6103) as u3 \gset
select pg_temp.mkuser(6104) as u4 \gset

-- fixtures inserted as the migration owner (superuser): holds cleared at various ages, one active
create function pg_temp.mkhold(u uuid, cleared_ago interval) returns uuid language plpgsql as $$
declare hd uuid; cd uuid; hid uuid;
begin
  insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, reason) values ('hold_user', pg_temp.f('a1'), u, 'fixture hold') returning id into hd;
  if cleared_ago is null then
    insert into rewards.reward_holds (user_id, hold_decision_id) values (u, hd) returning id into hid;
  else
    insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, reason) values ('clear_hold', pg_temp.f('a1'), u, 'fixture clear') returning id into cd;
    insert into rewards.reward_holds (user_id, hold_decision_id, cleared_decision_id, cleared_at) values (u, hd, cd, clock_timestamp() - cleared_ago) returning id into hid;
  end if;
  return hid;
end $$;
select pg_temp.setf('a1', :'a1');
select pg_temp.mkhold(:'u1', interval '91 days') as h91 \gset
select pg_temp.mkhold(:'u2', interval '89 days 23 hours') as h89 \gset
select pg_temp.mkhold(:'u3', interval '1 day') as h1 \gset
select pg_temp.mkhold(:'u4', null) as hact \gset
select count(*) as ndec from rewards.reward_decisions \gset

select pg_temp.fails(format($$delete from rewards.reward_holds where id = %L::uuid$$, :'h89'), '42501', 'a hold cleared 89 days 23 hours ago cannot be deleted (even by a superuser)');
select pg_temp.fails(format($$delete from rewards.reward_holds where id = %L::uuid$$, :'h1'), '42501', 'a recently cleared hold cannot be deleted');
select pg_temp.fails(format($$delete from rewards.reward_holds where id = %L::uuid$$, :'hact'), '42501', 'an ACTIVE hold cannot be deleted');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$delete from rewards.reward_holds where id = %L::uuid$$, :'h89'), '42501', 'the writer cannot delete a hold inside the 90 days');
select pg_temp.fails_as('reward_purge_owner', :'u3'::uuid, 'aal1', format($$delete from rewards.reward_holds where id = %L::uuid$$, :'h1'), '42501', 'the purge owner cannot delete holds at all');
select pg_temp.fails_as('authenticated', :'u1'::uuid, 'aal1', $$select rewards.expire_cleared_holds()::text$$, '42501', 'a client cannot invoke expiry');
select pg_temp.fails_as('service_role', :'u1'::uuid, 'aal1', $$select rewards.expire_cleared_holds()::text$$, '42501', 'service_role cannot invoke expiry');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$update rewards.reward_holds set cleared_decision_id = hold_decision_id, cleared_at = clock_timestamp() where id = %L::uuid$$, :'hact'), '42501',
                        'the writer cannot clear a hold with a decision that is not a clear_hold for the same account');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$update rewards.reward_holds set cleared_decision_id = (select id from rewards.reward_decisions where decision_type = 'clear_hold' and subject_user_id = %L::uuid), cleared_at = clock_timestamp() where id = %L::uuid$$, :'u3', :'hact'), '42501',
                        'the writer cannot clear a hold with another account''s clear_hold decision');
select pg_temp.fails($$update rewards.reward_holds set cleared_at = cleared_at - interval '100 days'$$, '42501', 'a clearance time cannot be back-dated to make a hold expire');
select pg_temp.ok((select count(*) from rewards.reward_holds) = 4, 'no refused attempt deleted a hold');

set role reward_writer_owner;
select rewards.expire_cleared_holds() as n_exp \gset
reset role;
select pg_temp.ok(:'n_exp'::int = 1 and not exists (select 1 from rewards.reward_holds where id = :'h91'::uuid)
              and (select count(*) from rewards.reward_holds where id in (:'h89'::uuid, :'h1'::uuid, :'hact'::uuid)) = 3,
                  'expiry removed exactly the hold cleared 91 days ago and kept the 89-day, 1-day and active holds');
select pg_temp.ok((select count(*) from rewards.reward_decisions) = :'ndec'::int, 'expiring a hold keeps every decision (the audit is not expired)');
-- exactly the one approved rule: nothing else deletes anything
select pg_temp.ok((select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('rewards', 'public')
                    and p.prosrc ~* 'delete\s+from\s+rewards\.reward_decisions') = 0, 'no function deletes from reward_decisions (confirmed-fraud audit has no expiry or purge)');
select pg_temp.ok((select array_agg(p.proname::text order by p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('rewards', 'public')
                    and p.prosrc ~* 'delete\s+from\s+rewards\.(reward_ledger|visits)') = array['purge_my_reward_data'], 'only the purge function deletes visits or ledger rows');
select pg_temp.ok((select array_agg(p.proname::text order by p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('rewards', 'public')
                    and p.prosrc ~* 'delete\s+from\s+rewards\.reward_holds') = array['expire_cleared_holds'], 'only expiry deletes holds');
-- Retention intervals: P2 allows exactly the 90 days on cleared holds. On the P3 build the engine additionally computes the END of a calendar-month
-- window (interval '1 month'; a window length, never a retention period): exactly those two P3 functions may contain it, and only that literal.
select pg_temp.ok((select array_agg(p.proname::text order by p.proname::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where (n.nspname = 'rewards' or p.proname ~ '^admin_reward_|^delete_my_account$|^record_visit$|^get_my_progress$|^repair_achievements$') and p.prosrc ~* 'interval\s+''[0-9]+\s+(day|month|year|week)')
                  = case when :'p3' then array['ach_candidate_chains', 'evaluate_achievements', 'expire_cleared_holds', 'get_my_progress', 'guard_holds_change'] else array['expire_cleared_holds', 'guard_holds_change'] end
              and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname = 'rewards' and p.proname not in ('evaluate_achievements', 'ach_candidate_chains') and p.prosrc ~* 'interval\s+''[0-9]+\s+(day|month|year|week)' and p.prosrc !~* '90 days')
              and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname in ('rewards', 'public') and p.proname in ('evaluate_achievements', 'get_my_progress', 'ach_candidate_chains') and p.prosrc ~* 'interval\s+''[0-9]+\s+(day|week|year)')
              and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                               where n.nspname in ('rewards', 'public') and p.proname in ('evaluate_achievements', 'get_my_progress', 'ach_candidate_chains')
                                 and exists (select 1 from regexp_matches(p.prosrc, 'interval\s+''([0-9]+)\s+month', 'gi') m where m[1] <> '1')),
                  'the only retention interval in the rewards function sources is the approved 90 days on cleared holds (P3 adds only a one-month window length / month step in three functions)');
-- a VALID clearance still works for the writer (the guard admits exactly one clear_hold decision of the same account, once)
select pg_temp.mkuser(6105) as u5 \gset
select pg_temp.mkhold(:'u5', null) as h5 \gset
insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, reason) values ('clear_hold', :'a1', :'u5', 'valid clearance') returning id as d5 \gset
select pg_temp.as_role('reward_writer_owner', null, null, format($$update rewards.reward_holds set cleared_decision_id = %L::uuid, cleared_at = clock_timestamp() where id = %L::uuid returning id::text$$, :'d5', :'h5')) as upd \gset
select pg_temp.ok((select cleared_decision_id = :'d5'::uuid and cleared_at is not null from rewards.reward_holds where id = :'h5'::uuid), 'a valid clearance (clear_hold decision of the same account) is accepted for the writer');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$update rewards.reward_holds set cleared_decision_id = %L::uuid, cleared_at = clock_timestamp() - interval '100 days' where id = %L::uuid$$, :'d5', :'h5'), '42501', 'an already cleared hold cannot be cleared again or back-dated');
-- null / low accuracy: stored as weak signals only, never an automatic hold or action
select pg_temp.mkloc(49.0) as l \gset
select pg_temp.mkuser(6201) as w \gset
select pg_temp.visit_at('2026-10-20 15:00:00+00', :'w', :'l', 'acc-null-0000000000001', null, null);
select pg_temp.visit_at('2026-10-20 15:00:01+00', :'w', :'l', 'acc-over-0000000000001', null, 500);
select pg_temp.ok((select array_agg(coalesce(accuracy_bucket, 'null') order by occurred_at) from rewards.visits where user_id = :'w') = array['null', 'over_50'], 'a missing accuracy stays NULL and a poor accuracy is only a coarse bucket');
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'w' and spendable_outcome = 'awarded') = 2 and (select count(*) from rewards.reward_holds where user_id = :'w') = 0,
                  'weak or missing accuracy neither blocks an award nor creates a hold (no automatic punitive action)');
select pg_temp.finish();
