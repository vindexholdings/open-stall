# Project State
Last updated: 2026-10-03 (Phase 0 complete)
Current phase: Phase 0 complete; Phase 1 awaiting human approval
Current task: none
Branch: claude/pensive-brahmagupta-wrrhxn (draft PR vindexholdings/open-stall#1)
Last commit: see git log (OS-009 commit)

Completed:
- OS-001 repo/remote verified. OS-002 Expo SDK 57 + TS strict + web in apps/mobile.
- OS-003 npm workspaces (apps/*, packages/*), root lockfile; packages/domain (zod coords, Haversine, rating/status/mode rules).
- OS-004 DONE: Supabase CLI 2.118.0; local config (storage off); ref xzzbcejgprilmolvdaes in ENVIRONMENT.md. Remote `supabase link` is a human step (DB password); not run. Supabase MCP here lacks permission on this project.
- OS-005 BLOCKED: apps/admin builds locally. Vercel project prj_aYX3LqJlAliTCo8leZYO7zlIk6SD has Root Directory = null (verified from Vercel bot PR metadata: isMonorepo true, rootDirectory null), so Vercel builds repo root (no framework/build script, empty output) -> 404 on prod AND preview. apps/admin/vercel.json is ignored until Root Directory = apps/admin. Prod 404 also because main has no app. "Success" status from Vercel is not proof of a working site.
- OS-010 DONE: architecture approved (Next.js admin on Vercel).
- OS-006 DONE: eas.json profiles; app.json bundleIdentifier/package com.vindexholdings.openstall, extra.eas.projectId 33614785-78d2-4c9c-9821-5d1341b21680. No `owner` set (add Expo account/org slug if EAS asks).
- OS-007 root ESLint (eslint-config-expo), .env.example (names only), scripts/check-secrets.mjs, `npm run check`; secrets rules in SECURITY.md.
- OS-008 .github/workflows/ci.yml: npm ci, lint, typecheck, test, secret check, web export on PRs/main.
- OS-009 packages/ui tokens (AA-contrast tested), Expo Router tabs shell (Nearby/Favorites/Settings) in apps/mobile/src/app, scheme "openstall".

Notes:
- Proxy blocks Expo API here; use EXPO_OFFLINE=1 for `expo install`/`expo export`.
- Brand blue #1E90FF fails AA with white text; use primaryStrong #0B63C4 for text/buttons.

Blockers (human):
- Vercel dashboard: Project Settings > Build and Deployment > Root Directory = apps/admin (keep "Include source files outside of the Root Directory" ON), Framework Preset Next.js, then redeploy. Verify preview shows "Open Stall Admin".
- Supabase local link postponed until a migration needs it (human decision 2026-10-03).

Next exact action:
After Vercel Root Directory fix and preview verified: await approval to merge PR #1 and start Phase 1. Do not start Phase 1 yet.

Last tests: `npm run check` (incl. admin lint/typecheck) pass; admin `next build` pass; mobile web export pass.
Never infer IDs or reuse another Vindex resource.
