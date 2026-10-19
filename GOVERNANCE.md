# Open Stall development governance

Owner-authorized 2026-10-18. This document is the current authority for delegation, the decision register and current delivery state. It supersedes conflicting older procedural approval requirements, including historical HANDOFF entries. It never overrides security, privacy, spending or production restrictions. HANDOFF carries assignments/evidence; CLAUDE.md carries builder rules. Historical notes remain provenance, not fresh gates.

## Decision authority

| Level | Who decides | Scope and evidence |
|---|---|---|
| 1: autonomous | Claude executes; Work reviews and sequences | Previously approved features, bounded UI work, documentation, regression fixes/refactoring and technical corrections within established architecture/roadmap. Routine commits, tests and packages require no Jake relay. |
| 2: enhanced Work review | Work releases a bounded package after focused security/privacy/architecture review; Claude alone implements | Isolated development of auth/authorization/RLS, ledgers, moderation, fraud, retention and deletion within approved policy. Work independently verifies material risks and releases subsequent ready packages. This includes local rewards P2–P4 after prerequisites; it is not blanket advance acceptance. |
| 3: owner only | Jake explicitly approves before action | Production deployment/release/live mutation/migration/destruction; protected-branch merges, force-push or destructive repository work; unrelated access; Mac permissions/broader filesystem/credential access or capability-expanding installs; new secret integrations; costs/overages/services/infrastructure spend; material architecture/new major features/business-rule changes; material privacy rights/retention/deletion/commercial/legal policy decisions. Work/Claude cannot waive these. |

Previously approved business rules and privacy/security policies stay fixed. A technical implementation choice inside them is Level 2, not another owner policy question. If an actual policy gap appears, batch the smallest concrete decision and recommendation; do not invent an approval for each task.

## Mac, credentials and test isolation

- Prefer Open Stall GitHub and already available isolated/cloud development. Mac access only when necessary, confined to authorized Open Stall resources and necessary temporary directories. No home-directory browsing, personal Desktop/Documents/Downloads/cloud storage, unrelated Vindex projects, shell profiles, keychains or credential contents.
- Keep CLAUDE.md's permanent access paragraph intact. Existing approved authenticated tools may operate on Open Stall without extracting credentials; new credential access, integrations or broader permissions are Level 3.
- Every test subprocess and deliberate negative control uses a constructed allowlist environment and isolated temporary HOME. Strip inherited credential/cloud/libpq/service/passfile/password/options configuration; inject only synthetic test values deliberately. Never use the real caller environment as the unsafe control. No production connection or unrelated filesystem access.
- Environment allowlisting is not an OS sandbox. Combine it with restricted filesystem mounts/permissions, no production bindings/secrets, least-privilege execution, bounded resource use and network controls appropriate to the runtime. State what was actually enforced; never claim OS isolation merely from instructions or env cleanup.
- Keep meaningful security tests, real race tests and mutation checks. Correct defects within authority; do not weaken tests, substitute PG18 for PG16, or count Claude-run tests as Work-run verification.

## Delivery workflow

1. Read current governance/register, state and latest HANDOFF. Work chooses dependency-ready bounded packages; Claude implements only written authorized scope in approved environments.
2. Level 2 packages require a focused threat/privacy/authority review and measurable acceptance criteria before implementation. Work may extend routine test/CI/documentation boundaries explicitly within existing roadmap; this cannot authorize Level 3 actions.
3. Deliver exact implementation/evidence/handoff SHAs and environment-specific results. Work inspects relevant code and independently reproduces material risks. A seen fingerprint is not a review; NEEDS_CHATGPT_REVIEW is actionable even if unchanged. Specific verified corrections dispose that delivery; a blocked/in-progress review does not.
4. On acceptance, Work releases the next ready Level 1/2 package in the same decision. P2–P4 need no repeated owner package approval. If prerequisites fail, fix within scope; otherwise advance independent authorized work, not speculative features.
5. Preserve other sections/local work; re-read before writes, never force or auto-resolve conflicts. Ordinary source commits/safe pushes need no owner relay. Protected branches/old branch/PR #1 remain unmerged. No deployment/production side effects.
6. Keep Work :00 and Claude :30 with their existing identities. Work checks are ACTIVE following Jake's explicit resume. Do not duplicate schedules, change Claude's routine or silently toggle states. Four-successful-active-check inactivity and two-successful-check pending-Work safeguards remain; waiting for Work/owner/usage reset is not Claude inactivity. Failed/missed/paused observations are not invented.
7. Notify only new owner decisions, material changes or meaningful security incidents. Latch/deduplicate unchanged gates. No external email/Slack. Included Claude allowance is a hard limit; no paid workaround.

## Authoritative decision and gate register

This is the only active owner-decision register. Other docs link here; HANDOFF/history and the local coordination JSON retain evidence/latches, not competing policy. No OPEN_OWNER action is presently needed while the compliant CI route is being prepared. Move the existing PG16 row to OPEN_OWNER only if that route actually cannot operate within authority.

| ID | Status | Specific action / reason | Existing authority; duplicate/superseded gate | Exact closure condition |
|---|---|---|---|---|
| OS-P1-LOCAL | CLOSED: owner approved | Disposable PG16 P1 core; security-sensitive | Jake's 2026-10-17 approval / Work90a07e8; supersedes repeated P1 package requests | Approval recorded; implementation still needs Work acceptance |
| OS-D3-PINNED-IPHONE-UX | CLOSED: owner approved | Corrected D3 visual design on iPhone | Jake2026-10-17 / ba74a7c; supersedes D2/D3 visual-pending gate only | Visual approval recorded; no unperformed test converted to pass |
| OS-WORK-PG16-RUNTIME | WORK_ACTIONABLE: isolated CI preparation | Independently run reviewed P1 under PG16 without personal-Mac install or inherited credentials | Existing environment blocker retained as ONE row. New Level2 delegation plus existing public-repo Actions offers a potential compliant path; earlier Mac-provisioning request is conditional, not repeated | Work inspects isolated job, triggers reviewed SHA, verifies actual PG16/isolation and required SQL/race/mutation evidence. Until then no independent DB acceptance |
| OS-REWARDS-P2-P4 | DELEGATED: Work prerequisite gates | Local P2 fraud/holds/reversals/deletion/retention; P3 achievements/progress; P4 local UI | 2026-10-18 standing Level2 authority supersedes separate owner P2/P3/P4 package approvals. Approved business/privacy policies unchanged | Work accepts each prerequisite, performs focused next-package review and issues written bounded assignment |
| OS-RELEASE-READINESS | OPEN_WORK: evidence | Native/device/reader, session/recovery, map/accessibility and final-source regression gaps | Visual approval is not release QA. Retain exact tested/not-run provenance; no duplicate visual approval | Itemized required source/device/runtime test evidence passes; separate owner release approval still mandatory |
| OS-PRODUCTION-RELEASE | DEFERRED_OWNER | Any production access/change requiring approval, migration/deploy/release or protected merge | Standing Level3; not a request to act now. Prior approved migration is not re-applied | Jake approves a concrete reviewed action, target and limits; completed only with verified execution |
| OS-ACCESS-COST-POLICY | DEFERRED_OWNER | Broader access/install/secrets, cost, material architecture/business/privacy/retention/deletion/legal change | Standing Level3; no new action proposed now. Approved90-day provisional cleared-hold retention and established deletion provenance remain | Batch exact proposed exception, reason and bounds; obtain explicit Jake approval before action |

A newly discovered owner decision gets a unique row with the same fields, not an hourly duplicate. Routine technical choices stay in Work assignments. Do not re-request already observed admin-page loads or applied migrations; distinguish owner evidence from independent Work evidence and still-unperformed save paths.

## Current delivery state and next milestones

- **Milestone1: P1 secure local core + independent verification.** Owner approved; NOT accepted by Work. Latest source0e69c5f, evidence6ac1f83, handoff78d7ced. Prior ledger and primary probe fixes are source-reviewed; actual PG16 SQL reproduction pending. Fix the deliberate control's inherited environment, then prepare an independently reviewable test-only CI job. No rewards outside disposable fixtures; production switch disabled/budget unset.
- **Milestone2: P2 local security lifecycle.** After P1 acceptance and focused Work security/privacy review, Work may release bounded holds/clearance/reversals, existing independent MFA admin checks, retention/deletion/purge/reporting per approved policy. No policy change, production access or UI expansion.
- **Milestone3: P3 then P4 achievement/progress delivery.** After P2 acceptance, Work may release G3 evaluation/provenance/privacy and then local mock UI after P3 acceptance. Real ledger-derived state only; content/business-rule gaps go to Jake only if material. No merchant redemption/new monetization/paid maps/new features.
- D3 visual approved; native Android/VoiceOver/TalkBack and other unperformed release tests remain open. Independent approved work may proceed without claiming those passed.

## PG16 environment assessment (2026-10-18)

Read-only assessment found only Postgres.app18.3 on the Mac and no docker/podman CLI; no Mac installation or permission change performed. Open Stall repository is public; existing Actions CI is configured but has no P1 command, no manual dispatch and no claude-local runs. Its ordinary triggers do not yet supply independent P1 evidence.

A compliant preparation path exists in the SAME GitHub Actions service: standard public Ubuntu24.04 runner, preinstalled PG16, throwaway socket-only clusters, no production credentials, no install/dependency upgrade/paid runner/service container/artifact storage. Official sources: [public standard runners are free](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job) and [Ubuntu24.04 installed software](https://github.com/actions/runner-images/blob/main/images/ubuntu/Ubuntu2404-Readme.md). Documentation is not proof of this job's actual runtime or results; verify major16 and actual runner/isolation at execution, abort if absent.

Claude may prepare `.github/workflows/rewards-p1-validation.yml` as a narrowly approved test-only P1 boundary extension. Work must inspect its exact SHA/security before enabling an execution trigger (for example a deliberate push of the reviewed SHA to a dedicated validation branch). No scheduling, protected merge, deployment, write token, secrets, new integration or self-hosted/personal-Mac runner. Checkout credentials must not persist; tests get a minimal environment and own HOME. Pin reviewed action/source versions, bound timeout/concurrency, use log-only evidence and verify zero-cost standard public-runner eligibility. Do not auto-trigger it on claude-local before Work review. No new owner approval is required for this compliant Level2 test setup; if a new secret/cost/access/installation/permission exception is actually required, keep this ONE environment gate and escalate precisely once.
