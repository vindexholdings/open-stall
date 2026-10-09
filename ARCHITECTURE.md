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

Data and licensing architecture (see IMPORT.md): canonical `locations` (Open Stall's records) are separate from `location_sources` (per-source provenance, license, attribution). External sources, including OpenStreetMap, are discovery/source layers feeding canonical records; they are not the owner of the canonical database. Separation aids provenance and future sources but does not remove ODbL/share-alike obligations; a human legal/licensing gate applies before commercial-scale OSM import, public launch with OSM-derived data, data licensing, or combining substantial OSM data with proprietary/community datasets.
Public clients access data only through constrained server functions (no direct table access). Distance uses a documented Haversine bounding-box approach inside those functions so PostGIS can replace it later without client changes.

Admin: apps/admin (Next.js) has three authenticated areas that share one identity model: /signin + /mfa (Supabase Auth, TOTP), /queue (community moderation) and /review (seeded-location validator). The app uses the public anon key plus the admin's own session; every capability is a SECURITY DEFINER `admin_*` SQL function that re-checks `admin_users` membership and JWT aal2 itself (`require_admin`). No service-role key exists in the admin app. The seeded-location functions (migration 20261010000001) are applied live (2026-10-08, owner-approved) and were locally tested; service_role-only `apply_location_review*` remain for importer/manual tooling. Hosting is not approved; run locally.

Auth (OS-201): apps/mobile has two Supabase clients: an anonymous discovery client (no session, location queries never identified) and a separate account client (PKCE, persisted session). Pure auth rules live in packages/domain/src/auth.ts; the testable service layer in apps/mobile/src/auth/authService.ts takes the client as an interface. Providers: email/password, Google (browser OAuth), Apple (native iOS ID token).
