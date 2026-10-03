# Project State
Last updated: 2026-10-04 (Phase 1 revised: three-state visibility + OSM importer; HUMAN GATE: migration push + import)
Current phase: Phase 1 (Discovery core)
Current task: HUMAN GATE before OS-111: approve first remote migration push; then OS-111 checkpoint
Branch: claude/pensive-brahmagupta-wrrhxn (draft PR vindexholdings/open-stall#1)
Last commit: see git log (OS-009 commit)

Completed:
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
- None. Supabase local link postponed until first migration requires it (human decision). PR #1 NOT to be merged until human approves.

Next exact action:
Human: review IMPORT.md (visibility rules + import plan) and approve (1) pushing 3 migrations in supabase/migrations to xzzbcejgprilmolvdaes, then `npm run verify:remote-rls`; (2) a dry-run, then apply, of the OSM import for cody-area (operator machine; sandbox cannot reach Overpass/Supabase). Then OS-111 checkpoint. Nothing applied remotely yet.

Last tests: `npm run check` pass (domain 40, mobile 7, importer 30, ui 15); `npm run test:db` pass (RLS, merge rules, importer contract; mutation-checked); `npm run test:e2e` pass.
Never infer IDs or reuse another Vindex resource.
