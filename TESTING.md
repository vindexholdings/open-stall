# Testing
During implementation test smallest affected surface; full gates at milestones/PR/release.
Required: TypeScript typecheck, lint, domain unit tests, database/RLS tests, critical integration tests, E2E smoke tests once established.

Critical flows:
1 location permission allow/deny
2 nearby verified sorting
3 filters
4 pending submission invisible publicly
5 admin approval makes canonical/public
6 navigation
7 free favorites cap
8 premium entitlement
9 points anti-duplication
10 account deletion
11 non-admin rejected from admin operations

Milestone gate: build/install, typecheck, lint, relevant tests, E2E smoke where available, secret check, PROJECT_STATE update.
