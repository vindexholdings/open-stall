# Backlog
Status: TODO | IN PROGRESS | BLOCKED | DONE

## Phase 0 Foundation
OS-001 DONE Verify dedicated repo/remote and isolation.
OS-002 DONE Scaffold Expo + TypeScript with web.
OS-003 DONE Establish workspace/shared domain structure.
OS-004 PARTIAL Bind dedicated Supabase project/local config. — PARTIAL: local config done; remote link BLOCKED on Supabase project ref
OS-005 BLOCKED Bind dedicated Vercel project. — BLOCKED: needs Vercel project + admin app (OS-010 decision)
OS-006 PARTIAL Bind Expo/EAS project/identifiers. — PARTIAL: eas.json profiles added; BLOCKED on Expo project ID, iOS bundle ID, Android package
OS-007 TODO Env example, secrets rules, lint/typecheck/tests.
OS-008 TODO CI checks for PRs.
OS-009 TODO Design tokens/navigation shell.
OS-010 TODO HUMAN ARCHITECTURE CHECKPOINT.

## Phase 1 Discovery core
OS-101 DB migrations: locations/amenities.
OS-102 RLS/public verified reads.
OS-103 Location permission UX.
OS-104 Map abstraction + map/list home.
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
