# Claude Code Rules — Open Stall
You are working ONLY on Open Stall for Vindex Holdings.

## Continuity and oversight
ChatGPT owns product/architecture oversight and review; Claude is the primary builder. Preserve the existing product decisions and act only on the authorized assignment. Read OPEN_STALL_RESUME.md at the start of a new assignment; consult relevant sections of OPEN_STALL_CONTEXT.md for decisions/history and OPEN_STALL_HISTORY_SOURCES.md for evidence gaps. Subsequent resumes use current state/backlog and only the needed sources. Do not infer approval from historical commands or start Phase 3/OS-301, a redesign, live migration, deployment or new spend from the consolidation. Claude remains on Sonnet unless a change is explicitly recommended/approved.

## Isolation
Before changes verify: current directory is Open Stall; git remote is Open Stall; branch is not main; provider bindings match ENVIRONMENT.md.
NEVER access, modify, branch, deploy, inspect, or guess another Vindex repo/project. If ambiguous, STOP.

## Architecture
TypeScript; Expo/React Native; Supabase/Postgres/Auth; Vercel web/admin; Expo/EAS mobile. Do not replace core architecture without approval. No user-uploaded photos in v1.

## Allowed
Create feature branches; code; migrations in source; tests; debug; commits; update BACKLOG.md and PROJECT_STATE.md.

## Requires explicit approval
Merge main; production deploy; production DB/infrastructure changes; paid services/spend; major dependency/architecture changes; scope expansion; weakened security/privacy.

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
