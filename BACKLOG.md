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
OS-101 DONE (migration written+validated locally; NOT pushed to remote) DB migrations: locations/amenities.
OS-102 DONE (local tests pass; remote push awaits human approval) RLS/public verified reads.
OS-103 DONE Location permission UX.
OS-104 DONE (provider-neutral MapView; Leaflet+configurable tiles; default OSM tiles dev-only) Map abstraction + map/list home.
OS-105 Nearby query/distance sort.
OS-106 Filters.
OS-107 Location detail.
OS-108 Navigation/deep links.
OS-109 Offline/cache.
OS-110 Discovery tests.
OS-111 HUMAN MVP-CORE CHECKPOINT.

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
OS-306 OSM-derived seed pipeline + attribution.
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
OS-608 HUMAN PRODUCTION RELEASE APPROVAL.

Do not silently pull future scope forward.
