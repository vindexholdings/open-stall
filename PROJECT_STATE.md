# Project State
Last updated: 2026-10-02 (OS-004..006)
Current phase: Phase 0
Current task: OS-005 (blocked on Vercel project ID). OS-010 approved.
Branch: claude/pensive-brahmagupta-wrrhxn (draft PR vindexholdings/open-stall#1)
Last commit: see git log (OS-009 commit)

Completed:
- OS-001 repo/remote verified. OS-002 Expo SDK 57 + TS strict + web in apps/mobile.
- OS-003 npm workspaces (apps/*, packages/*), root lockfile; packages/domain (zod coords, Haversine, rating/status/mode rules).
- OS-004 DONE: Supabase CLI 2.118.0; local config (storage off); ref xzzbcejgprilmolvdaes in ENVIRONMENT.md. Remote `supabase link` is a human step (DB password); not run. Supabase MCP here lacks permission on this project.
- OS-005 PARTIAL: apps/admin Next.js 16 (App Router, TS, ESLint, noindex, uses @open-stall/ui); builds; CI builds it. Vercel project not created.
- OS-006 DONE: eas.json profiles; app.json bundleIdentifier/package com.vindexholdings.openstall, extra.eas.projectId 33614785-78d2-4c9c-9821-5d1341b21680. No `owner` set (add Expo account/org slug if EAS asks).
- OS-007 root ESLint (eslint-config-expo), .env.example (names only), scripts/check-secrets.mjs, `npm run check`; secrets rules in SECURITY.md.
- OS-008 .github/workflows/ci.yml: npm ci, lint, typecheck, test, secret check, web export on PRs/main.
- OS-009 packages/ui tokens (AA-contrast tested), Expo Router tabs shell (Nearby/Favorites/Settings) in apps/mobile/src/app, scheme "openstall".

Notes:
- Proxy blocks Expo API here; use EXPO_OFFLINE=1 for `expo install`/`expo export`.
- Brand blue #1E90FF fails AA with white text; use primaryStrong #0B63C4 for text/buttons.

Blockers (human):
- Vercel project for apps/admin: create and provide project ID (OS-005).

Next exact action:
Record Vercel project ID in ENVIRONMENT.md, mark OS-005 DONE; then await approval for Phase 1.

Last tests: `npm run check` (incl. admin lint/typecheck) pass; admin `next build` pass; mobile web export pass.
Never infer IDs or reuse another Vindex resource.
