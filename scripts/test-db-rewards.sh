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
#   scripts/test-db-rewards.sh --mutations [name]   guard-removal mutation checks (each mutant is built from a COPY of the sources)
#   scripts/test-db-rewards.sh --baseline-golden <file>   write the pre-P1 ACL snapshot (bootstrap + existing migrations only) as SQL
set -euo pipefail

MODE="${1:-run}"
case "$MODE" in run|--isolation|--mutations|--baseline-golden) ;; *) echo "unknown option: $MODE" >&2; exit 64 ;; esac
# Every external helper this harness uses is checked BEFORE anything starts, so a missing tool is a loud exit 2, never a silent pass.
need() { command -v "$1" >/dev/null 2>&1 || { echo "missing prerequisite: $1 (nothing was started)" >&2; exit 2; }; }
for t in env grep cut tail cp mktemp cmp mkdir chmod rm cat tr sort mv; do need "$t"; done
[ "$MODE" != "--mutations" ] || need perl
[ "$MODE" != "run" ] || need node
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MAIN_PORT=54329
PORT=$MAIN_PORT

# ---------------------------------------------------------------- locate PostgreSQL 16 (and only 16)
is_pg16() { [ -x "$1/postgres" ] && [ -x "$1/initdb" ] && "$1/postgres" --version 2>/dev/null | grep -Eq '\) 16\.'; }
find_pg16() {
  local d
  # An explicit override must itself be PostgreSQL 16: it is never ignored and never silently replaced by another directory.
  if [ -n "${OPEN_STALL_PGBIN:-}" ]; then
    if is_pg16 "$OPEN_STALL_PGBIN"; then echo "$OPEN_STALL_PGBIN"; return 0; fi
    echo "OPEN_STALL_PGBIN is not a PostgreSQL 16 bin directory: $OPEN_STALL_PGBIN" >&2
    return 1
  fi
  for d in /usr/lib/postgresql/16/bin /Applications/Postgres.app/Contents/Versions/16/bin \
           /opt/homebrew/opt/postgresql@16/bin /usr/local/opt/postgresql@16/bin; do
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
SOCKDIR="$WORK"
use_cluster() { SOCKDIR="$1"; PORT="$2"; SOCK_ARGS=(-h "$SOCKDIR" -p "$PORT" -U postgres); }
use_cluster "$WORK" "$PORT"
psqlc() { run_as "$PSQL_BIN" -X -q "${SOCK_ARGS[@]}" -v ON_ERROR_STOP=1 "$@"; }
# The psql command prefix handed to two-session scripts (the database name is appended by the caller).
psql_prefix() { echo ${AS[@]+"${AS[@]}"} "${CLEAN_ENV[@]}" "$PSQL_BIN" -X -q "${SOCK_ARGS[@]}" -v ON_ERROR_STOP=1 -d "$1"; }

STARTED=()
start_cluster() {  # start_cluster <dir> <port>: a brand-new cluster with its own unix socket and no TCP address
  local d="$1" port="$2"
  mkdir -p "$d"; [ -z "${AS[*]:-}" ] || chown postgres "$d"
  run_as "$PGBIN/initdb" -D "$d/data" -A trust -U postgres --no-sync >/dev/null
  run_as "$PGBIN/pg_ctl" -D "$d/data" -o "-k $d -p $port -c listen_addresses='' -c fsync=off -c max_connections=100" -l "$d/log" -w start >/dev/null
  STARTED+=("$d")
}
stop_cluster() {
  local d="$1"
  if [ -f "$d/data/postmaster.pid" ]; then run_as "$PGBIN/pg_ctl" -D "$d/data" -m immediate stop >/dev/null 2>&1 || true; fi
}
cleanup() {
  local d
  for d in ${STARTED[@]+"${STARTED[@]}"}; do stop_cluster "$d"; done
  case "$WORK" in /tmp/os-rw.*) rm -rf "$WORK" ;; esac   # only this harness's own directory
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

echo "harness: $("$PGBIN/postgres" --version)"
start_cluster "$WORK/main" "$MAIN_PORT"
use_cluster "$WORK/main" "$MAIN_PORT"

# ---------------------------------------------------------------- isolation self-test
FAILS=0
chk() { if [ "$2" = "$3" ]; then echo "ok - isolation: $1"; else echo "not ok - isolation: $1 (expected '$3', got '$2')"; FAILS=$((FAILS+1)); fi; }
mkdir -p "$WORK/stubs"
printf '#!/bin/sh\nexit 127\n' > "$WORK/stubs/exit127"
printf '#!/bin/sh\necho "something unrelated broke"\nexit 2\n' > "$WORK/stubs/exit2-no-message"
chmod 755 "$WORK/stubs/exit127" "$WORK/stubs/exit2-no-message"
# refusal_probe <psql binary> [VAR=value ...]: prints "refused" only for a REAL PostgreSQL connection failure, else "not-refused:<why>".
# The probe runs through the SAME minimal clean child environment as every other psql (env -i, the harness's own HOME): nothing
# inherited (service, passfile, password, options, HOME, ...) can reach it. REFUSAL_OUT keeps psql's own output for assertions.
PROBE_SOCK="$WORK/no-such-socket-dir"   # inside the harness directory, never created: unreachable by construction, no TCP, no network
REFUSAL_OUT=""
refusal_probe() {
  local bin="$1"; shift
  local rc=0
  REFUSAL_OUT="$("${CLEAN_ENV[@]}" PGCONNECT_TIMEOUT=3 "$@" "$bin" -X -q -d postgres -c 'select 1' 2>&1)" || rc=$?
  if [ "$rc" = 2 ] && printf '%s' "$REFUSAL_OUT" | grep -q '^psql: error: connection to server'; then echo refused
  else echo "not-refused:rc=$rc"; fi
}
# stubs: one dumps the environment it receives (then behaves like a refused connection), one is a harmless service file naming ONLY an
# unreachable path inside the harness directory (no credential, no host name)
printf '#!/bin/sh\nenv > "%s/stub-env.txt"\necho "psql: error: connection to server on socket \\"stub\\" failed: stub"\nexit 2\n' "$WORK" > "$WORK/stubs/env-dump"
chmod 755 "$WORK/stubs/env-dump"
printf '[poison]\nhost=%s/poison-service-socket\n' "$WORK" > "$WORK/poison-service.conf"
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
  chk "server unix_socket_directories is the throwaway directory" "$(echo "$row" | cut -d'|' -f2)" "$SOCKDIR"
  chk "server listens on no TCP address" "$(echo "$row" | cut -d'|' -f3)" ""
  chk "data directory is inside the throwaway directory" "$(echo "$row" | cut -d'|' -f4)" "$SOCKDIR/data"
  chk "server major version is 16" "$(echo "$row" | cut -d'|' -f5)" "16"
  chk "server is a primary, not a replica" "$(echo "$row" | cut -d'|' -f6)" "f"
  chk "inherited PGOPTIONS did not change search_path" "$(echo "$row" | cut -d'|' -f8)" '"$user", public'
  # Negative controls. A "refusal" counts ONLY when psql itself ran, exited 2 (connection failure) and printed its own connection
  # error; a missing or broken helper (exit 127, an exec error, a stub that exits 2 without a connection error) never counts.
  chk "negative control: a poisoned PGHOST (an unreachable harness-owned socket path) is refused by psql itself" "$(refusal_probe "$PSQL_BIN" PGHOST="$PROBE_SOCK")" "refused"
  chk "the probe does NOT count a missing psql as a refusal" "$(refusal_probe "$WORK/stubs/no-such-psql" PGHOST="$PROBE_SOCK" | cut -c1-12)" "not-refused:"
  chk "the probe does NOT count an exec failure (exit 127) as a refusal" "$(refusal_probe "$WORK/stubs/exit127" PGHOST="$PROBE_SOCK" | cut -c1-12)" "not-refused:"
  chk "the probe does NOT count exit 2 without a connection error as a refusal" "$(refusal_probe "$WORK/stubs/exit2-no-message" PGHOST="$PROBE_SOCK" | cut -c1-12)" "not-refused:"
  # The probe itself runs in a clean environment. A stub records exactly what it receives while every poisoned variable is exported.
  rm -f "$WORK/stub-env.txt"
  ( export PGSERVICE=poison PGSERVICEFILE="$WORK/poison-service.conf" PGPASSFILE=/nonexistent/passfile PGPASSWORD=nope PGOPTIONS='-c search_path=evil' \
           PGDATABASE=prod PGUSER=prod PGPORT=1 PGSSLMODE=require DATABASE_URL=postgres://invalid SUPABASE_URL=https://example.invalid HOME=/nonexistent/home
    refusal_probe "$WORK/stubs/env-dump" PGHOST="$PROBE_SOCK" >/dev/null )
  chk "the stub ran and recorded the probe's environment" "$([ -s "$WORK/stub-env.txt" ] && echo yes || echo no)" "yes"
  chk "probe environment: no service, passfile, password, options, database, user, port, sslmode, URL or key variable" "$(grep -E '^(PGSERVICE|PGSERVICEFILE|PGPASSFILE|PGPASSWORD|PGOPTIONS|PGDATABASE|PGUSER|PGPORT|PGSSLMODE|DATABASE_URL|SUPABASE_)' "$WORK/stub-env.txt" | cut -d= -f1 | tr '\n' ' ')" ""
  chk "probe environment: HOME is the harness's own temporary HOME" "$(sed -n 's/^HOME=//p' "$WORK/stub-env.txt")" "$WORK/home"
  chk "probe environment: the only connection variables are the explicit socket and the timeout" "$(grep '^PG' "$WORK/stub-env.txt" | cut -d= -f1 | sort | tr '\n' ' ')" "PGCONNECT_TIMEOUT PGHOST "
  chk "probe environment: PGHOST is the explicit harness-owned socket path" "$(sed -n 's/^PGHOST=//p' "$WORK/stub-env.txt")" "$PROBE_SOCK"
  # Independent check with the REAL psql: a poisoned inherited service (which libpq would honor over PGHOST) cannot move the target.
  local seen
  seen="$( export PGSERVICE=poison PGSERVICEFILE="$WORK/poison-service.conf"; refusal_probe "$PSQL_BIN" PGHOST="$PROBE_SOCK" >/dev/null; printf '%s' "$REFUSAL_OUT" )"
  chk "real psql, inherited service poisoned: it still tried ONLY the explicit socket" "$(printf '%s' "$seen" | grep -c "$PROBE_SOCK")/$(printf '%s' "$seen" | grep -c 'poison-service-socket')" "1/0"
  # Control for the control: WITHOUT a clean environment the same poison DOES redirect libpq, so the check above can really detect a leak.
  seen="$(PGSERVICE=poison PGSERVICEFILE="$WORK/poison-service.conf" PGHOST="$PROBE_SOCK" PGCONNECT_TIMEOUT=3 "$PSQL_BIN" -X -q -d postgres -c 'select 1' 2>&1 || true)"
  chk "control: an UNCLEAN psql run is redirected by the inherited service (so the leak would be detected)" "$(printf '%s' "$seen" | grep -c 'poison-service-socket')" "1"
  # No TCP probe is made at all (nothing may reach another service): the server's own pid file proves where it listens.
  local pidf="$SOCKDIR/data/postmaster.pid"
  chk "postmaster.pid lists the throwaway socket directory" "$(sed -n 5p "$pidf")" "$SOCKDIR"
  chk "postmaster.pid lists no TCP listen address" "$(sed -n 6p "$pidf")" ""
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

if [ "$MODE" = "--baseline-golden" ]; then
  psqlc -d postgres -c "create database os_base" >/dev/null
  psqlc -d os_base -f "$SRC/supabase/tests/bootstrap.sql" >/dev/null
  for f in "$SRC"/supabase/migrations/*.sql; do psqlc -d os_base -f "$f" >/dev/null; done
  cat > "$WORK/gen.sql" <<SQL
\\i $SRC/supabase/tests/rewards/snapshot_fn.sql
select 'create temp table _golden (kind text, name text, owner text, acl text, extra text);';
select 'insert into _golden values' || E'\\n' || string_agg(format('(%L,%L,%L,%L,%L)', kind, name, owner, acl, extra), E',\\n' order by kind, name) || ';' from pg_temp.snap();
SQL
  chmod a+r "$WORK/gen.sql"
  psqlc -d os_base -A -t -f "$WORK/gen.sql" > "$WORK/golden.sql"
  [ -n "${2:-}" ] || { echo "usage: --baseline-golden <output file>" >&2; exit 64; }
  cp "$WORK/golden.sql" "$2"
  exit 0
fi

if [ "$MODE" = "run" ]; then
  command -v node >/dev/null 2>&1 || { echo "node is required for the boundary check" >&2; exit 2; }
  echo "boundary: file-inspection checks (no database, no network)"
  (cd "$ROOT" && node scripts/check-rewards-boundary.mjs --selftest | tail -1 && node scripts/check-rewards-boundary.mjs | tail -1)
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
# A mutant either deletes the region between "-- MUTABLE:<marker> begin" and "-- MUTABLE:<marker> end" in a COPY of rewards-wip, builds it
# in its OWN brand-new throwaway cluster (roles are cluster-wide), and the named test must then fail. The unmutated build is
# tested first in the main cluster, so a mutant can only be "killed" by a test that passes on the original.
build_template os_template "$SRC/supabase/rewards-wip" >/dev/null
survived=0; killed=0; equivalent=0; bad=0; idx=0
while IFS=$'\t' read -r name marker tfile expect; do
  case "$name" in ''|'#'*) continue ;; esac
  [ -z "${2:-}" ] || [ "$name" = "$2" ] || continue
  idx=$((idx+1))
  mdir="$WORK/mut_${name}"; mkdir -p "$mdir"; cp "$SRC"/supabase/rewards-wip/*.sql "$mdir/"
  cat "$mdir"/*.sql > "$WORK/orig.cat"
  case "$marker" in
    append:*) printf '%s\n' "${marker#append:}" > "$mdir/R999_mutant.sql" ;;   # an INJECTED extra statement (e.g. an extra grant)
    replace:*) spec="${marker#replace:}"; FROM="${spec%%=>*}" TO="${spec#*=>}" perl -0pi -e 's/\Q$ENV{FROM}\E/$ENV{TO}/g' "$mdir"/*.sql ;;   # a literal substitution
    *) perl -0pi -e "s/^[^\n]*MUTABLE:${marker} begin.*?MUTABLE:${marker} end[^\n]*\n//ms" "$mdir"/*.sql ;;
  esac
  cat "$mdir"/*.sql > "$WORK/mut.cat"
  if cmp -s "$WORK/orig.cat" "$WORK/mut.cat"; then echo "BAD   $name: the mutation changed nothing (marker or text '$marker' not found)"; bad=$((bad+1)); continue; fi
  # baseline: the test passes on the unmutated build (main cluster), checked once per test file
  use_cluster "$WORK/main" "$MAIN_PORT"
  if [ ! -e "$WORK/base_${tfile}.ok" ]; then
    if run_one os_template "$SRC/supabase/tests/rewards/$tfile" >/dev/null 2>&1; then : > "$WORK/base_${tfile}.ok"; else echo "BAD   $name: baseline test $tfile does not pass"; bad=$((bad+1)); continue; fi
  fi
  mc="$WORK/mc_${idx}"; mport=$((MAIN_PORT + idx))
  start_cluster "$mc" "$mport"; use_cluster "$mc" "$mport"
  build_template os_mut "$mdir" >/dev/null
  rc=0; run_one os_mut "$SRC/supabase/tests/rewards/$tfile" >/dev/null 2>&1 || rc=$?
  stop_cluster "$mc"; rm -rf "$mc"; use_cluster "$WORK/main" "$MAIN_PORT"
  if [ "$rc" != 0 ]; then
    if [ "$expect" = equivalent ]; then echo "UNEXPECTED $name: expected to survive but was killed by $tfile"; bad=$((bad+1)); else echo "KILLED   $name (marker $marker) by $tfile"; killed=$((killed+1)); fi
  else
    if [ "$expect" = equivalent ]; then echo "SURVIVED $name (marker $marker): documented equivalent mutant"; equivalent=$((equivalent+1)); else echo "SURVIVED $name (marker $marker): NOT killed by $tfile"; survived=$((survived+1)); fi
  fi
done < "$SRC/supabase/tests/rewards/mutations.tsv"
echo "mutations: $killed killed, $equivalent documented equivalent, $survived survived unexpectedly, $bad invalid"
[ "$survived" = 0 ] && [ "$bad" = 0 ] || exit 1
echo "REWARDS P1 mutation checks: every guard removal was caught (originals untouched; mutants built from copies in separate throwaway clusters)"
