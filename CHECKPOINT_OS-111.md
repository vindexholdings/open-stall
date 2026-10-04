# OS-111 Human MVP-Core Checkpoint (Phase 1)

Status 2026-10-04: code complete, backend LIVE, live database EMPTY (no import has run). Approve or redirect before Phase 2.

## What exists and is verified
- Backend (live): canonical `locations` + `location_sources`; no direct public table access; `nearby_locations`, `get_public_location`, `nearest_verified_location` (capped, trimmed fields); service-role-only import/finalize functions. Verified live by `npm run verify:remote-rls` (all checks passed).
- App (web/iOS/Android code): location permission flow, map + distance-sorted list, filters (incl. Verified only), detail with access facts/hours/fee/attribution, Apple/Google Maps navigation, offline cache, Verified/Unverified badges, "Nearest verified" hint.
- Importer (not run): guarded OSM importer, dry-run default.
- Tests: `npm run check` (lint, typecheck, domain 43, mobile 9, importer 37, ui 15, secret scan), `npm run test:db` (local Postgres, mutation-checked), `npm run test:e2e` (web smoke), web/android/admin builds.

## NOT yet proven (be honest about MVP readiness)
1. The app has never run against the live Supabase project with real rows: with an empty database it shows "No restrooms found nearby yet." Needs data to validate the end-to-end find-nearest flow.
2. No iOS/Android device testing (permission prompts, WebView map, deep links, Apple Maps handoff).
3. Map tiles use the public OSM tile server (development only). A production tile provider needs a decision (no paid service without approval).
4. Real-device accessibility audit (screen reader, large text) is Phase 6; basic roles/labels/targets are in place.
5. Admin app is a placeholder; verification/moderation tooling is Phase 3, so nothing can become Verified yet except by direct admin database edit.
6. Supabase CLI link/local `supabase db reset` run on the real stack was not done in the sandbox (CI tests use plain Postgres 16).

## Manual checks for the human (about 20 minutes)
1. Set `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` (public values) in `.env.local`, run `npx expo start`, open web and a phone (Expo Go works for the map WebView).
2. Allow location: confirm map + empty-state message. Deny location: confirm the Settings/retry path.
3. Optional data test: insert ONE real, known public restroom you have personally confirmed via the Supabase dashboard (status 'verified', restroom_verified true, last_verified_at set). Confirm it appears; confirm distance, Navigate (Google/Apple), detail, offline banner (airplane mode after one load). Remember dashboard edits auto-mark the record as manually edited (protected from importers).
4. Confirm an `unverified` row needs explicit evidence (the database will refuse otherwise).

## Decisions requested
- Approve OS-111 (Phase 1 complete) and Phase 2 start, or list changes.
- Approve a small development OSM dry run (Cody area) on your machine, then a small apply? (OS-110c licensing gate still governs anything larger or public.)
- Merge PR #1 to main / production web deploy: not requested, not done.
