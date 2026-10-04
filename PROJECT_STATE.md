# Project State
Last updated: 2026-10-05 (OS-111: dev OSM dry run done; apply of saved capture approved, human-run)
Current phase: Phase 1 (Discovery core), complete pending human checkpoint
Current task: OS-111 NOT approved. Human approved APPLY of the saved Cody dev capture (osm-cody-dev.local.json; dry run: 2 tiles, 87 elements, 65 records = 9 explicit + 56 inferred, 21 unnamed candidates skipped, complete) as run "cody-dev". Awaiting apply result, then CHECKPOINT_OS-111.md Parts B-C
Branch: claude/pensive-brahmagupta-wrrhxn (draft PR vindexholdings/open-stall#1)
Last commit: see git log (OS-009 commit)

Completed:
- 2026-10-05 Dry run (human): cody-area, 2 tiles, 87 elements, 65 records (9 explicit, 56 inferred), 21 unnamed-candidate skipped, complete=true, no DB writes. Human approved applying the saved capture to the live project as dev run "cody-dev". Expected public (Unverified) = 9 minus any held (OSM edit < 14 days) or duplicate-flagged; 56 inferred stay hidden candidates; none can be Verified by import. Cleanup: supabase/dev/osm-dev-cleanup.sql.
- 2026-10-05 OSM dev-import prep (nothing run/imported): grocery/convenience + lodging added to hidden candidate categories; Overpass editor identity (user/uid/changeset) stripped before classification and before saved captures; tested DB cleanup supabase/dev/osm-dev-cleanup.sql (only unedited OSM-only candidate/unverified rows seen by *-dev runs); IMPORT.md section 11 documents plan + ODbL consequences. Importer 65 tests; DB suite passes incl. cleanup.
- 2026-10-05 REVISED OS-111 test data: externally researched UNVERIFIED records (Maverik 2321 Big Horn Ave, Conoco 1737 17th St, Exxon/Good 2 Go 1543 Depot Dr, Cody WY 82414). Tooling: census.ts (US Census Geocoder, public-domain coordinates), researchedLocations.ts (never Verified; cited non-map evidence; attestations), researchCli (`npm run research:sql`), os111-research-records.json template (unusable until evidence filled), scoped cleanup SQL. source "research", no schema change, no OSM/Google. Honest limit: no Verified record exists live, so Verified UI/hint/filter-with-results are covered by automated tests only. Manual first-party tooling not used for OS-111. Domain copy now says "public sources". Nothing written to the live DB by Claude.
- 2026-10-05: manual-record tooling for the OS-111 live test (no OSM): packages/importer manualLocations (strict validation, attestations of original observation + public access, max 3, atomic idempotent SQL, source "manual", no third-party license), `npm run manual:sql`, `npm run live:nearby` (anon-only read check), cleanup SQL (human-run). Denied/retry UX fix (always offer Try again; web guidance). Tests: importer 48, DB suite includes manual-entry SQL on a local Postgres. No data added to the live DB by Claude.
- 2026-10-04 CHECKPOINT: v3 migrations (20261004000001_locations, 20261004000002_public_access, 20261004000003_import_functions) applied to Open Stall Supabase (xzzbcejgprilmolvdaes) by the human; `npm run verify:remote-rls` passed all checks against the live project. Live DB has NO location data (no import run). Importer and licensing gate (OS-110c) unchanged.
- v3 (Opus review applied; nothing applied remotely): canonical locations + location_sources; no direct public table access (nearby_locations/get_public_location/nearest_verified_location, capped, trimmed fields); standardized+validated run bounds and end-to-end finalize contract test; finalize safety (complete flag, scope, mass-hide threshold, zero-seen guard); automatic manual-edit protection; conservative duplicate flagging (never merge); recent-OSM-edit hold; hours/fee fields; nearest-verified hint in UI; ODbL licensing gate documented (IMPORT.md section 7).
- Revision (approved scope change): migrations rewritten for verified/unverified/candidate visibility, column-level public grants, import_runs, service_role-only import_locations/finalize_import_run (no-overwrite of verified/pending/closed/admin-edited; idempotent; stale handling). Domain/UI: Unverified badge, markers, explanation, Verified-only filter. packages/importer: OSM classifier, Overpass tiling/retries, dry-run-by-default CLI with project-ref guards, importer-to-DB contract test. See IMPORT.md.
- Phase 1 (code complete, nothing pushed to remote DB): OS-101 locations migration, OS-102 RLS (anon/authenticated read verified only; no client writes), OS-103 location permission UX, OS-104 provider-neutral MapView (Leaflet, configurable tiles, default OSM tiles dev-only), OS-105 nearby bbox query + ranking (~180s refresh), OS-106 filters, OS-107 detail, OS-108 Apple/Google Maps links + deep link validation, OS-109 offline cache (public data only), OS-110 tests (domain, mobile, local DB/RLS, web smoke). No fake/sample locations anywhere in app or DB.
- OS-001 repo/remote verified. OS-002 Expo SDK 57 + TS strict + web in apps/mobile.
- OS-003 npm workspaces (apps/*, packages/*), root lockfile; packages/domain (zod coords, Haversine, rating/status/mode rules).
- OS-004 DONE: Supabase CLI 2.118.0; local config (storage off); ref xzzbcejgprilmolvdaes in ENVIRONMENT.md. Remote `supabase link` is a human step (DB password); not run. Supabase MCP here lacks permission on this project.
- OS-005 DONE: apps/admin Next.js 16 on Vercel project prj_aYX3LqJlAliTCo8leZYO7zlIk6SD. Root Directory set to apps/admin; human verified branch preview shows "Open Stall Admin". Production still 404 until PR #1 merges to main (main has no app).
- OS-010 DONE: architecture approved (Next.js admin on Vercel).
- OS-006 DONE: eas.json profiles; app.json bundleIdentifier/package com.vindexholdings.openstall, extra.eas.projectId 33614785-78d2-4c9c-9821-5d1341b21680. No `owner` set (add Expo account/org slug if EAS asks).
- OS-007 root ESLint (eslint-config-expo), .env.example (names only), scripts/check-secrets.mjs, `npm run check`; secrets rules in SECURITY.md.
- OS-008 .github/workflows/ci.yml: npm ci, lint, typecheck, test, secret check, web export on PRs/main.
- OS-009 packages/ui tokens (AA-contrast tested), Expo Router tabs shell (Nearby/Favorites/Settings) in apps/mobile/src/app, scheme "openstall".

Notes:
- Proxy blocks Expo API here; use EXPO_OFFLINE=1 for `expo install`/`expo export`.
- Brand blue #1E90FF fails AA with white text; use primaryStrong #0B63C4 for text/buttons.

Blockers (human):
- OS-111 approval. First data import approval (none requested yet). Device testing (iOS/Android) not done. Production tile provider decision. ODbL licensing gate before larger-scale import/public launch.

Next exact action:
Human: run the apply command from chat (replays the saved capture, --area-name cody-dev, project guard), send the printed counts, then run the SQL count check and CHECKPOINT_OS-111.md Parts B-C. Claude records results; OS-111 stays unapproved. No re-query, no geography expansion, no merge, production deploy or Phase 2.

Last tests: `npm run check` and `npm run test:db` pass (importer 65); web smoke passes.
Never infer IDs or reuse another Vindex resource.
