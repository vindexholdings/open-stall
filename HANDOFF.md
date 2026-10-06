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
- **Current authorized scope:** coordination setup only (this file). Phase 3A work so far is a **read-only audit** (see CLAUDE HANDOFF). No product code, schema, live-database, deployment or merge work is authorized until ChatGPT/Jake assign it.
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
- Roles: Jake = owner/approval; ChatGPT = product + architecture oversight; Claude Code = primary builder (Sonnet unless approved otherwise). "Work" is not part of the normal development loop. Routine implementation, testing, debugging and commits inside approved scope should not require Jake to relay messages.

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

**Review status:** (none yet)

*Paste the Phase 3A read-only audit, the nine open decisions, instructions and approvals here.*

---

# CONSEQUENTIAL GATES

Claude must stop (set status `NEEDS_CONSEQUENTIAL_APPROVAL` or `NEEDS_OWNER_DECISION`) and wait for Jake before:

- any live database migration or mutation (including `supabase db push`, data writes, deleting the permanent test account)
- any deployment (Vercel production, EAS/store builds)
- any Git merge (main or PR #1) — and pushing anything other than approved work to the agreed branch
- any destructive operation (deleting data/branches/files, history rewrite, force-push, credential rotation)
- any paid service or cost
- credentials only Jake can provide, or exposing/requesting secrets
- an unresolved product decision (including each open Phase 3A decision)
- a material architecture or scope change (Phase 3 / OS-301 start, geography expansion, ODbL/tile-provider/launch gates, Google/Apple/Yahoo auth, `npm audit fix`)

Routine implementation, testing, debugging and commits inside approved scope do not need Jake to relay messages; record progress in CLAUDE HANDOFF and keep going.

**Status values for CLAUDE HANDOFF:** WORKING · NEEDS_CHATGPT_REVIEW · NEEDS_OWNER_DECISION · NEEDS_CONSEQUENTIAL_APPROVAL · PHASE_COMPLETE
