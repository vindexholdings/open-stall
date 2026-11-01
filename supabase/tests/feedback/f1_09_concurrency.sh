#!/usr/bin/env bash
# F1 real concurrent sessions on a disposable cluster: retries, bursts against the limit, competing links, competing decisions, competing approvals.
# A start gate (a held advisory lock) releases all sessions at once so they genuinely race.
# Usage: f1_09_concurrency.sh <psql command...>   (the harness appends the database name)
set -uo pipefail
PSQL=("$@")
T="$(mktemp -d /tmp/fbc9.XXXXXX)"; chmod 777 "$T"
trap 'rm -rf "$T"' EXIT
FAILS=0
q() { "${PSQL[@]}" -A -t -c "$1"; }
ok() { if [ "$2" = "t" ] || [ "$2" = "true" ]; then echo "ok - $1"; else echo "not ok - $1 (got '$2')"; FAILS=$((FAILS+1)); fi; }
eq() { if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }
uid() { echo "00000000-0000-0000-0000-$(printf '%012d' "$1")"; }
mkuser() { q "insert into auth.users (id, email) values ('$(uid "$1")', 'fc$1@test.invalid') on conflict do nothing" >/dev/null; uid "$1"; }
mkadmin() { local u; u="$(mkuser "$1")"; q "insert into public.admin_users (user_id) values ('$u') on conflict do nothing" >/dev/null; echo "$u"; }
err() { grep -oE 'ERROR:  [0-9A-Z]{5}' "$1" | head -1 | sed 's/ERROR:  //'; }
# a session script: the gate, then the caller identity, then the statement
sess() { # <sub> <aal> <sql>
  echo "\\set VERBOSITY sqlstate"
  echo "select pg_advisory_lock_shared(8771); select pg_advisory_unlock_shared(8771);"
  echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false); select set_config('request.jwt.claims', '{\"aal\":\"$2\"}', false);"
  echo "$3"
}
race() { # <outfile-prefix> then pairs: sub|aal|sql ... ; starts all sessions blocked on the gate, then releases them together
  local pfx="$1"; shift
  "${PSQL[@]}" -A -t -c "select pg_advisory_lock(8771)" -c "select pg_sleep(1.5)" -c "select pg_advisory_unlock(8771)" >"$T/gate" 2>&1 &
  local gp=$!; sleep 0.4
  local i=0 pids=() spec
  for spec in "$@"; do
    i=$((i+1)); IFS='|' read -r sub aal sql <<<"$spec"
    sess "$sub" "$aal" "$sql" | "${PSQL[@]}" -A -t -f - >"$T/$pfx$i" 2>&1 &
    pids+=($!)
  done
  wait "${pids[@]}" "$gp" 2>/dev/null
}
SUBMIT="select public.submit_feedback('%s', 'bug', 'map', '%s', '%s')::text;"
sub() { printf "$SUBMIT" "$1" "$2" "$3"; }

U1="$(mkuser 1)"; A1="$(mkadmin 71)"; A2="$(mkadmin 72)"; A3="$(mkadmin 73)"

# 1. the same retry key sent twice at the same instant: exactly one row, both calls succeed with the same id
race r1_ "$U1|aal1|$(sub fb-race-key-0000001 'Racing retry title' 'Racing retry description text')" "$U1|aal1|$(sub fb-race-key-0000001 'Racing retry title' 'Racing retry description text')"
eq "1: two simultaneous identical retries store exactly one item" "$(q "select count(*) from feedback.items where user_id = '$U1' and idempotency_key = 'fb-race-key-0000001'")" "1"
ID1="$(grep -o '"id": "[0-9a-f-]*"' "$T/r1_1" | head -1)"; ID2="$(grep -o '"id": "[0-9a-f-]*"' "$T/r1_2" | head -1)"
eq "1: both calls return the same item id" "$ID1" "$ID2"

# 2. a burst of 8 different submissions from one account: the hourly limit (5) holds
U2="$(mkuser 2)"
specs=(); for n in 1 2 3 4 5 6 7 8; do specs+=("$U2|aal1|$(sub "fb-burst-key-00000$n" "Burst title number $n" "Burst description for number $n here")"); done
race r2_ "${specs[@]}"
eq "2: a burst of 8 stored exactly 5 (the hourly limit holds under concurrency)" "$(q "select count(*) from feedback.items where user_id = '$U2'")" "5"
refused=0; for n in 1 2 3 4 5 6 7 8; do [ "$(err "$T/r2_$n")" = "53400" ] && refused=$((refused+1)); done
eq "2: the other 3 were refused with 53400" "$refused" "3"

# 3. two administrators link the SAME item to two DIFFERENT issues at once: exactly one canonical link wins
U3="$(mkuser 3)"
mk() { "${PSQL[@]}" -A -t -c "set role authenticated; select set_config('request.jwt.claim.sub','$1',false); select ((public.submit_feedback('$2','bug','map','$3','$4')::jsonb)->>'id')" 2>/dev/null | tail -1; }
ITEM="$(mk "$U3" fb-link-key-0000001 'Item to be linked twice' 'This item will be linked by two administrators at once.')"
adm() { "${PSQL[@]}" -A -t -c "set role authenticated; select set_config('request.jwt.claim.sub','$1',false); select set_config('request.jwt.claims','{\"aal\":\"aal2\"}',false); select $2" 2>/dev/null | tail -1; }
O1="$(mk "$U1" fb-link-key-0000002 'Origin one for the race' 'First origin item for the linking race here.')"
U4="$(mkuser 4)"
O2="$(mk "$U4" fb-link-key-0000009 'Origin two for the race' 'Second origin item for the linking race here.')"
IS1="$(adm "$A1" "((public.admin_feedback_create_issue('$O1', 'Issue one for the race', 'The first canonical issue for the race test.'))->>'issue_id')")"
IS2="$(adm "$A1" "((public.admin_feedback_create_issue('$O2', 'Issue two for the race', 'The second canonical issue for the race test.'))->>'issue_id')")"
race r3_ "$A2|aal2|select public.admin_feedback_link_duplicate('$ITEM', '$IS1')::text;" "$A3|aal2|select public.admin_feedback_link_duplicate('$ITEM', '$IS2')::text;"
eq "3: two competing links leave exactly ONE canonical link for the item" "$(q "select count(*) from feedback.item_links where item_id = '$ITEM'")" "1"
e1="$(err "$T/r3_1")"; e2="$(err "$T/r3_2")"
ok "3: both issues exist before the race" "$( [ -n "$IS1" ] && [ -n "$IS2" ] && [ "$IS1" != "$IS2" ] && echo t || echo "IS1=$IS1 IS2=$IS2")"
ok "3: exactly one of the two competing links was refused with 23505" "$( { [ "$e1" = "23505" ] && [ -z "$e2" ]; } || { [ "$e2" = "23505" ] && [ -z "$e1" ]; } && echo t || echo "e1=$e1 e2=$e2")"
eq "3: the item has exactly one duplicate history row" "$(q "select count(*) from feedback.status_history where item_id = '$ITEM' and to_status = 'duplicate'")" "1"

# 4. two administrators set the same received item to reviewing at once: exactly one decision is recorded
ITEM4="$(mk "$U3" fb-stat-key-0000001 'Item decided twice' 'This item will be set to reviewing by two administrators at once.')"
race r4_ "$A2|aal2|select public.admin_feedback_set_status('$ITEM4', 'reviewing')::text;" "$A3|aal2|select public.admin_feedback_set_status('$ITEM4', 'reviewing')::text;"
eq "4: two simultaneous decisions record exactly one reviewing step" "$(q "select count(*) from feedback.status_history where item_id = '$ITEM4' and to_status = 'reviewing'")" "1"
e1="$(err "$T/r4_1")"; e2="$(err "$T/r4_2")"
ok "4: the loser was refused with 22023 (stale view), not silently applied twice" "$( { [ "$e1" = "22023" ] && [ -z "$e2" ]; } || { [ "$e2" = "22023" ] && [ -z "$e1" ]; } && echo t || echo "e1=$e1 e2=$e2")"

# 5. two different administrators approve the same draft version at once: exactly one approval
adm "$A1" "((public.admin_feedback_draft_save('$IS1', 'Draft for the race', 'bug', 'The problem statement for the approval race test.'))->>'hash')" >/dev/null
H="$(q "select body_hash from feedback.drafts where issue_id = '$IS1' and version = 1")"
race r5_ "$A2|aal2|select public.admin_feedback_draft_approve('$IS1', 1, '$H')::text;" "$A3|aal2|select public.admin_feedback_draft_approve('$IS1', 1, '$H')::text;"
eq "5: two simultaneous approvals leave one approval" "$(q "select count(*) from feedback.drafts where issue_id = '$IS1' and approved_hash is not null")" "1"
e1="$(err "$T/r5_1")"; e2="$(err "$T/r5_2")"
ok "5: the loser was refused with 55000 (already approved)" "$( { [ "$e1" = "55000" ] && [ -z "$e2" ]; } || { [ "$e2" = "55000" ] && [ -z "$e1" ]; } && echo t || echo "e1=$e1 e2=$e2")"

echo "f1_09: $FAILS failed"
[ "$FAILS" -eq 0 ]
