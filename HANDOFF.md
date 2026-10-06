# HANDOFF — Open Stall coordination layer

Persistent coordination state between **Jake (owner / product approval)**, **ChatGPT (product + architecture oversight)** and **Claude Code (primary builder)**.
Rules: each party edits only its own section (Jake may edit any). Canonical project truth stays in PROJECT_STATE.md, BACKLOG.md, SECURITY.md, DATABASE.md, TESTING.md; this file is for status, instructions and review exchange, not a second copy of them. Read CHATGPT REVIEW before resuming after any review gate.

---

# CURRENT PROJECT STATE

- **Repo:** vindexholdings/open-stall (https://github.com/vindexholdings/open-stall)
- **Active branch:** `claude-local` (source of truth). Do NOT merge the old `claude/pensive-brahmagupta-wrrhxn` branch into it. PR #1 is still open and unmerged; `main` has no app.
- **HEAD at creation of this file:** `f016638` — "Record successful Phase 2 live validation" (this file is the next commit on top of it).
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

**Latest architecture/build proposal**
- None. No Phase 3 design has been proposed or authorized by Claude in this repository. Phase 3A proposals wait on the review items below.

**Work completed**
- Phase 2 build, live migrations through 20261008000001 and live validation (see PROJECT_STATE.md for the detailed record; HEAD `f016638`).
- Switched the working checkout to `claude-local` @ `f016638`; created this HANDOFF.md (the only file changed in this commit).

**Phase 3A read-only audit — CONTENT NOT AVAILABLE TO CLAUDE**
- The brief asked for this file to be seeded with the completed Phase 3A read-only audit and the nine open Phase 3A decisions. **Neither exists in the repository or in this Claude session's context** (searched the repo for Phase 3A material; none). They were produced elsewhere (ChatGPT / another session) and were not provided to Claude.
- Claude did not reconstruct or guess them. To avoid inventing decisions, the audit text and the nine decisions are left for ChatGPT/Jake to paste below, verbatim, under CHATGPT REVIEW (or tell Claude where the source file lives).

**Open Phase 3A decisions (nine)** — *to be supplied; placeholders only*
1. (not supplied)
2. (not supplied)
3. (not supplied)
4. (not supplied)
5. (not supplied)
6. (not supplied)
7. (not supplied)
8. (not supplied)
9. (not supplied)

**Product direction noted for Phase 3A (as stated by the owner; keywords only, not yet elaborated or designed)**
- authoritative identity (of locations/restrooms)
- evolving features
- temporal conditions
- derived values
- community reputation
- evidence
- future data consolidation
Claude has not designed or built any of these. Detail, scope and priority come from the audit/decisions above.

**Tests / results**
- Last full local validation (2026-10-05 recovery pass, per PROJECT_STATE.md): lint, typecheck, secret scan, 223 unit tests, `test:db` incl. two-session concurrency, auth e2e 56/56, smoke 25/25, admin build, web/android/ios bundles — all pass. Live: doctor + `live:account --contribute` passed 2026-10-06. Nothing run for this file.

**Blockers**
- Missing Phase 3A audit + nine decisions (above).
- This session has no Supabase CLI link/Vercel CLI; anything touching live infrastructure needs Jake's Mac or an authorized linked session.

**Questions requiring review**
1. ChatGPT/Jake: supply the Phase 3A audit and the nine open decisions (or the file path).
2. Is OS-301 (admin authorization) the first Phase 3 item once those are settled, or does Phase 3A change the order? (Not started; needs explicit go-ahead.)
3. Do the older context files (OPEN_STALL_CONTEXT.md, OPEN_STALL_RESUME.md, OPEN_STALL_HISTORY_SOURCES.md) stay as reference now that HANDOFF.md exists, or should they be folded into canonical docs?

**Exact next recommended action**
- Wait for ChatGPT's response in CHATGPT REVIEW. On receipt: read it, record the outcome here, then (if scope is authorized) propose a Phase 3A design/plan in this section before any build.

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
