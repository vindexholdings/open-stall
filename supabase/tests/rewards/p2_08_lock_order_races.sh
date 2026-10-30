#!/usr/bin/env bash
# P2 shared-key lock-order regressions (Work review 59c4f36), forced with deterministic delay barriers on real sessions:
#  (1) two accounts clear held visits whose UTC issuance days cross in opposite order (global counter rows are shared keys);
#  (2) two accounts purge with opposing aggregate-month sets, including recorded-only and award-only months, an existing month row and an
#      absent one, plus rollback/retry and exact disjoint deleted totals with zero drift.
# A test-only delay trigger (created here, as the migration owner, in this disposable clone only) sleeps after each clearance row / each
# ledger DELETE statement so the interleaving is not left to chance. Without the up-front ordered locks both scenarios hit 40P01.
# Usage: p2_08_lock_order_races.sh <psql command...>   (the harness appends the database name)
set -uo pipefail
PSQL=("$@")
T="$(mktemp -d /tmp/rwc2.XXXXXX)"; chmod 777 "$T"
trap 'rm -rf "$T"' EXIT
FAILS=0; CHECKS=0
q() { "${PSQL[@]}" -A -t -c "$1"; }
ok() { CHECKS=$((CHECKS+1)); if [ "$2" = "t" ] || [ "$2" = "true" ]; then echo "ok - $1"; else echo "not ok - $1 (got '$2')"; FAILS=$((FAILS+1)); fi; }
eq() { CHECKS=$((CHECKS+1)); if [ "$2" = "$3" ]; then echo "ok - $1"; else echo "not ok - $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }

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

mkvisit_at() { "${PSQL[@]}" -A -t -c "select set_config('request.jwt.claim.sub', '$1', false), (rewards.record_visit_at('$4'::timestamptz, '$2', $(latof "$2"), -100, '$3', null))->>'visit_id'" | tail -1 | cut -d'|' -f2; }
mkloc_nozone() { q "insert into public.locations (name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at) values ('C3 nozone $1', $LATBASE + $1 / 100.0, -100, 'verified', 'explicit', true, now()) returning id"; }
setup_enable 1000000
q "create function public.zz_delay() returns trigger language plpgsql as \$\$ begin perform pg_sleep(2); return null; end \$\$" >/dev/null
A1="$(mkadmin 9501)"; A2="$(mkadmin 9502)"; A3="$(mkadmin 9503)"
drift() { q "select drift_spendable from rewards.reconciliation_report()"; }

# ============================================================ 1. opposing-day clearances (shared global counter rows)
U1="$(mkuser 9511)"; U2="$(mkuser 9512)"
LX="$(mkloc 1)"; LY="$(mkloc 2)"
read LA LB <<< "$(q "select string_agg(id::text, ' ' order by id) from public.locations where id in ('$LX','$LY')" | tr '|' ' ')"
quick "$T/h1" adm_sql "$A1" "public.admin_reward_hold_user('$U1', 'hold one')"
quick "$T/h2" adm_sql "$A1" "public.admin_reward_hold_user('$U2', 'hold two')"
# U1: LA on day 1 then LB on day 2; U2: LA on day 2 then LB on day 1 (location order is the clearance's per-account order)
mkvisit_at "$U1" "$LA" "c3-clear-u1-a-0000001" "2026-09-01 15:00:00+00" >/dev/null
mkvisit_at "$U1" "$LB" "c3-clear-u1-b-0000001" "2026-09-02 15:00:00+00" >/dev/null
mkvisit_at "$U2" "$LA" "c3-clear-u2-a-0000001" "2026-09-02 15:00:00+00" >/dev/null
mkvisit_at "$U2" "$LB" "c3-clear-u2-b-0000001" "2026-09-01 15:00:00+00" >/dev/null
eq "setup: four held visits across two UTC days" "$(q "select count(*) from rewards.visits where user_id in ('$U1','$U2') and spendable_outcome = 'held'")" "4"
G0="$(q "select coalesce(sum(spendable), 0) from rewards.reward_counters_global_day")"
q "create trigger zz_clear_delay after insert on rewards.visit_clearances for each row execute function public.zz_delay()" >/dev/null
quick "$T/c1" adm_sql "$A2" "public.admin_reward_clear_hold('$U1', 'clear one')" &
PA=$!; sleep 0.6
quick "$T/c2" adm_sql "$A3" "public.admin_reward_clear_hold('$U2', 'clear two')" &
PB=$!
wait $PA; wait $PB
eq "opposing-day clearances: both commit, no deadlock victim" "$(cat "$T/c1" "$T/c2" | grep -c '40P01')/$(grep -c '"visits_cleared": 2' "$T/c1")/$(grep -c '"visits_cleared": 2' "$T/c2")" "0/1/1"
eq "no duplicate awards: exactly 2 spendable + 2 lifetime per account" "$(q "select (select count(*) from rewards.reward_ledger where user_id = '$U1') || '/' || (select count(*) from rewards.reward_ledger where user_id = '$U2')")" "4/4"
eq "global gross counter grew by exactly 20 (4 spendable awards) with no cap overflow" "$(q "select sum(spendable) - $G0 from rewards.reward_counters_global_day")" "20"
eq "zero reconciliation drift after the opposing clearances" "$(drift)" "0"
q "drop trigger zz_clear_delay on rewards.visit_clearances" >/dev/null

# ============================================================ 2. opposing-month purges (shared anonymous aggregate rows)
NZ="$(mkloc_nozone 3)"; Z1="$(mkloc 4)"; Z2="$(mkloc 5)"; Z3="$(mkloc 6)"; Z4="$(mkloc 7)"
PC="$(mkuser 9521)"; PD="$(mkuser 9522)"; PA="$(mkuser 9523)"; PB="$(mkuser 9524)"
mkvisit_at "$PC" "$Z3" "c3-purge-pc-000000001" "2026-09-05 15:00:00+00" >/dev/null
mkvisit_at "$PD" "$Z4" "c3-purge-pd-000000001" "2026-09-06 15:00:00+00" >/dev/null
mkvisit_at "$PA" "$Z1" "c3-purge-pa-000000001" "2026-09-10 15:00:00+00" >/dev/null
mkvisit_at "$PA" "$NZ" "c3-purge-pa-000000002" "2026-10-10 15:00:00+00" >/dev/null
mkvisit_at "$PB" "$Z2" "c3-purge-pb-000000001" "2026-10-11 15:00:00+00" >/dev/null
mkvisit_at "$PB" "$NZ" "c3-purge-pb-000000002" "2026-09-11 15:00:00+00" >/dev/null
G0="$(q "select coalesce(sum(spendable), 0) from rewards.reward_counters_global_day")"
# (a) rollback and retry: a late failure after the purge ran leaves the aggregate exactly as it was, then the retry succeeds
q "create table public.zz_block (u uuid references auth.users (id)); insert into public.zz_block values ('$PD')" >/dev/null
quick "$T/rb" del_sql "$PD"
eq "a purge that fails after its aggregation rolls back completely (error 23503, no aggregate row, visit and counters intact)" "$(err "$T/rb")/$(q "select count(*) from rewards.reward_deleted_aggregate_month")/$(q "select count(*) from rewards.visits where user_id = '$PD'")/$(q "select count(*) from rewards.reward_counters_user_day where user_id = '$PD'")" "23503/0/1/1"
q "drop table public.zz_block" >/dev/null
quick "$T/rt" del_sql "$PC"
eq "an unrelated purge creates the September row (the EXISTING-month case for the race below)" "$(err "$T/rt")/$(q "select deleted_visits || '|' || deleted_spendable || '|' || deleted_lifetime from rewards.reward_deleted_aggregate_month where month_utc = '2026-09-01'")" "/1|5|5"
quick "$T/rt2" del_sql "$PD"
eq "the retry after the rollback succeeds and adds exactly its own rows to September" "$(err "$T/rt2")/$(q "select deleted_visits || '|' || deleted_spendable || '|' || deleted_lifetime from rewards.reward_deleted_aggregate_month where month_utc = '2026-09-01'")" "/2|10|10"
# (b) opposing sets: PA = awards only in September + a recorded-only October visit; PB = awards only in October + a recorded-only September visit
q "create trigger zz_purge_delay after delete on rewards.reward_ledger for each statement execute function public.zz_delay()" >/dev/null
quick "$T/p1" del_sql "$PA" &
P1=$!; sleep 0.6
quick "$T/p2" del_sql "$PB" &
P2=$!
wait $P1; wait $P2
eq "opposing-month purges: both commit, no deadlock victim, no error" "$(cat "$T/p1" "$T/p2" | grep -c '40P01')/$(err "$T/p1")$(err "$T/p2")" "0/"
eq "exact deleted totals per UTC month (September: 4 visits 15/15; October: 2 visits 5/5), nothing retained was aggregated" "$(q "select string_agg(month_utc || ':' || deleted_visits || ':' || deleted_spendable || ':' || deleted_lifetime, ',' order by month_utc) from rewards.reward_deleted_aggregate_month")" "2026-09-01:4:15:15,2026-10-01:2:5:5"
eq "no row of any purged account remains and the global gross counter is untouched" "$(q "select (select count(*) from rewards.visits where idempotency_key like 'c3-purge-%') || '/' || (select count(*) from rewards.reward_counters_user_day where user_id in ('$PA','$PB','$PC','$PD')) || '/' || (select sum(spendable) - $G0 from rewards.reward_counters_global_day)")" "0/0/0"
eq "zero reconciliation drift after the opposing purges" "$(drift)" "0"
q "drop trigger zz_purge_delay on rewards.reward_ledger" >/dev/null

echo "checks: $((CHECKS - FAILS)) passed, $FAILS failed"
[ "$FAILS" = 0 ]
