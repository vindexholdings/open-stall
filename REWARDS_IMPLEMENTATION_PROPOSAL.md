# Rewards local implementation proposal (planning only)

Status: PROPOSAL, written 2026-10-11 for Work's assignment (`ad52d11`). **A proposal is not permission to implement.** Nothing here authorizes rewards code, schema, SQL, RPC, UI, a migration apply, activation, a production connection, deployment, merge, merchant redemption, a dependency, a service or any cost. It sequences the accepted designs in `VIP_REWARDS_PLAN.md` (G2) and `ACHIEVEMENTS_PLAN.md` (G3) into the smallest substantial local package first. Settled product rules are not reopened: no cooldown; first local-day visit +5 spendable and +5 lifetime; visits 2-4 +5 spendable only; 5+ recorded without points; provisional 60 spendable per account UTC day; reversals never restore capacity; held visits keep their original policy, day and ordinal; production rewards DISABLED and the global production budget unset. Security/privacy review is a required implementation gate, not settled by documentation acceptance.

## 1. Package sequence
| Pkg | Scope | Depends on | Not included |
|---|---|---|---|
| **P1 (first, smallest substantial)** | G2 core on a disposable Postgres: policy versions, default-disabled settings, `visits`, pure `evaluate_visit`, `record_visit`, append-only ledger with disjoint lifetime/spendable blocks, user-day and global counters, locks and rollback, role/privilege model, and the disposable-database harness | accepted G2 design; existing `npm run test:db` harness pattern | reversals, holds, deletion/purge, retention, achievements, any UI, any change to live `check_in` |
| P2 | `reverse_reward`, MFA hold/clear (`award_held_visit`), purge role and `purge_reward_data_for_deleted_user`, retention function, month-keyed deleted aggregate, reporting views | P1 passed; **security/privacy review of the P1 role model and the P2 design (gate)** | achievements, UI |
| P3 | G3 schema (definitions, chains, events, queue), `evaluate_achievements`, `get_my_progress`, `repair_achievements` | P1 and P2 passed | UI |
| P4 | local mock-only UI: progress card against `scripts/qa-mock-server.mjs`, accessible states, e2e | P3 passed | device claims, real data |
| later gates (not planned here) | cutover from legacy `check_in`, enabling rewards in production, any global budget, legal/accounting review, content approval | separate approvals | everything |

## 2. Precise source boundaries (P1)
- **New migrations live OUTSIDE `supabase/migrations/`**, in `supabase/rewards-wip/` (files `R001_...sql`, ...). A remote `supabase db push` reads only `supabase/migrations/`, so nothing in `rewards-wip/` can ever be applied remotely by accident. Moving a file into `migrations/` is a separate, explicitly approved step.
- New harness `scripts/test-db-rewards.sh` (a copy of the `scripts/test-db.sh` pattern: throwaway cluster in a `mktemp` directory on a unix socket, destroyed on exit) applies `supabase/tests/bootstrap.sql`, then `supabase/migrations/`, then `supabase/rewards-wip/`, then runs `supabase/tests/rewards/*.test.sql` and `supabase/tests/rewards/*.sh` (two-session). New npm script `test:db:rewards`. It is NOT added to `npm run check` or CI until P1 passes and Work agrees.
- New check script `scripts/check-rewards-boundary.mjs`: fails if any file in `supabase/migrations/` references a reward table or function, if `rewards-wip/` contains a name already in `migrations/`, or if any rewards file mentions a connection string, project ref or key. It is run by the harness and, once accepted, by `npm run check`.
- **Untouched in P1:** all existing migrations, `check_in` and its 12-hour/10-per-day behavior, `apps/mobile`, `apps/admin`, `packages/*`, CI workflows, `.env*`, docs other than state files and this proposal's follow-ups.
- Allowed new files only: `supabase/rewards-wip/*`, `supabase/tests/rewards/*`, `scripts/test-db-rewards.sh`, `scripts/check-rewards-boundary.mjs`, `docs/evidence/rewards/*`, plus edits to `package.json` (one script), `PROJECT_STATE.md`, `BACKLOG.md`, `TESTING.md`, `HANDOFF.md`.

## 3. Disposable-only environment safety and default-disabled behavior
- The harness refuses to start if `DATABASE_URL`, `SUPABASE_DB_URL`, `PGHOST`, `PGSERVICE` or any `SUPABASE_*` variable is set to anything other than empty or a local socket path, never reads `.env*`, and connects only to its own socket. The boundary check above also scans rewards files for connection strings. No network access is needed or used.
- `reward_settings` is a single-row table inserted by the migration as `rewards_enabled = false`, `global_budget = NULL`. No client role and no P1 function can change it. Tests enable it only inside a test transaction on the throwaway cluster. A post-migration assertion on a fresh cluster proves: settings are disabled and unset, `record_visit` records a visit and issues nothing (both outcomes `rewards_disabled`), and the ledger and counters are empty.
- Legacy `check_in` is regression-tested unchanged (same 12-hour guard and 10/day limit) in the same run, so coexistence is proven rather than assumed. Anonymous discovery functions and their grants are compared before and after (golden catalog diff).

## 4. Roles and privileges (separating writer, client and purge)
| Role | Kind | Rule |
|---|---|---|
| `anon`, `authenticated`, `service_role` | client/API | no privilege of any kind on any rewards or achievement table (no SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER); `EXECUTE` only on the public RPCs below |
| `reward_writer_owner` | NOLOGIN, NOINHERIT, no BYPASSRLS | owns the SECURITY DEFINER writer functions; may INSERT/SELECT (and UPDATE only on counter tables); NO DELETE, NO TRUNCATE, and NO UPDATE on the ledger, visits, chains or events |
| `reward_purge_owner` (P2) | NOLOGIN, NOINHERIT, no BYPASSRLS | owns only the purge function; DELETE and column UPDATE exactly as in `VIP_REWARDS_PLAN.md` section 7 and `ACHIEVEMENTS_PLAN.md` section 6; NO INSERT |
| table owner / migration role | superuser-like | not used at runtime; guard triggers still refuse protected changes by `current_user` |
Every protected table has statement-level `BEFORE TRUNCATE` triggers that always raise, and row-level append-only triggers (invoker security, fixed `search_path`, `current_user`-based). Function entry matrix: public RPCs `record_visit` (P1), `get_my_progress` (P3) = `authenticated` only; admin RPCs `reverse_reward`, `clear_hold`, `repair_achievements` (P2/P3) = `authenticated` with the existing admin identity and MFA gate checked inside; internal `evaluate_visit`, `evaluate_achievements`, award blocks, queue helpers = NO client EXECUTE (non-exposed schema, revoked from `public`, `anon`, `authenticated`, `service_role`); purge = EXECUTE only to the owner of `delete_my_account`. **Tests are golden catalog queries**: enumerate every privilege on every rewards table and function with `aclexplode`/`has_*_privilege` and compare to the expected set (any extra grant fails); attempt each forbidden operation as each role and expect `42501` or a trigger refusal, including TRUNCATE; independent MFA adjudication and append-only moderated originals are asserted unchanged.

## 5. Bounds to prove, not assume (applies to P1-P3)
| Bound | Provisional value | Proof required |
|---|---|---|
| repair users per call | 20 (server maximum) | invalid `p_limit` (NULL, 0, negative, above 20) rejected with `22023` or clamped as documented; test both |
| chains per user per evaluation call | 50 | processing remainder retained in `dirty_scope` |
| ledger rows scanned per evaluation call and elapsed time | proposed 5,000 rows and 2 s (local `statement_timeout` as a guard, not as handled flow) | representative data: one user with about 3,000 lifetime rows over 36 months (many windows) and 2,000 users with 30 days each; record `EXPLAIN (ANALYZE, BUFFERS)` and timings; if limits are exceeded, adjust and document, never silently widen |
| public progress paging | page size at most 50 chains, cursor-based | a user with 500 chains pages without scanning all history per request; invalid page size rejected |
| `dirty_scope` size | capped (proposed 500 chains) with an overflow flag meaning a bounded full re-scan | merge test: scopes are UNIONED, never overwritten; overflow behaves as specified |
| lock starvation | skipped users keep their row; order by `last_attempt_at` nulls first then `first_failed_at` | with one user's lock held repeatedly, other users' rows are still processed and the held user is eventually processed once released |
Queue data is user-linked repair data: it is deleted by the purge (test: no queue row survives deletion), never retained.

## 6. Version rule and failure handling (carried constraints)
- Progress reads and evaluation both call one `ach_effective_version(chain)` function: an awarded chain uses the version recorded on its latest `award` event; a revoked or unawarded lifetime chain uses the latest version in effect; a windowed chain uses the version fixed by the window start. Required test: threshold change, then reversal (revoke under the old version), then re-earn under the new version (`ACHIEVEMENTS_PLAN.md` section 4).
- Recoverable SQLSTATE handling is a HYPOTHESIS: the harness verifies on real Postgres 16 that `55P03` under a local `lock_timeout` is caught inside the block, that `57014` (statement timeout and cancellation, including `pg_cancel_backend`) behaves as feared and therefore propagates, and that `42501`, class `23` (other than designed no-ops), `40001`, `40P01` and class `XX` always propagate and abort the whole transaction. A handler never uses `when others`. Production safety gates (`rewards_enabled`, unset budget) are checked BEFORE any award block and cannot be bypassed by a caught error.

## 7. Dependency map
`bootstrap.sql` + existing migrations -> P1 (`reward_settings`, `reward_policy_versions`, `visits`, `evaluate_visit`, `record_visit`, `reward_ledger`, counters, role model, harness) -> [security/privacy review gate] -> P2 (`reverse_reward`, `clear_hold`/`award_held_visit`, purge, retention, reporting) -> P3 (`achievement_*`, `evaluate_achievements`, `get_my_progress`, `repair_achievements`) -> P4 (local mock UI). Legacy `check_in` and anonymous discovery run beside P1 untouched. Existing admin identity, MFA and `moderation_log` are reused, never extended in authority.

## 8. P1 test matrix and evidence requirements
Each item is a SQL test file or a two-session shell scenario in `supabase/tests/rewards/`; pure `evaluate_visit` cases are table-driven.
1. **Policy evaluation table** for every row of `VIP_REWARDS_PLAN.md` 11.3, including lifetime independence of the spendable cap; rapid four visits in a minute earn 20/5, the fifth is recorded only; no code path computes a same-location interval.
2. **Safety gate:** disabled and unset-budget issue nothing; default state of a fresh cluster; clients cannot change settings.
3. **Time:** day boundaries for America/Denver and a second zone, DST days 2026-11-01 and 2027-03-14, UTC cap across local days; invalid or missing zone fails closed.
4. **Concurrency (two real sessions):** one idempotency key from two sessions; racing for the 4th slot and for the last unit of the 60 cap and of a fixture budget; lock order shows no deadlock across locations; forced global exhaustion on a first visit leaves one lifetime row and no spendable row.
5. **Rollback and error classes:** injected failure in the spendable block; unexpected error aborts the whole visit and a retry with the same key succeeds; the SQLSTATE hypothesis tests of section 6.
6. **Privileges:** the golden catalog diff and refusal matrix of section 4; legacy `check_in` and anonymous discovery regression.
7. **Ledger invariants:** append-only (UPDATE/DELETE/TRUNCATE refused for every role), unique award per `(visit, kind)`, unique lifetime per user/location/local day, check constraints, balances equal ledger sums.
8. **Bounds** of section 5 for the P1 parts (counter merge, invalid inputs).
9. **Mutation checks:** remove each key guard (a trigger, a unique index, a lock, the safety gate) and show the matching test fails, then restore.
10. **Boundary:** the check script passes; no `.env*` read; no network.
**Evidence requirements:** commit hash, `postgres --version`, the exact command, per-file pass/fail counts, the `EXPLAIN` outputs and timings, the golden privilege list, mutation-check results, and an explicit statement that no production connection was made. Results are committed under `docs/evidence/rewards/` and reported with their limits (Linux, disposable Postgres, no device, no production, no legal or privacy certification). P2-P4 get their own matrices when authorized.

## 9. Gates still ahead and exact owner authorization text for P1
Implementation gates (none cleared by this document): (1) owner/Work authorization of P1 scope below, if required under the latest planning-only instruction; (2) security/privacy review of the P1 role model before P2; (3) Work review of each package's evidence; (4) separate approvals for cutover, enabling rewards, a global budget, legal/accounting review, content approval and any cost.
**Proposed authorization text (for Jake/Work to give, or amend):**
> I authorize Claude to implement and test, on a disposable local Postgres only, the first rewards package (P1): new SQL files under `supabase/rewards-wip/`, tests under `supabase/tests/rewards/`, `scripts/test-db-rewards.sh`, `scripts/check-rewards-boundary.mjs`, one `package.json` script and the associated documentation, exactly as described in `REWARDS_IMPLEMENTATION_PROPOSAL.md` sections 2 to 8. Rewards stay disabled and the global budget unset. This does NOT authorize any connection to a production or hosted database, applying any migration to one, moving files into `supabase/migrations/`, changing `check_in` or any existing file outside the allowed list, any UI, deployment, merge, new dependency, service or cost, merchant redemption, or enabling rewards anywhere.
