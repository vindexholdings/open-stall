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
