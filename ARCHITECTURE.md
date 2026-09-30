# Architecture
Use a conventional transferable stack; avoid builder lock-in.

Preferred monorepo:
apps/mobile — Expo React Native + web where practical
apps/admin — Vercel admin
packages/domain — shared types/validation/business rules
packages/ui — shared tokens/components where practical
supabase/migrations, seed, functions
docs as needed

If Expo web satisfies consumer web well, do not create a redundant third frontend.

Supabase: Postgres system of record, Auth, RLS, functions only where needed, migrations in Git. Never expose service-role keys.

Separate location database, base-map/routing provider, and seed sources. OpenStreetMap-derived candidates are NOT automatically verified restrooms. Preserve source licensing/attribution.

Nearby query: PostGIS preferred at scale; documented Haversine fallback acceptable early.
Refresh on open/filter/location change and about every 180 seconds while active. No realtime sockets required.

Environments: local/dev and production initially; add staging when justified. Local automation must not target production by default.
Production deployment/migrations require human approval.
