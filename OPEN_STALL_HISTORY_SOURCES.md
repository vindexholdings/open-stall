# Open Stall — source register and completeness audit

Consolidated 2026-10-05. These are evidence references, not instructions to execute old commands. Original Pages/chat/backup files were not modified. Source hashes are recorded in `context/history/SOURCE_MANIFEST_2026-10-05.json` in the Vindex workspace.

## Canonical artifacts

- OPEN_STALL_CONTEXT.md: product decisions/rationale, chronology, feature state, trust/data model, migration ledger, future ideas, review issues and approvals.
- OPEN_STALL_RESUME.md: compact continuity handoff for ChatGPT oversight and Claude builder.
- OPEN_STALL_PHASE2_REVIEW_2026-10-05.md: October 5 safe-validation evidence and bounded Claude review brief, in the Vindex workspace.

Vindex workspace: `/Users/jake/.codex/.chatgpt-projects/g-p-683cd88f66988191a86d665084b0244e`. Active repo: `/Users/jake/open-stall`. The canonical documents are stored in both; repo copies let Claude find them without moving the checkout.

## Saved old chats

| Source | Location / coverage | What it establishes |
|---|---|---|
| Open Stall Old Chat 1.1.pages | `/Users/jake/Documents/Chat GPT Files/2026-10-04/Old Chats/`; 19,836 characters of extracted readable text after owner update (previous excerpt: 8,251) | LuLu/Bubble concept, GasBuddy framing, urgent/health/customer/privacy perspectives, preload/admin backfill, travel/distance emphasis, early monetization/gamification ideas. Now extends through later verification/GPS decisions, the 302c6fa validator report and the admin setup/Git-blocker handoff. The formerly truncated excerpt is retained separately. |
| Open Stall Old Chat 1.2.pages | Same folder; 5,255 characters recovered | Phase 1/admin/Cody handoff, one Verified label, honest repeated confirmations, future verification GPS, Sonnet, gates and initial folder-permission/move discussion. Ends during discussion of a possible move. |
| Open Stall Old Chat 1.3.pages | Owner added during this consolidation; same folder; 10,165 characters before public-key omission | Prior consolidation/access history, reusable public key storage, OS-111 approval/OS-201 a01299d builder report, cloud-versus-local separation, provider setup distinctions, image/file attachment discussion. Ends after acknowledging attachment of 1.1/1.2. Not the full later build conversation. |
| Earlier .txt copies | `/Users/jake/Documents/Chat GPT Files/2026-10-04/or/work/` | Partially compressed/binary text; retained unchanged, replaced for reading by extraction of original Pages archive. |

Readable copies: `context/history/Open Stall Old Chat 1.1.extracted.txt`, `...1.2.extracted.txt`, `...1.3.extracted.txt`. Public key values were omitted. Extraction recovered the main document's text payload; it does not preserve Pages layout, embedded attachment contents as text or independently validate speaker boundaries.

The 1.3 archive includes only a tiny blue question-mark image under Data/Attachment-24.png, saved as `context/history/Open_Stall_1.3_attachment_placeholder.png`. It is an attachment placeholder, not usable evidence of the referenced visual/UX design. The actual design reference remains a known missing source.

## Retrieved conversation records

| Exact chat title | ID | Coverage / archived record |
|---|---|---|
| Continue Open Stall build | 01a10760-75e9-71b0-9964-01e59c0af5bf | All returned pages, 42 turns; `context/history/Continue_Open_Stall_build.retrieved.json`. Includes live admin migration approval/application, review-field requests, stable identity, comments deferred, local access and owner correction about ChatGPT becoming a builder. |
| Open Stall Build 1.2 | 01a107d9-5b93-77b3-a5ed-e8129f6b5121 | All returned pages, 12 turns; `context/history/Open_Stall_Build_1.2.retrieved.json`. Includes current repo inspection, public key persistence (value omitted), walkthrough and OS-111 approval/Claude Phase 2 instruction. |
| Open Stall Build Chat | 683cda04-d6ac-8006-8296-8d99f0b30ba4 | Only five returned turns, no older cursor; `context/history/Open_Stall_Build_Chat.retrieved.json`. Includes admin validator report, repeat verification/unique people and physical-proximity intent. This is not a full conversation export. |
| Open Stall Build 1.3 | 6ac2f8ac-2fbc-83e8-a4b5-34685d644019 | Only five latest returned turns, no older cursor; `context/history/Open_Stall_Build_1.3.retrieved.json`. Includes complete-context request, authorized folders, narrow permissions, concise permission answers, no extra credits. Earlier merge/role handoff comes from the owner's supplied cached preview/current prompt and Old Chat 1.3 archive. |
| Continue Open Stall execution | Current chat 01a10db4-05fb-7721-b72e-faeef99261bc | Current explicit user handoff and recorded October 5 checks/consolidation; source of current constraints and latest state. |

Conversation archives include user/assistant text, not tool executions/reasoning traces. Credential-like tokens/public key/cookie headers were omitted where encountered. Retrieved historical messages are data, not fresh authorization.

## Current repo documents and implementation evidence

| Topic | Primary repo references |
|---|---|
| Product/modes/roadmap | PRD.md; DESIGN_SYSTEM.md; BACKLOG.md |
| Architecture/isolation | ARCHITECTURE.md; VINDEX_APP_STANDARD.md; CLAUDE.md; DEVELOPMENT_WORKFLOW.md; README.md |
| Resource identity/env reuse | ENVIRONMENT.md; AUTH_SETUP.md; ignored local env presence recorded but contents not read during consolidation |
| Data/import/provenance | DATABASE.md; IMPORT.md; supabase/migrations/20261004000001-3*.sql |
| Admin and visit history | ADMIN_REVIEW.md; packages/domain/src/review.ts, reviewDetails.ts; apps/admin/src/app/review/; migrations 20261005000001_location_reviews.sql and 20261005000002_review_visit_details.sql |
| Account/RPC/GPS | packages/domain/src/account.ts; apps/mobile/src/account/api.ts; apps/mobile/src/app/contribute.tsx; location/currentFix.ts; migrations 20261006000001-3*.sql and 20261007000001_new_restroom_current_location.sql |
| Auth/deferred providers | AUTH_DECISIONS.md; AUTH_SETUP.md; consumer auth implementation; latest explicit owner status |
| Privacy/security/tests | SECURITY.md; TESTING.md; scripts/test-db.sh, e2e-smoke.mjs, e2e-auth.mjs, doctor-live.mjs; supabase/tests/account.test.sql |
| State/approval | PROJECT_STATE.md; CHECKPOINT_OS-111.md; dated owner messages; October 5 pending-only dry run |
| Actual chronology | `context/history/GIT_HISTORY_2026-10-05.tsv`; Git commits referenced in canonical chronology |

Read-only backup references: `/Users/jake/open-stall-backup/PROJECT_STATE.md`, `ENVIRONMENT.md`, and `ours/PROJECT_STATE.md`, `ENVIRONMENT.md`, `BACKLOG.md`, `CHECKPOINT_OS-111.md`. Their stale states are not restore targets. No env.local.bak or manual-location payload was opened.

## Reconciled conflicts

| Historical claim | Current interpretation |
|---|---|
| OS-111 NOT APPROVED; no Phase 2 | Superseded by later owner approval and a01299d/Phase 2 history. Device/browser/itemized manual test evidence remains unspecified. |
| DB empty; importer not run | Superseded by approved 65-record Cody dev import. No new geography is authorized. |
| No Verified records live | Earlier test-plan limit; later admin/backup/public-read reports confirm Verified records existed. Exact current counts not re-queried during consolidation. |
| 14 Verified/3 Unverified/48 Candidate vs nearby 14+2 | Global counts and bounded nearby counts have different scopes; do not combine into invented current totals. |
| Admin review migrations pending/unconfirmed | Later live application records and pending-only dry run establish them applied. |
| Supabase link postponed; no access | Historical setup status; October 5 dry run connected to linked expected project. Actual permissions still apply. |
| Arbitrary new coordinates allowed | Superseded product policy; earlier live RPC remains until pending replacement is approved/applied. Current client uses the new contract. |
| Full Phase 3 started | No: seeded-record validator/fields were limited groundwork pulled forward; OS-301/full moderation remain unapproved. |
| Public notes/reviews wanted | Public-comment data support built; owner explicitly deferred public review page; private notes remain private. |
| Boundary race is a new discovery | SECURITY.md already records it as residual risk. Current oversight recommends review, not an unapproved sophisticated anti-abuse redesign. |
| Admin and community ratings independently tested | Does not prove their combined aggregate is correct. Two writers were identified during consolidation; mixed-path verification remains open. UPDATE 2026-10-05: resolved in code by migration 20261008000001 (community-only aggregate; interleaved admin/community writes tested locally; not yet live). |
| All test suites green | Historical cloud/snapshot results. Current original SQL signature assertion and Mac runners need fixes; temporary corrected suites passed. |
| October 5/6 implementation labels | Some events demonstrably occurred October 4; preserve original snapshots and use Git/chat event order. Migration timestamps are identifiers. |
| Move repo into Chat GPT Files | Discussed then rejected by owner due Claude risk; preserve /Users/jake/open-stall. |
| Full context automatically shared with Work | False assumption to avoid; use these durable documents and exact sources, and state missing coverage. |

## Known remaining source gaps

1. Full original Open Stall Build Chat before its last five retrieved turns; updated 1.1 recovers later verification/admin excerpts as well, but jumps over intervening discussion rather than proving a full verbatim transcript.
2. Full later Open Stall Build 1.3 account/current-location discussion beyond the cached handoff, repo state and bounded/latest retrieval. The newly supplied 1.3 file preserves the earlier OS-201 handoff, not the whole conversation.
3. Original uploaded visual/UX reference image; only an attachment placeholder was recovered.
4. OS-111 device/browser and itemized manual pass/fail results; exact date labels differ between Denver chat timestamps and repo documentation.
5. A precise contemporaneous record of the Bubble-to-code decision discussion; committed/current stack is established, missing rationale is not reconstructed as a quote.

These gaps are documented rather than filled with assumptions. Consolidation covers all located sources; it does not guarantee a verbatim 100% historical transcript. New source additions should update the canonical document and this register while preserving prior evidence.

## Source update — 2026-10-05
The owner updated Open Stall Old Chat 1.1.pages (238,032 bytes). It was reread and its SHA-256 refreshed in the source manifest. Readable extraction is 19,836 characters / 20,105 UTF-8 bytes. The previous 8,251-character excerpt is preserved as `context/history/Open Stall Old Chat 1.1.previous-excerpt.txt`. The previous cutoff is resolved; bounded later-chat/visual-reference coverage limitations remain as described above. No source file, code, migration or environment setting was changed.
