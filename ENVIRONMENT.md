# Project Bindings — NO SECRETS
GitHub organization: Vindex Holdings organization
Repository: open-stall
Expected remote: https://github.com/vindexholdings/open-stall (verified OS-001)

Supabase organization: Vindex organization
Project: Open Stall
Project ref: xzzbcejgprilmolvdaes (approved 2026-10-02)
API URL: https://xzzbcejgprilmolvdaes.supabase.co
Local `supabase link` intentionally POSTPONED until the first migration needs it (human decision 2026-10-03). Command when needed (human, prompts for DB password): npx supabase link --project-ref xzzbcejgprilmolvdaes

Vercel team: Vindex team
Project: Open Stall web/admin
Project ID: prj_aYX3LqJlAliTCo8leZYO7zlIk6SD (approved 2026-10-03)
Root Directory: apps/admin (set in dashboard; branch preview verified by human 2026-10-03 shows "Open Stall Admin")
Production: serves main, which has no app until human-approved merge of PR #1 (expect 404 until then)
Production branch: main (has no app until a human-approved merge)

Expo organization/account: approved Vindex account
Project: Open Stall
Expo project ID: 33614785-78d2-4c9c-9821-5d1341b21680
iOS bundle ID: com.vindexholdings.openstall
Android package: com.vindexholdings.openstall

Put variable NAMES only in .env.example. Secrets stay in approved local/provider secret stores.
If actual CLI/project bindings do not match this file, STOP. Never pick the closest project.

Map tiles: configurable via EXPO_PUBLIC_MAP_TILE_URL / EXPO_PUBLIC_MAP_ATTRIBUTION (names only in .env.example).
Default public OSM tile server is DEVELOPMENT ONLY (OSM tile policy). Production tile provider = human decision (no paid service without approval).
Navigation: Apple Maps / Google Maps are external destinations only (OS-108); no map SDK keys used.

Supabase migrations applied (by human, 2026-10-04): 20261004000001_locations, 20261004000002_public_access, 20261004000003_import_functions. Remote access model verified with `npm run verify:remote-rls`. Cody dev import finalized: 65 records; 9 initially public Unverified and 56 initially hidden Candidate.

Admin migrations `20261005000001_location_reviews.sql` and `20261005000002_review_visit_details.sql` are applied (2026-10-04). Visit details are admin-only; public review browsing remains gated. Private notes are not converted to public comments. Local admin identity defaults to `local-admin`; optional `ADMIN_REVIEWER_ID` is independent of display username. OS-111 remains unapproved.

## Local customer-app configuration
The approved public publishable key is saved in `apps/mobile/.env.local` (ignored by Git). Reuse this file on future sessions; do not ask Jake for the key again while it exists. The legacy variable name `EXPO_PUBLIC_SUPABASE_ANON_KEY` accepts this public publishable key. Never substitute the admin service-role key. Run public API checks from the repo root with `node --env-file=apps/mobile/.env.local scripts/verify-remote-rls.mjs`.
