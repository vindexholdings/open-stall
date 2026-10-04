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
OS-111 HUMAN MVP-CORE CHECKPOINT: NOT APPROVED, BLOCKED on live E2E test with 1-3 manual records (CHECKPOINT_OS-111.md). No OSM import; Phase 2 not started.

## Phase 2 Accounts/contributions
OS-201 Auth email/Google/Apple.
OS-202 Evaluate Yahoo SSO.
OS-203 Profile/preferences/modes.
OS-204 Favorites/free cap.
OS-205 Ratings/check-ins.
OS-206 Location/edit submissions.
OS-207 Reports.
OS-208 Private-residence/abuse safeguards.
OS-209 Account deletion.
OS-210 Security/contribution tests.

## Phase 3 Admin/data
OS-301 Admin authorization.
OS-302 Moderation queue.
OS-303 Approve/reject/edit.
OS-304 Duplicate review/merge.
OS-305 CSV import/export.
OS-306 PARTIAL (core importer built in OS-110b) OSM-derived seed pipeline + attribution.
OS-307 Admin analytics.

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
