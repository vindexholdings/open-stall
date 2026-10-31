-- R009 (P3, additive): the ONE purge function is extended (create or replace; owner and EXECUTE unchanged) with the achievement tables.
-- The body is the accepted P2 purge byte-for-byte except for the marked P3 block and the extra counters in its result. No new authority.

create or replace function rewards.purge_my_reward_data() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); keep uuid[]; mm record; n_l bigint := 0; n_v bigint := 0; n_c bigint; n_sv bigint; n_sl bigint; n_sd bigint; n_sh bigint;
  n_q bigint; n_ce bigint; n_cc bigint; n_cs bigint;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || uid::text, 0));
  -- P3: the repair queue is user-linked operational data and is ALWAYS deleted. Achievement chains of this account only (by the account's own
  -- user_id; chain_id is opaque and never matched across accounts): a chain with ANY revoke event is retained evidence (all of its events and
  -- the moderated reversal/original/decision dependencies it cites are already kept together) and is only severed; every other chain and its
  -- events are deleted. Taken after the per-user lock, before any ledger/visit row work, like every other writer.
  delete from rewards.achievement_eval_queue where user_id = uid;                                get diagnostics n_q = row_count;
  -- the private resumable calculation state is temporary operational data: ALWAYS deleted, never retained as audit
  -- MUTABLE:p3_purge_calc begin
  delete from rewards.achievement_calc_state where user_id = uid;
  -- MUTABLE:p3_purge_calc end
  -- MUTABLE:p3_purge_chains begin
  delete from rewards.achievement_events e using rewards.achievement_chains c
    where c.user_id = uid and e.chain_id = c.chain_id
      and not exists (select 1 from rewards.achievement_events r where r.chain_id = c.chain_id and r.event = 'revoke');
                                                                                                  get diagnostics n_ce = row_count;
  delete from rewards.achievement_chains c where c.user_id = uid
    and not exists (select 1 from rewards.achievement_events r where r.chain_id = c.chain_id and r.event = 'revoke');
                                                                                                  get diagnostics n_cc = row_count;
  -- MUTABLE:p3_purge_chains end
  -- MUTABLE:p3_purge_sever begin
  update rewards.achievement_chains set user_id = null where user_id = uid;                      get diagnostics n_cs = row_count;
  -- MUTABLE:p3_purge_sever end
  perform 1 from rewards.visits where user_id = uid order by id for update;
  perform 1 from rewards.reward_ledger where user_id = uid order by id for update;
  select coalesce(array_agg(v.id order by v.id), '{}') into keep from rewards.visits v where v.user_id = uid and rewards.visit_is_retained(v.id);

  -- Shared-key order: the anonymous aggregate rows are shared by every account. Every month the removable rows can touch (a ledger
  -- row's month is its visit's month, so the visit months are the complete union, awards-only and recorded-only months alike) is
  -- created if absent and locked UP FRONT in ascending order, before either aggregation phase writes. Amounts still come only
  -- from DELETE ... RETURNING below; a zero row created here rolls back with the transaction.
  -- MUTABLE:p2_purge_month_locks begin
  for mm in select distinct date_trunc('month', v.issuance_day_utc)::date as m from rewards.visits v
            where v.user_id = uid and v.id <> all (keep) order by 1 loop
    insert into rewards.reward_deleted_aggregate_month (month_utc) values (mm.m) on conflict (month_utc) do nothing;
    perform 1 from rewards.reward_deleted_aggregate_month where month_utc = mm.m for update;
  end loop;
  -- MUTABLE:p2_purge_month_locks end

  with gone as (
    delete from rewards.reward_ledger l using rewards.visits v
      where l.user_id = uid and l.visit_id = v.id and v.id <> all (keep)
      returning date_trunc('month', v.issuance_day_utc)::date as m, l.kind, l.amount),
  agg as (
    select m, coalesce(sum(amount) filter (where kind = 'spendable'), 0) as s, coalesce(sum(amount) filter (where kind = 'lifetime'), 0) as l
    from gone group by m),
  up as (
    insert into rewards.reward_deleted_aggregate_month (month_utc, deleted_spendable, deleted_lifetime)
      select m, s, l from agg
      on conflict (month_utc) do update set deleted_spendable = rewards.reward_deleted_aggregate_month.deleted_spendable + excluded.deleted_spendable,
        deleted_lifetime = rewards.reward_deleted_aggregate_month.deleted_lifetime + excluded.deleted_lifetime
      returning 1)
  select (select count(*) from gone) into n_l;

  with gone as (
    delete from rewards.visits v where v.user_id = uid and v.id <> all (keep)
      returning date_trunc('month', v.issuance_day_utc)::date as m),
  agg as (select m, count(*) as n from gone group by m),
  up as (
    insert into rewards.reward_deleted_aggregate_month (month_utc, deleted_visits)
      select m, n from agg
      on conflict (month_utc) do update set deleted_visits = rewards.reward_deleted_aggregate_month.deleted_visits + excluded.deleted_visits
      returning 1)
  select (select count(*) from gone) into n_v;

  update rewards.reward_ledger set user_id = null where user_id = uid;                       get diagnostics n_sl = row_count;
  update rewards.visits set user_id = null, idempotency_key = null, accuracy_bucket = null, distance_bucket = null where user_id = uid;
                                                                                              get diagnostics n_sv = row_count;
  update rewards.reward_decisions set subject_user_id = null where subject_user_id = uid;    get diagnostics n_sd = row_count;
  update rewards.reward_holds set user_id = null where user_id = uid;                        get diagnostics n_sh = row_count;
  delete from rewards.reward_counters_user_day where user_id = uid;                          get diagnostics n_c = row_count;
  return jsonb_build_object('deleted_ledger_rows', n_l, 'deleted_visits', n_v, 'severed_visits', n_sv, 'severed_ledger_rows', n_sl,
    'severed_decisions', n_sd, 'severed_holds', n_sh, 'deleted_user_counters', n_c,
    'deleted_queue_rows', n_q, 'deleted_achievement_events', n_ce, 'deleted_achievement_chains', n_cc, 'severed_achievement_chains', n_cs);
end $$;
