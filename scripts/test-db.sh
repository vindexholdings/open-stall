#!/usr/bin/env bash
# Validates supabase/migrations and supabase/tests on a throwaway local Postgres.
# Never connects to any remote database. The temp cluster (and all synthetic test data) is
# destroyed on exit.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PGBIN" ] || { echo "Postgres server binaries not found (need initdb/pg_ctl)"; exit 2; }

WORK="$(mktemp -d)"
AS=()
if [ "$(id -u)" = 0 ]; then
  chown postgres "$WORK" && chmod 755 "$ROOT" && AS=(runuser -u postgres --)
fi
cleanup() { "${AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

"${AS[@]}" "$PGBIN/initdb" -D "$WORK/data" -A trust -U postgres >/dev/null
"${AS[@]}" "$PGBIN/pg_ctl" -D "$WORK/data" -o "-k $WORK -c listen_addresses=''" -l "$WORK/log" -w start >/dev/null
PSQL=("${AS[@]}" psql -h "$WORK" -U postgres -d postgres -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -f "$ROOT/supabase/tests/bootstrap.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migration: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
for f in "$ROOT"/supabase/tests/*.test.sql; do
  echo "test: $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "contract: importer output -> import_locations"
FIX="$WORK/contract.sql"
(cd "$ROOT" && npx tsx packages/importer/src/contractFixture.ts) > "$FIX"
chmod 644 "$FIX"
"${PSQL[@]}" -f "$FIX"
echo "DB validation passed."
