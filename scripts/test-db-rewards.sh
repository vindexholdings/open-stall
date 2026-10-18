#!/usr/bin/env bash
# P1 rewards harness: validates supabase/rewards-wip on a THROWAWAY local PostgreSQL 16 only.
#
# Isolation (verified by behavior, every run, not just stated):
#  * requires PostgreSQL major version 16 exactly; any other major version aborts
#  * every child process (initdb, pg_ctl, postgres, psql) starts through `env -i` with a minimal explicit environment, so
#    no inherited connection override (PGHOST, PGSERVICE, PGPASSFILE, PGOPTIONS, DATABASE_URL, SUPABASE_*, ...) reaches it
#  * the server listens on NO TCP address; it has its own unix socket inside its own mktemp directory
#  * an isolation self-test runs with deliberately poisoned variables and asserts the real server identity
#  * the harness reads no environment files, takes no connection argument and has no hosted or remote path
#  * cleanup removes only its own temporary directory (stopping only its own server)
#
# Usage:
#   scripts/test-db-rewards.sh                run isolation self-test, build, run every test in supabase/tests/rewards
#   scripts/test-db-rewards.sh --isolation    only the isolation self-test
#   scripts/test-db-rewards.sh --mutations    guard-removal mutation checks (each mutant is built from a COPY of the sources)
set -euo pipefail

MODE="${1:-run}"
case "$MODE" in run|--isolation|--mutations) ;; *) echo "unknown option: $MODE" >&2; exit 64 ;; esac
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=54329

# ---------------------------------------------------------------- locate PostgreSQL 16 (and only 16)
is_pg16() { [ -x "$1/postgres" ] && [ -x "$1/initdb" ] && "$1/postgres" --version 2>/dev/null | grep -Eq '\) 16\.'; }
find_pg16() {
  local d
  for d in "${OPEN_STALL_PGBIN:-}" /usr/lib/postgresql/16/bin /Applications/Postgres.app/Contents/Versions/16/bin \
           /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
    [ -n "$d" ] || continue
    if is_pg16 "$d"; then echo "$d"; return 0; fi
  done
  return 1
}
PGBIN="$(find_pg16 || true)"
[ -n "$PGBIN" ] || { echo "PostgreSQL 16 server binaries not found (need version 16 exactly; set OPEN_STALL_PGBIN to a 16 bin directory)" >&2; exit 2; }
PSQL_BIN="$PGBIN/psql"
[ -x "$PSQL_BIN" ] || PSQL_BIN="$(command -v psql || true)"
[ -n "$PSQL_BIN" ] || { echo "psql not found" >&2; exit 2; }

WORK="$(mktemp -d /tmp/os-rw.XXXXXX)"
AS=()
if [ "$(id -u)" = 0 ]; then
  chown postgres "$WORK" || { echo "cannot hand the work directory to the postgres user" >&2; rm -rf "$WORK"; exit 2; }
  AS=(runuser -u postgres --)
fi
mkdir -p "$WORK/home" "$WORK/src"
cp -R "$ROOT/supabase" "$WORK/src/supabase"
chmod -R a+rX "$WORK/src"
[ -z "${AS[*]:-}" ] || chown -R postgres "$WORK/home"
SRC="$WORK/src"

# Minimal explicit environment. Nothing else is inherited by any child.
CLEAN_ENV=(env -i "PATH=$PGBIN:/usr/bin:/bin" "LANG=C.UTF-8" "LC_ALL=C.UTF-8" "HOME=$WORK/home" "TZ=UTC")
run_as() { ${AS[@]+"${AS[@]}"} "${CLEAN_ENV[@]}" "$@"; }
SOCK_ARGS=(-h "$WORK" -p "$PORT" -U postgres)
psqlc() { run_as "$PSQL_BIN" -X -q "${SOCK_ARGS[@]}" -v ON_ERROR_STOP=1 "$@"; }
# The psql command prefix handed to two-session scripts (the database name is appended by the caller).
psql_prefix() { echo run_as "$PSQL_BIN" -X -q "${SOCK_ARGS[@]}" -v ON_ERROR_STOP=1 -d "$1"; }

cleanup() {
  if [ -f "$WORK/data/postmaster.pid" ]; then
    run_as "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  case "$WORK" in /tmp/os-rw.*) rm -rf "$WORK" ;; esac   # only this harness's own directory
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "harness: $("$PGBIN/postgres" --version)"
run_as "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres --no-sync >/dev/null
run_as "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -p $PORT -c listen_addresses='' -c fsync=off -c max_connections=100" \
  -l "$WORK/log" -w start >/dev/null

# ---------------------------------------------------------------- isolation self-test
FAILS=0
chk() { if [ "$2" = "$3" ]; then echo "ok - isolation: $1"; else echo "not ok - isolation: $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }
isolation_selftest() {
  # Poison every override a careless setup could inherit. The wrapper must drop all of them.
  local out
  out="$(
    export PGHOST=example.invalid PGPORT=1 PGSERVICE=prod PGSERVICEFILE=/nonexistent PGPASSFILE=/nonexistent PGSSLMODE=require \
           PGOPTIONS='-c search_path=evil' PGDATABASE=prod PGUSER=prod PGPASSWORD=nope DATABASE_URL=postgres://invalid \
           SUPABASE_URL=https://example.invalid SUPABASE_DB_URL=postgres://invalid SUPABASE_SERVICE_ROLE_KEY=invalid
    leaked="$(run_as env | grep -E '^(PG|DATABASE_URL|SUPABASE)' || true)"
    echo "leaked=${leaked}"
    psqlc -d postgres -A -t -F '|' -c "select inet_server_addr() is null, current_setting('unix_socket_directories'), current_setting('listen_addresses'), current_setting('data_directory'), (current_setting('server_version_num')::int / 10000), pg_is_in_recovery(), current_database(), current_setting('search_path')"
  )"
  chk "no connection override reaches a child process" "$(echo "$out" | sed -n 's/^leaked=//p')" ""
  local row; row="$(echo "$out" | tail -1)"
  chk "server has no TCP address (inet_server_addr is NULL)" "$(echo "$row" | cut -d'|' -f1)" "t"
  chk "server unix_socket_directories is the throwaway directory" "$(echo "$row" | cut -d'|' -f2)" "$WORK"
  chk "server listens on no TCP address" "$(echo "$row" | cut -d'|' -f3)" ""
  chk "data directory is inside the throwaway directory" "$(echo "$row" | cut -d'|' -f4)" "$WORK/data"
  chk "server major version is 16" "$(echo "$row" | cut -d'|' -f5)" "16"
  chk "server is a primary, not a replica" "$(echo "$row" | cut -d'|' -f6)" "f"
  chk "inherited PGOPTIONS did not change search_path" "$(echo "$row" | cut -d'|' -f8)" '"$user", public'
  # Negative control: the poison really is unusable if it leaked into a plain psql.
  local rc=0
  PGHOST=example.invalid PGCONNECT_TIMEOUT=3 timeout 15 "$PSQL_BIN" -X -q -d postgres -c 'select 1' >/dev/null 2>&1 || rc=$?
  chk "negative control: a poisoned PGHOST cannot connect" "$([ "$rc" != 0 ] && echo refused || echo connected)" "refused"
  rc=0
  psqlc -h 127.0.0.1 -d postgres -c 'select 1' >/dev/null 2>&1 || rc=$?
  chk "a TCP connection to the server is refused" "$([ "$rc" != 0 ] && echo refused || echo connected)" "refused"
  local dbs; dbs="$(psqlc -d postgres -A -t -c "select string_agg(datname, ',' order by datname) from pg_database")"
  chk "the cluster holds only its own default databases" "$dbs" "postgres,template0,template1"
}
isolation_selftest
[ "$FAILS" = 0 ] || { echo "isolation self-test FAILED"; exit 1; }
echo "isolation: all checks passed (no production connection was made)"
[ "$MODE" != "--isolation" ] || exit 0

# ---------------------------------------------------------------- build a template database from sources
build_template() {  # build_template <dbname> <wip dir>
  local db="$1" wip="$2" f
  psqlc -d postgres -c "create database $db" >/dev/null
  psqlc -d "$db" -f "$SRC/supabase/tests/bootstrap.sql" >/dev/null
  for f in "$SRC"/supabase/migrations/*.sql; do psqlc -d "$db" -f "$f" >/dev/null; done
  for f in "$wip"/*.sql; do echo "rewards-wip: $(basename "$f")"; psqlc -d "$db" -f "$f" >/dev/null; done
  psqlc -d postgres -c "alter database $db is_template true" >/dev/null
}

# run_one <template> <testfile>: clones a fresh database from the template and runs one test file.
N=0
run_one() {
  local tmpl="$1" f="$2" db log rc=0 checks
  N=$((N+1)); db="t_${N}"; log="$WORK/test_${N}.log"
  psqlc -d postgres -c "create database $db template $tmpl" >/dev/null
  case "$f" in
    *.sql) psqlc -d "$db" -v ROOT="$SRC" -f "$f" >"$log" 2>&1 || rc=$? ;;
    *.sh)  bash "$f" $(psql_prefix "$db") >"$log" 2>&1 || rc=$? ;;
  esac
  checks="$(grep -c 'ok - ' "$log" || true)"
  cp "$log" "$WORK/last.log"
  if [ "$rc" = 0 ]; then echo "PASS $(basename "$f") ($checks ok lines)"; else echo "FAIL $(basename "$f") (exit $rc)"; tail -25 "$log"; fi
  [ -z "${SHOW_LOG:-}" ] || cat "$log"
  return "$rc"
}

if [ "$MODE" = "run" ]; then
  build_template os_template "$SRC/supabase/rewards-wip"
  echo "run: $(psqlc -d postgres -A -t -c 'select version()')"
  failed=0
  for f in "$SRC"/supabase/tests/rewards/*.test.sql "$SRC"/supabase/tests/rewards/*.sh; do
    [ -e "$f" ] || continue
    run_one os_template "$f" || failed=$((failed+1))
  done
  echo "summary: $N test files, $failed failed"
  [ "$failed" = 0 ] || exit 1
  echo "REWARDS P1: all tests passed on a disposable local PostgreSQL 16 (no production connection was made)"
  exit 0
fi

# ---------------------------------------------------------------- mutation checks
# supabase/tests/rewards/mutations.tsv: name <TAB> marker <TAB> test file <TAB> kill|equivalent
# A mutant deletes the region between "-- MUTABLE:<marker> begin" and "-- MUTABLE:<marker> end" in a COPY of rewards-wip.
build_template os_template "$SRC/supabase/rewards-wip" >/dev/null
survived=0; killed=0; equivalent=0; bad=0
while IFS=$'\t' read -r name marker tfile expect; do
  case "$name" in ''|'#'*) continue ;; esac
  mdir="$WORK/mut_${name}"; mkdir -p "$mdir"; cp "$SRC"/supabase/rewards-wip/*.sql "$mdir/"
  before="$(cat "$mdir"/*.sql | md5sum)"
  perl -0pi -e "s/^[^\n]*MUTABLE:${marker} begin.*?MUTABLE:${marker} end[^\n]*\n//ms" "$mdir"/*.sql
  after="$(cat "$mdir"/*.sql | md5sum)"
  [ "$before" != "$after" ] || { echo "BAD   $name: marker '$marker' not found"; bad=$((bad+1)); continue; }
  psqlc -d postgres -c "drop database if exists os_mut" >/dev/null 2>&1 || true
  build_template os_mut "$mdir" >/dev/null
  # baseline on the unmutated template, then the mutant
  if ! run_one os_template "$SRC/supabase/tests/rewards/$tfile" >/dev/null 2>&1; then echo "BAD   $name: baseline test $tfile does not pass"; bad=$((bad+1)); continue; fi
  rc=0; run_one os_mut "$SRC/supabase/tests/rewards/$tfile" >/dev/null 2>&1 || rc=$?
  psqlc -d postgres -c "alter database os_mut is_template false" >/dev/null; psqlc -d postgres -c "drop database os_mut" >/dev/null
  if [ "$rc" != 0 ]; then
    if [ "$expect" = equivalent ]; then echo "UNEXPECTED $name: expected to survive but was killed by $tfile"; bad=$((bad+1)); else echo "KILLED   $name (marker $marker) by $tfile"; killed=$((killed+1)); fi
  else
    if [ "$expect" = equivalent ]; then echo "SURVIVED $name (marker $marker): documented equivalent mutant"; equivalent=$((equivalent+1)); else echo "SURVIVED $name (marker $marker): NOT killed by $tfile"; survived=$((survived+1)); fi
  fi
done < "$SRC/supabase/tests/rewards/mutations.tsv"
echo "mutations: $killed killed, $equivalent documented equivalent, $survived survived unexpectedly, $bad invalid"
[ "$survived" = 0 ] && [ "$bad" = 0 ] || exit 1
echo "REWARDS P1 mutation checks: every guard removal was caught (originals untouched; mutants built from copies)"
