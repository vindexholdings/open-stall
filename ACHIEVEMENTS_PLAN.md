# Achievements, challenges and progress plan (G3: design and planning only)

Status: PLANNING ONLY, written 2026-10-11 for Work's assignment (`65103e2`). Nothing here is built, migrated, enabled or shown to users. It authorizes no code, schema, migration, dependency, points UI, activation, merchant system, live change, deployment, merge or cost. **Every threshold, name, window and wording below is a PROPOSAL, not an owner approval and not a live feature.** It builds on the accepted G2 semantics in `VIP_REWARDS_PLAN.md` (no cooldown; four rewarded visits per user/location/local day; independent lifetime and spendable outcomes; gross-issuance counters; held visits; deletion rules). Production rewards stay DISABLED, so no achievement can exist in production until its own gates (G2 implementation, activation approval) are met.

## 1. Principles
- **Real data only.** Progress and awards are computed exclusively from real ledger rows (and, optionally, approved contributions). Nothing is invented, sampled, pre-filled or estimated. A user with no ledger rows has no progress, no badges and sees honest empty states.
- **Lifetime is the source, not spendable.** Achievements read only `lifetime` ledger entries (one per user/location/local day by the G2 unique index) and never the spendable balance. A user whose spendable cap is exhausted still progresses, because lifetime is independent by design; spending (none exists) can never reduce an achievement.
- **No streak pressure.** No consecutive-day streaks, no loss-aversion timers, no "you will lose" messaging. (Streaks add timezone edge cases, pressure to visit restrooms for points, and little user value.)
- **No offers, no merchants, no money.** Achievements carry no discount, access or cash value; any benefit would trigger the economics/legal review already required for lifetime points (`VIP_REWARDS_PLAN.md` section 6).
- **Reuse the architecture.** Postgres/Supabase functions, the existing Expo/React Native screens, the existing `Icon` set (the `medal` icon already exists). No new services, licenses, fonts, illustration or image assets, and no photos (CLAUDE.md: no user-uploaded photos in v1).

## 2. Data sources and dependencies
| Source | Used for | Notes |
|---|---|---|
| `reward_ledger` rows `kind = 'lifetime'` (awards and reversals) | all point/place/active-day achievements | joined to the visit for the stored location, local day, UTC issuance day; a reversal removes the award from progress |
| `visits` (accepted, non-held, not confirmed-fraud) | stored local day and location for windows | a held visit contributes nothing until cleared, then counts on its ORIGINAL local day (G2 11.4a) |
| Approved contributions (existing submissions with status approved) | optional "contributor" badges, a second source | PENDING submissions never count (CLAUDE.md: pending submissions are never public); proposal only, may be deferred |
Dependency map: G2 (`record_visit`, ledger, unique lifetime index, reversals, held-visit clearance, stored days, deletion purge, reporting basis) -> G3 evaluation and progress read -> dashboard "VIP progress" card (replaces today's non-interactive preview) -> nothing downstream. Nothing in G3 feeds back into rewards eligibility.

## 3. Small configurable catalog (proposals)
Definitions live in an immutable, versioned `achievement_definitions` table (key, kind, metric, threshold, window, active range, copy), changed by inserting a new version; changes are prospective, like reward policy.
| Kind | Name (proposal) | Rule (proposal) | Why |
|---|---|---|---|
| Lifetime badge | First Stop | first lifetime award (any location) | immediate, honest acknowledgement of the first real check-in |
| Lifetime badge | Regular | 50 lifetime points (10 first-daily check-ins) | modest habit marker |
| Lifetime badge | Trailblazer | 10 distinct locations with a standing lifetime award | rewards breadth, helps coverage of real data |
| Lifetime badge | Century | 100 lifetime points | long-term marker |
| Monthly challenge | Explorer of the Month | first-daily check-ins at 5 distinct places during the calendar month | a reachable target (about 1 per week) |
| Monthly challenge | Steady Month | first-daily check-ins on 8 distinct local days during the month | frequency without streaks |
| Seasonal collectible | e.g. "Winter 2026-27 Explorer" | complete a defined seasonal challenge (for example 8 distinct places between two dates) | permanent, collectible once earned; text and tone only, built from the existing medal icon, no new art |
Dormant by design: a "distinct towns" badge stays out of the catalog until real data exists in more than one town (no geography expansion is authorized). Contributor badges (for example 1 and 10 approved contributions) are optional and need owner confirmation.
User value versus effort (candid): the value is acknowledgement and a small reason to return; the evidence that it drives retention here is unvalidated. Cheapest validation: ship one lifetime badge and one monthly challenge first; add seasonal collectibles only if those are used. Effort: catalog table and evaluator S/M; progress read function S; dashboard progress card M; seasonal and contributor sources M each.

## 4. Evaluation, idempotency and concurrency
- **Progress is computed, never stored or edited.** A read function derives each definition's current numerator/denominator from the lifetime ledger joined to visits, so progress cannot be fabricated and reflects reversals automatically.
- **Awards are an append-only event log**: `user_achievement_events(user_id, definition_id, period_key, seq, event 'award'|'revoke', basis_entry_id, decision_id, created_at)`. Current state = the latest event per `(user_id, definition_id, period_key)`. `period_key` is `lifetime` for badges or the window (for example `2026-10`) for challenges. A unique key on `(user_id, definition_id, period_key, seq)` plus the user-level lock makes a double evaluation or two concurrent sessions crossing the same threshold produce exactly one award.
- **When it runs:** `evaluate_achievements(user)` runs inside the visit transaction as a THIRD, disjoint savepoint block A after blocks L and S (G2 section 4a), under the per-user lock already held (lock order 1; no new lock objects). A failure in A is recorded and never rolls back the reward; the evaluation is a pure function of the ledger, so the next evaluation (or a repair job) catches up idempotently. Achievements are eventually consistent and can never block or alter a reward.
- **Held-visit clearance** triggers an evaluation; the visit counts on its original local day for windows.
- **Recorded-only visits** (fifth and later) earn no lifetime row, so they add no progress.

## 5. Windows, time zones, eligibility
- A challenge window is a pair of LOCAL dates (`starts_on`, `ends_on`). A qualifying lifetime award counts for the window if the visit's stored location-local date falls in it, using the location's IANA zone (Cody: America/Denver). The same rule is used for every location, so a window never depends on the device clock or the user's own time zone.
- Eligibility: only lifetime awards that are not reversed; held, confirmed-fraud and recorded-only visits do not count; anonymous (signed-out) use has no achievements.
- A completed monthly challenge is awarded once for its `period_key`; progress resets by window, not by deletion of history. Seasonal collectibles are awarded once per season and kept.
- Fixtures: last and first second of a month in America/Denver; DST days (2026-11-01 fall-back, 2027-03-14 spring-forward); a second zone; a visit at 23:59 local on the last day versus 00:01 on the next (different windows even when the UTC date is the same).

## 6. Confirmed-fraud reversals and revocation provenance
- A confirmed-fraud reversal of a lifetime award (G2 `reverse_reward`, ordered by an independent MFA admin) reduces progress. If an earned achievement's basis no longer meets its threshold, the next evaluation appends a `revoke` event referencing the reversal ledger entry and the moderation decision; the original `award` event is never edited or deleted.
- A held visit has not yet counted, so a hold alone never revokes anything. If later qualifying visits restore the threshold within an open window, a new `award` event may be appended (the log shows both). A closed challenge window or season cannot be re-earned.
- User-facing wording is factual and neutral (proposal): "Removed after a review of an earlier check-in." No accusation, no detail of the evidence.

## 7. Privacy and account deletion
- Achievement events are personal data. On account deletion, unmoderated events are DELETED; events that reference a moderation decision or a reversal (revocations and the awards they revoke) are retained under the same rule as G2 section 7 (severed `user_id`, only audit fields kept, never called anonymous, no legal-compliance claim). No new aggregate beyond the G2 minimum; counts of badges per definition are derived from live data only.
- No public profiles, leaderboards or other-user visibility in v1 (they would expose visit history). Each person sees only their own progress. No coordinates, device identifiers or fingerprinting are added. Anonymous discovery is unaffected.

## 8. Accessible progress text, labels and empty states (proposals)
- Progress is always TEXT first: "Explorer of the Month: 3 of 5 places this month. 2 to go." A visual bar is decoration with `role="progressbar"` and `aria-valuemin/valuenow/valuemax/valuetext` matching the sentence; meaning is never color-only; targets 48 px; works at 200 percent text and 320 px width.
- Badge cards: name, state ("Earned 12 Oct 2026" or "Not earned yet"), and how to earn it ("Check in at 10 different restrooms"). A revoked badge says "Removed after a review" with no detail.
- A polite live region announces a newly earned badge ("You earned First Stop"); any celebration respects reduced motion and is optional.
- Empty and gated states: rewards disabled or no ledger yet -> keep today's honest preview ("VIP progress — rewards coming soon"); rewards enabled but no check-ins -> "No badges yet. Check in at a restroom to start your progress."; signed out -> "Sign in to track your progress." No sample data, no zero-filled fake bars, no preview of badges the user could not earn.
- Placement: the existing dashboard VIP card becomes a compact progress card linking to a simple progress list under the existing account area; no new navigation tab.

## 9. Future local test plan (planning only; no results exist or are claimed)
All on a disposable local Postgres plus pure table-driven tests, and the existing Chromium suites with the local mock for the UI, only after Work authorizes implementation:
1. Catalog table-driven: every threshold crossing, off-by-one at exactly the threshold, distinct-location counting, and no streak logic anywhere.
2. Idempotency and races: two sessions crossing one threshold, double evaluation, replayed visit with one idempotency key: exactly one award event.
3. Isolation from rewards: injected failure in block A leaves the visit and both reward kinds committed; rewards-disabled issues no progress.
4. Lifetime independence: a user at the 60 spendable cap still progresses; spending (none) cannot reduce progress.
5. Windows and zones per section 5, including month boundaries, DST days, a second zone and a held visit cleared in a later month (counts on its original local date).
6. Fraud: reversal reduces progress and revokes with provenance (reversal entry and decision referenced, original award event untouched); a hold alone never revokes; re-earn inside an open window; closed window not re-earnable.
7. Deletion: unmoderated events deleted, moderated/revocation events severed with audit fields only, second purge a no-op.
8. No fabricated state: a user with no ledger rows has no events, no progress numerators, no badges; signed-out and rewards-disabled show the honest states.
9. Accessibility: `progressbar` role and value text equal the sentence, no color-only meaning, 48 px targets, 320 px and enlarged-text fits, live-region announcement, reduced motion; automated axe plus the manual VoiceOver/TalkBack checklist (browser evidence is never reported as device or reader evidence).
10. Safety: no client write access to any achievement table, the client cannot supply a threshold, window or award, and no new dependency, asset or service is introduced.

## 10. Open items for Work (routine, not owner decisions) and owner confirmations
- Work: whether achievement evaluation belongs inside the visit transaction (this plan) or an idempotent post-commit job; exact seq allocation under the user lock; the revocation wording; whether contributor badges are in scope.
- Owner confirmation will be needed before anything ships: the catalog names, thresholds, windows and wording above are proposals, and any seasonal content and its dates are product content Jake should approve.
