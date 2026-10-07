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

# 3. Two administrators decide the SAME submission at the same moment (real competing transactions).
#    The row lock makes the second wait; it must then see the first decision and fail, so there is never
#    a second public location or a conflicting final decision.
AD1=00000000-0000-0000-0000-00000000c0d4
AD2=00000000-0000-0000-0000-00000000c0e5
S1=00000000-0000-0000-0000-0000000005a1
S2=00000000-0000-0000-0000-0000000005a2
S3=00000000-0000-0000-0000-0000000005a3
q "insert into auth.users (id, email) values ('$AD1', 'ad1@test.invalid'), ('$AD2', 'ad2@test.invalid');
   insert into public.admin_users (user_id) values ('$AD1'), ('$AD2');
   insert into public.submissions (id, user_id, kind, proposed, attested_public)
     select s.id, '$UC', 'new_location', jsonb_build_object('name', 'CONC race ' || s.n, 'latitude', 76 + s.n, 'longitude', 76), true
     from (values ('$S1'::uuid, 1), ('$S2'::uuid, 2), ('$S3'::uuid, 3)) as s(id, n);"
as_admin() { echo "set role authenticated; select set_config('request.jwt.claim.sub', '$1', false); select set_config('request.jwt.claims', '{\"sub\":\"$1\",\"aal\":\"aal2\"}', false);"; }

# race(first_admin first_call second_admin second_call) : first holds its transaction open for 2 s; second arrives 0.7 s later.
race() {
  "${PSQL[@]}" -X -q >/dev/null <<SQL &
begin;
$(as_admin "$1")
select public.admin_decide_submission($2);
select pg_sleep(2);
commit;
SQL
  local p1=$!
  sleep 0.7
  local rc=0
  "${PSQL[@]}" -X -q >/dev/null 2>/tmp/conc_second.err <<SQL || rc=$?
$(as_admin "$3")
select public.admin_decide_submission($4);
SQL
  wait "$p1"
  echo "$rc"
}

RC=$(race "$AD1" "'$S1', 'approve'" "$AD2" "'$S1', 'approve'")
[ "$RC" != "0" ] && grep -q "already decided" /tmp/conc_second.err || { echo "FAIL: second concurrent approve of one submission should fail with 'already decided' (rc=$RC)"; cat /tmp/conc_second.err; exit 1; }
q "do \$\$ begin
  assert (select count(*) = 1 from public.location_sources where source = 'community_submission' and source_reference = '$S1'), 'exactly one public location was created for the submission';
  assert (select count(*) = 1 from public.moderation_decisions where submission_id = '$S1' and decision = 'approve' and reviewer_id = '$AD1'), 'exactly one final decision, by the first administrator';
  assert (select status = 'approved' from public.submissions where id = '$S1'), 'submission approved once';
end \$\$;"
echo "concurrency: two admins approving the same submission OK"

RC=$(race "$AD1" "'$S2', 'approve'" "$AD2" "'$S2', 'reject', 'spam_or_abuse'")
[ "$RC" != "0" ] && grep -q "already decided" /tmp/conc_second.err || { echo "FAIL: reject after a concurrent approve should fail (rc=$RC)"; cat /tmp/conc_second.err; exit 1; }
q "do \$\$ begin
  assert (select count(*) = 1 from public.moderation_decisions where submission_id = '$S2' and decision in ('approve', 'reject')), 'one final decision only (no conflicting approve + reject)';
  assert (select status = 'approved' from public.submissions where id = '$S2'), 'the first decision stands';
end \$\$;"
echo "concurrency: approve then reject race OK"

RC=$(race "$AD1" "'$S3', 'reject', 'spam_or_abuse'" "$AD2" "'$S3', 'approve'")
[ "$RC" != "0" ] && grep -q "already decided" /tmp/conc_second.err || { echo "FAIL: approve after a concurrent reject should fail (rc=$RC)"; cat /tmp/conc_second.err; exit 1; }
q "do \$\$ begin
  assert (select status = 'rejected' from public.submissions where id = '$S3'), 'the rejection stands';
  assert (select count(*) = 0 from public.location_sources where source = 'community_submission' and source_reference = '$S3'), 'a rejected submission never becomes a public location';
  assert (select count(*) = 1 from public.moderation_decisions where submission_id = '$S3'), 'one final decision only';
end \$\$;"
echo "concurrency: reject then approve race OK"

# cleanup of the admin scenario (superuser; bypasses the append-only triggers for test data only)
q "set session_replication_role = replica;
   delete from public.moderation_decisions where submission_id in ('$S1', '$S2', '$S3');
   delete from public.moderation_log where target_id in ('$S1', '$S2', '$S3');
   delete from public.submissions where id in ('$S1', '$S2', '$S3');
   delete from public.location_sources where source = 'community_submission' and source_reference in ('$S1', '$S2', '$S3');
   delete from public.locations where name like 'CONC race %';
   delete from public.admin_users where user_id in ('$AD1', '$AD2');
   delete from auth.users where id in ('$AD1', '$AD2');"

q "delete from auth.users where id in ('$UA', '$UB', '$UC');"
echo "concurrency: OK"
