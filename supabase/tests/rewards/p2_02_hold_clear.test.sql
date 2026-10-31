-- P2 test 2: holds reserve nothing; clearing awards from the FROZEN original day, only remaining original-day capacity, current gates.
\i :ROOT/supabase/tests/rewards/p2_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(2001) as a1 \gset
select pg_temp.mkadmin(2002) as a2 \gset
select pg_temp.setf('a1', :'a1');
select pg_temp.mkloc(44.0) as la \gset
select pg_temp.mkloc(44.1) as lb \gset

-- ============================================================ a hold records visits as held, no award, no counter, no reservation
select pg_temp.mkuser(2101) as u \gset
select pg_temp.vo('2026-10-20 14:00:00+00', :'u', :'la', 'before-hold-000000001') as pre \gset
select pg_temp.ok(:'pre' = 'awarded|awarded|5|5', 'before any hold the visit is rewarded normally');
select count(*) as nct from rewards.reward_counters_user_day \gset
select spendable as gct from rewards.reward_counters_global_day where issuance_day_utc = '2026-10-20' \gset
select pg_temp.hold_as(:'a1', :'u') as hd \gset
select pg_temp.vo('2026-10-20 15:00:00+00', :'u', :'la', 'held-0000000000000001') as h1 \gset
select pg_temp.vo('2026-10-20 15:00:05+00', :'u', :'la', 'held-0000000000000002') as h2 \gset
select pg_temp.vo('2026-10-20 15:00:10+00', :'u', :'lb', 'held-0000000000000003') as h3 \gset
select pg_temp.ok(:'h1' = 'held|held|0|0' and :'h2' = 'held|held|0|0' and :'h3' = 'held|held|0|0', 'visits under an active hold are recorded as held with no points');
select pg_temp.ok((select array_agg(ordinal order by occurred_at) from rewards.visits where user_id = :'u' and idempotency_key like 'held-%' and location_id = :'la') = array[2, 3],
                  'held visits keep their slots (ordinals continue after the earlier rewarded visit)');
select pg_temp.ok((select count(*) from rewards.reward_ledger where user_id = :'u') = 2, 'a hold wrote no ledger rows (only the two pre-hold awards exist)');
select pg_temp.ok((select count(*) from rewards.reward_counters_user_day) = :'nct'::int
              and (select spendable from rewards.reward_counters_global_day where issuance_day_utc = '2026-10-20') = :'gct'::int,
                  'a hold reserves no capacity: user and global counters are unchanged by held visits');
select pg_temp.ok((select pg_temp.oc(pg_temp.visit_at('2026-10-20 15:00:00+00', :'u', :'la', 'held-0000000000000001'))) = 'held|held|0|0',
                  'replaying a held visit returns the identical held result');
select pg_temp.ok((select count(*) from rewards.reward_holds where user_id = :'u' and cleared_at is null) = 1 and (select count(*) from rewards.reward_holds) = 1,
                  'exactly one active hold exists and no visit (null or low accuracy included) created any other');
select pg_temp.mkuser(2102) as other \gset
select pg_temp.vo('2026-10-20 15:00:00+00', :'other', :'la', 'unheld-000000000001') as oth \gset
select pg_temp.ok(:'oth' = 'awarded|awarded|5|5', 'a hold on one account never affects another account');

-- ============================================================ clearing: original day, frozen policy, remaining capacity
-- A future policy version (prospective) with different amounts; after it takes effect the cleared awards must STILL use the original version.
insert into rewards.reward_policy_versions (effective_from, spendable_per_visit, lifetime_first_daily, max_rewarded_per_location_day, max_spendable_per_user_utc_day)
  values (clock_timestamp() + interval '1 second', 7, 9, 2, 14);
select pg_sleep(1.3);
select pg_temp.clear_as(:'a1', :'u') as cl \gset
select pg_temp.ok((:'cl'::jsonb ->> 'visits_cleared')::int = 3 and (:'cl'::jsonb ->> 'spendable_awarded')::int = 15 and (:'cl'::jsonb ->> 'lifetime_awarded')::int = 5,
                  'clearing awarded 3 held visits from the ORIGINAL policy: 5+5+5 spendable and one lifetime 5 (not the new 7/9 policy)');
select pg_temp.ok((select count(*) from rewards.reward_ledger l join rewards.visits v on v.id = l.visit_id
                    where l.user_id = :'u' and v.idempotency_key like 'held-%' and l.policy_version_id = v.policy_version_id and l.policy_day_local = v.policy_day_local
                      and l.reason = 'cleared_hold_award') = 4,
                  'every cleared award carries the visit''s frozen policy version and original local day (4 rows: 3 spendable + 1 lifetime)');
select pg_temp.ok((select count(*) from rewards.reward_ledger l where l.user_id = :'u' and l.reward_decision_id = (:'cl'::jsonb ->> 'decision_id')::uuid) = 4,
                  'every cleared award references the clear_hold decision');
select pg_temp.ok((select pg_temp.clr(id) from rewards.visits where idempotency_key = 'held-0000000000000003' and user_id = :'u') = 'awarded|awarded',
                  'the first visit at a second restroom that day earns the lifetime award at clearance');
select pg_temp.ok((select spendable from rewards.reward_counters_user_day where user_id = :'u' and issuance_day_utc = '2026-10-20') = 20
              and (select count(*) from rewards.reward_counters_user_day where user_id = :'u' and issuance_day_utc >= '2026-10-21') = 0,
                  'cleared issuance lands on the ORIGINAL UTC day counter (5 pre-hold + 15 cleared = 20), never on today');
select pg_temp.ok((select count(*) from rewards.reward_holds where user_id = :'u' and cleared_at is not null) = 1 and (select count(*) from rewards.reward_holds where user_id = :'u' and cleared_at is null) = 0,
                  'the hold is cleared exactly once');
select pg_temp.fails($$select rewards.award_held_visit((select id from rewards.visits where idempotency_key = 'held-0000000000000001'), gen_random_uuid())$$, 'RW033', 'a cleared visit cannot be awarded twice');
select pg_temp.ok((select pg_temp.oc(pg_temp.visit_at(clock_timestamp() + interval '1 hour', :'u', :'la', 'after-clear-00000001'))) = 'awarded|awarded|7|9',
                  'after clearing, NEW visits are recorded normally under the new policy (no lingering hold effect)');
select pg_temp.ok((select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
                    where n.nspname = 'rewards' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped and a.attname ~* '(^|_)(lat|lng|lon|latitude|longitude|gps|device|fingerprint|ip)(_|$)') = 0,
                  'no rewards table stores coordinates, device identifiers, fingerprints or IP addresses');

-- ============================================================ remaining-capacity rules at clearance (user day cap, location cap, global budget)
-- user UTC-day cap already consumed by 12 other visits that day (60), then a held visit at a 13th restroom
select pg_temp.mkuser(2201) as ucap \gset
create temp table _locs as select pg_temp.mkloc(45.0 + g / 100.0) as l, g from generate_series(1, 13) g;
select pg_temp.as_user(:'ucap');
select pg_temp.visit_at('2026-10-22 15:00:00+00', :'ucap', l, 'cap-fill-' || lpad(g::text, 11, '0')) from _locs where g <= 12 order by g;
select pg_temp.ok((select spendable from rewards.reward_counters_user_day where user_id = :'ucap' and issuance_day_utc = '2026-10-22') = 60, 'setup: the user already reached the 60 spendable UTC-day cap');
select pg_temp.hold_as(:'a1', :'ucap');
select pg_temp.visit_at('2026-10-22 18:00:00+00', :'ucap', (select l from _locs where g = 13), 'cap-held-0000000001') as r \gset
select pg_temp.clear_as(:'a1', :'ucap') as cl2 \gset
select pg_temp.ok((select pg_temp.clr(id) from rewards.visits where user_id = :'ucap' and idempotency_key = 'cap-held-0000000001') = 'user_day_cap|awarded',
                  'clearing respects the ORIGINAL day''s exhausted user cap (spendable user_day_cap) while the independent lifetime award still lands');
select pg_temp.ok((select spendable from rewards.reward_counters_user_day where user_id = :'ucap' and issuance_day_utc = '2026-10-22') = 60, 'the user counter did not move and no capacity was reopened');

-- location cap: held visits at ordinals 5 and 6 of one restroom/day
select pg_temp.mkuser(2301) as uloc \gset
select pg_temp.hold_as(:'a1', :'uloc');
select pg_temp.visit_at(('2026-10-23 15:00:0' || g || '+00')::timestamptz, :'uloc', :'lb', 'loc-held-00000000000' || g) from generate_series(1, 6) g;
select pg_temp.clear_as(:'a1', :'uloc') as cl3 \gset
select pg_temp.ok((select string_agg(pg_temp.clr(v.id), ',' order by v.ordinal) from rewards.visits v where v.user_id = :'uloc')
                 = 'awarded|awarded,awarded|not_first_daily,awarded|not_first_daily,awarded|not_first_daily,location_cap|not_first_daily,location_cap|not_first_daily',
                  'clearing applies the original location slots: ordinals 1-4 awarded, 5 and 6 location_cap, lifetime only on ordinal 1');

-- global budget: exhaust the budget for the day first, then clear a held visit from that day
select pg_temp.set_settings(true, 10);
select pg_temp.mkuser(2401) as ub1 \gset
select pg_temp.mkuser(2402) as ub2 \gset
select pg_temp.hold_as(:'a1', :'ub2');
select pg_temp.visit_at('2026-10-24 15:00:00+00', :'ub2', :'la', 'bud-held-00000000001') as r \gset
select pg_temp.vo('2026-10-24 15:00:00+00', :'ub1', :'la', 'bud-fill-00000000001') as f1 \gset
select pg_temp.vo('2026-10-24 15:00:01+00', :'ub1', :'la', 'bud-fill-00000000002') as f2 \gset
select pg_temp.clear_as(:'a1', :'ub2') as cl4 \gset
select pg_temp.ok((select pg_temp.clr(id) from rewards.visits where user_id = :'ub2') = 'budget_exhausted|awarded', 'clearing respects the original day''s exhausted global budget');
select pg_temp.set_settings(true, 1000000);

-- gates at clearance time: disabled and unset block BOTH award kinds; the visit stays unrewarded and is never retried
select pg_temp.mkuser(2501) as ug \gset
select pg_temp.hold_as(:'a1', :'ug');
select pg_temp.visit_at('2026-10-25 15:00:00+00', :'ug', :'la', 'gate-held-0000000001') as r \gset
select pg_temp.set_settings(false, 1000000);
select pg_temp.clear_as(:'a1', :'ug') as cl5 \gset
select pg_temp.ok((select pg_temp.clr(id) from rewards.visits where user_id = :'ug') = 'rewards_disabled|rewards_disabled' and (select count(*) from rewards.reward_ledger where user_id = :'ug') = 0,
                  'clearing while rewards are DISABLED awards neither kind');
select pg_temp.set_settings(true, null);
select pg_temp.mkuser(2502) as ug2 \gset
select pg_temp.set_settings(true, 1000000);
select pg_temp.hold_as(:'a1', :'ug2');
select pg_temp.visit_at('2026-10-25 15:00:00+00', :'ug2', :'la', 'gate-held-0000000002') as r \gset
select pg_temp.set_settings(true, null);
select pg_temp.clear_as(:'a1', :'ug2') as cl6 \gset
select pg_temp.ok((select pg_temp.clr(id) from rewards.visits where user_id = :'ug2') = 'budget_unset|rewards_disabled' and (select count(*) from rewards.reward_ledger where user_id = :'ug2') = 0,
                  'clearing with the budget UNSET awards neither kind (lifetime included)');
select pg_temp.set_settings(true, 1000000);
-- the writer's ledger gate also refuses a cleared-hold style award of either kind while disabled/unset (independent of the function)
select pg_temp.set_settings(false, 1000000);
select pg_temp.fails_as('reward_writer_owner', null, null, $$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reward_decision_id)
  select 'award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'spendable', 5, 'cleared_hold_award', (select id from rewards.reward_decisions limit 1) from rewards.visits v limit 1$$, 'RW010', 'the ledger gate refuses a cleared-hold award while rewards are disabled');
select pg_temp.set_settings(true, 1000000);
-- a cleared-hold style award is refused unless it cites a clear_hold decision of the SAME account for a HELD visit
select pg_temp.fails_as('reward_writer_owner', null, null, $$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reward_decision_id)
  select 'award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'spendable', 5, 'cleared_hold_award', (select id from rewards.reward_decisions where decision_type = 'hold_user' limit 1) from rewards.visits v where v.spendable_outcome = 'held' limit 1$$,
  '23514', 'a cleared-hold award citing a HOLD decision (not a clear_hold) is refused');
select pg_temp.fails_as('reward_writer_owner', null, null, $$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reward_decision_id)
  select 'award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'spendable', 5, 'cleared_hold_award', (select id from rewards.reward_decisions where decision_type = 'clear_hold' and subject_user_id <> v.user_id limit 1) from rewards.visits v where v.spendable_outcome = 'held' limit 1$$,
  '23514', 'a cleared-hold award citing another account''s clear_hold decision is refused');
select pg_temp.fails_as('reward_writer_owner', null, null, $$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reward_decision_id)
  select 'award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'spendable', 5, 'cleared_hold_award', (select id from rewards.reward_decisions where decision_type = 'clear_hold' and subject_user_id = v.user_id limit 1) from rewards.visits v where v.spendable_outcome <> 'held' and exists (select 1 from rewards.reward_decisions d where d.decision_type = 'clear_hold' and d.subject_user_id = v.user_id) limit 1$$,
  '23514', 'a cleared-hold award for a visit that was NOT held is refused');
select pg_temp.fails_as('reward_writer_owner', null, null, $$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
  select 'award', v.id, v.user_id, v.location_id, v.policy_day_local, v.policy_version_id, 'spendable', 5, 'cleared_hold_award' from rewards.visits v limit 1$$,
  '23514', 'a cleared-hold award with no decision at all is refused');
select pg_temp.fails($$select rewards.award_held_visit(gen_random_uuid(), gen_random_uuid())$$, 'RW030', 'an unknown visit cannot be awarded');
select pg_temp.finish();
