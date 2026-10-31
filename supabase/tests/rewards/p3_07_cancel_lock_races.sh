#!/usr/bin/env bash
# P3 real-session failure and race tests, on real concurrent sessions of a disposable cluster:
#  1. 55P03: a real chain lock held by another session makes the hook's bounded wait expire; the visit and both rewards COMMIT and a dirty
#     queue row COMMITS (a hypothesis proven here, not assumed). Repair then completes the chain.
#  2. 57014 from a real statement_timeout and from a real pg_cancel_backend PROPAGATE: the whole visit is aborted (no visit, no ledger row, no
#     queue row). No claim is made that a SET LOCAL statement_timeout bounds a running RPC beyond what is demonstrated here.
#  3. repair vs reversal interleavings: repair only TRIES the user lock (never waits), a skipped user keeps its row, a reversal that waits behind a
#     held user lock then revokes (final state equals a serial run), no deadlock; a repeatedly locked user does not starve the others.
# Usage: p3_07_cancel_lock_races.sh <psql command...>   (the harness appends the database name)
set -uo pipefail
PSQL=("$@")
T="$(mktemp -d /tmp/rwc7.XXXXXX)"; chmod 777 "$T"
trap 'rm -rf "$T"' EXIT
FAILS=0; CHECKS=0
q() { "${PSQL[@]}" -A -t -c "$1"; }
ok() { CHECKS=$((CHECKS+1)); if [ "$2" = "t" ] || [ "$2" = "true" ]; then echo "ok - $1"; else echo "not ok - $1 (got '$2')"; FAILS=$((FAILS+1)); fi; }
eq() { CHECKS=$((CHECKS+1)); if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }
uid() { echo "00000000-0000-0000-0000-$(printf '%012d' "$1")"; }
mkuser() { q "insert into auth.users (id, email) values ('$(uid "$1")', 'c7$1@test.invalid') on conflict do nothing" >/dev/null; uid "$1"; }
mkadmin() { local u; u="$(mkuser "$1")"; q "insert into public.admin_users (user_id) values ('$u') on conflict do nothing" >/dev/null; echo "$u"; }
LATBASE=61
mkloc() {
  local id; id="$(q "insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
    values ('C7 loc $1', $LATBASE + $1 / 100.0, -100, 'verified', 'explicit', true, now()) returning id")"
  q "insert into rewards.reward_location_zones values ('$id', 'America/Denver')" >/dev/null; echo "$id"
}
latof() { q "select latitude from public.locations where id = '$1'"; }
hdr() { echo "\\set VERBOSITY sqlstate"; echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);"; if [ -n "${2:-}" ]; then echo "select set_config('request.jwt.claims', '{\"aal\":\"$2\"}', false);"; fi; }
# the client path: public.record_visit, with an optional session setting (e.g. statement_timeout) applied first
visit_sql() { hdr "$1"; [ -z "${4:-}" ] || echo "$4"; echo "select (r->>'spendable_outcome')||'|'||(r->>'lifetime_outcome')||'|'||(r->>'visit_id') from (select public.record_visit('$2', $(latof "$2"), -100, '$3') as r) s;"; }
adm_sql() { hdr "$1" aal2; echo "select ($2)::text;"; }
quick() { local out="$1"; shift; "$@" | "${PSQL[@]}" -A -t -f - >"$out" 2>&1; }
err() { grep -oE 'ERROR:  [0-9A-Z]{5}' "$1" | head -1 | sed 's/ERROR:  //'; }
ms() { date +%s%3N; }
q "update rewards.reward_settings set rewards_enabled = true, global_budget_utc_day = 1000000" >/dev/null
q "insert into rewards.achievement_definitions (achievement_key, version, metric, threshold, window_rule, effective_from_date, copy) values ('first_stop', 1, 'qualifying_awards', 1, 'none', '2026-01-01', 'synthetic')" >/dev/null
A1="$(mkadmin 9701)"; A2="$(mkadmin 9702)"
chainlock() { echo "rewards:chain:$1:$2:$3"; }
holdchain() { "${PSQL[@]}" -A -t -c "select pg_advisory_lock(hashtextextended('$(chainlock "$1" first_stop lifetime)', 0))" -c "select pg_sleep($2)" -c "select pg_advisory_unlock(hashtextextended('$(chainlock "$1" first_stop lifetime)', 0))" >"$T/hold" 2>&1; }

# ============================================================ 1. a real, bounded 55P03: committed visit + dirty queue
U1="$(mkuser 9711)"; L1="$(mkloc 1)"
holdchain "$U1" 2 &
PH=$!; sleep 0.5
t0="$(ms)"; quick "$T/v1" visit_sql "$U1" "$L1" "c7-lock-0000000000000001"; t1="$(ms)"
wait $PH
eq "a held chain lock: the visit still returns awarded|awarded (no error)" "$(cut -d'|' -f1-2 "$T/v1" | tail -1)/$(err "$T/v1")" "awarded|awarded/"
ok "the wait was BOUNDED by the hook's own lock_timeout (well under the 2 s the lock was held)" "$( [ $((t1 - t0)) -lt 1800 ] && [ $((t1 - t0)) -ge 200 ] && echo t || echo "elapsed $((t1 - t0)) ms")"
eq "the visit and BOTH reward kinds are committed" "$(q "select (select count(*) from rewards.visits where user_id = '$U1') || '/' || (select count(*) from rewards.reward_ledger where user_id = '$U1' and entry_type = 'award')")" "1/2"
eq "no event was written by the timed-out attempt" "$(q "select count(*) from rewards.achievement_events")" "0"
eq "a dirty queue row COMMITTED with the visit: SQLSTATE 55P03, the unevaluated chain, one attempt" "$(q "select last_sqlstate || '|' || attempts || '|' || array_to_string(dirty_scope, ',') from rewards.achievement_eval_queue where user_id = '$U1'")" "55P03|1|first_stop|lifetime"
quick "$T/r1" adm_sql "$A1" "public.repair_achievements(5)"
eq "after the lock is released, repair completes the chain and clears the queue" "$(q "select count(*) from rewards.achievement_events")/$(q "select count(*) from rewards.achievement_eval_queue")" "1/0"

# ============================================================ 2. propagating 57014: a REAL statement_timeout and a REAL pg_cancel_backend
U2="$(mkuser 9712)"; L2="$(mkloc 2)"
holdchain "$U2" 2 &
PH=$!; sleep 0.5
quick "$T/v2" visit_sql "$U2" "$L2" "c7-timeout-0000000000001" "set statement_timeout = '100ms';"
wait $PH
eq "a statement_timeout shorter than the bounded wait raises 57014 out of the visit (not swallowed)" "$(err "$T/v2")" "57014"
eq "the timed-out visit left NOTHING: no visit, no ledger row, no event, no queue row" "$(q "select (select count(*) from rewards.visits where user_id = '$U2') || '/' || (select count(*) from rewards.reward_ledger where user_id = '$U2') || '/' || (select count(*) from rewards.achievement_eval_queue where user_id = '$U2')")" "0/0/0"
q "create function public.zz_sleep() returns trigger language plpgsql as \$\$ begin perform pg_sleep(8); return null; end \$\$" >/dev/null
q "create trigger zz_ev_sleep after insert on rewards.achievement_events for each row execute function public.zz_sleep()" >/dev/null
U3="$(mkuser 9713)"; L3="$(mkloc 3)"
quick "$T/v3" visit_sql "$U3" "$L3" "c7-cancel-00000000000001" "set application_name = 'p3cancel';" &
PV=$!
for i in $(seq 1 60); do
  pid="$(q "select pid from pg_stat_activity where application_name = 'p3cancel' and wait_event = 'PgSleep' limit 1")"
  [ -n "$pid" ] && break; sleep 0.2
done
ok "the visit's backend was found inside the achievement evaluation (sleeping in the event insert)" "$( [ -n "$pid" ] && echo t || echo f)"
q "select pg_cancel_backend($pid)" >/dev/null
wait $PV
eq "pg_cancel_backend during the achievement block raises 57014 out of the visit (not swallowed)" "$(err "$T/v3")" "57014"
eq "the cancelled visit left NOTHING: no visit, no ledger row, no event, no queue row" "$(q "select (select count(*) from rewards.visits where user_id = '$U3') || '/' || (select count(*) from rewards.reward_ledger where user_id = '$U3') || '/' || (select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = '$U3') || '/' || (select count(*) from rewards.achievement_eval_queue where user_id = '$U3')")" "0/0/0/0"
q "drop trigger zz_ev_sleep on rewards.achievement_events" >/dev/null

# ============================================================ 3. repair vs reversal interleavings and fair ordering
q "create function public.zz_delay() returns trigger language plpgsql as \$\$ begin perform pg_sleep(2); return null; end \$\$" >/dev/null
holduser() { "${PSQL[@]}" -A -t -c "begin" -c "select pg_advisory_xact_lock(hashtextextended('rewards:user:$1', 0))" -c "select pg_sleep($2)" -c "commit" >"$T/holduser" 2>&1; }
seed_user() { local n="$1" u l; u="$(mkuser "$n")"; l="$(mkloc "$n")"; quick "$T/seed$n" visit_sql "$u" "$l" "c7-seed-00000000000$n"; echo "$u"; }
visit_of() { q "select id from rewards.visits where user_id = '$1' limit 1"; }
recommend() { quick "$T/rec$1" adm_sql "$A1" "public.admin_reward_recommend_reversal('$2', 'recommend for race')"; tail -1 "$T/rec$1"; }
finalize_sql() { adm_sql "$A2" "public.admin_reward_finalize_reversal('$1', 'finalize for race')"; }
events_of() { q "select string_agg(e.event || '#' || e.seq, ',' order by e.seq) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.user_id = '$1' and c.achievement_key = 'first_stop'"; }

# (i) the reversal holds the user lock (slow ledger insert); repair only TRIES it, skips, and the row stays
U4="$(seed_user 14)"
eq "(setup) the visit's hook awarded First Stop" "$(events_of "$U4")" "award#1"
REC4="$(recommend 4 "$(visit_of "$U4")")"
q "insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope) values ('$U4', 'seed', array['first_stop|lifetime'])" >/dev/null
q "create trigger zz_rev_delay after insert on rewards.reward_ledger for each statement execute function public.zz_delay()" >/dev/null
quick "$T/f4" finalize_sql "$REC4" &
PF=$!; sleep 0.7
quick "$T/rp4" adm_sql "$A1" "public.repair_achievements(5)"
eq "repair while the reversal holds the user lock: skipped (not waited for), nothing processed" "$(grep -o '"skipped_locked": [0-9]*' "$T/rp4")/$(grep -o '"processed": [0-9]*' "$T/rp4")" '"skipped_locked": 1/"processed": 0'
eq "the skipped user's queue row is retained" "$(q "select count(*) from rewards.achievement_eval_queue where user_id = '$U4'")" "1"
wait $PF
q "drop trigger zz_rev_delay on rewards.reward_ledger" >/dev/null
eq "the reversal committed and its OWN in-transaction evaluation revoked the badge (no deadlock, no error)" "$(events_of "$U4")/$(err "$T/f4")" "award#1,revoke#2/"
quick "$T/rp4b" adm_sql "$A1" "public.repair_achievements(5)"
eq "the next repair clears the retained row without changing the log (idempotent, equals a serial run)" "$(events_of "$U4")/$(q "select count(*) from rewards.achievement_eval_queue where user_id = '$U4'")" "award#1,revoke#2/0"

# (ii) repair (any holder of the user lock) is running; the reversal WAITS, then revokes: final state equals a serial run
U5="$(seed_user 15)"
REC5="$(recommend 5 "$(visit_of "$U5")")"
holduser "$U5" 2 &
PH=$!; sleep 0.5
t0="$(ms)"; quick "$T/f5" finalize_sql "$REC5"; t1="$(ms)"
wait $PH
eq "the reversal waited behind the held user lock, then committed and revoked (no 40P01)" "$(events_of "$U5")/$(err "$T/f5")" "award#1,revoke#2/"
ok "the reversal really waited for the lock (about the 1.5 s remaining)" "$( [ $((t1 - t0)) -ge 1000 ] && echo t || echo "elapsed $((t1 - t0)) ms")"

# (iii) fair ordering: a repeatedly locked user at the front does not starve the others, and is served once released
U6="$(seed_user 16)"; U7="$(seed_user 17)"
q "insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope, first_failed_at) values ('$U6', 'seed', array['first_stop|lifetime'], now() - interval '2 hours'), ('$U7', 'seed', array['first_stop|lifetime'], now() - interval '1 hour')" >/dev/null
holduser "$U6" 2 &
PH=$!; sleep 0.5
quick "$T/fr1" adm_sql "$A1" "public.repair_achievements(1)"
wait $PH
eq "repair(1) with the front user locked: the locked user is skipped, the NEXT user is processed" "$(grep -o '"processed": [0-9]*' "$T/fr1")/$(grep -o '"skipped_locked": [0-9]*' "$T/fr1")/$(q "select string_agg(user_id::text, ',' order by user_id) from rewards.achievement_eval_queue")" "\"processed\": 1/\"skipped_locked\": 1/$U6"
quick "$T/fr2" adm_sql "$A1" "public.repair_achievements(1)"
eq "once released, the previously locked user is processed and the queue is empty" "$(grep -o '"processed": [0-9]*' "$T/fr2")/$(q "select count(*) from rewards.achievement_eval_queue")" '"processed": 1/0'

# (iv) many users and two concurrent repair calls: no deadlock, no duplicate event, queue empty
for n in 18 19 20 21; do u="$(seed_user $n)"; q "insert into rewards.achievement_eval_queue (user_id, reason, dirty_scope) values ('$u', 'seed', array['first_stop|lifetime'])" >/dev/null; done
quick "$T/b1" adm_sql "$A1" "public.repair_achievements(20)" &
PB1=$!
quick "$T/b2" adm_sql "$A2" "public.repair_achievements(20)" &
PB2=$!
wait $PB1; wait $PB2
eq "two concurrent repair calls: no deadlock victim, no error" "$(cat "$T/b1" "$T/b2" | grep -c '40P01')/$(err "$T/b1")$(err "$T/b2")" "0/"
eq "no duplicate event: 11 First Stop events in total (1 + 2 revoked + 2 revoked + 1 + 1 + 4 seeded users) and the queue is empty" "$(q "select count(*) from rewards.achievement_eval_queue")/$(q "select count(*) from rewards.achievement_events e join rewards.achievement_chains c using (chain_id) where c.achievement_key = 'first_stop'")" "0/11"

echo "checks: $((CHECKS - FAILS)) passed, $FAILS failed"
[ "$FAILS" = 0 ]
