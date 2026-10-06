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
- 4 hidden states invisible publicly (candidate/pending/closed/held/possible-duplicate hidden; unverified only with explicit evidence; no direct table access; internal fields not exposed; caps and input validation): `supabase/tests/locations_rls.test.sql` (local, mutation-checked). REMOTE VERIFICATION PENDING until migrations are approved and pushed (`npm run verify:remote-rls`).
- Importer and merge safety: `packages/importer/src/*.test.ts` (classification, recent-edit hold, tiling, Overpass retries, apply guards, batching, abort-before-write, no finalize from incomplete replays) plus SQL tests (idempotency, no-overwrite of verified/pending/closed/edited, automatic manual-edit protection, upgrade/downgrade, duplicate flagging, finalize bounds/thresholds/scope/zero-seen/multi-source) and an importer-to-database contract test including finalize, all in `npm run test:db`.
- 6 navigation: `navigation.test.ts` (destination-only URLs, id validation).
- Offline: `locationCache.test.ts`, `cachedSource.test.ts`.
- Web smoke: home, tabs, favorites, settings, invalid location link.
Flows 5, 7-11 belong to later phases.

Manual-entry tooling: `packages/importer/src/manualLocations.test.ts` (validation, attestations, caps, escaping/injection, example template rejected) plus a DB test that runs the generated SQL on a local Postgres (idempotency, validity, public API output, importer duplicate flagging, cleanup scope). Live E2E steps: CHECKPOINT_OS-111.md.

Researched-record tooling: `census.test.ts` (parser refuses no/multiple/mismatched/unusable matches), `researchedLocations.test.ts` (never Verified, evidence/attestation rules, map-database hosts rejected, committed template unusable until filled, escaping, cleanup scope), and a local-DB test running the generated SQL (idempotent, unverified-only, provenance separate, public API output, cleanup leaves other rows). Live steps: CHECKPOINT_OS-111.md. Live data contains no Verified record, so Verified UI/hint/filter are covered by automated tests only.

Validator: `packages/domain/src/review.test.ts` (parsing, explicit-confirmation rules, outcome mirror), `supabase/tests/reviews.test.sql` (Verified only on personal confirmation; not-exists hides and survives imports; unknown clears imported facts; OSM source preserved; first-party source added; audit row; client roles blocked; mutation-checked), `apps/admin/src/lib/gate.test.ts` (local-only gate + project guard), plus a runtime smoke of the gate against a production build.

Account layer: `supabase/tests/account.test.sql` (privileges for anon/authenticated on every table and function; isolation between users; favorites cap and hidden-location handling; rating aggregates incl. update/delete/account-deletion recompute; check-in distance/repeat/no stored coordinates; submission validation, residential/link rejection, unknown-field rejection, duplicate flag, pending cap, daily limit, never public; reports; deletion cascades) is mutation-checked (pending cap, residential guard, delete confirmation, anon grant, favorites cap, proximity, unknown fields). `packages/domain/src/account.test.ts` and `apps/mobile/src/account/api.test.ts` cover client rules and RPC wiring. `npm run test:e2e:auth` (real Chromium + local mock backend) also drives favorites, rating, check-in, report, submission, settings sync and account deletion, and asserts discovery and favorites requests carry no user token/coordinates.

Auth: `packages/domain/src/auth.test.ts` (feature gating, validation, generic errors, open-redirect and callback parsing), `apps/mobile/src/auth/authService.test.ts` (fake backend: email, Google, Apple nonce, callbacks, reset, sign-out) and `chunkedStorage.test.ts`; web smoke covers signed-out account/sign-in/favorites screens and that discovery needs no account. Live provider sign-in is a manual test (AUTH_SETUP.md).

Live checks (owner-run, public anon key only): `npm run doctor` (read-only: every table private to anon, every account function installed and refused to anon, discovery works, auth settings). Doctor probes tables with `select=*`, not `select=id`: profiles (PK user_id), favorites and review_observations (composite PKs) have no `id` column and answer 42703 before the permission check (regression-tested in account.test.sql). `npm run live:account` signs in with a TEST account you created in the app (LIVE_TEST_EMAIL/LIVE_TEST_PASSWORD) and exercises profile, favorites, rating/observations (restored afterwards), check-in refusal from afar, and with `-- --contribute` / `-- --delete` a report, submissions (attestation + residence refusals, pending never public) and account deletion. A real check-in must be tested in the app while at a restroom.

New-restroom policy and abuse controls: `supabase/tests/account.test.sql` (missing/NaN/0,0/out-of-range position, missing/zero/negative/NaN/over-50 m accuracy, coordinates smuggled in the payload, old signature gone, attestation, residence wording, links; near-listed (25 m / same name 100 m) and nearby pending proposals (own and other users') are ACCEPTED as separate raw rows and privately flagged (possible_duplicate_of, flags, duplicate_submission_ids; none visible to clients; response is only {submission_id}); an exact retry (same payload/fix/accuracy/note within 10 min) returns the same id and uses no hourly quota, while a request differing only in its note is its own proposal; legacy supporter table preserved and never written; 3/hour, daily and pending caps; repeat-rejection pause and its lift; each triage flag; one pending correction per restroom; pending items never public; anonymous discovery still works; service_role can still place/move coordinates) was mutation-checked (13 mutations) before the 20261008000001 policy repair; for the repair, removing the exact-retry return and replacing the global lock with the old per-cell lock were both caught. Community-only ratings: account.test.sql interleaves admin (apply_location_review_v2) and community writes (submit/update/delete) and checks admin-only places show no rating/count, stored aggregates are repaired by recompute, and admin history is preserved; review_visit_details.test.sql asserts admin ratings never reach the public aggregate. Two-session concurrency: `supabase/tests/concurrency.sh` (run by `npm run test:db`) holds one transaction open while a second session runs: two users reporting one place across a ~110 m rounding-cell boundary both get proposals and the later is flagged against the earlier; two community ratings plus one admin rating at once give count 2 / average 3 with no deadlock, and the admin rating stays history only. `npm run test:db` works on macOS (Postgres.app/Homebrew/pg_config discovery, or OPEN_STALL_PGBIN). `packages/domain/src/account.test.ts` covers fixProblem/buildProposal; `scripts/e2e-auth.mjs` drives the real UI (no location access, 500 m fix, missing name/attestation, residence, valid submit carrying the fix as separate arguments, a second nearby proposal sent as its own item with no merge/duplicate wording, corrections without location). `npm run live:account -- --contribute` checks the refusals on the live project without creating records; `--submit-new` creates one pending item.
