# Security / Privacy / Moderation
Never commit secrets or expose Supabase service-role key. Use RLS and least privilege. Validate privileged actions server-side. Production changes need approval.
Prefer ephemeral precise user location; do not persist unless a defined feature requires it. Avoid analytics tying precise coordinates to identifiable users.
All user-added locations/edits stay pending until moderation.
Private-residence controls: warning, place/address checks where feasible, residential flagging, admin review, takedown/report. Automation is not a guarantee.
Favor structured factual reports. Moderate any free text. Maintain admin audit trail and correction/dispute path.
Use Supabase Auth, secure redirects/deep links, independent admin authorization.
Billing entitlements must rely on trusted provider/server state.
Abuse-control submissions, check-ins, referrals, points, reports and account creation as needed.
Before launch: Terms, Privacy, Community Guidelines, data-source licensing/attribution review, store privacy disclosures.

## Secrets rules (OS-007)
- `.env.example` lists variable NAMES only; real values live in `.env.local` (git-ignored) or provider secret stores.
- `EXPO_PUBLIC_*` values are bundled into clients and are public; only the Supabase URL and anon/publishable key may use it.
- Service-role/secret keys are server/admin only and must never carry a public prefix.
- `npm run check:secrets` scans tracked files; it runs in `npm run check` and CI.
- Public data access: clients have NO direct table access. They call constrained SECURITY DEFINER functions (nearby_locations, get_public_location, nearest_verified_location) that return only verified or explicit-evidence unverified rows and a trimmed field set; inputs are validated and capped. See IMPORT.md.
- Importer uses the service-role key only on an operator machine via env; it is never committed, logged, or shipped to clients. Apply requires matching ENVIRONMENT.md ref plus --confirm-project. Import/finalize functions are service_role-only and enforce no-overwrite of verified/pending/closed/edited records, duplicate flagging (never auto-merge), a recent-edit hold, and mass-hide thresholds.
- Licensing gate (ODbL): OSM-derived data is kept in location_sources with provenance/attribution, but separation does not remove share-alike obligations. Human approval after legal review is required before commercial-scale OSM import, public launch with OSM-derived data, data licensing/sharing, or combining substantial OSM data with proprietary/community/commercial datasets (IMPORT.md section 7).
- Known accepted risks: scraping by sampling many points is possible but capped per call; OSM names/hours are unmoderated source text (shown as such); map queries reveal approximate location to Supabase logs (disclose in privacy policy).
- Manual records: first-party on-site observations only (source 'manual'); the generator requires attestations that data is original and the restroom is public (not a residence), caps the count, and never connects to a database. Cleanup SQL is human-run and scoped to manual dev-test records.
- Researched dev records (OS-111): UNVERIFIED only, provenance in location_sources, no map-database content, coordinates from the public-domain US Census Geocoder; the generator never connects to our database and cleanup SQL is human-run and scoped to os111 records.
