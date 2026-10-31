-- P2 test 3: audited reversal. Independent admins, exact copy of the original, gross issuance never decrements, caps never reopen.
\i :ROOT/supabase/tests/rewards/p2_helpers.sql
select pg_temp.enable_rewards(1000000);
select pg_temp.mkadmin(3001) as a1 \gset
select pg_temp.mkadmin(3002) as a2 \gset
select pg_temp.mkuser(3101) as u \gset
select pg_temp.mkloc(46.0) as la \gset
select pg_temp.mkloc(46.1) as lb \gset
select pg_temp.vid('2026-10-20 15:00:00+00', :'u', :'la', 'rev-visit-000000000001') as v1 \gset
select pg_temp.vid('2026-10-20 15:00:10+00', :'u', :'la', 'rev-visit-000000000002') as v2 \gset
select spendable as g0 from rewards.reward_counters_global_day where issuance_day_utc = '2026-10-20' \gset
select spendable as c0 from rewards.reward_counters_user_day where user_id = :'u' and issuance_day_utc = '2026-10-20' \gset
select pg_temp.ok((select spendable from rewards.user_balances(:'u')) = 10 and (select lifetime from rewards.user_balances(:'u')) = 5, 'setup: 10 spendable and 5 lifetime outstanding');

-- ============================================================ recommendation and independent final
select pg_temp.recommend_as(:'a1', :'v1') as rec \gset
select pg_temp.ok((select decision_type from rewards.reward_decisions where id = :'rec'::uuid) = 'recommend_reversal' and (select admin_id from rewards.reward_decisions where id = :'rec'::uuid) = :'a1'::uuid,
                  'a recommendation is an immutable decision by the verified admin');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_finalize_reversal(%L::uuid, 'same admin tries to finalize')$$, :'rec'), '23514',
                        'the recommending administrator cannot also finalize (independent admin required)');
select pg_temp.ok((select count(*) from rewards.reward_ledger where entry_type = 'reversal') = 0, 'the refused finalization left no reversal');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_finalize_reversal(%L::uuid, 'x')$$, gen_random_uuid()), 'RW035', 'finalizing an unknown recommendation is refused');
select pg_temp.finalize_as(:'a2', :'rec') as fin \gset
select pg_temp.ok((:'fin'::jsonb ->> 'reversed_entries')::int = 2 and (:'fin'::jsonb ->> 'reversed_spendable')::int = 5 and (:'fin'::jsonb ->> 'reversed_lifetime')::int = 5 and (:'fin'::jsonb ->> 'replayed') = 'false',
                  'the final reversal reversed both awards of the visit (5 spendable, 5 lifetime)');
select pg_temp.ok((select count(*) from rewards.reward_ledger r join rewards.reward_ledger o on o.id = r.reverses_entry_id
                    where r.entry_type = 'reversal' and o.entry_type = 'award' and r.visit_id = o.visit_id and r.user_id = o.user_id and r.location_id = o.location_id
                      and r.policy_day_local = o.policy_day_local and r.policy_version_id = o.policy_version_id and r.kind = o.kind and r.amount = -o.amount
                      and r.reward_decision_id = (:'fin'::jsonb ->> 'decision_id')::uuid and r.moderation_decision_id is null) = 2,
                  'each reversal copies visit, user, location, day, policy and kind of its original, negates the amount and cites the final decision');
select pg_temp.ok((select spendable from rewards.user_balances(:'u')) = 5 and (select lifetime from rewards.user_balances(:'u')) = 0, 'balances derive from the ledger: 5 spendable remain, lifetime fully reversed');
select pg_temp.ok((select spendable from rewards.reward_counters_global_day where issuance_day_utc = '2026-10-20') = :'g0'::int
              and (select spendable from rewards.reward_counters_user_day where user_id = :'u' and issuance_day_utc = '2026-10-20') = :'c0'::int,
                  'gross issuance counters NEVER decrement on reversal');
select pg_temp.ok((select count(*) from rewards.visits where user_id = :'u') = 2, 'reversal leaves the visits untouched');

-- retry/race: the same finalization again returns the identical result, with no new rows
select pg_temp.finalize_as(:'a2', :'rec') as fin2 \gset
select pg_temp.ok((:'fin2'::jsonb - 'replayed') = (:'fin'::jsonb - 'replayed') and (:'fin2'::jsonb ->> 'replayed') = 'true' and (select count(*) from rewards.reward_ledger where entry_type = 'reversal') = 2,
                  'a retried finalization is idempotent: identical result, replayed flag, no extra rows');
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_recommend_reversal(%L::uuid, 'again')$$, :'v1'), 'RW034', 'an already reversed visit cannot be recommended again');

-- ============================================================ direct ledger integrity (the independent guard), as the writer
select (select id from rewards.reward_ledger where visit_id = :'v2'::uuid and kind = 'spendable' and entry_type = 'award') as o2 \gset
select (select id from rewards.reward_ledger where entry_type = 'reversal' and kind = 'spendable' limit 1) as rv \gset
select pg_temp.recommend_as(:'a1', :'v2') as rec2 \gset
select pg_temp.finalize_as(:'a2', :'rec2') as fin_v2 \gset
select pg_temp.ok((select count(*) from rewards.reward_ledger where entry_type = 'reversal') = 3, 'setup: a second visit reversed (3 reversal rows: v1 two kinds, v2 spendable)');
-- fresh award for negative tests that is NOT yet reversed
select pg_temp.mkuser(3102) as u2 \gset
select pg_temp.vid('2026-10-20 16:00:00+00', :'u2', :'la', 'rev-visit-000000000003') as v3 \gset
select pg_temp.recommend_as(:'a1', :'v3') as rec3 \gset
select pg_temp.hold_as(:'a1', :'u2') as dummy \gset
select pg_temp.mkuser(3103) as u3 \gset
-- A genuine final decision for v3 would reverse it; craft one decision pair for the mismatch tests only
select pg_temp.fails_as('reward_writer_owner', null, null, format($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reverses_entry_id, reward_decision_id)
  select 'reversal', visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, -amount, 'fraud_reversal', id, %L::uuid from rewards.reward_ledger where visit_id = %L::uuid and kind = 'spendable' and entry_type = 'award'$$, :'rec3', :'v3'),
  '23514', 'a reversal citing only a RECOMMENDATION (not a final decision) is refused');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reverses_entry_id, reward_decision_id)
  select 'reversal', visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, -amount, 'fraud_reversal', id, %L::uuid from rewards.reward_ledger where visit_id = %L::uuid and kind = 'spendable' and entry_type = 'award'$$, (:'fin_v2'::jsonb ->> 'decision_id'), :'v3'),
  '23514', 'a reversal citing the final decision of ANOTHER visit is refused (mismatched decision)');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reverses_entry_id, reward_decision_id)
  select 'reversal', visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, -amount, 'fraud_reversal', %L::uuid, %L::uuid from rewards.reward_ledger where id = %L::uuid$$, :'rv', (:'fin'::jsonb ->> 'decision_id'), :'rv'),
  '23514', 'a reversal of a REVERSAL is refused');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reverses_entry_id, reward_decision_id)
  select 'reversal', visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, -amount, 'fraud_reversal', id, %L::uuid from rewards.reward_ledger where id = %L::uuid$$, (:'fin'::jsonb ->> 'decision_id'), :'o2'),
  '23514', 'a reversal whose decision belongs to a different visit than its original is refused');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reverses_entry_id, reward_decision_id)
  select 'reversal', visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, -amount, 'fraud_reversal', id, %L::uuid from rewards.reward_ledger where id = %L::uuid$$, (:'fin_v2'::jsonb ->> 'decision_id'), :'o2'),
  '23505', 'a second reversal of the same entry is refused by the unique reversal reference');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason, reverses_entry_id, reward_decision_id)
  select 'reversal', visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, -3, 'fraud_reversal', id, %L::uuid from rewards.reward_ledger where id = %L::uuid$$, (:'fin_v2'::jsonb ->> 'decision_id'), :'o2'),
  '23514', 'an arbitrary reversal amount is refused');
select pg_temp.fails_as('reward_writer_owner', null, null, format($$insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, visit_id, recommendation_id, reason)
  select 'final_reversal', admin_id, subject_user_id, visit_id, id, 'same admin forged final' from rewards.reward_decisions where id = %L::uuid$$, :'rec3'),
  '23514', 'a final decision by the SAME administrator as the recommendation is refused even when inserted directly');
select pg_temp.ok((select count(*) from rewards.reward_ledger where entry_type = 'reversal') = 3, 'no refused reversal left a row');

-- ============================================================ self-adjudication
select pg_temp.vid('2026-10-20 15:00:00+00', :'a1', :'lb', 'admin-own-visit-00000001') as av \gset
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_recommend_reversal(%L::uuid, 'own visit')$$, :'av'), '42501', 'an administrator cannot recommend reversal of their own award');
select pg_temp.recommend_as(:'a2', :'av') as arec \gset
select pg_temp.fails_as('authenticated', :'a1'::uuid, 'aal2', format($$select public.admin_reward_finalize_reversal(%L::uuid, 'own visit')$$, :'arec'), '42501', 'an administrator cannot finalize reversal of their own award');

-- ============================================================ fraud cannot reopen caps; reversal works while rewards are disabled
select pg_temp.mkuser(3201) as uc \gset
create temp table _locs as select pg_temp.mkloc(47.0 + g / 100.0) as l, g from generate_series(1, 13) g;
select pg_temp.visit_at('2026-10-22 15:00:00+00', :'uc', l, 'capfill-' || lpad(g::text, 12, '0')) from _locs where g <= 12 order by g;
select pg_temp.ok((select spendable from rewards.reward_counters_user_day where user_id = :'uc') = 60, 'setup: 60 spendable issued (cap reached)');
select id as cv from rewards.visits where user_id = :'uc' and idempotency_key = 'capfill-000000000001' \gset
select pg_temp.recommend_as(:'a1', :'cv') as crec \gset
select pg_temp.set_settings(false, 1000000);
select pg_temp.finalize_as(:'a2', :'crec') as cfin \gset
select pg_temp.set_settings(true, 1000000);
select pg_temp.ok((:'cfin'::jsonb ->> 'reversed_spendable')::int = 5, 'a reversal is allowed while rewards are disabled (it only undoes an issued award)');
select pg_temp.ok((select pg_temp.oc(pg_temp.visit_at('2026-10-22 18:00:00+00', :'uc', (select l from _locs where g = 13), 'capfill-after-00000001')))
                  = 'user_day_cap|awarded|0|5', 'after a reversal the user''s UTC-day cap is NOT reopened (still user_day_cap)');
select pg_temp.ok((select spendable from rewards.reward_counters_user_day where user_id = :'uc') = 60, 'the gross counter still reads 60 after the reversal');

-- ============================================================ reconciliation: zero drift
select pg_temp.ok((select drift_spendable from rewards.reconciliation_report()) = 0, 'reconciliation: gross counter = ledger awards + deleted aggregate (zero drift)');
select pg_temp.ok((select outstanding_spendable from rewards.reconciliation_report()) = (select coalesce(sum(amount), 0) from rewards.reward_ledger where kind = 'spendable')
              and (select outstanding_lifetime from rewards.reconciliation_report()) = (select coalesce(sum(amount), 0) from rewards.reward_ledger where kind = 'lifetime'),
                  'reconciliation: outstanding equals the signed ledger sum for both kinds');
select pg_temp.ok((select reversed_spendable from rewards.reconciliation_report()) = (select coalesce(sum(-amount), 0) from rewards.reward_ledger where entry_type = 'reversal' and kind = 'spendable'), 'reconciliation: reversed equals the negated reversal sum');
select pg_temp.finish();
