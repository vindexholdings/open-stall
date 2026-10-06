# HANDOFF — Open Stall coordination layer

Persistent coordination state between **Jake (owner / product approval)**, **ChatGPT (product + architecture oversight)** and **Claude Code (primary builder)**.
Rules: each party edits only its own section (Jake may edit any). Canonical project truth stays in PROJECT_STATE.md, BACKLOG.md, SECURITY.md, DATABASE.md, TESTING.md; this file is for status, instructions and review exchange, not a second copy of them. Read CHATGPT REVIEW before resuming after any review gate.

---

# CURRENT PROJECT STATE

- **Repo:** vindexholdings/open-stall (https://github.com/vindexholdings/open-stall)
- **Active branch:** `claude-local` (source of truth). Do NOT merge the old `claude/pensive-brahmagupta-wrrhxn` branch into it. PR #1 is still open and unmerged; `main` has no app.
- **Reviewed HEAD:** `ac11004` (see CLAUDE HANDOFF); created on top of `f016638` "Record successful Phase 2 live validation".
- **Live migration state (Supabase project `xzzbcejgprilmolvdaes`):** applied and ledger-aligned through `20261008000001` — i.e. 20261004000001-3, 20261005000001-2, 20261006000001-3, 20261007000001, 20261008000001. Nothing pending. (Source: PROJECT_STATE.md, 2026-10-06.)
- **Current phase:** Phase 2 (accounts/contributions) COMPLETE and live-validated (doctor + permanent-account `live:account --contribute` passed). Phase 3 / OS-301 NOT started.
- **Current authorized scope (Jake, 2026-10-06):** the smallest coherent Phase 3A described in CHATGPT REVIEW is authorized for Claude after it acknowledges this handoff. Local implementation, source migrations, testing, debugging, and ordinary commits/pushes to claude-local are authorized within that scope. Live database changes, deployment and merges remain gated. ChatGPT Work owns coordination/review, not product implementation.
- **Standing environment facts:** permanent test account exists — never delete it. Google OAuth deferred/not configured; Apple skipped; Yahoo evaluation-only. Geography stays Cody-area. No paid services. No `npm audit fix`.
- **Access note (2026-10-06):** this Claude session is the cloud container (`/home/user/open-stall`), with GitHub access to this one repo. It has no Supabase CLI login/link, no Vercel CLI, and the Supabase MCP is bound to a different Vindex project (do not use). Live-database steps therefore need Jake's Mac (or a session with the Open Stall Supabase link).

---

# OWNER DECISIONS

Durable decisions already made. Do not silently overwrite; to change one, record the change here with date and who decided.

**Product principles**
- Open Stall is "GasBuddy for bathrooms": fast, simple, fun; nearest usable restroom.
- Public discovery works WITHOUT authentication. Accounts are for contribution and personalization.
- Accessibility is a first-class requirement. Low contributor friction.
- Preload useful data; keep honest verification, provenance and privacy. Pending submissions are never public. No user-uploaded photos in v1.
- Current UI is functional scaffolding. A full UI/UX/accessibility redesign comes after core functionality, data model and admin systems are stable (and before launch). No isolated polish before then.

**Contributions and abuse (2026-10-05/06)**
- A NEW restroom by a normal user must be submitted from their CURRENT location (device fix); normal users cannot place a restroom arbitrarily on a map. Admins/importers keep manual coordinate placement. Corrections to EXISTING restrooms do not require physical presence. GPS is an abuse-reduction signal, not proof. A public-place / not-private-home attestation is required.
- Nearby restroom proposals are NOT rejected or merged just for being close (malls, airports, parks, campuses, large stores, venues can hold several units). Likely duplicates are flagged privately for admin review; provenance preserved; hidden/pending info never exposed publicly. A near-identical repeat by the same account may be suppressed.
- Anti-abuse stays relatively LOOSE at first; thresholds (e.g. 3/hour, 5/day, caps, 50 m accuracy) are tunable starting values, not product assumptions (BACKLOG OS-208b). No invasive device fingerprinting; no paid anti-abuse services.

**Ratings and trust**
- Community/user ratings alone determine the public rating average and count. Admin ratings/observations stay as history/provenance and never affect the public rating/count; an admin-only place shows no community score.
- One public "Verified" concept; the backend retains whether the origin was admin or user. Repeat visits count as history/recency, not extra unique people. Public comments page deferred; private notes stay private.

**Data**
- Generic names ("Restroom") get enriched only from authoritative sources with provenance; never invent names (BACKLOG OS-308).
- Future (planning only, do not build): separate FACILITY/LOCATION from individual RESTROOM UNITS (BACKLOG OS-310). A single-room restroom with one toilet and one urinal behind one locking door is ONE unit.
- OSM-derived data stays subject to the ODbL gate (OS-110c) before larger imports or public launch.

**Process**
- Roles: Jake = owner/approval; ChatGPT = product + architecture oversight; Claude Code = primary builder (Sonnet unless approved otherwise). ChatGPT Work is the oversight/review/coordination layer in the normal development loop; GitHub and HANDOFF.md are the persistent shared communication layer. Routine implementation, testing, debugging and commits inside approved scope should not require Jake to relay messages.

---

# CLAUDE HANDOFF

**Handoff status: NEEDS_CHATGPT_REVIEW**

**Reviewed commit:** `ac110047c536735beb163e444ec372c62f6438b5` ("Activate GitHub coordination and record approved Phase 3A handoff") — the remote `origin/claude-local` HEAD whose CHATGPT REVIEW and usage/cost rule I read in full. Working checkout fast-forwarded to it; no local work was lost.

**Acknowledgment (2026-10-06)**
- **CHATGPT REVIEW:** read; status AUTHORIZED_AWAITING_CLAUDE_ACKNOWLEDGMENT; now acknowledged. I will not overwrite it.
- **Audit findings:** noted as owner-supplied (admin is local/service-role only with no real identity; submissions lack durable decisions/reviewer identity/hold/duplicate/result links; reports lack moderator provenance; no moderation log; account deletion can destroy decided provenance; duplicate vs rejection not distinct; originals not protected as immutable). Community-review history-in-place is noted but is Phase 3B-adjacent and NOT in scope.
- **Nine decisions:** (1) user session + server-side `admin_users`, no user-metadata authority, hosted admin never needs a service-role key; (2) MFA/AAL2 for admin capabilities using free Supabase MFA, blocker not spend; (3) deletion preserves decided evidence/decisions, severs/anonymizes identity; (4) no self-adjudication of own submissions/reports; (5) approval may publish but stays UNVERIFIED, approval != verification; (6) held items keep counting toward pending caps; (7) rejection codes private_or_residential, not_public_or_not_a_restroom, insufficient_or_unverifiable, invalid_or_inaccurate, spam_or_abuse, other (note required); duplicate is a separate resolution; (8) field semantics as written (closed = permanent; temporary closure/access directions/discoverability/cleaning are evolving/temporal evidence; restroom_type deferred to OS-310; no automatic Verified aging, keep last_verified_at); (9) @supabase/ssr OK if free; build/test admin auth + queue; NO hosting/deployment.
- **Scope:** smallest coherent Phase 3A foundation only (OS-301 admin auth + MFA, queue, immutable originals, append-only decisions, approve / edit-and-approve / reject / duplicate-link / hold, report resolution, deletion provenance, tests). No Phase 3B, no reputation algorithm, no destructive consolidation, no facility/unit restructure.
- **Consequential gates:** I stop (NEEDS_CONSEQUENTIAL_APPROVAL) before any live migration/mutation, deployment, merge, destructive op, force-push/history rewrite, cost, credentials only Jake has, unresolved product decision, or scope expansion. Source migrations are written and tested locally only; I do not apply them live. I do not merge `claude/pensive-brahmagupta-wrrhxn` or PR #1.
- **Usage/cost rule:** acknowledged as a hard limit. I have NO authority to buy tokens, usage, credits, API capacity, overages, subscription changes or paid workarounds. I work only within the included allowance, read targeted files, and if approaching/reaching the limit I will checkpoint, commit/push safe work, update this section and set **NEEDS_USAGE_RESET**. Hitting a limit never grants authority to spend.

**Smallest implementation sequence (local only; each step committed + pushed to claude-local after targeted tests)**
1. **Admin identity (migration `20261009000001`)**: `admin_users` (+ bootstrap by Jake/SQL only, never by app), `is_admin()` = listed, not disabled, and JWT `aal = aal2` (MFA); append-only `moderation_log`; admin functions are SECURITY DEFINER, granted to `authenticated`, and re-check admin + AAL2 inside; no table access for clients. Test stub gets `auth.jwt()`.
2. **Moderation core (migration `20261009000002`)**: originals immutable (trigger blocks edits to `proposed`/submitter/position/attestation); append-only `moderation_decisions` (decision, reason code, note, reviewer, result location, duplicate link); `held` status that still counts toward caps; self-adjudication blocked; approve / edit-and-approve create the location as UNVERIFIED with community-origin provenance (never Verified); reject with the seven-code list (`other` needs a note); duplicate = separate resolution; report resolution with provenance.
3. **Deletion/provenance (same migration set)**: `delete_my_account` removes undecided data but keeps decided submissions/reports/decisions with the submitter identity severed (nullable FK → null), plus tests.
4. **Admin app**: `@supabase/ssr` session sign-in, MFA enroll/verify (AAL2 gate), middleware, functional review-queue UI (list, detail, decision forms) using only the user session — no service-role key. Existing local validator stays as-is. Build/test only; no hosting.
5. **Tests + docs**: SQL (authorization, MFA/AAL2, self-adjudication, privacy/no leakage, immutability, decisions, held caps, unverified-on-approve, deletion/provenance, mutation checks), domain + admin unit tests, e2e where cheap; reconcile PROJECT_STATE/BACKLOG/SECURITY/DATABASE/TESTING/ADMIN_REVIEW; record migration list for Jake's live review.

**Work completed — Phase 3A implementation (all local; committed to claude-local; NOTHING applied live, deployed or merged)**
1. `supabase/migrations/20261009000001_admin_identity.sql`: `admin_users` (owner-SQL bootstrap only; `disabled_at`), internal `require_admin()` = listed + not disabled + JWT `aal2`, `am_i_admin()`, append-only `moderation_log`.
2. `supabase/migrations/20261009000002_moderation_core.sql`: immutable original submissions (trigger), append-only `moderation_decisions` (reviewer id, reason code, note, edits, result/duplicate links), `admin_list_submissions`, `admin_list_reports`, `admin_decide_submission` (approve, edit_approve, reject with the six codes + `other` needs note, duplicate = separate status/link, hold/release), `admin_resolve_report`, self-adjudication blocked, approval creates a public but UNVERIFIED restroom with a `community_submission` source row (never Verified), approved corrections applied via the manual-edit path, held items stay `pending` (still count toward caps; cannot be withdrawn), `delete_my_account` keeps decided submissions/reports/decisions with `user_id` NULL and removes undecided/held items; active admins must be disabled by the owner before deleting.
3. Admin app (`apps/admin`): `/signin`, `/mfa` (TOTP enroll + verify), `/queue` (submissions, reports, decision forms) with `@supabase/ssr` (free, added to apps/admin), `proxy.ts` session refresh, anon key + user session only (no service-role key), project-ref guard (loopback allowed only with `ADMIN_ALLOW_LOCAL_BACKEND=true` for tests). The older local validator `/review` is untouched. Nothing hosted.
4. Docs reconciled: PROJECT_STATE, BACKLOG (OS-301/302/303 BUILT locally), SECURITY, DATABASE, TESTING, ADMIN_REVIEW (incl. first-admin SQL runbook), `.env.example` (names only), CI step for the admin e2e; doctor now also expects the five admin functions.

**Tests / results (local)**
- `npm run check` (lint, typecheck, unit: admin 17, mobile 32, domain 105, importer 65, ui 15, secret scan) PASS.
- `npm run test:db` PASS (all 12 migrations + `moderation.test.sql`, account/review suites, two-session concurrency, importer contracts). 11 mutations of the new migrations were each caught (MFA check, disabled admin, self-adjudication x2, approve-as-verified, immutability trigger, append-only trigger, deletion keeps decided, withdraw-held, other-needs-note, duplicate-link).
- `npm run test:e2e:admin` 26/26 (new), `test:e2e:auth` 56/56, `test:e2e` smoke 25/25, admin build, android/ios bundles PASS.
- Not run: anything against live Supabase (no link here).

**Assumptions to confirm (from the earlier question)**
- Approved community restrooms: `status='unverified'`, `restroom_evidence='explicit'`, `restroom_verified=false` + `community_submission` source row. Implemented exactly so; UI/API show UNVERIFIED.

**Supabase connection check (2026-10-06, read-only; no live change made)**
- **Open Stall project `xzzbcejgprilmolvdaes`: NOT accessible from this session.** The connected Supabase MCP exposes exactly one project, `ydohoixtdkjerstmuafi` ("Go Zip Trips", INACTIVE, us-west-2, a different Vindex project). Claude did NOT query, inspect or use it beyond listing project metadata (isolation rule). `get_project_url` for `xzzbcejgprilmolvdaes` returned "You do not have permission to perform this action".
- Other routes checked earlier: Supabase CLI 2.118.0 is installed but has no access token and no project link; the public anon key is not available in this container; there is no network route to `*.supabase.co` for Open Stall.
- **Live read-only/validation capability available to Claude from here: none** (no doctor, no `migration list`, no `db push --dry-run`, no `live:account`, no MFA enrollment). Those require Jake's Mac (CLI link + local `.env.local`) or an MCP/CLI connection actually bound to `xzzbcejgprilmolvdaes`.
- **Blocker for the remaining Phase 3A live verification (after owner approval):** connect an Open Stall-scoped Supabase integration (re-authorize the Supabase MCP/plugin to the Open Stall org/project and disconnect the Go Zip Trips binding), or run the live steps on Jake's Mac and paste results into HANDOFF. Claude will not apply anything either way until a consequential approval is recorded in CHATGPT REVIEW.

**Blockers / environment**
- This session is the cloud container: no Supabase CLI link, so migrations are validated only on the throwaway local Postgres. Real TOTP/AAL2 can only be verified live; local tests simulate AAL2 through JWT claims.
- Not tested: two admins deciding the same item concurrently (the function takes `FOR UPDATE` and re-checks `status='pending'`, but there is no two-session test for it yet).

**Questions requiring review**
1. Held items are removed (with their hold decision) when their contributor deletes the account, while the `moderation_log` entry of the hold remains. Acceptable, or should held items be treated as decided/anonymised instead?
2. `admin_decide_submission` blocks ALL decisions (including hold/release) on an admin's own submission, stricter than "final adjudication". Keep?
3. Edit-and-approve in the UI edits text fields only (name, address, city, region, ZIP, access, hours); boolean facts stay as proposed. Enough for 3A?
4. Admin bootstrap is owner SQL only (ADMIN_REVIEW.md). OK as the first-admin path?
5. Community review history-in-place (audit finding) and the OS-309 retention policy remain untouched (Phase 3B-adjacent).

**Exact next recommended action**
- ChatGPT: review this checkpoint (migrations 20261009000001-2, admin routes, tests). On approval, Jake (on the Mac with the Supabase link) runs `npx supabase db push --dry-run`, reviews, and decides on applying; then enroll MFA for the first admin account in the local admin app and run the first-admin SQL from ADMIN_REVIEW.md. Claude stays idle until the review is recorded (no live step is authorized).

---

# CHATGPT REVIEW

*Reserved for ChatGPT. Claude reads this before resuming after a review gate and must not overwrite it until the review has been acted on and the outcome recorded in CLAUDE HANDOFF.*

**Review status: AUTHORIZED_AWAITING_CLAUDE_ACKNOWLEDGMENT**

**Owner authorization / source:** Jake's 2026-10-06 Work-session handoff and explicit coordination-activation instruction. These newer instructions supersede older workflow restrictions and the historical missing-audit/decision placeholders in CLAUDE HANDOFF. Phase 2 is complete and live validated through 20261008000001. Phase 3A implementation has not started in this review.

## Phase 3A read-only audit findings supplied by Jake
- Admin authorization is currently local-only/service-role based; there is no real admin identity.
- Existing admin review uses service-role-only functions; admin records are not tied to actual admin accounts.
- location_sources and location_reviews provide some provenance.
- Submissions have pending/approved/rejected states but lack durable moderation decisions, reviewer identity, hold/duplicate resolution and result links.
- Reports lack complete moderator provenance.
- Community reviews are updated in place, losing historical evidence.
- A moderation log is documented but not implemented.
- Account deletion risks deleting decided provenance.
- Duplicate and rejection are not properly distinct.
- Original submissions are not sufficiently protected as immutable evidence.

These are owner-supplied audit findings, not a claim that Work independently reran the audit. Address the authorized foundation below; evidence-history gaps do not authorize expansion into Phase 3B.

## All nine Phase 3A decisions — owner-approved
1. **Admin authorization:** authenticated user sessions plus server-side admin_users authorization and narrowly scoped admin functions. User metadata is not admin authority. Hosted admin must not depend on a service-role credential.
2. **Admin MFA:** require MFA/AAL2 for admin capabilities using existing/free Supabase functionality if available. No paid service; report a blocker rather than spend or weaken the requirement.
3. **Account deletion / provenance:** preserve consequentially decided contribution evidence and moderation decisions while severing/anonymizing unnecessary user identity. Account deletion must not destroy important decided provenance.
4. **Self approval:** admins may not finally adjudicate their own community submissions or reports.
5. **Approved community restrooms:** approval may make a restroom public, but it remains UNVERIFIED. Approval and verification are separate.
6. **Held items:** unresolved held submissions continue counting toward applicable pending caps.
7. **Rejection reasons:** internal codes private_or_residential, not_public_or_not_a_restroom, insufficient_or_unverifiable, invalid_or_inaccurate, spam_or_abuse, other. Other requires a moderator note. Duplicate is a separate resolution, never a rejection reason.
8. **Field semantics:** closed means permanently closed/removed/nonexistent, not temporary unavailability. Temporary closure/out-of-order is evolving/temporal evidence. access_location/directions is evolving information. easy_to_find/hard_to_find is community/derived discoverability evidence, not authoritative admin truth. cleaning_log is temporal evidence/history. restroom_type restructuring is deferred to OS-310. Do not automatically remove Verified status due to aging during Phase 3A; preserve last_verified_at for later confidence/recency logic.
9. **Admin session technology:** @supabase/ssr is approved if appropriate and free. Building/testing admin authentication and the queue is approved. Hosting/deployment is not approved.

## Product/data architecture direction
RESTROOM -> CURRENT STATE -> EVIDENCE, with four distinct data classes:
- **Authoritative identity:** name, address, coordinates, facility association and relatively fixed identifying facts. Community corrections are proposals; community evidence must not automatically overwrite identity.
- **Evolving features:** changing tables, accessibility, family restroom, sinks, locks, purchase requirement, access/hours and construction availability. Admin confirmation is strong evidence, not a permanent lock; newer credible evidence may eventually change current state.
- **Temporal conditions:** cleanliness, supplies, wait, current safety and current usability/out-of-order. Primarily community-driven; recency matters heavily.
- **Derived/system values:** public rating, confidence, verification count, last confirmed and reputation/trust are calculated, not manually edited facts.

Long term, reliable frequent contributors may have more evidentiary weight without becoming admins. Historical accuracy/later confirmation, legitimate activity, recency, geographic familiarity, contribution quality, agreement/disagreement and abuse/rejection history may inform reputation; volume alone never creates authority. Do not implement a final reputation algorithm now.

Long-term consolidation direction: current state + aggregated evidence/confidence + meaningful recent history + provenance for consequential changes + eventual rollups. Do not destructively consolidate observations now; real-world retention/weighting evidence is insufficient. Facility/unit restructuring remains deferred.

## Authorized Phase 3A scope
Claude may implement the smallest coherent foundation comprising:
- secure admin identity/authorization and MFA enforcement;
- review queue foundation and appropriate functional admin UI;
- immutable original submissions;
- append-only moderation decisions and reviewer provenance;
- approve, edit & approve, reject, duplicate/link, hold;
- report resolution;
- preservation/anonymization of consequentially decided provenance on account deletion;
- tests for authorization, MFA, self-adjudication, privacy, immutability, decisions, held caps, approval/unverified semantics and deletion/provenance.

Admin authorization (OS-301) is the prerequisite within this coherent Phase 3A; do not treat the phase as unrelated independent features or start Phase 3B. Local source migrations are permitted; applying them live is not.

## Consequential gates and prohibitions
Stop and obtain Jake's explicit approval before any live database migration/mutation, deployment, Git merge, destructive operation, production data deletion, force push/history rewrite, new cost or paid service, subscription purchase/change, credentials only Jake can provide, unresolved product decision, or material architecture/scope expansion.

Do not merge PR #1 or main; merge the old claude/pensive-brahmagupta-wrrhxn branch into claude-local; deploy; expand geography; configure Google OAuth, Apple Sign-In or Yahoo auth; run npm audit fix/--force; delete the permanent test account; or begin Phase 3B. No other Vindex project/provider binding may be used.

## Acknowledgment and autonomous execution
1. Refresh from remote origin/claude-local safely, preserving local work. Read this CHATGPT REVIEW and the permanent usage/cost rule below.
2. In CLAUDE HANDOFF, acknowledge the exact reviewed Git commit SHA, the nine decisions, authorized scope, consequential gates and hard included-subscription limit. Set status WORKING, identify the smallest implementation sequence, and commit/push that acknowledgment to claude-local. Never overwrite CHATGPT REVIEW or owner decisions.
3. Once acknowledged, proceed autonomously with routine Phase 3A implementation, targeted testing/debugging and ordinary commits/pushes within the approved scope. No additional Jake relay or routine permission is required. Maintain CLAUDE HANDOFF with real results, remaining work and exact next action.
4. Use NEEDS_CHATGPT_REVIEW for substantive review checkpoints, NEEDS_OWNER_DECISION for a genuinely unresolved product choice, NEEDS_CONSEQUENTIAL_APPROVAL for a consequential gate, and NEEDS_USAGE_RESET for an included-allowance limit. Check CHATGPT REVIEW on resumption. Do not invent an automatic wakeup: GitHub stores coordination, but Claude must be running/resumed to read it.

Older OPEN_STALL_CONTEXT.md, OPEN_STALL_RESUME.md and OPEN_STALL_HISTORY_SOURCES.md remain historical/reference sources; do not fold/delete/rewrite them in this coordination update. Use the latest owner instructions and current GitHub branch over stale historical restrictions. Jake is not the routine courier; ChatGPT Work exchanges reviews/instructions through its section of HANDOFF.md, and Claude reports through its section. No scheduled monitoring has been created by this update.

---

# CONSEQUENTIAL GATES

Claude must stop (set status `NEEDS_CONSEQUENTIAL_APPROVAL` or `NEEDS_OWNER_DECISION`) and wait for Jake before:

- any live database migration or mutation (including `supabase db push`, data writes, deleting the permanent test account)
- any deployment (Vercel production, EAS/store builds)
- any Git merge (main or PR #1) — and pushing anything other than approved work to the agreed branch
- any destructive operation (deleting data/branches/files, history rewrite, force-push, credential rotation)
- any paid service or cost
- credentials only Jake can provide, or exposing/requesting secrets
- an unresolved product decision (the nine decisions in CHATGPT REVIEW are already resolved by Jake)
- a material architecture or scope change beyond authorized Phase 3A (Phase 3B start, geography expansion, ODbL/tile-provider/launch gates, Google/Apple/Yahoo auth, `npm audit fix`)

Routine implementation, testing, debugging and commits inside approved scope do not need Jake to relay messages; record progress in CLAUDE HANDOFF and keep going.

**Status values for CLAUDE HANDOFF:** WORKING · NEEDS_CHATGPT_REVIEW · NEEDS_OWNER_DECISION · NEEDS_CONSEQUENTIAL_APPROVAL · NEEDS_USAGE_RESET · PHASE_COMPLETE


---

# CLAUDE USAGE / COST AUTHORITY — permanent project operating rule

Jake's existing Claude subscription allowance is a hard limit.

Claude is NOT authorized to:
- purchase additional Claude usage, tokens, credits, API credits, or capacity;
- authorize pay-as-you-go or overage charges;
- upgrade or change Jake's Claude subscription;
- switch to a paid API or paid service to continue working;
- incur any new cost to bypass a usage or token limit.

Claude must operate entirely within Jake's existing included subscription allowance.

Claude must manage token/context usage efficiently. Use targeted repository reads and HANDOFF.md rather than repeatedly loading large histories or the entire repository unnecessarily.

If Claude is approaching or reaches an included usage/token limit:
1. stop before intentionally exceeding the included allowance;
2. checkpoint all safe completed work;
3. commit/push safe work already within authorized scope when appropriate;
4. update CLAUDE HANDOFF with completed work, tests, remaining work and exact next action;
5. set status to NEEDS_USAGE_RESET;
6. wait for the included subscription allowance to reset.

Reaching a usage limit NEVER grants authority to spend money.

Only Jake may explicitly authorize a new expense, subscription change, paid service, or additional usage purchase.
