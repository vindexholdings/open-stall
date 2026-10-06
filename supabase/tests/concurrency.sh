#!/usr/bin/env bash
# Two-session concurrency checks against the throwaway cluster started by scripts/test-db.sh.
# Usage (from test-db.sh): concurrency.sh <psql command...>
# Each scenario holds one transaction open (pg_sleep) while a second session runs, then asserts the outcome.
set -euo pipefail
PSQL=("$@")
q() { "${PSQL[@]}" -X -A -t -c "$1"; }

q "insert into auth.users (id, email) values
     ('00000000-0000-0000-0000-00000000c0a1', 'ca@test.invalid'),
     ('00000000-0000-0000-0000-00000000c0b2', 'cb@test.invalid'),
     ('00000000-0000-0000-0000-00000000c0c3', 'cc@test.invalid');
   insert into public.locations (id, name, latitude, longitude, status, restroom_evidence, restroom_verified, last_verified_at)
     values ('00000000-0000-0000-0000-00000000c10c', 'CONC verified', 74, 74, 'verified', 'explicit', true, now());"

as_user() { echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false);"; }
UA=00000000-0000-0000-0000-00000000c0a1
UB=00000000-0000-0000-0000-00000000c0b2
UC=00000000-0000-0000-0000-00000000c0c3
LOC=00000000-0000-0000-0000-00000000c10c

# 1. Two people report one place at the same moment, straddling a ~110 m rounding-cell boundary (73.0005).
#    Both proposals are kept; the later writer waits for the earlier commit and flags it privately.
"${PSQL[@]}" -X -q >/dev/null <<SQL &
begin;
$(as_user "$UA")
select public.submit_location('{"name":"Conc restroom"}', 73.00049, 73, 10, true, null);
select pg_sleep(2);
commit;
SQL
P1=$!
sleep 0.7
"${PSQL[@]}" -X -q >/dev/null <<SQL
$(as_user "$UB")
select public.submit_location('{"name":"Conc restroom"}', 73.00051, 73, 10, true, null);
SQL
wait "$P1"
q "do \$\$ declare a uuid; b uuid; begin
  select id into a from public.submissions where user_id = '$UA' and kind = 'new_location';
  select id into b from public.submissions where user_id = '$UB' and kind = 'new_location';
  assert a is not null and b is not null and a <> b, 'concurrent reports are two separate proposals';
  assert (select 'near_pending_submission' = any (flags) and duplicate_submission_ids = array[a] from public.submissions where id = b),
    'the later concurrent proposal is privately flagged against the earlier one across the cell boundary';
end \$\$;"
echo "concurrency: simultaneous nearby proposals OK"

# 2. Two community reviews and one admin rating land on one restroom at the same time:
#    no deadlock, no lost update, and the admin rating never reaches the public aggregate.
"${PSQL[@]}" -X -q >/dev/null <<SQL &
begin;
$(as_user "$UA")
select public.submit_review('$LOC', 4, 'plain', null);
select pg_sleep(2);
commit;
SQL
P1=$!
"${PSQL[@]}" -X -q >/dev/null <<SQL &
begin;
reset role;
set role service_role;
select public.apply_location_review_v2('$LOC', 'Admin', 'conc-admin', 'exists', true, current_date, '{"rating":1}');
select pg_sleep(1);
commit;
SQL
P2=$!
sleep 0.7
"${PSQL[@]}" -X -q >/dev/null <<SQL
$(as_user "$UC")
select public.submit_review('$LOC', 2, 'plain', null);
SQL
wait "$P1"
wait "$P2"
q "do \$\$ begin
  assert (select rating_count = 2 and average_rating = 3.00 from public.locations where id = '$LOC'),
    'both concurrent community ratings counted, admin rating excluded';
  assert (select count(*) = 1 from public.location_reviews where location_id = '$LOC' and rating = 1), 'admin rating kept as history';
end \$\$;"
echo "concurrency: simultaneous ratings OK"

q "delete from auth.users where id in ('$UA', '$UB', '$UC');"
echo "concurrency: OK"
