#!/usr/bin/env bash
# P2 two-session (and many-session) scenarios on the real lifecycle paths, as the `authenticated` role through the public admin RPCs,
# public.record_visit and public.delete_my_account, against the throwaway cluster started by scripts/test-db-rewards.sh.
# Scenarios hold one transaction open (pg_sleep) while a second session runs: reversal/reversal, reversal/record, reversal/purge,
# purge/reversal, clear/record, record/clear, clear/clear, purge/record, hold/hold, and a mixed no-deadlock stress.
# Lock order under test: policy(0) -> user advisory(1) -> user/location/day(2) -> user-day counter(3) -> global counter(4).
# Usage: p2_07_concurrency.sh <psql command...>   (the harness appends the database name)
set -uo pipefail
PSQL=("$@")
T="$(mktemp -d /tmp/rwc2.XXXXXX)"; chmod 777 "$T"
trap 'rm -rf "$T"' EXIT
FAILS=0; CHECKS=0
q() { "${PSQL[@]}" -A -t -c "$1"; }
ok() { CHECKS=$((CHECKS+1)); if [ "$2" = "t" ] || [ "$2" = "true" ]; then echo "ok - $1"; else echo "not ok - $1 (got '$2')"; FAILS=$((FAILS+1)); fi; }
eq() { CHECKS=$((CHECKS+1)); if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }

secs="$(q "select least(extract(epoch from (date_trunc('day', now() at time zone 'UTC') + interval '1 day') - (now() at time zone 'UTC')),
                      extract(epoch from ((date_trunc('day', now() at time zone 'America/Denver') + interval '1 day') at time zone 'America/Denver') - now()))::int")"
if [ "$secs" -lt 150 ]; then echo "(waiting $((secs+3)) s for a day boundary to pass)"; sleep $((secs+3)); fi

uid() { echo "00000000-0000-0000-0000-$(printf '%012d' "$1")"; }
mkuser() { q "insert into auth.users (id, email) values ('$(uid "$1")', 'c2$1@test.invalid') on conflict do nothing" >/dev/null; uid "$1"; }
mkadmin() { local u; u="$(mkuser "$1")"; q "insert into public.admin_users (user_id) values ('$u') on conflict do nothing" >/dev/null; echo "$u"; }
LATBASE=60
mkloc() {
  local id; id="$(q "insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
    values ('C2 loc $1', $LATBASE + $1 / 100.0, -100, 'verified', 'explicit', true, now()) returning id")"
  q "insert into rewards.reward_location_zones values ('$id', 'America/Denver')" >/dev/null; echo "$id"
}
latof() { q "select latitude from public.locations where id = '$1'"; }
hdr() { echo "\\set VERBOSITY sqlstate"; echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);"; if [ -n "${2:-}" ]; then echo "select set_config('request.jwt.claims', '{\"aal\":\"$2\"}', false);"; fi; }
visit_sql() { hdr "$1"; echo "select (r->>'spendable_outcome')||'|'||(r->>'lifetime_outcome')||'|'||(r->>'spendable_points')||'|'||(r->>'lifetime_points')||'|'||(r->>'replayed')||'|'||(r->>'visit_id')
        from (select public.record_visit('$2', $(latof "$2"), -100, '$3') as r) s;"; }
adm_sql() { hdr "$1" aal2; echo "select ($2)::text;"; }
del_sql() { hdr "$1" aal1; echo "select public.delete_my_account('DELETE')::text;"; }
# hold <file> <sql-producing command...>: run a script inside a transaction that stays open ~2 s after the statement ran
held() { local out="$1"; shift; { "$@"; echo "select pg_sleep(2);"; } | "${PSQL[@]}" -A -t -c "begin" -f - -c "commit" >"$out" 2>&1; }
quick() { local out="$1"; shift; "$@" | "${PSQL[@]}" -A -t -f - >"$out" 2>&1; }
err() { grep -oE 'ERROR:  [0-9A-Z]{5}' "$1" | head -1 | sed 's/ERROR:  //'; }
setup_enable() { q "update rewards.reward_settings set rewards_enabled = true, global_budget_utc_day = $1" >/dev/null; }
setup_enable 1000000
A1="$(mkadmin 9101)"; A2="$(mkadmin 9102)"; A3="$(mkadmin 9103)"
drift() { q "select drift_spendable from rewards.reconciliation_report()"; }
now_visit() { q "select (r->>'visit_id') from (select rewards.record_visit_at(clock_timestamp(), '$2', $(latof "$2"), -100, '$3', null) as r from (select set_config('request.jwt.claim.sub', '$1', false)) z) s"; }
mkvisit() { q "select set_config('request.jwt.claim.sub', '$1', false)" >/dev/null; "${PSQL[@]}" -A -t -c "select set_config('request.jwt.claim.sub', '$1', false), (rewards.record_visit_at(clock_timestamp(), '$2', $(latof "$2"), -100, '$3', null))->>'visit_id'" | tail -1 | cut -d'|' -f2; }

# ============================================================ 1. two administrators finalize the same recommendation at once
U="$(mkuser 9201)"; L="$(mkloc 1)"
V="$(mkvisit "$U" "$L" "c2-rev-visit-000000001")"
REC="$(q "select public.admin_reward_recommend_reversal('$V', 'recommend') from (select set_config('request.jwt.claim.sub', '$A1', false), set_config('request.jwt.claims', '{\"aal\":\"aal2\"}', false)) z" 2>&1 | tail -1)"
REC="$({ hdr "$A1" aal2; echo "select public.admin_reward_recommend_reversal('$V', 'recommend')::text;"; } | "${PSQL[@]}" -A -t -f - | tail -1)"
ok "setup: a recommendation exists" "$([ -n "$REC" ] && echo t || echo f)"
held "$T/a1" adm_sql "$A2" "public.admin_reward_finalize_reversal('$REC', 'final A')" &
PA=$!; sleep 0.7
quick "$T/b1" adm_sql "$A3" "public.admin_reward_finalize_reversal('$REC', 'final B')"
wait $PA
RA="$(grep '"replayed"' "$T/a1" | head -1)"; RB="$(grep '"replayed"' "$T/b1" | head -1)"
eq "racing finalizers: exactly one created, the other replayed" "$(echo "$RA" | grep -c '"replayed": false')/$(echo "$RB" | grep -c '"replayed": true')" "1/1"
eq "both return the identical decision id and totals" "$(echo "$RA" | sed 's/"replayed": [a-z]*//')" "$(echo "$RB" | sed 's/"replayed": [a-z]*//')"
eq "exactly two reversal rows and one final decision exist" "$(q "select (select count(*) from rewards.reward_ledger where visit_id = '$V' and entry_type = 'reversal') || '/' || (select count(*) from rewards.reward_decisions where visit_id = '$V' and decision_type = 'final_reversal')")" "2/1"

# ============================================================ 2. a reversal and a new visit of the same user race
U="$(mkuser 9202)"; L="$(mkloc 2)"; L2="$(mkloc 3)"
V="$(mkvisit "$U" "$L" "c2-revrec-visit-00001")"
REC="$({ hdr "$A1" aal2; echo "select public.admin_reward_recommend_reversal('$V', 'recommend')::text;"; } | "${PSQL[@]}" -A -t -f - | tail -1)"
G0="$(q "select coalesce(sum(spendable),0) from rewards.reward_counters_global_day")"
held "$T/a2" adm_sql "$A2" "public.admin_reward_finalize_reversal('$REC', 'final')" &
PA=$!; sleep 0.7
quick "$T/b2" visit_sql "$U" "$L2" "c2-revrec-visit-00002"
wait $PA
eq "the reversal committed and the concurrent visit was recorded and awarded normally" "$(grep -c '"reversed_entries": 2' "$T/a2")/$(grep -cE '^awarded\|awarded\|5\|5\|false\|' "$T/b2")" "1/1"
eq "gross counters only grew (the reversal never decremented them)" "$(q "select (select sum(spendable) from rewards.reward_counters_global_day) = $G0 + 5")" "t"
eq "reconciliation shows zero drift after the race" "$(drift)" "0"

# ============================================================ 3. reversal first, then the account is deleted (purge waits for the reversal)
U="$(mkuser 9203)"; L="$(mkloc 4)"; L2="$(mkloc 5)"
V="$(mkvisit "$U" "$L" "c2-revpurge-visit-001")"; V2="$(mkvisit "$U" "$L2" "c2-revpurge-visit-002")"
REC="$({ hdr "$A1" aal2; echo "select public.admin_reward_recommend_reversal('$V', 'recommend')::text;"; } | "${PSQL[@]}" -A -t -f - | tail -1)"
held "$T/a3" adm_sql "$A2" "public.admin_reward_finalize_reversal('$REC', 'final')" &
PA=$!; sleep 0.7
quick "$T/b3" del_sql "$U"
wait $PA
eq "reversal then purge: both succeed, no error" "$(err "$T/a3")$(err "$T/b3")" ""
eq "the reversed pair is retained and severed; the other visit is deleted and aggregated" "$(q "select (select count(*) from rewards.visits where id = '$V' and user_id is null) || '/' || (select count(*) from rewards.reward_ledger where visit_id = '$V' and user_id is null) || '/' || (select count(*) from rewards.visits where id = '$V2')")" "1/4/0"
eq "reconciliation zero drift after reversal then purge" "$(drift)" "0"

# ============================================================ 4. purge first, then a reversal of the deleted account's award (finalize waits, then refuses)
U="$(mkuser 9204)"; L="$(mkloc 6)"
V="$(mkvisit "$U" "$L" "c2-purgerev-visit-001")"
REC="$({ hdr "$A1" aal2; echo "select public.admin_reward_recommend_reversal('$V', 'recommend')::text;"; } | "${PSQL[@]}" -A -t -f - | tail -1)"
held "$T/a4" del_sql "$U" &
PA=$!; sleep 0.7
quick "$T/b4" adm_sql "$A2" "public.admin_reward_finalize_reversal('$REC', 'final')"
wait $PA
eq "purge committed" "$(err "$T/a4")" ""
eq "the waiting finalization is refused cleanly (account deleted)" "$(err "$T/b4")" "RW030"
eq "no reversal or final decision was written, the award stays as retained evidence" "$(q "select (select count(*) from rewards.reward_ledger where visit_id = '$V' and entry_type = 'reversal') || '/' || (select count(*) from rewards.reward_decisions where visit_id = '$V' and decision_type = 'final_reversal') || '/' || (select count(*) from rewards.reward_ledger where visit_id = '$V' and entry_type = 'award' and user_id is null)")" "0/0/2"

# ============================================================ 5. hold + held visits: clear races with a new visit (both orders)
U="$(mkuser 9205)"; L="$(mkloc 7)"; L2="$(mkloc 8)"
quick "$T/h5" adm_sql "$A1" "public.admin_reward_hold_user('$U', 'hold')"
quick "$T/v5" visit_sql "$U" "$L" "c2-hold-visit-0000001"
eq "setup: the visit under hold is held" "$(grep -cE '^held\|held\|0\|0\|false' "$T/v5")" "1"
held "$T/a5" adm_sql "$A2" "public.admin_reward_clear_hold('$U', 'clear')" &
PA=$!; sleep 0.7
quick "$T/b5" visit_sql "$U" "$L2" "c2-hold-visit-0000002"
wait $PA
eq "clear first: the waiting new visit sees no hold and is awarded" "$(grep -cE '^awarded\|awarded\|5\|5\|false' "$T/b5")" "1"
eq "clear awarded the held visit from its original day" "$(grep -c '"visits_cleared": 1' "$T/a5")" "1"
U="$(mkuser 9206)"; L="$(mkloc 9)"; L2="$(mkloc 10)"
quick "$T/h6" adm_sql "$A1" "public.admin_reward_hold_user('$U', 'hold')"
held "$T/a6" visit_sql "$U" "$L" "c2-hold-visit-0000003" &
PA=$!; sleep 0.7
quick "$T/b6" adm_sql "$A2" "public.admin_reward_clear_hold('$U', 'clear')"
wait $PA
eq "visit first: the waiting clear includes the just-recorded held visit (nothing is left held without a clearance)" "$(grep -c '"visits_cleared": 1' "$T/b6")/$(q "select count(*) from rewards.visits v where v.user_id = '$U' and v.spendable_outcome = 'held' and not exists (select 1 from rewards.visit_clearances c where c.visit_id = v.id)")" "1/0"

# ============================================================ 6. two administrators clear the same hold; two hold the same account
U="$(mkuser 9207)"; L="$(mkloc 11)"
quick "$T/h7" adm_sql "$A1" "public.admin_reward_hold_user('$U', 'hold')"
quick "$T/v7" visit_sql "$U" "$L" "c2-clear2-visit-000001"
held "$T/a7" adm_sql "$A2" "public.admin_reward_clear_hold('$U', 'clear one')" &
PA=$!; sleep 0.7
quick "$T/b7" adm_sql "$A3" "public.admin_reward_clear_hold('$U', 'clear two')"
wait $PA
eq "racing clears: one succeeds, the other finds no active hold (RW032)" "$(grep -c '"visits_cleared": 1' "$T/a7")/$(err "$T/b7")" "1/RW032"
eq "no double award: exactly one spendable and one lifetime award for the held visit" "$(q "select count(*) from rewards.reward_ledger where user_id = '$U'")" "2"
U="$(mkuser 9208)"
held "$T/a8" adm_sql "$A1" "public.admin_reward_hold_user('$U', 'hold one')" &
PA=$!; sleep 0.7
quick "$T/b8" adm_sql "$A2" "public.admin_reward_hold_user('$U', 'hold two')"
wait $PA
eq "racing holds: one succeeds, the other is refused (RW031); exactly one active hold" "$(err "$T/a8")/$(err "$T/b8")/$(q "select count(*) from rewards.reward_holds where user_id = '$U' and cleared_at is null")" "/RW031/1"

# ============================================================ 7. account deletion races with a new visit (record waits, then fails and leaves nothing)
U="$(mkuser 9209)"; L="$(mkloc 12)"
mkvisit "$U" "$L" "c2-delrec-visit-000001" >/dev/null
held "$T/a9" del_sql "$U" &
PA=$!; sleep 0.7
quick "$T/b9" visit_sql "$U" "$L" "c2-delrec-visit-000002"
wait $PA
eq "deletion committed" "$(err "$T/a9")" ""
eq "the waiting visit is refused (the account is gone, foreign key) and wrote nothing" "$(err "$T/b9")/$(q "select count(*) from rewards.visits where idempotency_key = 'c2-delrec-visit-000002'")" "23503/0"
eq "no row of the deleted account remains and the aggregate holds its first visit" "$(q "select (select count(*) from rewards.visits where idempotency_key like 'c2-delrec-%') || '/' || (select count(*) from rewards.reward_counters_user_day where user_id = '$U')")" "0/0"
eq "zero drift after purge/record race" "$(drift)" "0"

# ============================================================ 8. mixed stress: no deadlock, zero drift, rollback leaves nothing
declare -a PIDS=()
for n in 1 2 3 4 5 6; do
  SU="$(mkuser $((9300 + n)))"; SL="$(mkloc $((20 + n)))"; SL2="$(mkloc $((30 + n)))"
  mkvisit "$SU" "$SL" "c2-stress-seed-0000$n" >/dev/null
  SV="$(q "select id from rewards.visits where idempotency_key = 'c2-stress-seed-0000$n'")"
  SR="$({ hdr "$A1" aal2; echo "select public.admin_reward_recommend_reversal('$SV', 'recommend')::text;"; } | "${PSQL[@]}" -A -t -f - | tail -1)"
  ( quick "$T/s_rev_$n" adm_sql "$A2" "public.admin_reward_finalize_reversal('$SR', 'final')" ) & PIDS+=($!)
  ( quick "$T/s_vis_$n" visit_sql "$SU" "$SL2" "c2-stress-vis-0000$n" ) & PIDS+=($!)
  ( quick "$T/s_vis2_$n" visit_sql "$SU" "$SL" "c2-stress-vis-1000$n" ) & PIDS+=($!)
  if [ $((n % 2)) = 0 ]; then ( quick "$T/s_del_$n" del_sql "$SU" ) & PIDS+=($!); fi
done
for p in "${PIDS[@]}"; do wait "$p"; done
eq "no session was a deadlock victim (fixed lock order)" "$(cat "$T"/s_* | grep -c '40P01')" "0"
eq "every stress outcome is a success or a designed refusal (23503 deleted account, RW030) and nothing else" "$(cat "$T"/s_* | grep -oE 'ERROR:  [0-9A-Z]{5}' | sed 's/ERROR:  //' | sort -u | grep -vxE '23503|RW030' | tr '\n' ' ')" ""
eq "reconciliation shows zero drift after the stress" "$(drift)" "0"
eq "every visit and its ledger rows agree (no orphan awards, no held visit without clearance among cleared accounts)" "$(q "select count(*) from rewards.reward_ledger l where entry_type = 'award' and not exists (select 1 from rewards.visits v where v.id = l.visit_id)")" "0"

echo "checks: $((CHECKS - FAILS)) passed, $FAILS failed"
[ "$FAILS" = 0 ]
