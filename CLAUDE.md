# Claude Code Rules — Open Stall
You are working ONLY on Open Stall for Vindex Holdings.

## Continuity and oversight
Read GOVERNANCE.md first: it is the authoritative standing delegation framework and decision register (owner directive2026-10-18). Work owns product/architecture/security review and sequencing; Claude alone implements. Read current PROJECT_STATE and the latest CHATGPT REVIEW before acting. Older HANDOFF, resume/context and backlog notes are historical where superseded; never infer production, spending or access approval from them. No repeated owner approval is needed for Level1 work or Work-released Level2 local roadmap packages, including rewards P2–P4 after prerequisites. Consult historical sources only for relevant provenance. Claude remains on Sonnet unless a change is explicitly recommended/approved.

## Isolation
Before changes verify: current directory is Open Stall; git remote is Open Stall; branch is not main; provider bindings match ENVIRONMENT.md.
NEVER access, modify, branch, deploy, inspect, or guess another Vindex repo/project. If ambiguous, STOP.

## Architecture
TypeScript; Expo/React Native; Supabase/Postgres/Auth; Vercel web/admin; Expo/EAS mobile. Do not replace core architecture without approval. No user-uploaded photos in v1.

## Allowed within standing delegation
Level1: approved features, bounded UI/documentation/refactoring, tests/debugging, corrections and safe source commits/pushes in authorized Open Stall environments. Level2: Work-released security-sensitive local packages (auth/RLS/ledgers/moderation/fraud/retention/deletion) after focused review, preserving approved policy. Work independently reviews material risks before progression. P1 corrections remain authorized; P2–P4 require Work prerequisite/package approval, not a new Jake relay. Do not implement a package before Work releases it or start unrelated features while blocked.

## Mandatory owner approval (Level3)
Explicit Jake approval before production deployment/release/live mutation/migration/destruction; protected merges/force-push/destructive repository work; unrelated access, Mac permissions/broader filesystem/credential access or capability-expanding installations; new secret integrations; costs/services/subscription changes/overages; material architecture/new major features/business-rule changes; or material privacy-rights/retention/deletion/commercial/legal-policy changes. Work/Claude cannot waive these. Existing security/privacy policies and the permanent access restrictions below remain mandatory. Never expose credentials or weaken a meaningful test to accelerate work.

## Test environment and gate discipline
All test subprocesses, including deliberate bad-environment controls, use explicit allowlist environments, isolated temporary HOME and only synthetic poison values; no inherited service/passfile/cloud/credential configuration or unrelated filesystem access. Prefer existing isolated/cloud Open Stall resources over the personal Mac. These rules and env cleanup are not OS sandboxing: state actual filesystem/network isolation and evidence limits. Preserve test strength, PG16 specificity and Claude-versus-Work result provenance. Use GOVERNANCE.md's single decision register; do not recreate or re-escalate unchanged owner gates. Batch genuine exceptions. Preserve existing schedules and paused/enabled states unless explicitly authorized to change them.

## Usage efficiency
Repository files are memory. At start read PROJECT_STATE, current BACKLOG task, then only relevant docs/files. Avoid full PRD rereads, broad repo scans, long explanations, repeated summaries, unchanged-file rewrites, and full test suites after tiny edits. Use targeted tests while iterating.

## Usage-limit checkpoint
Before stopping or when context/usage is constrained: finish smallest safe unit; commit tested work; update PROJECT_STATE with branch, commit, completed/in-progress work, exact next action, failures and last tests; then STOP. On resume use PROJECT_STATE + Git, not chat history.

## Code
TypeScript strict. Validate untrusted input. Never commit secrets. Use env vars. Keep domain logic testable. Accessibility/urgent-use UX are first class. Pending user submissions are never public.

## Done
Acceptance criteria met; affected tests/typecheck/lint pass; no secrets; state/docs updated; work committed on feature branch.

Responses should be concise: changed, tests, blockers, next.

### Permanent access restrictions — owner authorized
Work only with Open Stall project resources, the GitHub repository vindexholdings/open-stall (operational branch claude-local), and temporary directories necessary for the authorized Open Stall task. This includes the existing Open Stall development, backup and QA workspaces only when needed for that task. Do not access, list, search, read, upload, modify or use unrelated Vindex projects, personal folders (including Desktop, Documents, Downloads and personal cloud-sync folders), unrelated cloud accounts or credentials without Jake's explicit approval. Do not inspect credential contents. Existing authenticated tooling may be used for authorized Open Stall operations without exposing credentials; no credential discovery or access to unrelated provider bindings is permitted. Preserve authorized coding, local testing/debugging, documentation and safe commits/pushes within scope. If required access falls outside this boundary or its purpose is ambiguous, stop that access and report the exact need for approval. These are agent operating restrictions, not a claim of operating-system isolation or changed macOS permissions.
