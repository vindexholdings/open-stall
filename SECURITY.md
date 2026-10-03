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
- Importer uses the service-role key only on an operator machine via env; it is never committed, logged, or shipped to clients. Apply requires matching ENVIRONMENT.md ref plus --confirm-project.
- Imported OSM data (ODbL): keep attribution; include share-alike/derived-database review in the pre-launch licensing review.
