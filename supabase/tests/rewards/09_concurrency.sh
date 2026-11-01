#!/usr/bin/env bash
# P1 test 4 and the real-Postgres part of section 6: two-session (and many-session) scenarios through the PUBLIC record_visit as
# the `authenticated` role, against the throwaway cluster started by scripts/test-db-rewards.sh.
# Usage: 09_concurrency.sh <psql command...>   (the harness appends the database name)
set -uo pipefail
PSQL=("$@")
T="$(mktemp -d /tmp/rwc.XXXXXX)"; chmod 777 "$T"
trap 'rm -rf "$T"' EXIT
FAILS=0; CHECKS=0
q() { "${PSQL[@]}" -A -t -c "$1"; }
ok() { CHECKS=$((CHECKS+1)); if [ "$2" = "t" ] || [ "$2" = "true" ]; then echo "ok - $1"; else echo "not ok - $1 (got '$2')"; FAILS=$((FAILS+1)); fi; }
eq() { CHECKS=$((CHECKS+1)); if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }

# Day boundaries make counters ambiguous mid-test: wait out a UTC or Denver midnight if one is near.
secs="$(q "select least(extract(epoch from (date_trunc('day', now() at time zone 'UTC') + interval '1 day') - (now() at time zone 'UTC')),
                      extract(epoch from ((date_trunc('day', now() at time zone 'America/Denver') + interval '1 day') at time zone 'America/Denver') - now()))::int")"
if [ "$secs" -lt 120 ]; then echo "(waiting $((secs+3)) s for a day boundary to pass)"; sleep $((secs+3)); fi
TODAY="$(q "select (now() at time zone 'UTC')::date")"

mkuser() { q "insert into auth.users (id, email) values ('00000000-0000-0000-0000-$(printf '%012d' "$1")', 'cc$1@test.invalid') on conflict do nothing" >/dev/null; echo "00000000-0000-0000-0000-$(printf '%012d' "$1")"; }
LATBASE=20
mkloc() { # mkloc <n> -> prints id (latitude LATBASE + n/100), verified, explicit evidence, Denver zone
  local id; id="$(q "insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
    values ('CC loc $1', $LATBASE + $1 / 100.0, -100, 'verified', 'explicit', true, now()) returning id")"
  q "insert into rewards.reward_location_zones values ('$id', 'America/Denver')" >/dev/null; echo "$id"
}
latof() { q "select latitude from public.locations where id = '$1'"; }
# visit_sql <user> <location> <key>: one record_visit as an authenticated client; prints 'spend|life|sp|lp|replayed|visit_id'
visit_sql() {
  echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);
        select (r->>'spendable_outcome')||'|'||(r->>'lifetime_outcome')||'|'||(r->>'spendable_points')||'|'||(r->>'lifetime_points')||'|'||(r->>'replayed')||'|'||(r->>'visit_id')
        from (select public.record_visit('$2', $(latof "$2"), -100, '$3') as r) s;"
}
setup_enable() { q "update rewards.reward_settings set rewards_enabled = true, global_budget_utc_day = $1" >/dev/null; }
gcount() { q "select coalesce((select spendable from rewards.reward_counters_global_day where issuance_day_utc = '$TODAY'), 0)"; }
ucount() { q "select coalesce((select spendable from rewards.reward_counters_user_day where user_id = '$1' and issuance_day_utc = '$TODAY'), 0)"; }
nledger() { q "select count(*) from rewards.reward_ledger where user_id = '$1' and kind = '$2'"; }

# ============================================================ 1. one idempotency key from two sessions
U="$(mkuser 9001)"; L="$(mkloc 1)"; setup_enable 1000000
{ { visit_sql "$U" "$L" "conc-idem-key-0000001"; echo "select pg_sleep(2);"; } | "${PSQL[@]}" -A -t -c "begin" -f - -c "commit" >"$T/a1" 2>&1; } &
PA=$!
sleep 0.7
visit_sql "$U" "$L" "conc-idem-key-0000001" | "${PSQL[@]}" -A -t -f - >"$T/b1" 2>&1
wait $PA
A="$(grep -E '^(awarded|user_day|location|budget|rewards)' "$T/a1" | head -1)"; B="$(grep -E '^(awarded|user_day|location|budget|rewards)' "$T/b1" | head -1)"
eq "same key from two sessions: both end with the same visit id" "$(echo "$A" | cut -d'|' -f6)" "$(echo "$B" | cut -d'|' -f6)"
eq "the first session recorded it, the second replayed it" "$(echo "$A" | cut -d'|' -f5)/$(echo "$B" | cut -d'|' -f5)" "false/true"
eq "one visit and one award set (1 spendable, 1 lifetime)" "$(q "select (select count(*) from rewards.visits where user_id = '$U') || '/' || (select count(*) from rewards.reward_ledger where user_id = '$U')")" "1/2"
eq "the user counter holds exactly one award" "$(ucount "$U")" "5"

# ============================================================ 2. two sessions race for the 4th slot at one location
U="$(mkuser 9002)"; L="$(mkloc 2)"
for i in 1 2 3; do visit_sql "$U" "$L" "conc-slot-key-00000$i" | "${PSQL[@]}" -A -t -f - >/dev/null; done
{ { visit_sql "$U" "$L" "conc-slot-key-000004"; echo "select pg_sleep(2);"; } | "${PSQL[@]}" -A -t -c "begin" -f - -c "commit" >"$T/a2" 2>&1; } &
PA=$!
sleep 0.7
visit_sql "$U" "$L" "conc-slot-key-000005" | "${PSQL[@]}" -A -t -f - >"$T/b2" 2>&1
wait $PA
A2="$(grep -E '^(awarded|user_day|location|budget)' "$T/a2" | head -1 | cut -d'|' -f1-4)"; B2="$(grep -E '^(awarded|user_day|location|budget)' "$T/b2" | head -1 | cut -d'|' -f1-4)"
eq "racing for the 4th slot: the first accepted takes it, the second is the 5th (location_cap)" "$A2 / $B2" "awarded|not_first_daily|5|0 / location_cap|not_first_daily|0|0"
eq "exactly 4 spendable awards exist (20 points) and ordinals 4 and 5 are distinct" "$(q "select (select count(*) from rewards.reward_ledger where user_id = '$U' and kind = 'spendable') || '/' || (select string_agg(ordinal::text, ',' order by ordinal) from rewards.visits where user_id = '$U')")" "4/1,2,3,4,5"

# ============================================================ 3. two sessions race for the last point of the 60 cap (same location)
U="$(mkuser 9003)"; L="$(mkloc 3)"
q "insert into rewards.reward_counters_user_day values ('$U', '$TODAY', 55)" >/dev/null
{ { visit_sql "$U" "$L" "conc-cap60-key-00001"; echo "select pg_sleep(2);"; } | "${PSQL[@]}" -A -t -c "begin" -f - -c "commit" >"$T/a3" 2>&1; } &
PA=$!
sleep 0.7
visit_sql "$U" "$L" "conc-cap60-key-00002" | "${PSQL[@]}" -A -t -f - >"$T/b3" 2>&1
wait $PA
A3="$(grep -E '^(awarded|user_day|location|budget)' "$T/a3" | head -1 | cut -d'|' -f1-4)"; B3="$(grep -E '^(awarded|user_day|location|budget)' "$T/b3" | head -1 | cut -d'|' -f1-4)"
eq "racing for the 60th point: one session gets it, the other user_day_cap" "$A3 / $B3" "awarded|awarded|5|5 / user_day_cap|not_first_daily|0|0"
eq "the user counter is exactly 60, never more" "$(ucount "$U")" "60"
eq "exactly one spendable and one lifetime award" "$(nledger "$U" spendable)/$(nledger "$U" lifetime)" "1/1"

# ============================================================ 4. user-cap race across two locations: both get lifetime
U="$(mkuser 9004)"; LX="$(mkloc 4)"; LY="$(mkloc 5)"
q "insert into rewards.reward_counters_user_day values ('$U', '$TODAY', 55)" >/dev/null
{ { visit_sql "$U" "$LX" "conc-twoloc-key-0001"; echo "select pg_sleep(2);"; } | "${PSQL[@]}" -A -t -c "begin" -f - -c "commit" >"$T/a4" 2>&1; } &
PA=$!
sleep 0.7
visit_sql "$U" "$LY" "conc-twoloc-key-0002" | "${PSQL[@]}" -A -t -f - >"$T/b4" 2>&1
wait $PA
A4="$(grep -E '^(awarded|user_day|location|budget)' "$T/a4" | head -1 | cut -d'|' -f1-4)"; B4="$(grep -E '^(awarded|user_day|location|budget)' "$T/b4" | head -1 | cut -d'|' -f1-4)"
eq "user at 55/60, first visits at two locations: one spendable, BOTH lifetime" "$A4 / $B4" "awarded|awarded|5|5 / user_day_cap|awarded|0|5"
eq "counter exactly 60; one spendable and two lifetime ledger rows" "$(ucount "$U")/$(nledger "$U" spendable)/$(nledger "$U" lifetime)" "60/1/2"

# ============================================================ 5. global budget: the LAST unit contended by two users (forced S failure on a first visit)
UA="$(mkuser 9005)"; UB="$(mkuser 9006)"; LA="$(mkloc 6)"; LB="$(mkloc 7)"
G0="$(gcount)"; setup_enable $((G0 + 5))
{ { visit_sql "$UA" "$LA" "conc-budget-key-0001"; echo "select pg_sleep(2);"; } | "${PSQL[@]}" -A -t -c "begin" -f - -c "commit" >"$T/a5" 2>&1; } &
PA=$!
sleep 0.7
S0="$(q "select extract(epoch from clock_timestamp())")"
visit_sql "$UB" "$LB" "conc-budget-key-0002" | "${PSQL[@]}" -A -t -f - >"$T/b5" 2>&1
S1="$(q "select extract(epoch from clock_timestamp())")"
wait $PA
A5="$(grep -E '^(awarded|user_day|location|budget)' "$T/a5" | head -1 | cut -d'|' -f1-4)"; B5="$(grep -E '^(awarded|user_day|location|budget)' "$T/b5" | head -1 | cut -d'|' -f1-4)"
eq "last budget unit: the first session wins" "$A5" "awarded|awarded|5|5"
eq "the second session's FIRST visit: spendable budget_exhausted, lifetime still awarded" "$B5" "budget_exhausted|awarded|0|5"
ok "the second session really waited for the first (blocked on the global counter row)" "$(awk -v a="$S0" -v b="$S1" 'BEGIN { print ((b - a) > 0.9) ? "t" : "f" }')"
eq "the loser has exactly one lifetime ledger row, no spendable row and NO user-counter row" "$(nledger "$UB" lifetime)/$(nledger "$UB" spendable)/$(q "select count(*) from rewards.reward_counters_user_day where user_id = '$UB'")" "1/0/0"
eq "the global counter rose by exactly the one winning award and never exceeded the budget" "$(( $(gcount) - G0 ))" "5"

# ============================================================ 6. 20 users contend for 10 budget units at the same instant
G0="$(gcount)"; setup_enable $((G0 + 50))
LB6="$(mkloc 8)"
q "select pg_advisory_lock(777), pg_sleep(1.5), pg_advisory_unlock(777)" >/dev/null &   # barrier holder
sleep 0.4
PIDS=()
for i in $(seq 1 20); do
  U="$(mkuser $((9100 + i)))"
  { echo "select pg_advisory_lock_shared(777); select pg_advisory_unlock_shared(777);"; visit_sql "$U" "$LB6" "conc-many-key-$(printf '%07d' "$i")"; } | "${PSQL[@]}" -A -t -f - >"$T/m$i" 2>&1 &
  PIDS+=($!)
done
for p in "${PIDS[@]}"; do wait "$p" || true; done
wait
ALL="$(cat "$T"/m* | grep -E '^(awarded|user_day|location|budget)' | cut -d'|' -f1-2 | sort | uniq -c | tr -s ' ' | tr '\n' ';')"
eq "20 simultaneous first visits, 10 budget units: 10 awarded, 10 budget_exhausted, all 20 get lifetime" "$ALL" " 10 awarded|awarded; 10 budget_exhausted|awarded;"
eq "the global counter rose by exactly the budget (50), no overshoot" "$(( $(gcount) - G0 ))" "50"
eq "20 lifetime and 10 spendable ledger rows exist for these users" "$(q "select count(*) filter (where kind='lifetime') || '/' || count(*) filter (where kind='spendable') from rewards.reward_ledger where location_id = '$LB6'")" "20/10"
eq "no session failed (no deadlock, no serialization error)" "$(cat "$T"/m* | grep -ci 'error\|deadlock')" "0"

# ============================================================ 7. lock order: many multi-visit transactions in mixed orders, no deadlock
G0="$(gcount)"; setup_enable 100000000
LS=(); for n in 11 12 13 14; do LS+=("$(mkloc $n)"); done
q "select pg_advisory_lock(778), pg_sleep(1.5), pg_advisory_unlock(778)" >/dev/null &
sleep 0.4
PIDS=()
for i in $(seq 1 24); do
  U="$(mkuser $((9200 + i % 8)))"
  X="${LS[$((i % 4))]}"; Y="${LS[$(( (i * 3 + 1) % 4 ))]}"
  { echo "select pg_advisory_lock_shared(778); select pg_advisory_unlock_shared(778);"; echo "begin;"; visit_sql "$U" "$X" "conc-order-key-$(printf '%03d' "$i")a"; visit_sql "$U" "$Y" "conc-order-key-$(printf '%03d' "$i")b"; echo "commit;"; } | "${PSQL[@]}" -A -t -f - >"$T/o$i" 2>&1 &
  PIDS+=($!)
done
for p in "${PIDS[@]}"; do wait "$p" || true; done
wait
eq "24 concurrent two-visit transactions in mixed location orders: no error, no deadlock (40P01)" "$(cat "$T"/o* | grep -ci 'error\|deadlock')" "0"
eq "every one of the 48 visits was recorded" "$(q "select count(*) from rewards.visits where idempotency_key like 'conc-order-key-%'")" "48"
eq "counters equal issued awards (the storm's user-days, and the global day) after the storm" "$(q "select (select count(*) from (select c.user_id from rewards.reward_counters_user_day c left join (select l.user_id, v.issuance_day_utc, sum(l.amount) s from rewards.reward_ledger l join rewards.visits v on v.id = l.visit_id where l.kind='spendable' group by 1,2) a on a.user_id = c.user_id and a.issuance_day_utc = c.issuance_day_utc where c.user_id::text like '00000000-0000-0000-0000-0000000092%' and c.spendable is distinct from a.s::int) x) || '/' || (select count(*) from (select 1 from rewards.reward_counters_global_day c left join (select v.issuance_day_utc, sum(l.amount) s from rewards.reward_ledger l join rewards.visits v on v.id = l.visit_id where l.kind='spendable' group by 1) a on a.issuance_day_utc = c.issuance_day_utc where c.spendable is distinct from a.s::int) y)")" "0/0"
eq "no user exceeded the 60 cap and no location-day more than 4 spendable awards" "$(q "select (select count(*) from rewards.reward_counters_user_day where spendable > 60) || '/' || (select count(*) from (select 1 from rewards.reward_ledger where kind='spendable' group by user_id, location_id, policy_day_local having count(*) > 4) z)")" "0/0"

# ============================================================ 8. REAL lock timeout, statement timeout and cancellation (section 6 hypothesis)
setup_enable 100000000
"${PSQL[@]}" -q -c "select pg_advisory_lock(12345); select pg_sleep(3.5); select pg_advisory_unlock(12345);" >/dev/null 2>&1 &
PA=$!
sleep 0.8
out="$("${PSQL[@]}" -A -t -c "set lock_timeout = '300ms'; do \$\$ begin begin perform pg_advisory_lock(12345); exception when lock_not_available then raise notice 'caught-55P03'; end; end \$\$;" 2>&1)"
ok "a REAL lock timeout (55P03) is caught inside the block by a lock_not_available handler" "$(echo "$out" | grep -q 'caught-55P03' && echo t || echo f)"
out="$("${PSQL[@]}" -A -t -c "set statement_timeout = '300ms'; do \$\$ begin begin perform pg_advisory_lock(12345); exception when lock_not_available then raise notice 'wrongly-caught'; end; end \$\$;" 2>&1 || true)"
ok "a REAL statement timeout (57014) is NOT caught by that handler: it propagates" "$(echo "$out" | grep -q 'statement timeout' && ! echo "$out" | grep -q 'wrongly-caught' && echo t || echo f)"
wait $PA 2>/dev/null || true
# cancellation by another session
"${PSQL[@]}" -A -t -c "set application_name = 'rw_cancel_target'; do \$\$ begin begin perform pg_sleep(6); exception when lock_not_available then raise notice 'wrongly-caught'; end; end \$\$;" >"$T/cancel" 2>&1 &
PA=$!
sleep 0.8
q "select count(pg_cancel_backend(pid)) from pg_stat_activity where application_name = 'rw_cancel_target'" >/dev/null
wait $PA 2>/dev/null || true
ok "a REAL pg_cancel_backend cancellation (57014) propagates through the handler" "$(grep -q 'canceling statement due to user request' "$T/cancel" && ! grep -q 'wrongly-caught' "$T/cancel" && echo t || echo f)"
# the same two faults inside record_visit: whole visit aborts, nothing is left behind
for mode in "statement_timeout = '600ms'|statement timeout" "lock_timeout = '600ms'|lock timeout"; do
  setting="${mode%%|*}"; label="${mode##*|}"
  G0="$(gcount)"; setup_enable $((G0 + 1000))
  UA="$(mkuser $((9300 + RANDOM % 50)))"; UB="$(mkuser $((9400 + RANDOM % 50)))"; LA="$(mkloc $((20 + RANDOM % 60)))"; LB="$(mkloc $((100 + RANDOM % 80)))"
  { { visit_sql "$UA" "$LA" "conc-fault-a-$RANDOM$RANDOM"; echo "select pg_sleep(2.5);"; } | "${PSQL[@]}" -A -t -c "begin" -f - -c "commit" >"$T/fa" 2>&1; } &
  PA=$!
  sleep 0.7
  { echo "set $setting;"; visit_sql "$UB" "$LB" "conc-fault-b-key-$RANDOM$RANDOM"; } | "${PSQL[@]}" -A -t -f - >"$T/fb" 2>&1 || true
  wait $PA
  eq "a REAL $label while waiting on the global counter aborts the whole visit (no visit, no ledger row, no counter)" \
     "$(q "select (select count(*) from rewards.visits where user_id = '$UB') || '/' || (select count(*) from rewards.reward_ledger where user_id = '$UB') || '/' || (select count(*) from rewards.reward_counters_user_day where user_id = '$UB')")" "0/0/0"
  ok "the error surfaced to the caller (not swallowed by the spendable block)" "$(grep -qi 'timeout' "$T/fb" && echo t || echo f)"
done

echo "checks: $((CHECKS - FAILS)) passed, $FAILS failed"
if [ "$FAILS" != 0 ]; then for f in "$T"/a1 "$T"/b1 "$T"/a2 "$T"/b2 "$T"/a5 "$T"/b5 "$T"/m1 "$T"/o1; do echo "--- captured session output: $(basename "$f")"; head -12 "$f" 2>/dev/null; done; fi
[ "$FAILS" = 0 ]
