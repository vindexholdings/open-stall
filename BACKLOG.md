# Backlog
Status: TODO | IN PROGRESS | BLOCKED | DONE

## Phase 0 Foundation
OS-001 DONE Verify dedicated repo/remote and isolation.
OS-002 DONE Scaffold Expo + TypeScript with web.
OS-003 DONE Establish workspace/shared domain structure.
OS-004 DONE Bind dedicated Supabase project/local config. (ref recorded; remote link run by human when migrations need pushing)
OS-005 DONE Bind dedicated Vercel project. (prj_aYX3LqJlAliTCo8leZYO7zlIk6SD; Root Directory apps/admin; preview verified by human 2026-10-03)
OS-006 DONE Bind Expo/EAS project/identifiers.
OS-007 DONE Env example, secrets rules, lint/typecheck/tests.
OS-008 DONE CI checks for PRs.
OS-009 DONE Design tokens/navigation shell.
OS-010 DONE HUMAN ARCHITECTURE CHECKPOINT (approved 2026-10-02: Next.js admin at apps/admin on Vercel).

## Phase 1 Discovery core
OS-101 DONE (v3 migrations LIVE on Open Stall Supabase; verified 2026-10-04) DB migrations: locations/amenities.
OS-102 DONE (no direct public table access; constrained public functions LIVE; `npm run verify:remote-rls` passed against live project) RLS/public reads.
OS-103 DONE Location permission UX.
OS-104 DONE (provider-neutral MapView; Leaflet+configurable tiles; default OSM tiles dev-only) Map abstraction + map/list home.
OS-105 DONE (bbox query via LocationSource + domain ranking; refresh ~180s) Nearby query/distance sort (now via server functions; live DB currently EMPTY, no data imported).
OS-106 DONE Filters (incl. Verified only).
OS-107 DONE Location detail (Report/Correct + Favorite deferred to Phase 2).
OS-108 DONE (Apple/Google Maps external links, destination-only; openstall://location/<uuid> deep link, id validated) Navigation/deep links.
OS-109 DONE (public verified data only; no position/area stored; 14-day expiry, 300 entries) Offline/cache.
OS-110 DONE (remote access-model verification passed) Discovery tests.
OS-110a DONE(LIVE) Three-state visibility + canonical/source split + constrained public functions + safety rules (approved scope change, Opus review applied).
OS-110b DONE(code; importer NOT run, no data imported) OSM importer pulled forward from OS-306 (reusable, idempotent, refreshable, guarded). No import without separate approval.
OS-110c HUMAN LEGAL/LICENSING GATE (ODbL): required before commercial-scale OSM import, public launch with OSM data, data licensing, or combining substantial OSM data with proprietary/community datasets.
OS-111 DONE (APPROVED by owner 2026-10-05; device/browser not recorded) HUMAN MVP-CORE CHECKPOINT.

## Phase 2 Accounts/contributions
OS-201 DONE for email/password (live validated 2026-10-05: signup, confirmation, login/logout, password reset, password saving). Google OAuth DEFERRED/not configured; Apple SKIPPED Auth email/Google/Apple. Discovery stays public; account features/contributions require sign-in.
OS-202 DONE (evaluated and DEFERRED, see AUTH_DECISIONS.md) Evaluate Yahoo SSO.
OS-203 DONE (live validated) Profile/preferences/modes: Settings (Plain/Risqué, default transport, display name), local-first, synced to the account.
OS-204 DONE (live validated) Favorites/free cap of 5 (premium raise later, OS-502).
OS-205 DONE (live validated; real on-site check-in still to be tried in the field) Ratings 1-5 + structured observations; check-ins verified within 150 m, position never stored.
OS-206 DONE (live: 20261007000001 applied and validated 2026-10-06) Submissions: NEW restrooms only from the contributor's CURRENT location (device fix, accuracy <= 50 m, no map pin, no arbitrary coordinates); corrections to existing restrooms need no location; pending only, never public, public-place attestation required, no photos. Admins keep manual placement/editing of coordinates (service_role / Phase 3).
OS-207 DONE (live validated) Reports with controlled issue types.
OS-208 DONE (live: 20261007000001 + correction 20261008000001 applied and validated 2026-10-06; thresholds in SECURITY.md) Private-residence heuristic, link/contact rejection, shared rate limiter, repeat-rejection pause, private duplicate flags. APPROVED POLICY (2026-10-05): proximity/name never rejects or merges a new proposal; each proposal stored separately and flagged for admin review; no coalescing/supporters; exact own retry idempotent.
OS-208a DONE (live: 20261008000001 applied 2026-10-06; 0 aggregate mismatches) Community ratings drive the public average/count; admin ratings are history/provenance only; existing aggregates recomputed from community rows. Admin verification/observations still establish location facts.
OS-208b BACKLOG (observability/tuning, no behavior change now) Loose thresholds to revisit with market evidence: 3/hour, 5/day (shared with corrections), 5 pending new / 10 pending, 50 m accuracy (indoor GPS friction: malls/airports), pause ratio. Add denial/flag telemetry only privacy-safely when an analytics decision is made. Admin queue (Phase 3) must surface flags/possible_duplicate_of/duplicate_submission_ids. Facility/unit schema stays deferred (OS-308 context). Product question for owner: should a one-user, one-place repeat of different content be capped more tightly than the global caps? (not changed).
OS-209 DONE (UI + SQL + mock e2e tested; deletion in the real UI not exercised: the permanent test account is kept) Account deletion (typed DELETE; cascades all account data).
OS-210 DONE (tests; live doctor + live:account --contribute passed 2026-10-06 after 20261008000001) SQL account suite (mutation-checked), domain/app tests, real-browser mock-backend e2e. Earlier note: live verification waited for the owner applying the migrations.

## Phase 3 Admin/data
OS-301 DONE-VALIDATED (Phase 3A; migrations 20261009000001-2 live; first admin active with verified TOTP; live decisions by admin verified read-only 2026-10-07; hosting NOT approved, admin app local-only) Admin authorization: admin_users + MFA (aal2) enforced inside every admin function, user session + @supabase/ssr, no service-role credential in the new admin routes. The older local validator (/review) still uses its local-only service-role gate.
OS-302 DONE-VALIDATED (Phase 3A, live; queue used locally by the admin) Moderation queue foundation: /queue (submissions + reports), private flags, held items, immutable originals, append-only decisions. Seeded-location validator (/review) unchanged, see ADMIN_REVIEW.md.
OS-303 DONE-VALIDATED with limits (live: 1 reject + 1 report dismiss; hold/release/resolve/approve/duplicate covered by local tests only) approve / edit-and-approve / reject (6 codes) / duplicate-link / hold / release; report resolve/dismiss. Approval publishes UNVERIFIED only (approval != verification). Seeded-location review function + UI unchanged.
OS-304 Duplicate review/merge.
OS-305 CSV import/export.
OS-306 PARTIAL (core importer built in OS-110b) OSM-derived seed pipeline + attribution.
OS-307 Admin analytics.
OS-308 DATA QUALITY (not started; Phase 3, no geography expansion) Enrich generic names: several legitimate Cody records (municipal properties, parks, public restroom facilities) display only as "Restroom". Replace with descriptive names ("[Park Name] Restroom", "[Facility Name] Public Restroom") using authoritative City of Cody / Park County facility or property data where licensing allows (check terms/public-record status first). Keep the original name and source/provenance in location_sources, record the enrichment as its own source, go through the admin review/audit path, and NEVER invent a name when no authoritative source exists.
OS-310 DATA MODEL PLANNING ONLY (not authorized to build; no schema change now) Separate FACILITY/LOCATION (address, place, hours, access) from individual RESTROOM UNITS; one facility (mall, airport, park, campus, large store, venue) can hold several units. Unit attributes to plan: toilet/stall count, urinal count, sink count, single-user/private room vs multi-user room, partitions/dividers, locking door, family restroom, privacy/layout, accessibility characteristics, gender/type. Counting rule: one room behind one door is ONE unit regardless of fixtures (a men's single room with one toilet and one urinal behind one locking door is one unit, not two). Today each submission/location row is effectively one unit; possible_duplicate_of/duplicate_submission_ids are the admin hooks for grouping later.
OS-309 Moderation retention (not started; with OS-301/OS-302): define how long submitter linkage, capture_accuracy_m and triage flags are kept after a submission is approved/rejected (default proposal: unlink the submitter and drop the accuracy/flags within 30 days of review) and surface submissions.flags in the review queue (sort by flag).

## Phase 4 Community
OS-401 Points ledger.
OS-402 Achievements.
OS-403 Leaderboards.
OS-404 Referrals/abuse protection.
OS-405 Activity feed.
OS-406 Sharing/deep links.

## Phase 5 Monetization
OS-501 Ads abstraction.
OS-502 Premium entitlement.
OS-503 Apple/Google billing.
OS-504 Stripe web.
OS-505 Paywall.
OS-506 Monetization tests.

## Phase 6 Release
OS-601 Analytics/privacy.
OS-602 Notifications.
OS-603 Legal-page hooks.
OS-604 Accessibility audit.
OS-605 Security/RLS audit.
OS-606 Performance/release tests.
OS-607 Store readiness.
OS-608 HUMAN PRODUCTION RELEASE APPROVAL (requires OS-110c ODbL/licensing sign-off).

Do not silently pull future scope forward.

## Oversight follow-up — 2026-10-05 (status after the Claude recovery pass)
- RESOLVED (applied live 2026-10-06): OS-206/208 hold. Proximity no longer rejects/merges (20261008000001); one global lock replaces the per-cell lock, so the cross-cell race is gone (two-session test in supabase/tests/concurrency.sh). Caps/indoor GPS friction and privacy-safe observability remain open as OS-208b; no thresholds changed.
- RESOLVED: OS-210 SQL privilege assertion now uses the installed 15-argument apply_location_review (plus apply_location_review_v2); scripts/test-db.sh and the e2e Chrome lookup run on macOS.
- Full UI/UX/accessibility redesign remains planned after core functionality/data/admin stabilization and before launch; no isolated polish now.
