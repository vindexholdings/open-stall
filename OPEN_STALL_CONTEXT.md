# Open Stall — canonical project context and history

Consolidated 2026-10-05, America/Denver. Owner: Jake / Vindex Holdings. This is continuity documentation for the existing project, not a new product plan or authorization to develop. Development is paused while context is consolidated; subsequent work must stay within the next authorized task.

## 1. Read this first

Open Stall is a fast, simple, fun **GasBuddy for bathrooms**: find the nearest **usable** public restroom and understand access before going there. Urgent users—including people with health conditions, caregivers and families—must reach useful results quickly. Public discovery remains available without authentication. Accessibility, preloaded locations, honest community verification, admin provenance, privacy-conscious contributions and low customer friction are core requirements.

ChatGPT owns product oversight, architecture, critical review, sequencing and approval preparation. Claude is the primary builder. The execution environment should remove copying/pasting and do authorized mechanical work; it must not become a second independent builder or reinterpret the product. Preserve the conventional transferable stack and the existing checkout. Keep Claude on Sonnet unless a different model is explicitly recommended and approved. Use included subscription allowances; do not buy credits, add paid services or silently enable extra usage/spend.

Current verified checkout: `/Users/jake/open-stall`, branch `claude-local`, HEAD `afdb89abf482a42369bbf1f2719dace7b53628ac`, tracking `origin/claude/pensive-brahmagupta-wrrhxn`, ahead five commits. Phase 2 is substantially built and its earlier version was live validated. Phase 2 current-location/anti-abuse correction `0fa3e3a` was merged in `afdb89a`. Migration `20261007000001_new_restroom_current_location.sql` is **pending and has not been intentionally approved/applied live**. A successful Supabase dry run on October 5 listed only that migration. Local reviewDetails/admin work survives the merge.

No main/PR merge, production deployment, new geography, Phase 3/OS-301 start, paid service, destructive local operation or unapproved live database application is authorized. The October 5 oversight recommendation is to hold live migration approval while Claude reviews the duplicate-handling concerns and test integration gaps. That recommendation is not approval for a redesign or arbitrary threshold changes.

Only documentation was changed during the current review and consolidation. Preserve untracked `manual-locations.json`, `.PROJECT_STATE.md.swp`, ignored environment files, historical migrations and the backup directory. No credentials are reproduced here.

## 2. Evidence, completeness and conflict rules

This document consolidates all **available** Open Stall records found in the authorized locations. It is not a claim that every historical message is available.

Evidence order: current explicit owner instructions govern scope; later explicit owner approvals supersede older checkpoint restrictions; inspected code/Git establish what exists; the successful remote dry run establishes which migration is pending; dated live-test reports establish what was observed then. Product intent comes from owner messages and PRD. Assistant suggestions are proposals unless adopted. Code behavior does not, by itself, establish an approved product decision.

Recovered sources:

- Original `Open Stall Old Chat 1.1.pages`, `Open Stall Old Chat 1.2.pages` and owner-added `Open Stall Old Chat 1.3.pages` in `/Users/jake/Documents/Chat GPT Files/2026-10-04/Old Chats/`. Their compressed document text was extracted into readable copies under this consolidation's `context/history/`; originals were left untouched.
- Earlier `.txt` copies under `/Users/jake/Documents/Chat GPT Files/2026-10-04/or/work/` contain binary/compressed artifacts. They were read for comparison but the recovered Pages text is clearer.
- All returned pages of **Continue Open Stall build** (42 turns) and **Open Stall Build 1.2** (12 turns), archived as sanitized conversation records. Tool executions and reasoning traces are omitted.
- Bounded returned excerpts of **Open Stall Build Chat** and **Open Stall Build 1.3** (five turns each), plus the explicit current handoff and cached preview supplied by the owner.
- Current repo PRD, architecture, design, environment, workflow, database, import, security, testing, authentication, admin-review, backlog, checkpoint and project-state files; Git history; inspected implementation.
- Read-only backup records under `/Users/jake/open-stall-backup/`, including `ours/` snapshots. Backup credentials and manual-location payloads were not read.
- October 5 execution review and validation results in `OPEN_STALL_PHASE2_REVIEW_2026-10-05.md` in the Vindex workspace.

Updated source coverage: the owner replaced Old Chat 1.1 on October 5. Its recovered text now extends beyond the former public-comments cutoff through the one-Verified-badge discussion, unique verifiers versus repeat confirmations, GPS-proximity intent, Claude’s 302c6fa validator report and the local admin setup/Git-blocker handoff. The previous early excerpt is retained separately for provenance. Old Chat 1.2 ends during the folder-move discussion. The long ChatGPT build conversations are exposed as bounded excerpts with no older-page cursor. The updated 1.1 still jumps from the early public-comments question to the later verification discussion; any intervening decision discussion not present in the sources cannot be invented. The owner supplied Old Chat 1.3 during consolidation; it adds the OS-111/OS-201 handoff and attachment/access history, but still ends before the later account-validation and current-location discussion. Further sources can be appended without restarting this reconstruction. Old Chat 1.3 references an uploaded visual/UX image. Its Pages archive contains only a small blue question-mark attachment placeholder; the actual design image is unavailable and its appearance has not been inferred.

Dates conflict in older documents: some October 4 implementation/import events were labeled October 5 or 6; migration filenames use future timestamps; cloud UTC dates can differ from Denver dates. Use event order and dated Git/chat evidence, not migration filenames, as chronology. OS-111 is recorded as approved October 5 in repo docs; the approving handoff in **Open Stall Build 1.2** is timestamped October 4 at 18:56 Denver. Approval is established; its documentation date differs. Do not invent a device/browser or itemized test results.

## 3. Original idea and why it evolved

The earliest saved concept called the app **Bathroom Finder — LuLu**. It included a nearest-location button, distance-sorted results, ratings, services, maps/directions, five free favorites, ads, paid benefits, referral/sharing/community features, and playful emoji ratings. Initial onboarding mentioned email/Facebook, notifications/location permission and global language selection. Premium ideas included ad removal, unlimited favorites, service ratings, comments, ETA and advanced search. Achievement names and Amazon gift-card rewards were brainstormed; Siri was a v2 idea.

The owner initially explored building in Bubble and asked for viewpoints spanning developer, marketer, urgent-use customer, health inspector and privacy/defamation counsel. The explicit goal was a simple, fun, accurate experience that explains purchase requirements, locks, difficult access, cleanliness, broken facilities and risks.

The owner confirmed that locations must be preloaded so the app is useful at first use: chains, gas stations, big retailers and franchises were examples. Admins must be able to add/edit, with users backfilling knowledge as usage grows. Distance, time to reach a restroom and travel mode were emphasized. Assistant-proposed filters such as transit/open-now were suggestions; their appearance in the old conversation does not prove current implementation or authorization.

The committed September 29 build package establishes the later direction: **Open Stall**, U.S.-first, Expo/React Native + responsive web, Supabase and a separate admin app. This conventional codebase avoids builder lock-in and permits professional developers to take over. The archived sources do not preserve every discussion approving the transition from Bubble; the existing repo and current owner instructions clearly establish the approved current stack. Do not return to Bubble or rename the product.

## 4. Product decisions and rationale

| Topic | Established decision / status | Rationale and practical limit |
|---|---|---|
| Core discovery | Decided: no sign-in required | Urgent customers should not complete onboarding to find a restroom. Accounts support contribution/personalization. |
| Customer experience | Decided: fast, simple, fun, trustworthy; accessibility first | Evaluate real usability for health conditions, families and disability access; playful presentation must preserve clarity. |
| Geography/platform | Decided: U.S.-first, iOS/Android/responsive web; current dev dataset Cody only | U.S.-first is product direction, not permission to broaden imports. Native device coverage remains a separate verification need. |
| Travel | Decided/built: distance order, walk/drive/bike, external Apple/Google directions | Current ETA is a straight-line speed estimate, not road-route prediction; do not market it as precise routing. |
| Voice/modes | Decided/built: Plain default; Risqué/Crapper Mapper changes copy/rating visual | Both use the same numeric 1–5 ratings and information/accessibility structure. |
| Access facts | Decided: key, purchase and fee can independently apply; customers-only distinct | Replacing all purchase facts with customers-only would destroy a meaningful distinction. Multiple answers can be true. |
| Unknown facts | Decided: unknown is unknown, never automatically No | Missing information should not mislead an urgent user. |
| Stable vs transient | Decided: amenities/access separate from current conditions | A previous clean visit is not evidence that today's floor or supplies are good. Admin transient conditions reset to unknown per visit. |
| Cold start | Decided: preload then community backfill | A location network needs useful inventory before it has contributors. A business existing does not prove a restroom. |
| Public visibility | Decided/built: Verified and explicit-evidence Unverified visible; Candidate/Pending/Closed hidden | Avoid making incomplete inferred records look usable; label uncertainty honestly. |
| Verification label | Decided: one public Verified concept | Admin/user origins belong in provenance; do not introduce a special Admin Verified badge. |
| Repeat confirmation | Decided: repeat genuine visits improve recency/history, not unique-user count | Jake can revisit as the first user; six visits by one person are not six people. Stable identity matters. |
| Physical verification GPS | Preserved future requirement, not fully implemented | Proximity should support on-site verification; ~30–60m was a proposal, not a settled threshold. Store necessary result/accuracy/time rather than a permanent precise movement history. |
| New restroom contribution | Decided: normal users use current location | Prevent arbitrary map placement; admin/importer coordinate control remains. Current client uses a fresh fix, <=50m and <=2 minutes; exact hard thresholds are implementation choices under review. |
| Existing corrections | Decided/built: ordinary correction needs no physical presence | A wrong fact should be correctable without a trip. Optional pin correction can use location; normal corrections should remain easy. |
| Pending contribution | Decided/built: never public until moderation | Account submission is not verification or automatic publication. Approval workflow remains future Phase 3. |
| Abuse controls | Decided principle: start relatively loose; observe/tune using evidence | Hard caps/rules are not proven optimal simply because tests pass. GPS is a signal and can be spoofed. |
| Public reviews | Desired future customer page, explicitly deferred | Pseudonymous username can show; do not expose email. Admin data support exists; user-facing free-text review browsing is not launched. |
| Existing private notes | Decided: remain private | Capture future public comments separately; never retroactively publish private notes. |
| Photos | Decided: no user-uploaded photos in v1 | Preserve the established scope and moderation/privacy burden. |
| Multiple bathrooms per facility | Decided future data-model requirement; not authorized to build now | A mall/airport/address may contain several different units. Distance/address alone must not establish identity. |
| Facility/unit attributes | Deferred planning | Stall/toilet, urinal and sink counts; private single-user vs shared room; partitions/dividers, locking door, family restroom and layout/privacy facts. |
| Generic names | OS-308 deferred authoritative enrichment | Keep source/provenance and admin audit; never invent park/facility names. No geography expansion. |
| UI readiness | Decided: current UI is functional scaffolding | Full UI/UX/accessibility redesign after core functionality/data/admin stabilization and before launch; do not polish isolated screens prematurely. |
| Provider auth | Email working; Google deferred/not configured; Apple skipped; Yahoo evaluated/deferred | Code support is not provider setup. Apple cost needs approval. Yahoo evaluation is not authorization to implement. |
| Monetization | Future ads + premium; five free favorites and unlimited premium planned | No price or paid vendor approved. Urgent accessibility/access facts must not be paywalled. |
| Gamification | Future, not active | Points reference values are proposals for a later ledger; no excessive/unhealthy check-in incentives. Dethroned redesign/omit unless approved. |
| Permissions/cost | Decided: narrow access, explicit genuine gates, no extra credits | Avoid broad screen recording/browser-profile/password access; older permission advice does not override current scope or sandbox. |

## 5. Implementation history

Dates below use Denver where supported; sequence is more reliable than inconsistent prose dates.

| Period / evidence | What happened | Result / decision |
|---|---|---|
| Original concept; saved 1.1 | LuLu/Bubble exploration; urgent-use, preload, access/rating/privacy requirements | Established the customer problem; early feature ideas were not all adopted. |
| Sept 29 evening; `daea5fc`, `68a16e4` through `efc6389` | Build package uploaded; repo isolation, Expo/TS, workspaces, domain/UI, local Supabase config, EAS profiles, secret/lint/test gates and CI | Phase 0 foundation. Git UTC dates after midnight may show Sept 30. |
| Oct 2–3; `0ff2d8f`, `ac4fce1`, `6544448` | Correct project bindings; Next.js admin; Vercel root directory actually configured/verified | Architecture approved; earlier premature “complete” record corrected. |
| Oct 3; `0b25b46` through `77d0a90` | Discovery schema/RLS, location UX, map/list, nearby query, filters, details, navigation/deep links, offline and tests | Original public model emphasized verified-only discovery. |
| Oct 3; `14f5cb7` through `7b8c351` | Approved three-state visibility, reusable OSM importer, canonical/source split, constrained public RPCs, no-overwrite/finalize/duplicate protections; Opus review recorded | Explicit-evidence Unverified became public with badge; inferred Candidate hidden. ODbL gate retained. |
| Oct 4; `867a7ef` | Human applied three base migrations and remote RLS validation passed | Backend live before seed; old “empty DB” notes belong to this stage. |
| Oct 4; `6574b7c`, `89e08e9` | Manual 1–3 first-party test-record generator, then externally researched Unverified test-record approach | Test preparation only; researched three-record workflow later stopped. Keep tools/history, do not infer records were added. |
| Oct 4; `5651019`, `735242a` | Approved small Cody OSM dev import: 87 source elements, 65 records, 9 explicit/public Unverified, 56 inferred/hidden Candidate, no duplicates/holds | Regional preloading replaced the small researched-record test plan; no national import permission. |
| Oct 4; `302c6fa` | Claude built local admin validator with views for Unverified/Candidate/Verified/Closed, review outcome preview, private audit/provenance and service-only writes | Limited seeded-record validator pulled forward; did not authorize full Phase 3. |
| Oct 4; early execution chat | Local server/watch-limit/credential issues; reviewer wording simplified; key/purchase/fee independent; imported details collapsed; owner applied review migration | Saving enabled; old “Saving unavailable” was a missing migration, not proof the form could save. |
| Oct 4; `da95ba5` | Owner requested embedded map, editable username, customers-only/family/restroom type, stars/comment/cleanliness, hot/cold water, condition checks, posted inspection log | New additive visit-details support, stable identity and repeat visit history; private notes protected. Owner explicitly kept public review page deferred. |
| Oct 4; earlier execution records | Review migrations `20261005000001` and `...00002` applied; owner reviewed real records | Backup reported 14 Verified/3 Unverified/48 Candidate globally. Later nearby API query returned 14 Verified/2 Unverified within query bounds; these are different scopes, not necessarily conflicting. |
| Old Chat 1.3 archive | Preserves OS-201 builder report at a01299d, cloud-vs-Mac separation, setup checklist and visual-reference attachment discussion | Code support versus live provider setup distinguished; reused local public config, no secret reconstruction. Visual image is a source gap. |
| Oct 4 evening / Oct 5 repo record | Owner said remaining customer checks finished; OS-111 approval recorded; Claude assigned Phase 2 | Device/browser and itemized manual results not recorded. Old NOT APPROVED lines are superseded. |
| Oct 4 evening; `a01299d`, `dbda804`, `20d8d0b`, `4b744a9` (UTC Oct 5) | Claude implemented account auth, doctor/mock browser checks, Yahoo evaluation, account database and customer features | Email/password provider setup/live tests followed; Google/Apple capability does not mean enabled. |
| Oct 4; `cc37185`, `13c6733`, `d193140` | Local/remote integration preserved env facts and admin reviewDetails; remote doctor correction merged | Local cloud/local history diverged but existing local work was retained. |
| Oct 4–5; owner reports/current state | Owner applied three account migrations, live account checks passed; signup/confirmation/reset and contributions checked | Permanent test account retained; no production deployment or Phase 3 start. Doctor 42703 was a select=id diagnostic bug; fixed to select=*. |
| Oct 5; `0fa3e3a`, `afdb89a` | Current-location new-submission policy and pre-queue controls built by Claude and merged locally | New migration still pending; ahead five. No auto-application. |
| Oct 5; current execution review | Safe local checks, disposable DB validation and remote dry run; duplication/friction/test issues recorded | Recommendation to hold live approval; no code fixes implemented by ChatGPT. Claude direct assignment failed expired login. |
| Oct 5; this consolidation | Recovered Pages text, read earlier chats/repo/backup, reconciled decisions and status | Documentation only; no further development started. |

## 6. Current feature state

### Phase 0 and Phase 1

Foundation and discovery are built: Expo SDK 57/TypeScript strict/npm workspace app, provider-neutral map/list, distance-sorted nearby results, filters/details, verification badges/nearest-verified hint, external navigation, permission denial/retry and public-data offline cache. No fake/sample records are shipped as real locations. Base backend and Cody seed are live. OS-111 was approved; native/device coverage is not inferred from that approval.

Public ranking remains distance-first. Default radius is five miles; active refresh about 180 seconds. Current walk/bike/drive ETA uses constant speeds and straight-line distance. OSM tile default is development-only. Production tile choice remains unresolved. Apple Maps bike navigation has a historically recorded walk fallback; do not promise identical platform behavior without verifying it.

### Phase 2

| Item | Current status |
|---|---|
| OS-201 authentication | Email/password, confirmation, login/logout and password reset live validated. Separate account/discovery clients; PKCE and stored sessions. Google deferred; Apple skipped. |
| OS-202 Yahoo | Evaluated and deferred, not an implementation task. Historical support/cost rationale must be rechecked if revisited. |
| OS-203 preferences | Local-first/synced display name, Plain/Risqué and default travel mode, live validated. |
| OS-204 favorites | Five free favorites, live validated. Premium enlargement not built. |
| OS-205 reviews/check-ins | Numeric ratings and six structured observations; check-in <=150m, coordinates compared then discarded. Earlier live checks passed; real on-site check-in field test remains. Check-in is not the final physical-verification workflow. |
| OS-206 submissions | Earlier live version validated. New current-location app/domain/RPC contract built/merged, pending `20261007000001`. Ordinary edits require no GPS. |
| OS-207 reports | Controlled issue types, optional restricted text, live validated. |
| OS-208 anti-abuse | Earlier safeguards live; new pre-queue rules built, pending migration, under oversight review. |
| OS-209 deletion | Typed DELETE, cascade semantics, tests/mock browser coverage. Do not exercise deletion on permanent test account. |
| OS-210 tests | Substantial coverage. Current repo SQL privilege assertion integration mismatch and Mac test-runner gaps remain; temporary corrected copies passed. |

Customer public free-text review browsing, full moderation/auth/admin workflows, reward economy and payments are not complete. Database.md lists both implemented and future tables; it is not evidence that point_ledger/subscriptions/referrals exist.

### Limited existing admin capability

`apps/admin` `/review` validates seeded records; it is part of the intended admin app, not throwaway tooling. It remains local-only pending OS-301 authorization. Required gate: explicit local flag, localhost host, never Vercel, correct project and server-side service key. All pages/actions use the gate; key is not sent to browser.

Exists + Visited in person + date can mark Verified; exists without visit makes eligible records Unverified and does not downgrade Verified; not exists closes/hides and imports cannot republish; unsure preserves facts/status except notes. Reviews retain prior state, OSM source and separate first-party provenance. Manual edits protect against import overwrites. This administrative attestation path **does not yet enforce the future GPS-proximity verification requirement**.

Visit details include separate family/gender-neutral; hot/cold water; customer/key/fee facts; men/women/all-gender/family/single occupancy; optional stars, public-comment field, private note, cleanliness, seats/mirrors/doors/paper/floor, posted cleaning/inspection log. Stable reviewer identity prevents alias changes/revisits counting as extra people. Earlier visits do not move verification recency backward. Capture of a public-comment field does not make it publicly readable today.

## 7. Architecture, bindings and local files

| Resource | Established binding |
|---|---|
| Repo | `https://github.com/vindexholdings/open-stall`; active path `/Users/jake/open-stall` |
| Branch | `claude-local`; upstream `origin/claude/pensive-brahmagupta-wrrhxn`; PR #1 historically draft/unmerged |
| Consumer | `apps/mobile`, Expo/React Native + web; Expo Router; shared `packages/domain` and `packages/ui` |
| Admin | `apps/admin`, Next.js on approved Vercel project; local validator until real admin auth |
| Supabase | Open Stall, ref `xzzbcejgprilmolvdaes`; URL `https://xzzbcejgprilmolvdaes.supabase.co` |
| Vercel | `prj_aYX3LqJlAliTCo8leZYO7zlIk6SD`, root `apps/admin` |
| Expo | `33614785-78d2-4c9c-9821-5d1341b21680` |
| Native IDs | `com.vindexholdings.openstall` on iOS and Android |
| Backup | `/Users/jake/open-stall-backup`; read-only historical reference, not an active checkout or restore instruction |

Never infer bindings from an account-wide list or substitute another Vindex venture. Inspect `ENVIRONMENT.md` and stop on real target mismatch. Provider environment/preview assertions here are historical, not a fresh production status check.

Use `apps/mobile/.env.local` for the approved public URL/publishable key when it exists; do not repeatedly ask for it. Despite its legacy name, EXPO_PUBLIC_SUPABASE_ANON_KEY can hold the publishable key. Admin service-role settings live in ignored `apps/admin/.env.local`; never substitute them into a public client. No env file was opened during consolidation. Keep credentials out of chat, commits and context artifacts. Permanent test-account credentials are not stored here; any needed password/account maintenance is an owner action.

The existing checkout stays in place; the owner rejected moving it because of Claude/session risk. `manual-locations.json` and `.PROJECT_STATE.md.swp` remain untracked. Never sweep them into a commit or delete them. Backups, raw archived sources and synced project reference files remain unchanged.

## 8. Data and trust model

Canonical `locations` are Open Stall's display records; `location_sources` hold per-source references, licensing, attribution and freshness; `import_runs` record bounds/completion. Provenance separation supports audit/multiple sources but does not erase licensing obligations. Public clients cannot query tables directly: constrained server functions return only displayable rows and trimmed fields. Import/admin/account functions use validated inputs and least privilege with fixed search paths.

OSM explicit restroom evidence becomes Unverified, not Verified. Inferred eligible places are hidden candidates; private/restricted/residential/disused/unsupported records are skipped. Recent source edits can be held; duplicate imports are flagged/hidden, never automatically merged; protected verified/pending/closed/admin-edited records are not overwritten. Finalization requires complete scoped runs and guards empty or mass hiding. Source editor identities/contact data are stripped. Imported hours may be inaccurate.

Cody dev import was approved and performed; larger geography was not. Prior manual and research generators remain as unused/historical tools. Do not invent first-party visits or names. The ODbL gate remains before commercial-scale import, public launch using OSM-derived data, data licensing/sharing or substantial mixing. Reverification does not automatically make copied names/coordinates/addresses independently sourced. Current records include reviewed/enriched OSM-derived rows; the earlier disposable-only import plan is no longer a complete description of their state. Cleanup is scoped, protected and requires authorization; deleting only source links is not data-origin removal.

Location-linked submissions necessarily retain the submitter and proposed restroom point while pending; this is defined contribution data, not continuous tracking. Do not overstate privacy as “no identifiable coordinates ever stored.” OS-309 retention remains a proposal: unlink submitter/drop accuracy/flags within 30 days after review has not been approved or implemented. Search location is sent through the separate anonymous client, without the signed-in account token; provider logs remain a disclosure consideration.

## 9. Migration ledger and contract compatibility

| Migration | Current established state |
|---|---|
| 20261004000001_locations | Applied remotely |
| 20261004000002_public_access | Applied remotely |
| 20261004000003_import_functions | Applied remotely |
| 20261005000001_location_reviews | Applied remotely; preserve local 15-argument admin validator work |
| 20261005000002_review_visit_details | Applied remotely; preserve stable identities/private notes/admin history |
| 20261006000001_account_core | Applied remotely |
| 20261006000002_favorites_reviews_checkins | Applied remotely |
| 20261006000003_submissions_reports_deletion | Applied remotely |
| 20261007000001_new_restroom_current_location | Pending; October 5 dry run lists only this; no live approval/application |

Applied status comes from prior owner records reconciled with the pending-only dry run, not a new dump of every migration ledger row. Migration filename dates are identifiers, not application dates. Never rewrite applied history to repair integration defects.

Pending migration adds capture accuracy/flags and private submission_supporters, drops the old three-argument arbitrary-coordinate submit_location, installs a six-argument current-location version returning `{coalesced, submission_id}`, and updates correction controls. It does not deliberately update existing location facts, but **does change schema/privileges/RPC contracts**. Therefore the older phrase “no data is touched” is too broad. Coordinate dev-client/backend versions; do not deploy merely because a dry run succeeds.

## 10. Current anti-abuse behavior versus approved principle

> **Status 2026-10-05, after the Claude recovery pass (local only, nothing applied live):** the table below describes 20261007000001 alone. With correction migration 20261008000001 the final behavior is: no proximity/name rejection or merge; every proposal is its own row with private flags (`possible_duplicate_of`, `near_listed_restroom`, `near_own_pending`, `near_pending_submission`, `duplicate_submission_ids`); an exact own retry within 10 minutes returns the same id and uses no quota; response is `{submission_id}` only; one global advisory lock replaces the per-cell lock (cross-cell race gone, two-session test added); `submission_supporters` kept untouched as legacy. Rate, cap, accuracy, pause and triage thresholds are unchanged (OS-208b). Canonical detail: SECURITY.md, DATABASE.md.

The approved policy is current-location new proposals, privacy-conscious safety, and loose/observable controls until market evidence. The pending numeric behavior is not market-validated:

| Control | Current pending implementation | Oversight consideration |
|---|---|---|
| New GPS | 0 < accuracy <=50m; client fix <=2 minutes; no free-form payload coordinates | Indoor/disabled contributors may have trouble; moving outside can shift the proposal. Freshness is an honest-client check, not spoof-proof server evidence. |
| Already public | Reject any public location <25m, or same normalized name <100m | Distinct bathroom units/generic names can collide; proximity is not identity. |
| Own pending | Reject within 30m or same name within 100m | Same distinct-unit problem. |
| Other pending | Combine as supporter within 30m or same name within 100m | SUPERSEDED 2026-10-05 by owner-approved policy: separate raw proposals, private admin flags, no coalescing (migration 20261008000001). Different legitimate units must not be silently collapsed. |
| Rate | 3 new/hour; 5 total submissions/day shared with edits | Blocks additional useful corrections after five new entries; support/coalesced actions also count. |
| Queue cap | 5 pending new, 10 pending total | Can stall contributors while moderation is slow. |
| Repeat rejection | >=5 rejected in 30 days and approved*4 < rejected | Code corresponds to approval share <20% of approved+rejected, not <25% as the prose suggests. Resolve meaning before changing policy. |
| Triage only | Accuracy >25m, new account, implausible travel, near hidden candidate, distant edit pin | Flags do not block. They are captured now; UI/admin queue surfacing deferred. |
| Concurrency | Per-user and one rounded 0.001-degree cell lock | Nearby cross-cell transactions can race. SECURITY.md already documents this residual risk; correcting or accepting it should be proportionate to early-market needs. |

Rejected attempts raise exceptions and roll back action-log writes. Stored flags/accepted-action counts cannot by themselves reveal denial rates/false positives. Privacy-conscious aggregates could support tuning; no new analytics stack/Phase 3 implementation is approved by this observation.

## 11. Validation evidence and unresolved integration issues

October 5 execution checks:

- Full local check passed: lint, type checks, secret scan, **223 tests** (admin 6, mobile 32, domain 105, importer 65, UI 15).
- Account mock-browser E2E passed, including signed-out discovery, correct RPC payload, GPS refusal/coalesced feedback and correction without GPS.
- All nine migrations executed successfully in a disposable local Postgres cluster. The **unmodified SQL suite fails** at account.test.sql:69 because it checks the obsolete 12-argument apply_location_review signature. All SQL suites and importer/manual/research contracts pass after changing only a temporary copy of that test to 15 arguments. Repository test is still unfixed.
- Original smoke runner fails with Mac Chrome because it lacks an explicit headless flag. All no-backend and signed-out smoke checks pass using a temporary runner with --headless=new. Repository runner is still unfixed. The local DB runner also assumes Linux Postgres paths/Bash array behavior; a temporary macOS adaptation was used.
- Remote **dry run** succeeds and lists only pending migration. It does not execute SQL remotely or prove runtime behavior against existing remote data.
- Earlier Phase 2 live checks and owner manual account tests passed; that evidence is for the pre-correction live backend. Corrected new-location submission has not yet been live validated. On-site check-in, full native devices, production tile provider and final accessibility/UX redesign remain separate needs.

Outstanding review findings (diagnosis/proposal, not instruction to independently build):

> **Resolution status 2026-10-05 (Claude recovery pass, local, uncommitted at time of writing):** 1 resolved by 20261008000001 (separate proposals + private flags). 2 resolved (global lock; withdrawing/deleting one proposal no longer affects another's item). 3 resolved (15-argument signature + v2 privilege checks; macOS DB/Chrome runners fixed in the repo). 4 open as BACKLOG OS-208b (no thresholds changed). 5 moot (no supporter path). 6 resolved: public average/count are community-only; admin ratings are history; existing aggregates recomputed; mixed-path and concurrent tests added. 7 unchanged (preserved gap). Evidence: TESTING.md, PROJECT_STATE.md.

1. Proximity-only duplicate logic conflicts with the future multi-unit-per-facility principle. Ask Claude for a narrow Phase 2 treatment preserving distinct proposals for review without building the facility/unit feature now.
2. Cross-cell concurrent submissions can escape coalescing; selected shared item can also race withdrawal/deletion. Decide proportionate handling and regression coverage, recognizing the race is already documented as residual risk.
3. Repair stale SQL privilege test; preserve both installed validator signatures and v2 restrictions. Make Mac runners reliable without changing product behavior.
4. Review restrictive caps/GPS friction and denial observability against the loose-until-evidence principle. No exact replacement threshold has been selected.
5. Secondary supporter dedupe checks only 30m while coalescing also matches same name within 100m. Repeated support outside 30m can consume quotas despite ON CONFLICT doing nothing.
6. **Newly identified during consolidation:** admin v2 rating logic computes locations.average_rating/rating_count from location_reviews, while community reviews' trigger computes the same fields from reviews. Static code shows two independent writers; last action can replace the other population's aggregate. Combined admin/community behavior was not established by the separate suites. Claude should verify with a mixed-path test and propose the intended aggregation; ChatGPT has not changed it or invented a new scoring policy.
7. Physical GPS verification intent exists in older owner handoffs but admin verification currently uses visit/date attestation. Preserve as an implementation gap; do not confuse check-in distance or new-submission GPS with final verification evidence.

## 12. Future roadmap: preserved, not pulled forward

- Phase 3: real admin authorization OS-301, moderation queue/actions, duplicate review/merge, CSV tools, seeded import extension and analytics. Existing local seed validator is partial groundwork, not blanket approval. OS-308 authoritative generic-name enrichment and OS-309 retention remain deferred.
- Facility vs restroom units: future distinct identifiers/parent relationship for malls, airports, multiple floors/rooms/shared addresses. Counts and physical layout/privacy facts remain planning only. Existing men/women/family review fields do not constitute the full model.
- Public review page: user-readable comments with pseudonymous username, stars, recency and trustworthy history; private notes never auto-public. Owner explicitly kept it behind its later gate. Current account observation UI is not this page.
- Phase 4: points ledger, achievements, leaderboards, referrals, community activity/sharing. PRD reference points are check-in +5, review +10, approved add +25, helpful report +10, referral +50; these are later design inputs, not active rewards. No gift-card redemption/funded liability approved. Avoid unhealthy check-in incentives.
- Phase 5: ads abstraction; premium entitlement, ad removal/unlimited favorites/richer amenity history; Apple/Google billing and Stripe web. PayPal optional/deferred. Prices, ad density/formats, subscriber forecasts and provider costs are not settled by the earliest brainstorm.
- Phase 6: opt-in notifications, privacy-conscious analytics, terms/privacy/community rules, source licensing, security/accessibility/performance audits, store readiness and explicit release approval. Full UI/UX/accessibility redesign precedes launch.
- Historical-only ideas: Facebook login, global-language onboarding, two favorites on home, business logos, exact 300x50/300x250 ad slots/every-third-row placement, Siri, transit and open-now variations. Preserve as ideas, not current commitments. Original paid ETA/advanced filters are not permission to paywall urgent accessibility/access facts.

## 13. Approvals and operating relationship

Prior approvals were specific: resource bindings, Next.js admin architecture, constrained discovery/data-model revisions, small Cody dev import, local admin fields/review migrations, OS-111 and Phase 2, earlier account migration applications. They do not authorize later migrations, full Phase 3, expanded OSM areas or deployment. Do not repeat already-granted access questions merely because an archived chat had an older restriction; actual sandbox/credential limitations still apply.

The owner repeatedly objected to being the integration layer and to losing ChatGPT oversight when Work became another builder. Going forward: keep this as the single continuing execution chat; make durable repo documents the handoff; consolidate Claude tasks; inspect/review rather than redesign; do authorized read-only/mechanical work directly; give brief outcomes and genuine gates. If user action is unavoidable, batch a checklist when appropriate instead of endless one-command exchanges. Keep permission answers very brief when requested.

The owner wants narrow Open Stall/files/tool access, not broad screen recording, normal browser passwords/cookies/profile/history or unrelated venture files. Existing explicit account/CLI permissions are not authorization to expose credentials. Earlier “Always Allow Keychain” advice is historical; do not silently configure blanket access.

Claude Code is installed at `/Users/jake/.local/bin/claude`. October 5 bounded read-only assignment failed with expired OAuth token. Owner reauthentication is needed before direct coordination can resume. No credentials from chat were used. Do not spawn replacement builders to bypass this relationship. Loops/direct assistant interconnection was a workflow aspiration, not a completed integration or new service authorization.

## 14. Resume protocol and next gate

Use OPEN_STALL_RESUME.md for the short handoff; load relevant sections here when needed. Before a new development assignment, confirm the consolidation has been accepted or the owner has issued the next task. Read current state/current backlog and verify checkout/bindings; preserve all local work. Do not automatically start Phase 3.

The recommended subsequent sequence is: restore Claude account access; send one narrow review/repair brief; Claude proposes/implements only approved Phase 2 corrections; ChatGPT assesses product/architecture impact and test evidence; rerun relevant checks and pending-only dry run; present the concrete migration for explicit owner live approval. Any proposal requiring unresolved product choices must be brought back rather than silently selecting a policy.

Current approval gate remains **intentional live application of `20261007000001` + `20261008000001` together, after ChatGPT review**, not a main merge or deployment. No live mutation should occur during context consolidation.

## 15. Source navigation

Detailed references and archive coverage are in OPEN_STALL_HISTORY_SOURCES.md. Original evidence stays read-only. The source register identifies documents that are historical snapshots so future agents do not revive obsolete instructions. Full Git chronology and sanitized recovered conversation files are stored under the Vindex workspace `context/history/`.

## October 5 source supplement: updated Old Chat 1.1

The updated original Pages source was reread in full and compared with its previous extraction. It adds approximately 11,600 characters, reaching the admin setup handoff instead of stopping at the public-comments question. It independently grounds the already-preserved one-Verified-label decision, separate unique-verifier/confirmation/recency counts, legitimate physical repeat visits, proposed 30–60m proximity evidence without permanent user GPS history, Claude’s 302c6fa validator behavior/safety report, and the local lockfile/manual-locations preservation history. These additions reinforce existing context; they do not authorize new development or retrospectively approve a live migration. The “I approve the additive review migration” passage is an assistant response in the retrieved original chat, not standalone human authorization; subsequent owner instructions and live-application records establish the historical approval/application. Historical setup commands remain evidence only and were not executed.
