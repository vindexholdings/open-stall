# Project State
Last updated: 2026-10-04 (Phase 1 OS-101..110 built; HUMAN GATE: migration push)
Current phase: Phase 1 (Discovery core)
Current task: HUMAN GATE before OS-111: approve first remote migration push; then OS-111 checkpoint
Branch: claude/pensive-brahmagupta-wrrhxn (draft PR vindexholdings/open-stall#1)
Last commit: see git log (OS-009 commit)

Completed:
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
Human: approve pushing supabase/migrations (20261004000001_locations.sql, 20261004000002_locations_rls.sql) to project xzzbcejgprilmolvdaes. After push run `npm run verify:remote-rls` (needs public URL+anon key in env), then OS-111 MVP-core checkpoint. Real-location import (OSM candidates) needs separate approval; Overpass/Supabase are blocked from the cloud sandbox so import/push run on the human machine.

Last tests: `npm run check` pass (domain 38, mobile 7); `npm run test:db` pass (local throwaway Postgres 16); `npm run test:e2e` pass (headless Chrome); web + android exports compile.
Never infer IDs or reuse another Vindex resource.
