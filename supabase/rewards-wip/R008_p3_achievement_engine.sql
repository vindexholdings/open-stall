-- R008 (P3, additive): the achievement engine, the in-transaction hooks, the signed-in progress read and the admin repair.
-- Derived ONLY from real standing lifetime awards (never spendable, never contribution data). No definition exists until a
-- test or a separately approved content release inserts one. Internal functions are owned by the writer and callable by no client.

-- ---------------------------------------------------------------- pure helpers
create function rewards.ach_today() returns date language sql stable set search_path = '' as $$
  select (clock_timestamp() at time zone 'UTC')::date
$$;
create function rewards.ach_rule(p_key text) returns text language sql stable set search_path = '' as $$
  select window_rule from rewards.achievement_definitions where achievement_key = p_key order by version desc limit 1
$$;
-- Local start date of a chain's window, or NULL for a lifetime chain. A malformed period is a private OSA01.
create function rewards.ach_window_start(p_rule text, p_period text) returns date
language plpgsql immutable set search_path = '' as $$
begin
  if p_rule = 'none' then
    if p_period = 'lifetime' then return null; end if;
  elsif p_rule = 'calendar_month' then
    if p_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$' then return (p_period || '-01')::date; end if;
  elsif p_rule = 'fixed' then
    if p_period ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$' then
      begin return p_period::date; exception when sqlstate '22008' then null; end;
    end if;
  end if;
  raise exception 'invalid achievement period' using errcode = 'OSA01';
end $$;

-- ONE shared version selector (evaluator AND progress). An awarded lifetime chain keeps the version recorded on its latest award event;
-- a revoked or unawarded lifetime chain uses the latest version in effect (prospective); a windowed chain uses the version fixed by its
-- window start (never a version that takes effect inside the open window).
create function rewards.ach_select_version(p_user uuid, p_key text, p_period text, p_today date)
returns rewards.achievement_definitions
language plpgsql stable set search_path = '' as $$
declare rule text := rewards.ach_rule(p_key); ws date; d rewards.achievement_definitions%rowtype; ev record;
begin
  if rule is null then raise exception 'unknown achievement' using errcode = 'OSA01'; end if;
  ws := rewards.ach_window_start(rule, p_period);
  if rule = 'none' then
    select e.event, e.version into ev from rewards.achievement_events e join rewards.achievement_chains c using (chain_id)
      where c.user_id = p_user and c.achievement_key = p_key and c.period_key = p_period order by e.seq desc limit 1;
    -- MUTABLE:p3_version_awarded begin
    if ev.event = 'award' then
      select * into d from rewards.achievement_definitions where achievement_key = p_key and version = ev.version;
    else
    -- MUTABLE:p3_version_awarded end
      select * into d from rewards.achievement_definitions
        where achievement_key = p_key and effective_from_date <= p_today order by effective_from_date desc, version desc limit 1;
    -- MUTABLE:p3_version_awarded_else begin
    end if;
    -- MUTABLE:p3_version_awarded_else end
  elsif rule = 'calendar_month' then
    -- MUTABLE:p3_version_window_start begin
    select * into d from rewards.achievement_definitions
      where achievement_key = p_key and effective_from_date <= ws order by effective_from_date desc, version desc limit 1;
    -- MUTABLE:p3_version_window_start end
  else
    select * into d from rewards.achievement_definitions
      where achievement_key = p_key and window_starts_on = ws and effective_from_date <= ws order by effective_from_date desc, version desc limit 1;
  end if;
  if d.achievement_key is null then raise exception 'no catalog version in effect' using errcode = 'OSA01'; end if;
  return d;
end $$;

-- ONE budgeted pass over the user's award rows in a window: all four metrics for the STANDING (non-reversed) ones, or {"over": true, "rows": budget + 1}
-- when the window holds more than p_budget raw award rows (a partial metric is NEVER returned).
create function rewards.ach_metrics(p_user uuid, p_from date, p_to date, p_budget integer) returns jsonb
-- The planner is pinned (no bitmap scan, no seq scan, no sort, no hash/merge join) to ordered index scans with LIMIT and nested-loop reversal probes: a bitmap scan + sort or a hash anti-join would read every
-- remaining award or every reversal of the account, so the stated work model (raw rows <= budget, one probe per raw row) would not hold. jit is off
-- because the disabled-sort cost of the aggregates would otherwise push the plan over the JIT threshold (about 270 ms per call).
language sql stable set search_path = '' set enable_bitmapscan = off set enable_seqscan = off set enable_hashjoin = off set enable_mergejoin = off set enable_sort = off set jit = off as $$
  -- The bounded read is over RAW candidate award rows in the window (standing OR reversed), so heavily reversed histories cannot hide work behind the
  -- standing filter; the sentinel row (budget + 1) detects an over-budget window. Reversal probes are one unique-index lookup per raw row read.
  with raw as materialized (
    select l.id, l.amount, l.location_id, l.policy_day_local from rewards.reward_ledger l
     where l.user_id = p_user and l.kind = 'lifetime' and l.entry_type = 'award'
       and l.policy_day_local between coalesce(p_from, date '0001-01-01') and coalesce(p_to, date '9999-12-31')
     order by l.policy_day_local, l.id
     -- MUTABLE:p3_budget_probe begin
     limit p_budget + 1
     -- MUTABLE:p3_budget_probe end
  ), cnt as (select count(*) as n from raw),
  std as (
    -- MUTABLE:p3_metric_standing begin
    select r.* from raw r where (select n from cnt) <= p_budget
       and not exists (select 1 from rewards.reward_ledger x where x.reverses_entry_id = r.id)
    -- MUTABLE:p3_metric_standing end
  )
  select case when (select n from cnt) > p_budget then jsonb_build_object('over', true, 'rows', p_budget + 1)
    else jsonb_build_object('lifetime_points_total', coalesce((select sum(amount) from std), 0), 'distinct_locations', (select count(distinct location_id) from std),
           'qualifying_awards', (select count(*) from std), 'distinct_active_days', (select count(distinct policy_day_local) from std), 'rows', (select n from cnt)) end
$$;
-- ---------------------------------------------------------------- resumable exact calculation for a window larger than one call's budget
create function rewards.ach_calc_invalidate(p_user uuid) returns void language sql security definer set search_path = '' as $$
  delete from rewards.achievement_calc_state where user_id = p_user
$$;
create function rewards.ach_calc_pass(p_user uuid, p_ck text) returns text language sql stable security definer set search_path = '' as $$
  select pass from rewards.achievement_calc_state where user_id = p_user and window_key = p_ck
$$;
create function rewards.ach_calc_get(p_user uuid, p_ck text) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('lifetime_points_total', points, 'distinct_locations', locs, 'qualifying_awards', awards, 'distinct_active_days', days, 'rows', 0)
    from rewards.achievement_calc_state where user_id = p_user and window_key = p_ck and pass = 'done'
$$;
-- Starts (never restarts) the calculation for a window; the oldest FINISHED states make room (at most 50 per account). Returns false when no room.
create function rewards.ach_calc_start(p_user uuid, p_ck text) returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || p_user::text, 0));
  if exists (select 1 from rewards.achievement_calc_state where user_id = p_user and window_key = p_ck) then return true; end if;
  select count(*) into n from rewards.achievement_calc_state where user_id = p_user;
  if n >= 50 then
    delete from rewards.achievement_calc_state s where s.user_id = p_user and s.pass = 'done'
      and s.window_key in (select window_key from rewards.achievement_calc_state where user_id = p_user and pass = 'done' order by created_at limit n - 49);
    select count(*) into n from rewards.achievement_calc_state where user_id = p_user;
    if n >= 50 then return false; end if;
  end if;
  insert into rewards.achievement_calc_state (user_id, window_key, pass) values (p_user, p_ck, 'days');
  return true;
end $$;
-- Persists an EXACT, finished result (a window that fit the budget) as a finished calculation state, so the NEXT read of the same window is free
-- (ach_calc_get) in repair and in display. Valid for exactly as long as every other finished state: ach_run deletes it on any real award, clearance or
-- reversal for the account (outside the recoverable savepoint) and purge deletes it. Never stores an over-budget outcome; at most 50 rows per account
-- (the oldest FINISHED rows make room, otherwise nothing is stored and the read simply stays uncached). Runs under the caller's user lock.
create function rewards.ach_calc_store(p_user uuid, p_ck text, p_m jsonb) returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_m is null or (p_m ->> 'over')::boolean is true or p_m ->> 'lifetime_points_total' is null then return; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || p_user::text, 0));
  if not rewards.ach_calc_start(p_user, p_ck) then return; end if;
  update rewards.achievement_calc_state
     set points = (p_m ->> 'lifetime_points_total')::bigint, awards = (p_m ->> 'qualifying_awards')::integer,
         days = (p_m ->> 'distinct_active_days')::integer, locs = (p_m ->> 'distinct_locations')::integer, pass = 'done'
   where user_id = p_user and window_key = p_ck;
exception
  -- a deleted or unknown subject can never own saved state (the account foreign key refuses it): store nothing, no error. ONLY this class.
  when foreign_key_violation then null;
end $$;
-- One bounded step (at most p_budget RAW award rows) of the exact calculation. Returns {"done", "rows", "metrics"}; "rows" is what was read.
create function rewards.ach_calc_step(p_user uuid, p_ck text, p_from date, p_to date, p_budget integer) returns jsonb
language plpgsql security definer set search_path = '' set enable_bitmapscan = off set enable_seqscan = off set enable_hashjoin = off set enable_mergejoin = off set enable_sort = off set jit = off set plan_cache_mode = force_custom_plan as $$
declare st rewards.achievement_calc_state%rowtype; a record;
  zero uuid := '00000000-0000-0000-0000-000000000000';
  wf date := coalesce(p_from, date '0001-01-01'); wt date := coalesce(p_to, date '9999-12-31');
  cd date; ci uuid; cl uuid; ci2 uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || p_user::text, 0));
  select * into st from rewards.achievement_calc_state where user_id = p_user and window_key = p_ck for update;
  -- Cursors and window bounds are SENTINELS, never `is null or ...` alternatives: an OR would stop the predicates from being index conditions in a
  -- cached generic plan and the step would re-read everything before the cursor.
  cd := coalesce(st.cursor_day, date '0001-01-01'); ci := coalesce(st.cursor_id, zero); cl := coalesce(st.cursor_loc, zero); ci2 := coalesce(st.cursor_id2, zero);
  if st.user_id is null then return jsonb_build_object('done', false, 'rows', 0, 'missing', true); end if;
  if st.pass = 'done' then return jsonb_build_object('done', true, 'rows', 0, 'metrics', rewards.ach_calc_get(p_user, p_ck)); end if;
  if p_budget < 1 then return jsonb_build_object('done', false, 'rows', 0); end if;
  if st.pass = 'days' then
    with raw as materialized (
      select l.id, l.amount, l.location_id, l.policy_day_local from rewards.reward_ledger l
       where l.user_id = p_user and l.kind = 'lifetime' and l.entry_type = 'award'
         and l.policy_day_local between wf and wt
         and (l.policy_day_local, l.id) > (cd, ci)
       order by l.policy_day_local, l.id limit p_budget),
    std as (select r.* from raw r where not exists (select 1 from rewards.reward_ledger x where x.reverses_entry_id = r.id))
    select (select count(*) from raw) as n_raw,
           (select r.policy_day_local from raw r order by r.policy_day_local desc, r.id desc limit 1) as lday,
           (select r.id from raw r order by r.policy_day_local desc, r.id desc limit 1) as lid,
           coalesce((select sum(amount) from std), 0) as pts, (select count(*) from std) as aw,
           (select count(distinct policy_day_local) from std where policy_day_local is distinct from st.last_day) as dn,
           (select max(policy_day_local) from std) as maxd
      into a;
    update rewards.achievement_calc_state set
        points = points + a.pts, awards = awards + a.aw, days = days + a.dn, last_day = coalesce(a.maxd, last_day),
        cursor_day = coalesce(a.lday, cursor_day), cursor_id = coalesce(a.lid, cursor_id), steps = steps + 1,
        pass = case when a.n_raw < p_budget then 'locs' else 'days' end
      where user_id = p_user and window_key = p_ck;
    return jsonb_build_object('done', false, 'rows', a.n_raw);
  end if;
  -- pass 'locs': ordered by location (the window filter is applied AFTER the raw read so the raw rows read are exactly what is charged)
  with raw as materialized (
    select l.id, l.location_id, l.policy_day_local from rewards.reward_ledger l
     where l.user_id = p_user and l.kind = 'lifetime' and l.entry_type = 'award'
       and (l.location_id, l.id) > (cl, ci2)
     order by l.location_id, l.id limit p_budget),
  std as (select r.* from raw r where r.policy_day_local between wf and wt
            and not exists (select 1 from rewards.reward_ledger x where x.reverses_entry_id = r.id))
  select (select count(*) from raw) as n_raw,
         (select r.location_id from raw r order by r.location_id desc, r.id desc limit 1) as lloc,
         (select r.id from raw r order by r.location_id desc, r.id desc limit 1) as lid,
         (select count(distinct location_id) from std where location_id is distinct from st.last_loc) as ln,
         (select s.location_id from std s order by s.location_id desc limit 1) as maxl
    into a;
  update rewards.achievement_calc_state set
      locs = locs + a.ln, last_loc = coalesce(a.maxl, last_loc),
      cursor_loc = coalesce(a.lloc, cursor_loc), cursor_id2 = coalesce(a.lid, cursor_id2), steps = steps + 1,
      pass = case when a.n_raw < p_budget then 'done' else 'locs' end
    where user_id = p_user and window_key = p_ck;
  if a.n_raw < p_budget then
    return jsonb_build_object('done', true, 'rows', a.n_raw, 'metrics', rewards.ach_calc_get(p_user, p_ck));
  end if;
  return jsonb_build_object('done', false, 'rows', a.n_raw);
end $$;

-- The exact reference for one metric (no budget): used by tests and diagnostics; the engine uses ach_metrics with its call budget.
create function rewards.ach_metric_value(p_user uuid, p_metric text, p_from date, p_to date) returns integer
language sql stable set search_path = '' as $$
  select (rewards.ach_metrics(p_user, p_from, p_to, 2147483000) ->> p_metric)::integer
$$;
-- Chains an event on a given local day can affect (bounded by the catalog, never by history). A key with no version yet in effect for
-- that window is omitted, so scope never contains an entry that cannot be evaluated.
create function rewards.ach_scope_for_day(p_day date, p_today date default null) returns text[]
language sql stable set search_path = '' as $$
  with t as (select coalesce(p_today, rewards.ach_today()) as today),
  keys as (select achievement_key as k, (array_agg(window_rule order by version desc))[1] as rule
             from rewards.achievement_definitions group by achievement_key)
  select coalesce(array_agg(x order by x), '{}') from (
    select k || '|lifetime' as x from keys, t
      where rule = 'none' and exists (select 1 from rewards.achievement_definitions d where d.achievement_key = k and d.effective_from_date <= t.today)
    union
    select k || '|' || to_char(p_day, 'YYYY-MM') from keys
      where rule = 'calendar_month'
        and exists (select 1 from rewards.achievement_definitions d where d.achievement_key = k and d.effective_from_date <= date_trunc('month', p_day)::date)
    union
    select d.achievement_key || '|' || d.window_starts_on::text from rewards.achievement_definitions d
      where d.window_rule = 'fixed' and p_day between d.window_starts_on and d.window_ends_on and d.effective_from_date <= d.window_starts_on
  ) q
$$;

-- Every chain a bounded full re-scan must visit for one user (existing chains plus every window the user's real awards fall in).
create function rewards.ach_candidate_chains(p_user uuid) returns setof text
language sql stable set search_path = '' as $$
  with recursive t as (select rewards.ach_today() as today),
  keys as (select achievement_key as k, (array_agg(window_rule order by version desc))[1] as rule
             from rewards.achievement_definitions group by achievement_key),
  -- distinct months by LOOSE INDEX PROBES: one index probe per month with an award, never a scan of every award
  probe(d) as (
    select (select min(l.policy_day_local) from rewards.reward_ledger l where l.user_id = p_user and l.kind = 'lifetime' and l.entry_type = 'award')
    union all
    select (select min(l.policy_day_local) from rewards.reward_ledger l
             where l.user_id = p_user and l.kind = 'lifetime' and l.entry_type = 'award' and l.policy_day_local >= (date_trunc('month', probe.d) + interval '1 month')::date)
    from probe where probe.d is not null),
  months as (select distinct date_trunc('month', d)::date as m from probe where d is not null)
  select k || '|lifetime' from keys, t
    where rule = 'none' and exists (select 1 from rewards.achievement_definitions d where d.achievement_key = k and d.effective_from_date <= t.today)
  union
  select k || '|' || to_char(m, 'YYYY-MM') from keys, months
    where rule = 'calendar_month'
      and exists (select 1 from rewards.achievement_definitions d where d.achievement_key = k and d.effective_from_date <= m)
  union
  select distinct d.achievement_key || '|' || d.window_starts_on::text from rewards.achievement_definitions d
    where d.window_rule = 'fixed' and d.effective_from_date <= d.window_starts_on
      and exists (select 1 from rewards.reward_ledger l where l.user_id = p_user and l.kind = 'lifetime' and l.entry_type = 'award'
                   and l.policy_day_local between d.window_starts_on and d.window_ends_on)
  union
  select c.achievement_key || '|' || c.period_key from rewards.achievement_chains c where c.user_id = p_user
$$;
-- ---------------------------------------------------------------- queue upsert (scope is UNIONED, never overwritten; cap 500 with overflow)
create function rewards.ach_enqueue(p_user uuid, p_scope text[], p_reason text, p_sqlstate text, p_bump integer) returns void
language plpgsql security definer set search_path = '' as $$
declare cur rewards.achievement_eval_queue%rowtype; merged text[]; ov boolean := false; rewind boolean := false;
begin
  select * into cur from rewards.achievement_eval_queue where user_id = p_user for update;
  select array_agg(e order by split_part(e, '|', 2), e) into merged
    from (select distinct unnest(coalesce(cur.dirty_scope, '{}') || coalesce(p_scope, '{}')) as e) s;
  merged := coalesce(merged, '{}');
  -- MUTABLE:p3_queue_cap begin
  if cardinality(merged) > 500 then merged := merged[1:500]; ov := true; rewind := true; end if;
  -- MUTABLE:p3_queue_cap end
  -- A NEW truncation invalidates any coverage an in-progress re-scan already traversed (the dropped entries may lie behind its cursor), so the
  -- re-scan REWINDS to the beginning; it is idempotent, and the row is deleted only after a full pass completes.
  insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope, overflow, attempts, last_sqlstate)
    values (p_user, p_reason, merged, ov, p_bump, p_sqlstate)
  on conflict (user_id) do update
    set reason = excluded.reason, dirty_scope = excluded.dirty_scope,
        overflow = rewards.achievement_eval_queue.overflow or excluded.overflow,
        rescan_cursor = case when rewind then null else rewards.achievement_eval_queue.rescan_cursor end,
        attempts = rewards.achievement_eval_queue.attempts + p_bump,
        last_sqlstate = coalesce(excluded.last_sqlstate, rewards.achievement_eval_queue.last_sqlstate);
end $$;
-- ---------------------------------------------------------------- the evaluator: ONE rule, recompute eligibility, append only on a state change
-- Runs under the caller's per-user advisory lock (taken again here; it is re-entrant) BEFORE any chain or queue row. The function-level
-- lock_timeout is the real bounded wait whose expiry (55P03) the hooks treat as recoverable. At most 50 chains per call, oldest window first.
create function rewards.evaluate_achievements(p_user uuid, p_scope text[], p_basis uuid default null, p_today date default null, p_budget integer default 5000) returns jsonb
language plpgsql security definer set search_path = '' set lock_timeout = '250ms' as $$
declare
  today date := coalesce(p_today, rewards.ach_today());
  row_budget integer := p_budget;   -- RAW award rows one call may read (released starting budget 5000; the request's remaining budget when called from the progress read)
  scanned integer := 0; cache jsonb := '{}'::jsonb; ck text; m jsonb;
  ordered text[]; n integer; i integer := 0; entry text; k text; per text; rule text; ws date; we date;
  cs text; r jsonb; fresh boolean;
  d rewards.achievement_definitions%rowtype; c rewards.achievement_chains%rowtype; last_ev rewards.achievement_events%rowtype;
  val integer; eligible boolean; awarded boolean; nseq integer; basis rewards.reward_ledger%rowtype;
  processed integer := 0; appended integer := 0;
begin
  if p_user is null then raise exception 'subject required' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || p_user::text, 0));
  select array_agg(e order by split_part(e, '|', 2), e) into ordered from (select distinct unnest(coalesce(p_scope, '{}')) as e) s;
  n := coalesce(cardinality(ordered), 0);
  -- At most 50 chains per call, oldest window first, AND at most row_budget standing awards read per call: when the next chain does not fit
  -- the remaining budget the loop stops and that chain is returned as REMAINING (resumed next call); a chain whose own window holds more
  -- than the whole budget is DEFERRED (never evaluated partially, kept pending and reported unavailable). A metric is never approximated.
  while i < n and processed < 50 loop
    i := i + 1; entry := ordered[i];
    if entry !~ '^[a-z][a-z0-9_]{2,47}[|][0-9A-Za-z:-]{1,40}$' then raise exception 'invalid scope entry' using errcode = 'OSA01'; end if;
    k := split_part(entry, '|', 1); per := split_part(entry, '|', 2);
    rule := rewards.ach_rule(k);
    if rule is null then raise exception 'unknown achievement' using errcode = 'OSA01'; end if;
    ws := rewards.ach_window_start(rule, per);
    d := rewards.ach_select_version(p_user, k, per, today);
    we := case rule when 'calendar_month' then ((ws + interval '1 month')::date - 1) when 'fixed' then d.window_ends_on else null end;
    ck := coalesce(ws::text, '') || '|' || coalesce(we::text, '');
    m := cache -> ck;
    if m is null then
      m := rewards.ach_calc_get(p_user, ck);                       -- an exact FINISHED calculation (valid until a relevant change invalidates it)
      if m is null then
        cs := rewards.ach_calc_pass(p_user, ck);
        if cs is not null then
          -- a resumable exact calculation is in progress for this window: advance it by what the budget allows, otherwise stop here
          if row_budget - scanned <= 0 then i := i - 1; exit; end if;
          r := rewards.ach_calc_step(p_user, ck, ws, we, row_budget - scanned);
          scanned := scanned + (r ->> 'rows')::integer;
          if (r ->> 'done')::boolean is not true then i := i - 1; exit; end if;   -- unfinished: stays pending (remaining), no number, no event
          m := r -> 'metrics';
        else
          if row_budget - scanned <= 0 then i := i - 1; exit; end if;
          fresh := scanned = 0;
          m := rewards.ach_metrics(p_user, ws, we, row_budget - scanned);
          if (m ->> 'over')::boolean is true then
            -- the probe really read budget + 1 raw rows: CHARGED, including the sentinel. A window that alone exceeds a fresh budget starts its
            -- resumable exact calculation (persisted, so the next call steps it instead of probing again); either way the chain stays pending.
            scanned := scanned + (m ->> 'rows')::integer;
            if fresh then perform rewards.ach_calc_start(p_user, ck); end if;
            i := i - 1; exit;
          end if;
          scanned := scanned + (m ->> 'rows')::integer;
          -- an exact result that fit is SAVED: the display (and the next repair) reads it for free instead of scanning the same window again
          -- MUTABLE:p3_store_exact_eval begin
          perform rewards.ach_calc_store(p_user, ck, m);
          -- MUTABLE:p3_store_exact_eval end
        end if;
      end if;
      -- MUTABLE:p3_metrics_cache begin
      cache := cache || jsonb_build_object(ck, m);
      -- MUTABLE:p3_metrics_cache end
    end if;
    val := (m ->> d.metric)::integer;
    eligible := val >= d.threshold;
    processed := processed + 1;
    -- The chain is serialized by a per-chain advisory lock (bounded by the function-level lock_timeout), NOT by FOR UPDATE, so the writer
    -- needs no UPDATE privilege on chains. Order: user lock, then chain locks in sorted scope order, then the queue row.
    -- MUTABLE:p3_chain_lock begin
    perform pg_advisory_xact_lock(hashtextextended('rewards:chain:' || p_user::text || ':' || k || ':' || per, 0));
    -- MUTABLE:p3_chain_lock end
    select * into c from rewards.achievement_chains where user_id = p_user and achievement_key = k and period_key = per;
    if c.chain_id is null then
      if eligible then
        insert into rewards.achievement_chains (user_id, achievement_key, period_key) values (p_user, k, per) returning * into c;
        insert into rewards.achievement_events (chain_id, seq, event, version, reason, qualifying_value, threshold)
          values (c.chain_id, 1, 'award', d.version, 'first_award', val, d.threshold);
        appended := appended + 1;
      end if;
    else
      select * into last_ev from rewards.achievement_events where chain_id = c.chain_id order by seq desc limit 1;
      awarded := coalesce(last_ev.event = 'award', false);
      nseq := coalesce(last_ev.seq, 0) + 1;
      if eligible and not awarded then
        insert into rewards.achievement_events (chain_id, seq, event, version, reason, qualifying_value, threshold)
          values (c.chain_id, nseq, 'award', d.version, case when last_ev.seq is null then 'first_award' else 're_earn' end, val, d.threshold);
        appended := appended + 1;
      elsif not eligible and awarded then
        if p_basis is not null then
          select * into basis from rewards.reward_ledger
            where id = p_basis and user_id = p_user and kind = 'lifetime' and entry_type = 'reversal';
        else
          select * into basis from rewards.reward_ledger r
            where r.user_id = p_user and r.kind = 'lifetime' and r.entry_type = 'reversal'
              and (ws is null or r.policy_day_local between ws and we) order by r.created_at desc, r.id desc limit 1;
        end if;
        if basis.id is null or basis.reward_decision_id is null then
          raise exception 'a revoke needs the moderated reversal that caused it' using errcode = 'RW040';
        end if;
        insert into rewards.achievement_events (chain_id, seq, event, version, reason, qualifying_value, threshold, basis_entry_id, decision_id)
          values (c.chain_id, nseq, 'revoke', d.version, 'reversal', val, d.threshold, basis.id, basis.reward_decision_id);
        appended := appended + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('processed', processed, 'appended', appended, 'scanned', scanned,
    'remaining', to_jsonb(coalesce(ordered[i + 1:], '{}')));
end $$;
-- The hook wrapper: its own savepoint. ONLY an explicitly listed recoverable class is caught (55P03 under the bounded lock_timeout, and
-- the private OSA01); there is NO catch-all handler. Everything else (42501, class 23, XX, OSA02, 40001, 40P01, 57014) propagates and
-- aborts the whole transaction. The handler runs AFTER the inner writes were rolled back, in the outer transaction, and logs the queue.
create function rewards.ach_run(p_user uuid, p_scope text[], p_basis uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; rem text[];
begin
  -- A real award/reversal changed this account's standing awards: every saved exact calculation is stale. This runs OUTSIDE the savepoint below, so a
  -- recoverable evaluation failure cannot roll the invalidation back and leave a stale exact number alive.
  -- MUTABLE:p3_calc_invalidate begin
  perform rewards.ach_calc_invalidate(p_user);
  -- MUTABLE:p3_calc_invalidate end
  begin
    r := rewards.evaluate_achievements(p_user, p_scope, p_basis);
    rem := array(select jsonb_array_elements_text(r -> 'remaining'));
    -- every unfinished chain (budget stop, or an exact calculation still in progress) is PERSISTED atomically, also when no queue row existed before
    -- MUTABLE:p3_run_persist_remaining begin
    if cardinality(rem) > 0 then perform rewards.ach_enqueue(p_user, rem, 'bounded', null, 1); end if;
    -- MUTABLE:p3_run_persist_remaining end
  -- MUTABLE:p3_recoverable_handler begin
  exception
    when sqlstate '55P03' then perform rewards.ach_enqueue(p_user, p_scope, p_reason, '55P03', 1);
    when sqlstate 'OSA01' then perform rewards.ach_enqueue(p_user, p_scope, p_reason, 'OSA01', 1);
  -- MUTABLE:p3_recoverable_handler end
  end;
end $$;
-- One bounded step of repair for ONE user whose lock the caller already holds: a slice of dirty scope, else one page of the full re-scan.
create function rewards.ach_process_queue(p_user uuid, p_budget integer default 5000) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare q rewards.achievement_eval_queue%rowtype; r jsonb; newrem text[]; page text[]; lastdone text; rescan_done boolean := false;
begin
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || p_user::text, 0));
  select * into q from rewards.achievement_eval_queue where user_id = p_user for update;
  if q.user_id is null then return jsonb_build_object('state', 'none', 'scanned', 0); end if;
  if cardinality(q.dirty_scope) > 0 then
    r := rewards.evaluate_achievements(p_user, q.dirty_scope, null, null, p_budget);
    newrem := array(select jsonb_array_elements_text(r -> 'remaining'));
    update rewards.achievement_eval_queue
       set dirty_scope = newrem, attempts = attempts + 1, last_attempt_at = clock_timestamp()
     where user_id = p_user;
  elsif q.overflow then
    select array_agg(c order by split_part(c, '|', 2), c) into page from (
      select c from rewards.ach_candidate_chains(p_user) c
       where (q.rescan_cursor is null or (split_part(c, '|', 2), c) > (split_part(q.rescan_cursor, '|', 2), q.rescan_cursor))
       order by split_part(c, '|', 2), c limit 50) s;
    if page is null then
      rescan_done := true; r := jsonb_build_object('remaining', '[]'::jsonb, 'scanned', 0);
    else
      r := rewards.evaluate_achievements(p_user, page, null, null, p_budget);
      newrem := array(select jsonb_array_elements_text(r -> 'remaining'));
      -- the cursor is the last entry actually PROCESSED (a budget stop leaves the tail of the page unprocessed), never the end of the page
      lastdone := page[cardinality(page) - coalesce(cardinality(newrem), 0)];
      rescan_done := cardinality(newrem) = 0 and cardinality(page) < 50;
    end if;
    update rewards.achievement_eval_queue
       set attempts = attempts + 1, last_attempt_at = clock_timestamp(),
           overflow = not rescan_done,
           rescan_cursor = case when rescan_done then null else coalesce(lastdone, q.rescan_cursor) end
     where user_id = p_user;
  else
    return jsonb_build_object('state', 'none', 'scanned', 0);
  end if;
  delete from rewards.achievement_eval_queue where user_id = p_user and cardinality(dirty_scope) = 0 and not overflow;
  return jsonb_build_object('state', 'processed', 'scanned', coalesce((r ->> 'scanned')::integer, 0));
end $$;
-- ---------------------------------------------------------------- admin repair (mechanical recomputation only; never edits ledger or adjudication)
-- Candidate selection is a plain NON-LOCKING read; each candidate's user lock is only TRIED (never waited for), so repair cannot form a
-- cycle with a writer that waits. A skipped user keeps its row and stays first in line (oldest attempt first); skipped users do not use
-- up the call's slots, so other users are still served and a repeatedly locked user is processed as soon as it is released.
create function public.repair_achievements(p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); lim integer; cand uuid[]; u uuid; done integer := 0; skipped integer := 0; failed integer := 0; q record;
  batch_scanned integer := 0; pr jsonb;
begin
  if p_limit is null or p_limit < 1 then raise exception 'invalid limit' using errcode = '22023'; end if;
  lim := least(p_limit, 20);
  select array_agg(user_id) into cand from (
    select user_id from rewards.achievement_eval_queue order by last_attempt_at nulls first, first_failed_at, user_id limit 100) s;
  foreach u in array coalesce(cand, '{}') loop
    -- the BATCH is capped too, PERMISSIVELY (a scheduling allowance, not a hard 20,000): each user step is charged 5,001 up front (reserved, refunded to the measured count on success), and the batch stops once 20,000 are charged, so stop-after-user can reach 25,001
    -- MUTABLE:p3_repair_batch_cap begin
    exit when done + failed >= lim or batch_scanned >= 20000;
    -- MUTABLE:p3_repair_batch_cap end
    if not pg_try_advisory_xact_lock(hashtextextended('rewards:user:' || u::text, 0)) then skipped := skipped + 1; continue; end if;
    select * into q from rewards.achievement_eval_queue where user_id = u for update;
    if q.user_id is null or (cardinality(q.dirty_scope) = 0 and not q.overflow) then continue; end if;
    -- The user step's MAXIMUM work (5,000 raw rows + the sentinel) is RESERVED before the recoverable block: an exception unwinds the callee's own
    -- counters, so a late failure after thousands of rows read must still be charged. Only a successful, measured return refunds the unused part.
    -- MUTABLE:p3_repair_reserve begin
    batch_scanned := batch_scanned + 5001;
    -- MUTABLE:p3_repair_reserve end
    begin
      pr := rewards.ach_process_queue(u);
      batch_scanned := batch_scanned - 5001 + coalesce((pr ->> 'scanned')::integer, 0);
      done := done + 1;
    exception
      when sqlstate '55P03' then perform rewards.ach_enqueue(u, '{}', 'repair', '55P03', 1); failed := failed + 1;
      when sqlstate 'OSA01' then perform rewards.ach_enqueue(u, '{}', 'repair', 'OSA01', 1); failed := failed + 1;
    end;
  end loop;
  return jsonb_build_object('processed', done, 'skipped_locked', skipped, 'failed', failed, 'scanned', batch_scanned,
    'queue_remaining', (select count(*) from rewards.achievement_eval_queue));
end $$;

-- ---------------------------------------------------------------- the ONLY client read: the caller's own progress (no subject parameter)
create function public.get_my_progress(p_cursor text default null, p_limit integer default 20) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid(); st record; today date := rewards.ach_today(); entries text[]; more boolean := false; e text;
  items jsonb := '[]'::jsonb; pend text[]; ov boolean; k text; per text; rule text; ws date; we date;
  scanned integer := 0; rr jsonb; cache jsonb := '{}'::jsonb; ck text; m jsonb; df rewards.achievement_definitions%rowtype; val integer; eligible boolean; ev record; state text; stale text[] := '{}'; late boolean; item jsonb;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 50 then raise exception 'invalid page size' using errcode = '22023'; end if;
  if p_cursor is not null and p_cursor !~ '^[a-z][a-z0-9_]{2,47}[|][0-9A-Za-z:-]{1,40}$' then raise exception 'invalid cursor' using errcode = '22023'; end if;
  select rewards_enabled, global_budget_utc_day into st from rewards.reward_settings;
  -- disabled or unset: no live numbers at all
  if st.rewards_enabled is not true or st.global_budget_utc_day is null then
    return jsonb_build_object('state', 'disabled', 'items', '[]'::jsonb, 'next_cursor', null);
  end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || uid::text, 0));
  -- read-repair: only the caller's own queue row, user lock first
  if exists (select 1 from rewards.achievement_eval_queue where user_id = uid) then
    -- the repair step's whole budget is RESERVED before the recoverable block (a failure unwinds the callee's counters, so a late 55P03/OSA01 after
    -- thousands of rows read must leave the request charged); a successful, measured return replaces the reservation with the real count
    -- MUTABLE:p3_progress_reserve begin
    scanned := 5000;
    -- MUTABLE:p3_progress_reserve end
    begin
      -- ONE logical request budget (5,000 raw award rows): the read-repair step draws on it, and the display below spends only what remains
      -- MUTABLE:p3_progress_shared_budget begin
      rr := rewards.ach_process_queue(uid, 5000);
      scanned := coalesce((rr ->> 'scanned')::integer, 0);
      -- MUTABLE:p3_progress_shared_budget end
    exception
      when sqlstate '55P03' then perform rewards.ach_enqueue(uid, '{}', 'progress', '55P03', 1);
      when sqlstate 'OSA01' then perform rewards.ach_enqueue(uid, '{}', 'progress', 'OSA01', 1);
    end;
  end if;
  select dirty_scope, overflow into pend, ov from rewards.achievement_eval_queue where user_id = uid;
  select array_agg(x) into entries from (
    select x from (
      with keys as (select achievement_key as kk, (array_agg(window_rule order by version desc))[1] as rl
                      from rewards.achievement_definitions group by achievement_key)
      select kk || '|lifetime' as x from keys
        where rl = 'none' and exists (select 1 from rewards.achievement_definitions d where d.achievement_key = kk and d.effective_from_date <= today)
      union
      select kk || '|' || to_char(today, 'YYYY-MM') from keys
        where rl = 'calendar_month'
          and exists (select 1 from rewards.achievement_definitions d where d.achievement_key = kk and d.effective_from_date <= date_trunc('month', today)::date)
      union
      select d.achievement_key || '|' || d.window_starts_on::text from rewards.achievement_definitions d
        where d.window_rule = 'fixed' and today between d.window_starts_on and d.window_ends_on and d.effective_from_date <= d.window_starts_on
      union
      select c.achievement_key || '|' || c.period_key from rewards.achievement_chains c where c.user_id = uid
    ) u
    where p_cursor is null or (split_part(x, '|', 1), split_part(x, '|', 2)) > (split_part(p_cursor, '|', 1), split_part(p_cursor, '|', 2))
    order by split_part(x, '|', 1), split_part(x, '|', 2) limit p_limit + 1) z;
  entries := coalesce(entries, '{}');
  if cardinality(entries) > p_limit then more := true; entries := entries[1:p_limit]; end if;
  foreach e in array entries loop
    k := split_part(e, '|', 1); per := split_part(e, '|', 2);
    begin
      if ov or e = any (coalesce(pend, '{}')) then
        item := jsonb_build_object('achievement', k, 'period', per, 'state', 'unavailable');
      else
        rule := rewards.ach_rule(k);
        ws := rewards.ach_window_start(rule, per);
        df := rewards.ach_select_version(uid, k, per, today);
        we := case rule when 'calendar_month' then ((ws + interval '1 month')::date - 1) when 'fixed' then df.window_ends_on else null end;
        -- ONE request budget across read-repair and display: cache hits cost nothing; a finished exact calculation is read for free; a probe that
        -- finds the window over budget is CHARGED (sentinel included) and its outcome is cached, so it is never repeated inside the request; a window that
        -- does not fit is reported UNAVAILABLE (never a partial number) and queued for the bounded evaluator.
        ck := coalesce(ws::text, '') || '|' || coalesce(we::text, '');
        m := cache -> ck;
        if m is null then
          m := rewards.ach_calc_get(uid, ck);
          if m is null then
            if 5000 - scanned <= 0 then
              m := jsonb_build_object('over', true, 'rows', 0);
            else
              m := rewards.ach_metrics(uid, ws, we, 5000 - scanned);
              -- MUTABLE:p3_progress_charge begin
              scanned := scanned + (m ->> 'rows')::integer;
              -- MUTABLE:p3_progress_charge end
              -- an exact result that fit the remaining budget is SAVED, so a later request reads it for free (user-only recovery: no admin repair needed)
              -- MUTABLE:p3_store_exact_display begin
              perform rewards.ach_calc_store(uid, ck, m);
              -- MUTABLE:p3_store_exact_display end
            end if;
          end if;
          cache := cache || jsonb_build_object(ck, m);
        end if;
        if (m ->> 'over')::boolean is true then m := null; end if;
        if m is null then
          item := jsonb_build_object('achievement', k, 'period', per, 'state', 'unavailable');
          stale := stale || e;
        else
        val := (m ->> df.metric)::integer;
        eligible := val >= df.threshold;
        select x.event, x.created_at into ev from rewards.achievement_events x join rewards.achievement_chains c using (chain_id)
          where c.user_id = uid and c.achievement_key = k and c.period_key = per order by x.seq desc limit 1;
        -- an ineligible badge is NEVER labelled earned, and an unearned one is never labelled earned
        -- MUTABLE:p3_progress_states begin
        state := case
          when ev.event = 'award' and eligible then 'earned'
          when ev.event = 'award' then 'being_updated'
          when eligible then 'updating'
          when ev.event = 'revoke' then 'removed'
          else 'in_progress' end;
        -- MUTABLE:p3_progress_states end
        late := state = 'earned' and we is not null and (ev.created_at at time zone 'UTC')::date > we;
        item := jsonb_build_object('achievement', k, 'period', per, 'state', state, 'copy', df.copy, 'metric', df.metric);
        if state in ('in_progress', 'updating', 'earned', 'removed') then
          item := item || jsonb_build_object('value', val, 'threshold', df.threshold);
        end if;
        if state = 'earned' then item := item || jsonb_build_object('earned_at', ev.created_at, 'earned_late', late); end if;
        if state in ('being_updated', 'updating') then stale := stale || e; end if;
        end if;
      end if;
    exception when sqlstate 'OSA01' then
      item := jsonb_build_object('achievement', k, 'period', per, 'state', 'unavailable');
    end;
    items := items || item;
  end loop;
  if cardinality(stale) > 0 then perform rewards.ach_enqueue(uid, stale, 'progress_stale', null, 0); end if;
  return jsonb_build_object('state', 'ready', 'items', items,
    'next_cursor', case when more then entries[cardinality(entries)] else null end);
end $$;


-- ---------------------------------------------------------------- hooks: additive replacements of the P2 recorder, clearance and reversal
-- Bodies are the accepted P1/P2 bodies byte-for-byte except for the marked achievement hook (and, in clearance, the scope bookkeeping).
-- The hook is the LAST statement before commit, in its own savepoint inside ach_run, so it can never alter the reward outcome.
create or replace function rewards.record_visit_at(
  p_at timestamptz,
  p_location uuid,
  p_lat double precision,
  p_lng double precision,
  p_idempotency_key text,
  p_accuracy_m double precision
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  t0 timestamptz;
  utc_day date;
  local_day date;
  lc record;
  zone text;
  st record;
  pol record;
  existing rewards.visits%rowtype;
  dist_bucket text;
  acc_bucket text;
  ord integer;
  user_issued integer;
  global_issued integer;
  ev record;
  v_id uuid := gen_random_uuid();
  s_out text;
  l_out text;
  s_pts integer := 0;
  l_pts integer := 0;
  got integer;
  on_hold boolean;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_at is null then raise exception 'server time required' using errcode = '22023'; end if;
  if p_location is null or p_lat is null or p_lng is null
     or p_lat <> p_lat or p_lng <> p_lng
     or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  if p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{16,64}$' then
    raise exception 'invalid idempotency key' using errcode = '22023';
  end if;
  if p_accuracy_m is not null and (p_accuracy_m <> p_accuracy_m or p_accuracy_m <= 0 or p_accuracy_m > 100000) then
    raise exception 'invalid accuracy' using errcode = '22023';
  end if;

  t0 := p_at;
  utc_day := (t0 at time zone 'UTC')::date;

  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || uid::text, 0));

  select * into existing from rewards.visits where user_id = uid and idempotency_key = p_idempotency_key;
  if existing.id is not null then
    if existing.location_id <> p_location then
      raise exception 'idempotency key already used for another restroom' using errcode = '22023';
    end if;
    return jsonb_build_object(
      'visit_id', existing.id, 'replayed', true,
      'spendable_outcome', existing.spendable_outcome, 'lifetime_outcome', existing.lifetime_outcome,
      'spendable_points', coalesce((select sum(amount) from rewards.reward_ledger where visit_id = existing.id and kind = 'spendable' and entry_type = 'award'), 0),
      'lifetime_points', coalesce((select sum(amount) from rewards.reward_ledger where visit_id = existing.id and kind = 'lifetime' and entry_type = 'award'), 0));
  end if;

  select * into lc from rewards.location_check(p_location, p_lat, p_lng);
  if lc.available is not true then
    raise exception 'location not available' using errcode = '22023';
  end if;
  if lc.distance_bucket is null then
    raise exception 'too far from the restroom' using errcode = '22023';
  end if;
  dist_bucket := lc.distance_bucket;
  acc_bucket := case when p_accuracy_m is null then null when p_accuracy_m <= 25 then 'within_25'
                     when p_accuracy_m <= 50 then 'within_50' else 'over_50' end;

  select * into st from rewards.reward_settings;
  select * into pol from rewards.reward_policy_versions where effective_from <= t0 order by effective_from desc limit 1;
  if pol.id is null then raise exception 'no policy version in effect' using errcode = 'RW020'; end if;

  select z.time_zone into zone from rewards.reward_location_zones z where z.location_id = p_location;
  if not rewards.is_valid_time_zone(zone) then
    insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id,
        time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, accuracy_bucket, spendable_outcome, lifetime_outcome)
      values (v_id, uid, p_location, p_idempotency_key, t0, pol.id, st.history_id,
        null, null, utc_day, null, dist_bucket, acc_bucket, 'no_valid_time_zone', 'no_valid_time_zone');
    return jsonb_build_object('visit_id', v_id, 'replayed', false, 'spendable_outcome', 'no_valid_time_zone',
      'lifetime_outcome', 'no_valid_time_zone', 'spendable_points', 0, 'lifetime_points', 0);
  end if;
  local_day := (t0 at time zone zone)::date;

  perform pg_advisory_xact_lock(hashtextextended('rewards:uld:' || uid::text || ':' || p_location::text || ':' || local_day::text, 0));

  select count(*) + 1 into ord from rewards.visits
    where user_id = uid and location_id = p_location and policy_day_local = local_day;

  -- Read under the user lock, which hold placement and clearance also take, so a hold and a visit are strictly ordered.
  -- MUTABLE:p2_hold_read begin
  select exists (select 1 from rewards.reward_holds h where h.user_id = uid and h.cleared_at is null) into on_hold;
  -- MUTABLE:p2_hold_read end

  select coalesce((select spendable from rewards.reward_counters_user_day where user_id = uid and issuance_day_utc = utc_day), 0)
    into user_issued;
  select coalesce((select spendable from rewards.reward_counters_global_day where issuance_day_utc = utc_day), 0)
    into global_issued;

  select * into ev from rewards.evaluate_visit(pol.spendable_per_visit, pol.lifetime_first_daily, pol.max_rewarded_per_location_day,
    pol.max_spendable_per_user_utc_day, ord, user_issued, global_issued, st.rewards_enabled, st.global_budget_utc_day, on_hold);
  s_out := ev.spendable_outcome;
  l_out := ev.lifetime_outcome;

  if l_out = 'awarded' then
    insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
      values ('award', v_id, uid, p_location, local_day, pol.id, 'lifetime', ev.lifetime_points, 'first_visit_of_local_day');
    l_pts := ev.lifetime_points;
  end if;

  if s_out = 'awarded' then
    begin
      insert into rewards.reward_counters_user_day (user_id, issuance_day_utc, spendable)
        select uid, utc_day, pol.spendable_per_visit where pol.spendable_per_visit <= pol.max_spendable_per_user_utc_day
        on conflict (user_id, issuance_day_utc) do update
          set spendable = rewards.reward_counters_user_day.spendable + pol.spendable_per_visit
          where rewards.reward_counters_user_day.spendable + pol.spendable_per_visit <= pol.max_spendable_per_user_utc_day;
      get diagnostics got = row_count;
      if got = 0 then raise exception 'user day cap reached' using errcode = 'RW001'; end if;

      insert into rewards.reward_counters_global_day (issuance_day_utc, spendable)
        select utc_day, pol.spendable_per_visit where pol.spendable_per_visit <= st.global_budget_utc_day
        on conflict (issuance_day_utc) do update
          set spendable = rewards.reward_counters_global_day.spendable + pol.spendable_per_visit
          where rewards.reward_counters_global_day.spendable + pol.spendable_per_visit <= st.global_budget_utc_day;
      get diagnostics got = row_count;
      if got = 0 then raise exception 'global budget exhausted' using errcode = 'RW002'; end if;

      insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
        values ('award', v_id, uid, p_location, local_day, pol.id, 'spendable', ev.spendable_points, 'rewarded_visit');
      s_pts := ev.spendable_points;
    exception
      when sqlstate 'RW001' then s_out := 'user_day_cap';
      when sqlstate 'RW002' then s_out := 'budget_exhausted';
    end;
  end if;

  insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id,
      time_zone, policy_day_local, issuance_day_utc, ordinal, distance_bucket, accuracy_bucket, spendable_outcome, lifetime_outcome)
    values (v_id, uid, p_location, p_idempotency_key, t0, pol.id, st.history_id,
      zone, local_day, utc_day, ord, dist_bucket, acc_bucket, s_out, l_out);

  -- Third, disjoint achievement block (savepoint-isolated inside ach_run): it can never alter or roll back the visit or either reward kind.
  -- MUTABLE:p3_hook_visit begin
  if l_out = 'awarded' then
    perform rewards.ach_run(uid, rewards.ach_scope_for_day(local_day), null, 'visit');
  end if;
  -- MUTABLE:p3_hook_visit end

  return jsonb_build_object('visit_id', v_id, 'replayed', false, 'spendable_outcome', s_out, 'lifetime_outcome', l_out,
    'spendable_points', s_pts, 'lifetime_points', l_pts);
end $$;

create or replace function public.admin_reward_clear_hold(p_user uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); did uuid; h rewards.reward_holds%rowtype; hv record; dd record; r jsonb; n integer := 0; s bigint := 0; l bigint := 0;
  ach text[] := '{}';
begin
  if p_user is null then raise exception 'account required' using errcode = '22023'; end if;
  if p_user = a then raise exception 'administrators cannot adjudicate their own account' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || p_user::text, 0));
  select * into h from rewards.reward_holds where user_id = p_user and cleared_at is null for update;
  if h.id is null then raise exception 'the account has no active hold' using errcode = 'RW032'; end if;
  -- Shared-key order: clearance touches the global counter of every UTC day its held visits fall on, and holds each until commit. A
  -- per-account location order is not a global order, so EVERY issuance day this clearance can touch is serialized UP FRONT, in
  -- ascending day order, before any counter row is taken. Two clearances (any accounts) therefore queue instead of crossing.
  -- MUTABLE:p2_clear_day_locks begin
  for dd in select distinct v.issuance_day_utc as d from rewards.visits v
            where v.user_id = p_user and v.spendable_outcome = 'held'
              and not exists (select 1 from rewards.visit_clearances c where c.visit_id = v.id)
            order by 1 loop
    perform pg_advisory_xact_lock(hashtextextended('rewards:gday:' || dd.d::text, 0));
  end loop;
  -- MUTABLE:p2_clear_day_locks end
  insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, reason) values ('clear_hold', a, p_user, p_reason) returning id into did;
  update rewards.reward_holds set cleared_decision_id = did, cleared_at = clock_timestamp() where id = h.id;
  -- held visits in a deterministic order, each from its own frozen day
  for hv in select id, policy_day_local from rewards.visits
            where user_id = p_user and spendable_outcome = 'held'
              and not exists (select 1 from rewards.visit_clearances c where c.visit_id = visits.id)
            order by location_id, policy_day_local, ordinal, id loop
    r := rewards.award_held_visit(hv.id, did);
    n := n + 1; s := s + (r ->> 'spendable_points')::int; l := l + (r ->> 'lifetime_points')::int;
    if (r ->> 'lifetime_points')::int > 0 then ach := ach || rewards.ach_scope_for_day(hv.policy_day_local); end if;
  end loop;
  -- MUTABLE:p3_hook_clear begin
  if cardinality(ach) > 0 then perform rewards.ach_run(p_user, ach, null, 'clearance'); end if;
  -- MUTABLE:p3_hook_clear end
  return jsonb_build_object('decision_id', did, 'visits_cleared', n, 'spendable_awarded', s, 'lifetime_awarded', l);
end $$;

create or replace function public.admin_reward_finalize_reversal(p_recommendation uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare a uuid := public.require_admin(); rec rewards.reward_decisions%rowtype; fin rewards.reward_decisions%rowtype; o record; did uuid;
        n integer := 0; s bigint := 0; l bigint := 0;
        ach text[] := '{}'; lrev uuid; rid uuid;
begin
  select * into rec from rewards.reward_decisions where id = p_recommendation and decision_type = 'recommend_reversal';
  if rec.id is null then raise exception 'recommendation not found' using errcode = 'RW035'; end if;
  if rec.subject_user_id is null then raise exception 'the account was deleted' using errcode = 'RW030'; end if;
  if rec.subject_user_id = a then raise exception 'administrators cannot adjudicate their own account' using errcode = '42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('rewards:user:' || rec.subject_user_id::text, 0));
  -- re-read under the lock: the account may have been deleted (severed) while this call waited
  select * into rec from rewards.reward_decisions where id = p_recommendation;
  if rec.subject_user_id is null then raise exception 'the account was deleted' using errcode = 'RW030'; end if;
  -- retry/race: an existing final decision returns the identical result
  select * into fin from rewards.reward_decisions where recommendation_id = p_recommendation and decision_type = 'final_reversal';
  if fin.id is not null then
    select count(*), coalesce(sum(-amount) filter (where kind = 'spendable'), 0), coalesce(sum(-amount) filter (where kind = 'lifetime'), 0)
      into n, s, l from rewards.reward_ledger where reward_decision_id = fin.id and entry_type = 'reversal';
    return jsonb_build_object('decision_id', fin.id, 'replayed', true, 'reversed_entries', n, 'reversed_spendable', s, 'reversed_lifetime', l);
  end if;
  if not exists (select 1 from rewards.reward_ledger a where a.visit_id = rec.visit_id and a.entry_type = 'award'
                   and not exists (select 1 from rewards.reward_ledger r where r.reverses_entry_id = a.id)) then
    raise exception 'the visit has no unreversed award' using errcode = 'RW034';
  end if;
  insert into rewards.reward_decisions (decision_type, admin_id, subject_user_id, visit_id, recommendation_id, reason)
    values ('final_reversal', a, rec.subject_user_id, rec.visit_id, rec.id, p_reason) returning id into did;
  for o in select a.id, a.visit_id, a.user_id, a.location_id, a.policy_day_local, a.policy_version_id, a.kind, a.amount from rewards.reward_ledger a
           where a.visit_id = rec.visit_id and a.entry_type = 'award'
             and not exists (select 1 from rewards.reward_ledger r where r.reverses_entry_id = a.id)
           order by a.location_id, a.policy_day_local, a.id loop
    perform pg_advisory_xact_lock(hashtextextended('rewards:uld:' || o.user_id::text || ':' || o.location_id::text || ':' || o.policy_day_local::text, 0));
    insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason,
        reverses_entry_id, reward_decision_id)
      values ('reversal', o.visit_id, o.user_id, o.location_id, o.policy_day_local, o.policy_version_id, o.kind, -o.amount, 'fraud_reversal', o.id, did)
      returning id into rid;
    n := n + 1;
    if o.kind = 'spendable' then s := s + o.amount;
    else l := l + o.amount; lrev := rid; ach := ach || rewards.ach_scope_for_day(o.policy_day_local); end if;
  end loop;
  -- MUTABLE:p3_hook_reversal begin
  if lrev is not null then perform rewards.ach_run(rec.subject_user_id, ach, lrev, 'reversal'); end if;
  -- MUTABLE:p3_hook_reversal end
  return jsonb_build_object('decision_id', did, 'replayed', false, 'reversed_entries', n, 'reversed_spendable', s, 'reversed_lifetime', l);
end $$;

-- ---------------------------------------------------------------- ownership and privileges
grant create on schema rewards to reward_writer_owner;
grant create on schema public to reward_writer_owner;
alter function rewards.ach_today() owner to reward_writer_owner;
alter function rewards.ach_rule(text) owner to reward_writer_owner;
alter function rewards.ach_window_start(text, text) owner to reward_writer_owner;
alter function rewards.ach_select_version(uuid, text, text, date) owner to reward_writer_owner;
alter function rewards.ach_metrics(uuid, date, date, integer) owner to reward_writer_owner;
alter function rewards.ach_calc_invalidate(uuid) owner to reward_writer_owner;
alter function rewards.ach_calc_store(uuid, text, jsonb) owner to reward_writer_owner;
alter function rewards.ach_calc_pass(uuid, text) owner to reward_writer_owner;
alter function rewards.ach_calc_get(uuid, text) owner to reward_writer_owner;
alter function rewards.ach_calc_start(uuid, text) owner to reward_writer_owner;
alter function rewards.ach_calc_step(uuid, text, date, date, integer) owner to reward_writer_owner;
alter function rewards.ach_metric_value(uuid, text, date, date) owner to reward_writer_owner;
alter function rewards.ach_scope_for_day(date, date) owner to reward_writer_owner;
alter function rewards.ach_candidate_chains(uuid) owner to reward_writer_owner;
alter function rewards.ach_enqueue(uuid, text[], text, text, integer) owner to reward_writer_owner;
alter function rewards.evaluate_achievements(uuid, text[], uuid, date, integer) owner to reward_writer_owner;
alter function rewards.ach_run(uuid, text[], uuid, text) owner to reward_writer_owner;
alter function rewards.ach_process_queue(uuid, integer) owner to reward_writer_owner;
alter function public.repair_achievements(integer) owner to reward_writer_owner;
alter function public.get_my_progress(text, integer) owner to reward_writer_owner;
revoke create on schema rewards from reward_writer_owner;
revoke create on schema public from reward_writer_owner;

revoke all on function rewards.ach_today(), rewards.ach_rule(text), rewards.ach_window_start(text, text),
  rewards.ach_select_version(uuid, text, text, date), rewards.ach_metric_value(uuid, text, date, date), rewards.ach_metrics(uuid, date, date, integer), rewards.ach_calc_invalidate(uuid), rewards.ach_calc_pass(uuid, text), rewards.ach_calc_get(uuid, text), rewards.ach_calc_start(uuid, text), rewards.ach_calc_store(uuid, text, jsonb), rewards.ach_calc_step(uuid, text, date, date, integer), rewards.ach_scope_for_day(date, date),
  rewards.ach_candidate_chains(uuid), rewards.ach_enqueue(uuid, text[], text, text, integer),
  rewards.evaluate_achievements(uuid, text[], uuid, date, integer), rewards.ach_run(uuid, text[], uuid, text), rewards.ach_process_queue(uuid, integer),
  public.repair_achievements(integer), public.get_my_progress(text, integer)
  from public, anon, authenticated, service_role;
grant execute on function rewards.ach_today(), rewards.ach_rule(text), rewards.ach_window_start(text, text),
  rewards.ach_select_version(uuid, text, text, date), rewards.ach_metric_value(uuid, text, date, date), rewards.ach_metrics(uuid, date, date, integer), rewards.ach_calc_invalidate(uuid), rewards.ach_calc_pass(uuid, text), rewards.ach_calc_get(uuid, text), rewards.ach_calc_start(uuid, text), rewards.ach_calc_store(uuid, text, jsonb), rewards.ach_calc_step(uuid, text, date, date, integer), rewards.ach_scope_for_day(date, date),
  rewards.ach_candidate_chains(uuid), rewards.ach_enqueue(uuid, text[], text, text, integer),
  rewards.evaluate_achievements(uuid, text[], uuid, date, integer), rewards.ach_run(uuid, text[], uuid, text), rewards.ach_process_queue(uuid, integer)
  to reward_writer_owner;
-- the only client entry points: the caller's own progress (authenticated) and the admin-gated repair (identity and aal2 are checked INSIDE)
grant execute on function public.get_my_progress(text, integer), public.repair_achievements(integer) to authenticated;
