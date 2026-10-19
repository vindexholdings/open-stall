# Backlog

Current authority/owner gates: see GOVERNANCE.md (2026-10-18 standing delegation). P1 corrections and independent PG16 validation are current; subsequent local P2–P4 are Work prerequisite/review gates, not renewed owner package approvals. Historical visual-pending and separate-package-owner-gate wording below is superseded by that register; D3 visual is approved, release QA is separate.
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
OS-209 DONE (UI + SQL + mock e2e tested; deletion in the real UI not exercised: the permanent test account is kept) Account deletion (typed DELETE; removes only never-moderated account data (moderated evidence is kept, submitter severed) [reconciled 2026-10-08; original OS-209 text said it cascaded all account data]).
OS-210 DONE (tests; live doctor + live:account --contribute passed 2026-10-06 after 20261008000001) SQL account suite (mutation-checked), domain/app tests, real-browser mock-backend e2e. Earlier note: live verification waited for the owner applying the migrations.

## Phase 3 Admin/data
OS-301 DONE-VALIDATED (Phase 3A; migrations 20261009000001-2 live; first admin active with verified TOTP; live decisions by admin verified read-only 2026-10-07; hosting NOT approved, admin app local-only) Admin authorization: admin_users + MFA (aal2) enforced inside every admin function, user session + @supabase/ssr, no service-role credential anywhere in the admin app. /review (seeded-location validator) now uses the same session + MFA model via the OS-301b functions (migration 20261010000001, live); the old local-only service-role gate is gone.
OS-302 DONE-VALIDATED (Phase 3A, live; queue used locally by the admin) Moderation queue foundation: /queue (submissions + reports), private flags, held items, immutable originals, append-only decisions. Seeded-location validator (/review) unchanged, see ADMIN_REVIEW.md.
OS-303 DONE-VALIDATED with limits (live: 1 reject + 1 report dismiss; hold/release/resolve/approve/duplicate covered by local tests only) approve / edit-and-approve / reject (6 codes) / duplicate-link / hold / release; report resolve/dismiss. Approval publishes UNVERIFIED only (approval != verification). Seeded-location review function + UI unchanged.
OS-301b CLOSED 2026-10-08/09 (Work): authenticated seeded-location review integration accepted after independent local validation; migration 20261010000001 applied live only under Jake's separate approval (read-only post-check passed); Jake observed /queue and /review load with his existing MFA admin account, expected records, no errors, nothing modified (OWNER-OBSERVED; Work did not inspect the browser or JWT). Live review-SAVE operations remain untested; page loading is not mutation-path coverage.
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
- Consumer UI/UX/accessibility redesign: R1/R2 closed, R3 functionally accepted, R4 integrated validation delivered locally (REDESIGN_DOD.md). Remaining before launch (owner/QA gates, not local work): Safari/Firefox, native iOS/Android runs, real screen-reader pass, tile-provider/ODbL decision.

## Dashboard-first milestone and VIP planning (owner-approved 2026-10-10; status 2026-10-11)
- Show/Hide Password: ACCEPTED locally (Work b556988).
- D1 dashboard-first home: technically reviewed; waits at Jake's visual checkpoint (Work presents it). Not design-accepted; no speculative further redesign before feedback.
- G1 VIP/rewards plan: design ACCEPTED as local planning evidence (Work 2a70b57 / f7ebdbf). Jake's rewards policy is APPROVED and recorded in `VIP_REWARDS_PLAN.md` section 2 and the section 9 policy matrix: NO cooldown; 4 rewarded visits per user/location/local day (+5 spendable each, +5 lifetime on the first); 60 spendable per user per UTC day (provisional); lifetime independent of the spendable cap; configurable/versioned/prospective; reversals never restore gross issuance; deletion approved subject to privacy/security review; 90-day provisional hold retention; optional GPS accuracy as a weak signal; existing MFA admins review holds. Global production budget UNSET, production rewards DISABLED.
- Next, in order: (1) owner iPhone feedback on the corrected D2 build -> bounded dashboard corrections (separate track, nothing speculative); (2) **G2 implementation specification delivered for Work review** (`VIP_REWARDS_PLAN.md` section 11); local-only G2 implementation (disposable Postgres only) starts only when Work authorizes it; no policy item waits on an owner decision any more; (3) G3 achievements/challenges specification, dependent on a correct earned-data model. Superseded: the 60-minute cooldown and the "G2 waits for ALL owner decisions" gate.
- Gates: reward activation and redemption (economics, cost, legal and accounting, integration); exterior photos are approved for PLANNING only, with the "no user-uploaded photos in v1" rule in CLAUDE.md still needing an explicit scope decision; no uploads, storage vendor or purchased assets.
- Device QA continues separately: redesigned-build iPhone checks (login unconfirmed), Android and TalkBack NOT RUN.
- D2 (owner-directed visual corrections): DELIVERED LOCALLY 2026-10-11 and technically reviewed by Work; the dashboard design is NOT ACCEPTED until Jake reviews the corrected build on his iPhone (pinned source 3e75528 is valid; 2a70b57 only adds the Add restroom label-in-name fix). The three G1 technical corrections and the metrics/label corrections are DONE (accepted by Work, 2a70b57).
- G1 second- and third-round technical corrections (Work 67f3dd2, 2446657): DONE and accepted as design/documentation evidence only (not implemented SQL, security or concurrency validation).
- G3 achievements/challenges/progress SPECIFICATION delivered 2026-10-11 as `ACHIEVEMENTS_PLAN.md` (planning only, all content proposals; awaiting Work review; no implementation, no UI, no activation). G2 planning accepted by Work and reconciled (`f822d9c`).
- G2 corrected planning ACCEPTED (Work 65103e2, `fdfd689`/`f822d9c`) and G3 specification ACCEPTED (Work ad52d11, `e9deba8`), both planning only. `REWARDS_IMPLEMENTATION_PROPOSAL.md` (2026-10-11) sequences P1 (G2 core, disposable Postgres, `supabase/rewards-wip/`, default-disabled) -> security/privacy review gate -> P2 (reversals/holds/purge/retention) -> P3 (G3 evaluation/progress) -> P4 (local mock UI). It is a proposal, NOT authorization; the exact P1 authorization text is in its section 9.
- OWNER GATE `OS-REWARDS-P1-LOCAL-AUTHORIZATION` (Work c5f8173): the rewards proposal is accepted as a planning proposal; Jake must authorize P1 (local core on disposable PostgreSQL 16, within proposal section 2 paths) before implementation starts. Work's technical constraints are reconciled in the proposal (section 10). P2/P3/P4 not authorized by P1. Implementation STOPPED until the gate is recorded.
- D3 (owner corrections, Work 4b420fd): DELIVERED LOCALLY 2026-10-11 (Details Features & Access, history-aware Back, filter sheet, 1 mi default radius with straight-line distances, icons); Corrected build ACCEPTED by Work for local engineering review (2026-10-12, `79886f8`); Owner iPhone VISUAL approval recorded 2026-10-17 (Work ba74a7c; checkpoint OS-D3-PINNED-IPHONE-UX closed; source `79886f8`; device/OS versions not supplied). Visual approval only: release readiness and every native functional, reader, large-text and login check stay OPEN (`MOBILE_QA.md` section 10); no further redesign. Not started and not authorized: community ratings/comments planning, turn-by-turn, monetization, paid maps (design/planning backlog only); rewards P1 (owner gate).
- Public community reviews (latest 2-3 with rating/comment): PLANNING ONLY, `PUBLIC_REVIEWS_FEASIBILITY.md` (2026-10-17), awaiting Work review. Not authorized to build: needs new schema (comments do not exist), moderation, legal and store UGC gates (Phase 3B), and a demand check first.
- Release-readiness verification (OPEN, not run by the visual approval): corrected-build iPhone and Android functional journeys, real D3 VoiceOver and TalkBack, native large text/safe areas/keyboard, QA-account sign-in and SecureStore lifecycle, native location and contribution recovery, then targeted final-source regression and the unresolved hosted/admin/MFA/security/privacy/map-licensing/provider/cost gates. Full matrix in `MOBILE_QA.md` section 10. No deployment, merge or live mutation is approved.
- Rewards P1 (`OS-REWARDS-P1-LOCAL-AUTHORIZATION`): AUTHORIZED by the owner (Work 90a07e8) and DELIVERED 2026-10-18 and CORRECTED after Work's reviews `d38b5df` and `758887d` (implementation `0e69c5f5adee5a36b4958c43b4b9c4919a099cea`, local disposable PostgreSQL 16 only, evidence in `docs/evidence/rewards/`). Not independently reproduced: Work has only PostgreSQL 18.3 (blocker OS-WORK-PG16-RUNTIME). P2 (reversals, holds, purge, retention) is the next proposed package and is NOT authorized; moving anything into `supabase/migrations/` is a separate approval and must wait for the P2 purge (account deletion).
