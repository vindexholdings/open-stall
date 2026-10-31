# Open Stall — short continuation brief

Updated 2026-10-06. Canonical context: OPEN_STALL_CONTEXT.md. Evidence/coverage: OPEN_STALL_HISTORY_SOURCES.md. This brief does not authorize new development.

- Product: fast/simple/fun GasBuddy for bathrooms; nearest usable restroom, public discovery without login, accessibility and low friction. Accounts for contribution/personalization. Preload useful data; retain honest verification/provenance and privacy.
- Roles: ChatGPT oversight/architecture/product review; Claude primary builder (Sonnet unless approved otherwise). Minimize copy/paste. No extra credits/new paid services. Do not introduce another planning/build direction.
- Checkout: /Users/jake/open-stall; claude-local; afdb89a merges 0fa3e3a; ahead five of origin/claude/pensive-brahmagupta-wrrhxn. Keep existing checkout and local reviewDetails work. Preserve untracked manual-locations.json/.PROJECT_STATE.md.swp and ignored envs/backups.
- Phase: OS-111 approved; Phase 2 COMPLETE: migrations applied live and validated 2026-10-06 (doctor + permanent-account live:account --contribute passed). Email/password/confirmation/reset working. Google deferred/not configured, Apple skipped, Yahoo evaluated/deferred. Permanent test account stays.
- Database: 20261004000001-3, 20261005000001-2, 20261006000001-3, 20261007000001 and 20261008000001 all applied live; ledger aligned through 20261008000001. Nothing pending.
- Approved contribution policy: new restroom from current location for normal user; admin/importer coordinate control; normal correction needs no presence. Start controls loose/observable, tune from market evidence. Exact hard thresholds are under review, not market-tested decisions.
- Trust: one public Verified concept; backend retains admin/user origin. Repeat visits count as history/recency, not extra unique people. Future GPS proximity for physical verification remains unimplemented in current admin visit/date flow. Public comments page deferred; private notes remain private.
- UI: functional scaffolding; full UI/UX/accessibility redesign after core functionality/data/admin stabilization and before launch. No isolated polish.
- Deferred: separate facility/location from individual restroom units (several per address); counts for stalls/toilets/urinals/sinks; private/single-user/shared, dividers/partitions, locking door, family/layout/privacy. Captured as BACKLOG OS-310 (planning only, do not build now). OS-308 generic names requires authoritative evidence; OS-309 retention proposal not policy yet.
- Tests (2026-10-05 recovery pass, all local): lint, typecheck, secret scan, 223 unit tests (admin 6, mobile 32, domain 105, importer 65, UI 15), `npm run test:db` (all migrations, SQL suites, two-session concurrency, importer/manual/research contracts), auth e2e 56 checks, smoke e2e 25 checks, admin build, web/android/ios bundles. macOS runners are fixed in the repo. Current-location and policy correction NOT live validated.
- POLICY REPAIR FINISHED 2026-10-05 (committed cebe3f2; applied live 2026-10-06): nearby proposals stored separately with private admin flags (no proximity/name reject or merge); exact own retry within 10 min is idempotent; global lock (no cross-cell race); community-only public ratings (admin ratings = history), aggregates recomputed. Details: PROJECT_STATE.md, SECURITY.md.
- Earlier review hold: resolved by the repair; caps/indoor GPS friction/denial telemetry remain open as BACKLOG OS-208b.
- Gates: no main/PR merge, production deploy, broader geography, Phase 3/OS-301, paid services, destructive operations or live DB application without explicit approval. ODbL/tile provider/launch gates remain. Do not run npm audit fix/--force.
- Next: no authorized work. OS-208b threshold tuning stays backlog. No Git push or deployment has occurred; PR #1 merge, deployment and Phase 3/OS-301 each need explicit approval.

First session: read this brief and relevant canonical-context sections. Later resumes: use PROJECT_STATE.md + current BACKLOG task + needed sources; avoid reloading every historical message or asking for existing keys.

History update: owner-revised Old Chat 1.1 reread October 5; verification/recency/GPS/validator/admin handoff recovered and incorporated. Original cutoff resolved; source register tracks remaining transcript/image gaps.
