#!/usr/bin/env bash
# Validates supabase/migrations and supabase/tests on a throwaway local Postgres.
# Never connects to any remote database. The temp cluster (and all synthetic test data) is
# destroyed on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Locate Postgres server binaries (initdb/pg_ctl). Order: OPEN_STALL_PGBIN override, Linux packages,
# Postgres.app, Homebrew, pg_config, PATH.
find_pgbin() {
  local d best="" bestv=-1 v
  if [ -n "${OPEN_STALL_PGBIN:-}" ]; then
    if [ -x "$OPEN_STALL_PGBIN/initdb" ]; then echo "$OPEN_STALL_PGBIN"; return 0; fi
    echo "OPEN_STALL_PGBIN has no initdb: $OPEN_STALL_PGBIN" >&2
    return 1
  fi
  for d in /usr/lib/postgresql/*/bin; do   # highest major version wins
    [ -x "$d/initdb" ] || continue
    v="$(basename "$(dirname "$d")")"
    case "$v" in ''|*[!0-9]*) v=0 ;; esac
    if [ "$v" -gt "$bestv" ]; then best="$d"; bestv="$v"; fi
  done
  if [ -n "$best" ]; then echo "$best"; return 0; fi
  for d in /Applications/Postgres.app/Contents/Versions/latest/bin \
           /opt/homebrew/opt/postgresql@*/bin /opt/homebrew/opt/postgresql/bin \
           /usr/local/opt/postgresql@*/bin /usr/local/opt/postgresql/bin; do
    if [ -x "$d/initdb" ]; then echo "$d"; return 0; fi
  done
  if command -v pg_config >/dev/null 2>&1; then
    d="$(pg_config --bindir 2>/dev/null || true)"
    if [ -n "$d" ] && [ -x "$d/initdb" ]; then echo "$d"; return 0; fi
  fi
  if command -v initdb >/dev/null 2>&1; then dirname "$(command -v initdb)"; return 0; fi
  return 1
}
PGBIN="$(find_pgbin || true)"
[ -n "$PGBIN" ] || { echo "Postgres server binaries not found (need initdb/pg_ctl); set OPEN_STALL_PGBIN"; exit 2; }
PSQL_BIN="$PGBIN/psql"
[ -x "$PSQL_BIN" ] || PSQL_BIN="$(command -v psql || true)"
[ -n "$PSQL_BIN" ] || { echo "psql not found"; exit 2; }

WORK="$(mktemp -d)"
# Unix socket paths are length-limited (~104 bytes on macOS); fall back to a short /tmp dir.
if [ "${#WORK}" -gt 70 ]; then rm -rf "$WORK"; WORK="$(mktemp -d /tmp/os-db.XXXXXX)"; fi
AS=()
if [ "$(id -u)" = 0 ]; then
  chown postgres "$WORK" && chmod 755 "$ROOT" && AS=(runuser -u postgres --)
fi
# ${AS[@]+...} keeps the empty-array expansion safe under `set -u` on Bash 3.2 (macOS).
run_as() { ${AS[@]+"${AS[@]}"} "$@"; }
cleanup() {
  if [ -f "$WORK/data/postmaster.pid" ]; then
    run_as "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true
  fi
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_as "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
run_as "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("$PSQL_BIN" -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -v ROOT="$ROOT" -q)

run_as "${PSQL[@]}" -f "$ROOT/supabase/tests/bootstrap.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migration: $(basename "$f")"
  run_as "${PSQL[@]}" -f "$f"
done
for f in "$ROOT"/supabase/tests/*.test.sql; do
  echo "test: $(basename "$f")"
  run_as "${PSQL[@]}" -f "$f"
done
echo "concurrency: two-session checks"
run_as bash "$ROOT/supabase/tests/concurrency.sh" "${PSQL[@]}"
echo "contract: importer output -> import_locations"
FIX="$WORK/contract.sql"
(cd "$ROOT" && npx tsx packages/importer/src/contractFixture.ts) > "$FIX"
chmod 644 "$FIX"
run_as "${PSQL[@]}" -f "$FIX"
echo "manual entry: generated SQL -> local database"
MAN="$WORK/manual.sql"
(cd "$ROOT" && npx tsx packages/importer/src/manualFixture.ts) > "$MAN"
chmod 644 "$MAN"
run_as "${PSQL[@]}" -f "$MAN"
echo "research entry: generated SQL -> local database"
RES="$WORK/research.sql"
(cd "$ROOT" && npx tsx packages/importer/src/researchFixture.ts) > "$RES"
chmod 644 "$RES"
run_as "${PSQL[@]}" -f "$RES"
echo "DB validation passed."
