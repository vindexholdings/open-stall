#!/usr/bin/env bash
# P3 failed-subcall budget accounting and real cancellation, on REAL sessions of a disposable cluster (Work's bd33fae review).
#  A. get_my_progress: a REAL late 55P03 (a held chain lock) AFTER a near-budget metric scan inside the read-repair subcall. The callee's own counters are
#     unwound by the exception, so the caller RESERVES the repair step's budget before the recoverable block; the display must not get a second 5,000.
#  B. get_my_progress: a late OSA01 (an invalid queued entry after the first chain already scanned and awarded). Same accounting, plus the unwound award.
#  C. repair_achievements: a MIXED batch (one user late-failing 55P03 after a near-budget scan, healthy near-budget users around it): the failed user's
#     work is charged (reservation), healthy users still make progress (a stop-everything implementation fails this), the rest stays queued, retry completes.
#  D. a REAL pg_cancel_backend DURING a calculation step through the public progress path: 57014 propagates, the committed cursor/counts/queue are exactly
#     unchanged, no partial number or event; the retry finishes exactly once. (Forced-error and real-cancellation evidence are different tests: p3_13 vs this.)
# Work is measured INDEPENDENTLY by PostgreSQL (pg_stat_xact_user_tables), over the ENTIRE public RPC, not by the engine's self-reported counter.
# Usage: p3_14_failure_budget_cancel.sh <psql command...>   (the harness appends the database name)
set -uo pipefail
PSQL=("$@")
T="$(mktemp -d /tmp/rwc14.XXXXXX)"; chmod 777 "$T"
trap 'rm -rf "$T"' EXIT
FAILS=0; CHECKS=0
q() { "${PSQL[@]}" -A -t -c "$1"; }
ok() { CHECKS=$((CHECKS+1)); if [ "$2" = "t" ] || [ "$2" = "true" ]; then echo "ok - $1"; else echo "not ok - $1 (got '$2')"; FAILS=$((FAILS+1)); fi; }
eq() { CHECKS=$((CHECKS+1)); if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }
le() { CHECKS=$((CHECKS+1)); if [ "$2" -le "$3" ] 2>/dev/null; then echo "ok - $1 ($2 <= $3)"; else echo "not ok - $1 (got '$2', limit $3)"; FAILS=$((FAILS+1)); fi; }
uid() { echo "00000000-0000-0000-0000-$(printf '%012d' "$1")"; }
mkuser() { q "insert into auth.users (id, email) values ('$(uid "$1")', 'c14$1@test.invalid') on conflict do nothing" >/dev/null; uid "$1"; }
mkadmin() { local u; u="$(mkuser "$1")"; q "insert into public.admin_users (user_id) values ('$u') on conflict do nothing" >/dev/null; echo "$u"; }
mkloc() {
  local id; id="$(q "insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
    values ('C14 loc $1', 63 + $1 / 100.0, -100, 'verified', 'explicit', true, now()) returning id")"
  q "insert into rewards.reward_location_zones values ('$id', 'America/Denver')" >/dev/null; echo "$id"
}
READS="select coalesce(sum(seq_tup_read + idx_tup_fetch + idx_scan), 0)::bigint from pg_stat_xact_user_tables where relname = 'reward_ledger'"
# seed <user> <ndays> : one lifetime award per local day on each of the 5 fixture locations (triggers disabled for the SEED ONLY)
seed() { "${PSQL[@]}" -q -v ON_ERROR_STOP=1 >/dev/null <<SQL
do \$\$
declare locs uuid[]; pol bigint; sh bigint;
begin
  select array_agg(id order by id) into locs from public.locations where name like 'C14 loc %' and id in (select location_id from rewards.reward_location_zones);
  select id into pol from rewards.reward_policy_versions order by effective_from limit 1;
  select max(id) into sh from rewards.reward_settings_history;
  set local session_replication_role = replica;
  with d as (select (date '2024-01-01' + g)::date as day, g from generate_series(0, $2 - 1) g),
       l as (select locs[n] as loc, n from generate_series(1, cardinality(locs)) n),
       v as (select gen_random_uuid() as id, l.loc, d.day, 'c14-$1-' || l.n || '-' || d.g as key from d cross join l),
       iv as (insert into rewards.visits (id, user_id, location_id, idempotency_key, occurred_at, policy_version_id, settings_history_id, time_zone,
                  policy_day_local, issuance_day_utc, ordinal, distance_bucket, spendable_outcome, lifetime_outcome)
              select id, '$1', loc, key, (day || ' 18:00:00+00')::timestamptz, pol, sh, 'America/Denver', day, day, 1, 'within_50', 'location_cap', 'awarded' from v returning id, location_id, policy_day_local)
  insert into rewards.reward_ledger (entry_type, visit_id, user_id, location_id, policy_day_local, policy_version_id, kind, amount, reason)
    select 'award', id, '$1', location_id, policy_day_local, pol, 'lifetime', 5, 'first_visit_of_local_day' from iv;
end \$\$;
SQL
}
hdr() { echo "\\set VERBOSITY sqlstate"; echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);"; if [ -n "${2:-}" ]; then echo "select set_config('request.jwt.claims', '{\"aal\":\"$2\"}', false);"; fi; }
# measured RPC: the WHOLE public call between two readings of PostgreSQL's own transaction-level ledger counters
measured() { # <user> <aal|-> <sql returning one text value> <outfile>
  { echo "\\set VERBOSITY sqlstate"; echo "begin;"; echo "select ($READS) as r0 \\gset"
    echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);"
    [ "$2" = "-" ] || echo "select set_config('request.jwt.claims', '{\"aal\":\"$2\"}', false);"
    echo "select 'RESULT|' || ($3)::text;"; echo "reset role;"
    echo "select 'READS|' || (($READS) - :r0);"; echo "commit;"; } | "${PSQL[@]}" -A -t -f - >"$4" 2>&1
}
reads_of() { grep -o '^READS|[0-9]*' "$1" | cut -d'|' -f2; }
result_of() { grep '^RESULT|' "$1" | cut -d'|' -f2-; }
quick() { local out="$1"; shift; "$@" | "${PSQL[@]}" -A -t -f - >"$out" 2>&1; }
err() { grep -oE 'ERROR:  [0-9A-Z]{5}' "$1" | head -1 | sed 's/ERROR:  //'; }
holdchain() { "${PSQL[@]}" -A -t -c "select pg_advisory_lock(hashtextextended('rewards:chain:$1:$2:lifetime', 0))" -c "select pg_sleep($3)" -c "select pg_advisory_unlock(hashtextextended('rewards:chain:$1:$2:lifetime', 0))" >"$T/hold" 2>&1; }
events_of() { q "select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = '$1' and c.achievement_key = '$2'"; }
qrow() { q "select coalesce((select coalesce(last_sqlstate, '') || '|' || array_to_string(dirty_scope, ',') from rewards.achievement_eval_queue where user_id = '$1'), 'none')"; }

q "update rewards.reward_settings set rewards_enabled = true, global_budget_utc_day = 1000000" >/dev/null
for n in lt1 lt2; do   # lt1 is the queued chain; lt2 is a NON-pending chain the display must evaluate itself (it is the one a second budget would be spent on)
 
  q "insert into rewards.achievement_definitions (achievement_key, version, metric, threshold, window_rule, effective_from_date, copy) values ('$n', 1, 'lifetime_points_total', 100, 'none', '2019-01-01', 'synthetic')" >/dev/null
done
for i in 1 2 3 4 5; do mkloc "$i" >/dev/null; done
ADM="$(mkadmin 9801)"
BOUND=$((3 * 5001 + 600))   # one logical request: 5,000 raw rows + sentinel, <= one reversal probe per raw row (+ heap), + a few hundred catalog/chain/queue lookups

# ============================================================ A. progress: REAL late 55P03 after a near-budget scan
UA="$(mkuser 9811)"; seed "$UA" 980   # 5 locations x 980 days = 4,900 raw standing awards: fits ONE budget (5,000) but almost all of it
q "insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope) values ('$UA', 'seed', array['lt1|lifetime'])" >/dev/null
holdchain "$UA" lt1 4 &
PH=$!; sleep 0.6
measured "$UA" - "public.get_my_progress(null, 50)" "$T/a1"
wait $PH
eq "A: the progress call itself returned (the late 55P03 is recoverable there, no error to the client)" "$(err "$T/a1")" ""
le "A: the ENTIRE progress RPC read at most one logical request's work although the repair subcall failed late after ~4,900 raw rows (a display with a second full budget reads about twice this)" "$(reads_of "$T/a1")" "$BOUND"
eq "A: no partial or stale earned state: no event" "$(events_of "$UA" lt1)" "0"
eq "A: the pending scope is exactly retained with the 55P03 marker" "$(qrow "$UA")" "55P03|lt1|lifetime,lt2|lifetime"
eq "A: the pending chain is reported unavailable (no number)" "$(result_of "$T/a1" | python3 -c "import sys,json; d=json.load(sys.stdin); print(','.join(i['state'] for i in d['items'] if i['achievement'] in ('lt1','lt2')))")" "unavailable,unavailable"
measured "$UA" - "public.get_my_progress(null, 50)" "$T/a2"
q "select 1" >/dev/null
quick "$T/a3" bash -c "$(declare -f hdr); hdr '$ADM' aal2; echo 'select public.repair_achievements(20)::text;'"
eq "A: retry after the lock is released completes the chain exactly once and repair clears the queue (the progress display re-queues a chain it could not show on the budget left over after repair; the next repair clears it without any new event)" "$(events_of "$UA" lt1)/$(events_of "$UA" lt2)/$(qrow "$UA")" "1/1/none"
le "A: the retry is bounded by one logical request too" "$(reads_of "$T/a2")" "$BOUND"

# ============================================================ B. progress: late OSA01 after substantial work (and an unwound award)
UB="$(mkuser 9812)"; seed "$UB" 980
q "insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope) values ('$UB', 'seed', array['lt1|lifetime','zz_unknown|lifetime'])" >/dev/null
measured "$UB" - "public.get_my_progress(null, 50)" "$T/b1"
eq "B: the progress call returned (OSA01 is a recoverable class)" "$(err "$T/b1")" ""
le "B: the ENTIRE progress RPC is bounded to one logical request although the evaluator failed late after scanning and appending the first chain" "$(reads_of "$T/b1")" "$BOUND"
eq "B: the first chain's award was UNWOUND with the failed subcall (no partial state)" "$(events_of "$UB" lt1)" "0"
eq "B: the queue retains BOTH entries with the OSA01 marker" "$(qrow "$UB")" "OSA01|lt1|lifetime,lt2|lifetime,zz_unknown|lifetime"
# the queue guard accepts only the writer role: remove the bad entry AS the writer
q "set role reward_writer_owner; update rewards.achievement_eval_queue set dirty_scope = array['lt1|lifetime'] where user_id = '$UB'" >/dev/null
measured "$UB" - "public.get_my_progress(null, 50)" "$T/b2"
quick "$T/b3" bash -c "$(declare -f hdr); hdr '$ADM' aal2; echo 'select public.repair_achievements(20)::text;'"
eq "B: once the bad entry is gone the retry completes exactly once" "$(events_of "$UB" lt1)/$(events_of "$UB" lt2)/$(qrow "$UB")" "1/1/none"

# ============================================================ C. repair: a MIXED batch (one late-failing user, healthy near-budget users around it)
UF="$(mkuser 9820)"; seed "$UF" 980
H=(); for n in 1 2 3 4 5 6; do h="$(mkuser $((9820 + n)))"; seed "$h" 980; H+=("$h"); done
q "insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope, first_failed_at) values ('$UF', 'seed', array['lt1|lifetime'], now() - interval '2 hours')" >/dev/null
for n in 0 1 2 3 4 5; do
  q "insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope, first_failed_at) values ('${H[$n]}', 'seed', array['lt1|lifetime'], now() - interval '1 hour' + interval '$n minutes')" >/dev/null
done
holdchain "$UF" lt1 6 &
PH=$!; sleep 0.6
measured "$ADM" aal2 "public.repair_achievements(20)" "$T/c1"
wait $PH
RES="$(result_of "$T/c1")"
jf() { echo "$RES" | python3 -c "import sys,json; print(json.load(sys.stdin)['$1'])"; }
eq "C: the failed user is counted failed, exactly one" "$(jf failed)" "1"
eq "C: the failed user's near-budget work was CHARGED: only 4 healthy users fit under the 20,000 batch allowance (5,001 reserved + 4 x 4,900 = 24,601; with the failure uncharged a fifth healthy user would also run)" "$(jf processed)" "4"
ok "C: the reported batch count is permissive-bounded (stop-after-user: below 20,000 + one more user step, 25,001 at most)" "$( [ "$(jf scanned)" -ge 20000 ] && [ "$(jf scanned)" -le 25001 ] && echo t || echo "scanned $(jf scanned)")"
le "C: the ENTIRE multi-user batch read at most 5 user steps of work (independent PostgreSQL counters)" "$(reads_of "$T/c1")" "$((5 * (3 * 5001 + 600)))"
eq "C: the failed user kept exactly its pending scope and wrote nothing" "$(qrow "$UF")/$(events_of "$UF" lt1)" "55P03|lt1|lifetime/0"
eq "C: healthy users around the failure DID make progress (a stop-everything batch fails this): H1-H4 awarded once each, queues cleared" "$(for n in 0 1 2 3; do echo -n "$(events_of "${H[$n]}" lt1)$(qrow "${H[$n]}")|"; done)" "1none|1none|1none|1none|"
eq "C: the remaining healthy users are still pending and untouched" "$(qrow "${H[4]}")/$(qrow "${H[5]}")/$(events_of "${H[4]}" lt1)$(events_of "${H[5]}" lt1)" "|lt1|lifetime/|lt1|lifetime/00"
# retry once the lock is gone: everything completes, one award each, no double counting
for i in 1 2 3; do quick "$T/c2" bash -c "$(declare -f hdr); hdr '$ADM' aal2; echo 'select public.repair_achievements(20)::text;'"; done
eq "C: retry completes the failed user and the rest: exactly one award event for EVERY user, no queue rows left" "$(for u in "$UF" "${H[@]}"; do echo -n "$(events_of "$u" lt1)"; done)/$(q "select count(*) from rewards.achievement_eval_queue where user_id = any (array['$UF', '$(IFS=,; echo "${H[*]}" | sed "s/,/','/g")']::uuid[])")" "1111111/0"

# ============================================================ D. a REAL pg_cancel_backend DURING a calculation step (public progress path)
UD="$(mkuser 9830)"
seed "$UD" 1200   # 5 x 1,200 = 6,000 raw standing awards: ONE window larger than a fresh budget -> the resumable exact calculation
q "insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope) values ('$UD', 'seed', array['lt1|lifetime'])" >/dev/null
quick "$T/d0" bash -c "$(declare -f hdr); hdr '$UD'; echo 'select public.get_my_progress(null, 50)::text;'"
eq "D: the first request started the persisted exact calculation (state row exists, pass days, no event)" "$(q "select count(*) || '|' || coalesce(max(pass), '-') from rewards.achievement_calc_state where user_id = '$UD'")/$(events_of "$UD" lt1)" "1|days/0"
SNAP_STATE="$(q "select md5(s::text) from rewards.achievement_calc_state s where user_id = '$UD'")"
SNAP_QUEUE="$(q "select md5(e::text) from rewards.achievement_eval_queue e where user_id = '$UD'")"
q "create function public.zz_sleep14() returns trigger language plpgsql as \$\$ begin perform pg_sleep(10); return new; end \$\$" >/dev/null
q "create trigger zz_state_sleep before update on rewards.achievement_calc_state for each row execute function public.zz_sleep14()" >/dev/null
quick "$T/d1" bash -c "$(declare -f hdr); hdr '$UD'; echo \"set application_name = 'p3cancel14';\"; echo 'select public.get_my_progress(null, 50)::text;'" &
PV=$!
pid=""
for i in $(seq 1 80); do
  pid="$(q "select pid from pg_stat_activity where application_name = 'p3cancel14' and wait_event = 'PgSleep' limit 1")"
  [ -n "$pid" ] && break; sleep 0.2
done
ok "D: the progress backend was found INSIDE the calculation step (sleeping in the state update, after the rows were read)" "$( [ -n "$pid" ] && echo t || echo f)"
q "select pg_cancel_backend($pid)" >/dev/null
wait $PV
eq "D: a real pg_cancel_backend during the step raises 57014 out of the public progress RPC (not swallowed)" "$(err "$T/d1")" "57014"
q "drop trigger zz_state_sleep on rewards.achievement_calc_state" >/dev/null
eq "D: the committed calculation state (cursor, counts, pass, steps) is byte-for-byte unchanged" "$(q "select md5(s::text) from rewards.achievement_calc_state s where user_id = '$UD'")" "$SNAP_STATE"
eq "D: the queue row is byte-for-byte unchanged" "$(q "select md5(e::text) from rewards.achievement_eval_queue e where user_id = '$UD'")" "$SNAP_QUEUE"
eq "D: no partial number or event was left" "$(events_of "$UD" lt1)" "0"
for i in 1 2 3 4; do quick "$T/d2" bash -c "$(declare -f hdr); hdr '$UD'; echo 'select public.get_my_progress(null, 50)::text;'"; done
eq "D: the retry finishes the exact calculation ONCE: one award, qualifying_value = the exact standing points (6,000 x 5), queue cleared" "$(q "select count(*) || '|' || max(qualifying_value) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = '$UD' and c.achievement_key = 'lt1'")/$(q "select count(*) from rewards.achievement_eval_queue where user_id = '$UD' and 'lt1|lifetime' = any (dirty_scope)")" "1|30000/0"
q "drop function public.zz_sleep14()" >/dev/null

echo "p3_14: $CHECKS checks, $FAILS failed"
[ "$FAILS" -eq 0 ]
