# Testing
During implementation test smallest affected surface; full gates at milestones/PR/release.
Required: TypeScript typecheck, lint, domain unit tests, database/RLS tests, critical integration tests, E2E smoke tests once established.

Critical flows:
1 location permission allow/deny
2 nearby verified sorting
3 filters
4 pending submission invisible publicly
5 admin approval makes canonical/public
6 navigation
7 free favorites cap
8 premium entitlement
9 points anti-duplication
10 account deletion
11 non-admin rejected from admin operations

Milestone gate: build/install, typecheck, lint, relevant tests, E2E smoke where available, secret check, PROJECT_STATE update.

## Phase 1 coverage (OS-110)
Commands: `npm run check` (lint, typecheck, unit tests, secret scan), `npm run test:db` (migrations + RLS on a throwaway local Postgres), `npm run test:e2e` (web smoke in headless Chrome).
Fixtures: synthetic rows exist only in tests (in-memory, or the throwaway local DB destroyed on exit). They are never written to dev/production databases.
- 1 permission allow/deny: `locationAccess.test.ts` (state mapping). Device prompts need manual device testing.
- 2 nearby verified sorting: `nearby.test.ts`, `publicLocation` row tests (non-verified rows rejected).
- 3 filters: `filters.test.ts` (unknown never matches positive filters).
- 4 hidden states invisible publicly (candidate/pending/closed hidden; unverified only with explicit evidence): `supabase/tests/locations_rls.test.sql` (local, mutation-checked). REMOTE VERIFICATION PENDING until migrations are approved and pushed (`npm run verify:remote-rls`).
- Importer: `packages/importer/src/*.test.ts` (classification, tiling, Overpass retries, apply guards, batching, abort-before-write) plus SQL merge tests (idempotency, no-overwrite of verified/pending/closed/admin-edited, upgrade/downgrade, stale handling) and an importer-to-database contract test in `npm run test:db`.
- 6 navigation: `navigation.test.ts` (destination-only URLs, id validation).
- Offline: `locationCache.test.ts`, `cachedSource.test.ts`.
- Web smoke: home, tabs, favorites, settings, invalid location link.
Flows 5, 7-11 belong to later phases.
