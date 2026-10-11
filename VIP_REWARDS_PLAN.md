# VIP / rewards plan (G1: design only)

Status: DESIGN ONLY, written 2026-10-11, corrected the same day after Work's review (`b556988`). Nothing here is built, migrated or shown to users. No live database change, no UI, no merchant redemption. Rules below marked **(approved)** come from Jake via Work; everything else is a proposal, and decisions that change product behavior are listed in section 9 for the owner.

## 1. What exists today (read from the migrations, not assumed)
Checked `supabase/migrations/` through `20261010000001`. Only `20261006000002_favorites_reviews_checkins.sql` defines `check_in`; no later migration redefines it or the `checkins` table.
| Item | Current behavior |
|---|---|
| Function | `check_in(p_location, p_lat, p_lng)`, security definer, authenticated only; returns `{checkin_id}` and nothing else |
| Location evidence | client-sent coordinates must be within **150 m** of the restroom (`distance_m`); no accuracy, no timestamp from the client, no device attestation. Coordinates are **not stored** |
| Repeat guard | **one check-in per user and location per 12 hours** (error `54000`), serialized by a per-user/location advisory lock |
| Rate limit | **10 check-ins per user per day** through `enforce_rate_limit` (`action_log`, rolling window) |
| Storage | `checkins(id, user_id, location_id, created_at)`; RLS on, no client grants; `user_id` and `location_id` cascade on delete, so deleting an account deletes its check-ins |
| Points | `profiles.points_balance integer not null default 0 check (>= 0)` exists and is returned by `get_my_profile`; **nothing writes it** and there is no ledger, no lifetime counter, no policy table. The app does not display it (D1 shows no balances) |
So today a check-in is a recorded visit with no reward, and the 12-hour rule makes "four rewarded visits a day" impossible.

## 2. Approved rules (approved)
- +5 **spendable** points per eligible check-in.
- +5 **lifetime** points on the FIRST daily check-in at each location (lifetime is cumulative achievement: never spendable, never decremented by spending).
- Up to **four rewarded** check-ins per user per location per day. Later visits may be recorded without points.
- Default maximum per user/location/day: **20 spendable and 5 lifetime** (4 x 5 and 1 x 5). Defaults are configurable and versioned; changes apply prospectively only.
- No seven-day declining schedule.
- Eligibility must not fabricate human presence: server trusted time, the existing auth/location evidence, idempotency, atomic concurrent cap enforcement.
- Points have no promised monetary value and nothing is redeemable now; premium or merchant offers need separate economics, cost, legal and integration approval.

## 3. The conflict and the replacement design
The 12-hour guard and the 10/day rate limit conflict with four rewarded visits per day. Do not just delete the guard. Split three concerns that are mixed in `check_in` today:
1. **Visit recording** (append-only `visits`): one row per accepted visit with server `occurred_at`, the location, a client-generated idempotency key (`unique (user_id, idempotency_key)`; a retry returns the same visit and never double-awards), and minimal evidence (a distance bucket computed server-side from the client coordinates, which are then discarded). Recording is always allowed within abuse limits.
2. **Reward eligibility** (a pure, versioned policy function evaluated in the same transaction): rewarded visits at this location in the current policy day (< per-location cap), the cooldown, the per-user daily cap and the global issuance budget (section 4a). The result and policy version are stored with the visit: `eligible`, `eligible_first_daily`, `recorded_only` (with the reason: location cap, cooldown, user cap, budget exhausted) or `held`.
3. **Abuse limits** (separate from and stricter than the reward caps): per-user visits recorded per day (replacing today's 10/day; proposal 30), per user/location visits recorded per day (proposal 12), and the signals in section 5. Hitting one holds or refuses; it never silently grants points.

## 4. Ledger (design)
- `reward_policy_versions` (immutable): `id`, `effective_from`, `spendable_per_visit` (5), `lifetime_first_daily` (5), `max_rewarded_per_location_day` (4), `max_spendable_per_user_day`, `max_spendable_global_day`, `cooldown_minutes`, `day_boundary`, `created_by`, `created_at`. A change inserts a new row; a trigger requires `effective_from > now()` so a change is always prospective.
- `reward_ledger` (append-only: UPDATE denied, and DELETE denied except the narrow deletion path in section 7):
  `id`, `entry_type` (`award` | `reversal`), `visit_id`, `user_id`, `policy_version`, `kind` (`spendable` | `lifetime`), `amount` (> 0 for an award, < 0 for a reversal), `reason`, `reverses_entry_id` (reversals only, references the original award row), `moderation_decision_id` (reversals only, references the admin decision that ordered it), `created_at`.
- **Awards and reversals are idempotent separately, so one never blocks the other.** Awards: a partial unique index `unique (visit_id, kind) where entry_type = 'award'`. Reversals: `unique (reverses_entry_id)` (an original row can be reversed at most once, whole amount only). A check constraint ties a reversal to its original (same `kind` and `visit_id`, `amount = -original.amount`) and requires `moderation_decision_id`. A repeated reversal request (a retry, a double click, two admins) does `insert ... on conflict (reverses_entry_id) do nothing` and returns the existing reversal row, so a reversal can never be duplicated. The original award row is never edited, so the evidence stays intact.
- **Balances are derived**: spendable = sum of spendable rows (awards plus reversals, minus future redemptions, none now); lifetime = sum of lifetime rows. `profiles.points_balance` becomes a cache written only by the award/reversal function and checked by a reconciliation query (cache vs ledger sum), part of the test suite and a periodic admin check. Clients never write any of it.
- All awards happen inside one security-definer function using server time; the client sends only the location, coordinates and an idempotency key.

### 4a. Concurrency: separate limits, separate serialization
The per-user/location/day advisory lock alone cannot enforce limits that span locations or users. Each limit needs its own atomically updated counter, taken in a fixed order so transactions cannot deadlock:
| Order | What is serialized | Mechanism |
|---|---|---|
| 0 | Policy version in effect | read the immutable version row chosen by server `now()`; versions are insert-only and prospective, so no lock is needed and a transition cannot change a transaction midway |
| 1 | One user's visits | `pg_advisory_xact_lock(hash('user', user_id))` (stops one user racing themselves across locations) |
| 2 | User + location + policy day (idempotency, location cap, cooldown) | `pg_advisory_xact_lock(hash('uld', user_id, location_id, day))` then count rewarded visits |
| 3 | User + policy day issuance (per-user daily cap) | `reward_counters_user_day(user_id, day, spendable, lifetime)` updated by `insert ... on conflict do update set spendable = spendable + :amount where spendable + :amount <= :cap returning` (an atomic conditional increment; zero rows returned means the cap is reached) |
| 4 | Global daily issuance (budget) | `reward_counters_global_day(day, spendable)` with the same conditional increment, always LAST because it is the hottest row; if contention appears, split it into N bucket rows, which changes only this step |
Lock order is always 0, 1, 2, 3, 4 and the visit, ledger rows and counter updates commit together or not at all, so an award cannot exist without its counters. When a cap is reached the visit is still recorded as `recorded_only` with the reason. **Policy transitions:** the policy day's counters carry across a change; the cap values used are those of the version in effect at the visit's server time, so lowering a cap applies to later visits that same day and never claws back earlier awards. Tests: two concurrent sessions at one location (cap), the same user at two locations (user cap), many users (global budget), retry with one idempotency key, a transition between two visits.

## 5. Evidence limits and fraud signals (implementability and privacy)
Client coordinates do not prove presence: a client can send any coordinates, and the design never treats them as proof. Today's payload is `p_location`, `p_lat`, `p_lng` plus the authenticated user and server time. **Accuracy is not sent, coordinates are discarded after the 150 m check, and no device identifier or IP address is collected or planned.** No device fingerprinting is introduced.
| Signal | Inputs needed | Available today | Plan | Retention / privacy |
|---|---|---|---|---|
| Rapid repeat visits | user, location, server time | yes (visit rows) | implement in G2 | the visit row (user, location, time) lives until account deletion (section 7) |
| Cap and rate-limit hits | counters, `action_log`, reason on the visit | yes | implement in G2 | counter rows kept as aggregates; per-user detail with the visits |
| Retry duplicates | idempotency key | no, new argument | implement in G2 (additive, optional) | key stored with the visit |
| Distance bucket from the restroom | client coordinates, restroom coordinates | partly (checked, then discarded) | store only the bucket (for example <= 50 m, 50-150 m), never the coordinates | bucket only; weak, claim-derived evidence |
| Implausible movement between visits | the RESTROOM coordinates of two consecutive visits and the server times | yes, without storing any user coordinate | implement in G2: distance between the two restrooms divided by elapsed server time above a plausible travel speed flags `held` | derived from public location data and server time; weak, because both visits are still claims |
| Accuracy ceiling | client-reported accuracy | **no** (not in the payload) | defer: needs an additive optional argument and a client change; client-reported and spoofable | accuracy bucket only |
| Multi-account or shared-device patterns | device or network identifiers | **no** | **defer**; needs legal and privacy review; no fingerprinting; the only conceivable first-party signal (accounts with near-identical visit sequences) is not built without review | none collected |
**Suspicious is not fraud.** States: `eligible` -> `held` (reversible, reason recorded) -> `cleared` or `confirmed_fraud` (reversing ledger rows, section 4). Every change goes through the existing admin identity, MFA and `moderation_log` audit pattern; no self-adjudication; no automatic punitive account action without human review. The existing Phase 3A rules (immutable originals, append-only decisions, self-adjudication block, provenance kept with the person severed) are preserved. Retention of the per-visit flags and hold reasons: proposal 90 days after a hold is cleared; confirmed-fraud audit records follow section 7.

## 6. Economics model (planning, not an accounting or legal conclusion)
- Spendable issuance = 5 x eligible visits. Per user/location/day exposure is at most 20 spendable (and 5 lifetime); with the per-user daily cap (proposal 60 spendable) and the global daily budget, issuance per day is bounded no matter how many places a user visits.
- **What is true today:** no redeemable reward, cash-out, price or promise exists in the product, and nothing issues points. **What is not known:** points that users can earn create expectations, and unpriced future exposure can arise before any redemption exists (promotional commitments, accounting treatment, consumer-protection or loyalty-program rules). The plan makes no claim that exposure is zero; it is unpriced and unassessed. Legal and accounting review is required before any points are issued.
- **Lifetime points** are designed as an achievement counter, not spendable. If any benefit, tier, discount or access is ever attached to them they stop being purely cosmetic and need the same review; until then no benefit attaches.
- Illustration only, not a forecast: 1,000 active users averaging 2 rewarded visits a day issue 10,000 spendable points a day, 300,000 a month. At a hypothetical redemption cost of $0.002 per point and full redemption that would be $600 a month. Real numbers need a priced redemption and a measured redemption rate.
- Controls: per-user and global daily issuance caps, a budget switch that pauses issuance prospectively, versioned configuration, and user-facing copy that says points have no cash value.

## 7. Privacy and deletion (resolving the append-only conflict)
The ledger is append-only (no UPDATE, no DELETE), but deleting an account must remove the person's data, and today `checkins` cascade on account deletion. These conflict; the alternatives:
- **A. Sever and keep:** keep ledger and visit rows, set `user_id` to null at deletion. Needs a narrow carve-out in the immutability trigger (only `user_id: value -> null`, only inside the deletion function) and leaves granular events (location, time, amounts) with no user. Reconciliation stays exact. Re-identification risk is small but real for sparse data (one user visiting a rarely used restroom at a known time).
- **B. Delete and aggregate (recommended):** the deletion function, and only it, may delete that user's `visits` and ledger rows (the trigger permits DELETE only while a deletion-function setting is on) after it writes the totals into anonymous per-day aggregate rows (`reward_deleted_aggregate(day, spendable, lifetime, visits)`, no user id). Reconciliation compares cache and ledger sums per user for live users and, globally, ledger sum + deleted aggregate = counter totals. Held or confirmed-fraud audit evidence is the only per-event data kept, with the person severed (the Phase 3A principle, unchanged), stored in the existing moderation tables rather than the ledger.
- **C. Pseudonymize (keep a salted hash of the user id): rejected.** Pseudonymized data is still personal data.
Policy implications for the owner: under B a user's points and history disappear with the account (said plainly in the deletion screen before any points exist), exact historical per-user economics cannot be reconstructed after deletion, and fraud cases remain auditable. Coordinates are never stored under any option. This changes no approved Phase 3A deletion or provenance rule; it extends the same rule to the new tables.

## 8. Later packages that depend on this (not designed in detail here)
- Lifetime badges, monthly challenges, seasonal collectible badges and progress: derived only from actual earned ledger data; no fabricated progress; none shown until the ledger exists.
- Exterior photos: planning must cover moderation, faces and license plates, privacy, EXIF/location stripping, ownership, licensing and takedown, storage and egress cost, and a vendor decision. **`CLAUDE.md` says no user-uploaded photos in v1**, so this needs an explicit scope decision before any design beyond planning; no uploads, storage vendor or purchased assets without reviewed approval.

## 9. Decisions needed from the owner (material product impact; I will not choose silently)
Batched recommendation, one line each (technical details stay in this document):
| # | Decision | Options | Recommendation |
|---|---|---|---|
| 1 | Reward day boundary | UTC day / location-local day / rolling 24 h | location-local day, with an IANA time zone stored per location at import (the Cody seed would use `America/Denver`) |
| 2 | Cooldown between rewarded visits at one place | none / 60 min / 2 h | 60 minutes (stops rapid-tap farming, still allows four a day) |
| 3 | Caps | per user/location/day 4 (approved); per user/day across places; global daily budget | 60 spendable per user per day; a global daily budget set by the owner before issuance starts |
| 4 | Reversal policy | whether a confirmed-fraud reversal may also reduce lifetime points; who may order it | yes, only by an audited reversing row ordered by an admin who did not take part in the original visit |
| 5 | Deletion policy | option A, B or C (section 7) | B: delete and aggregate, fraud audit kept with the person severed |
| 6 | Retention | per-visit flags and hold reasons | 90 days after a hold is cleared; confirmed-fraud audit per Phase 3A |
| 7 | Accuracy argument | whether to add an optional accuracy value to the check-in call (client change) | yes, as an additive argument, treated as weak evidence |
| 8 | Fraud review | who reviews holds and how fast | the existing admin queue, same MFA and audit rules |

## 10. Sequence and pending gates
D1 dashboard and the password correction -> Work review and **Jake's visual checkpoint** (D1 is open at that gate) -> bounded owner-feedback dashboard corrections -> **G2** (local-only policy, ledger, counters and configuration with source migrations on disposable Postgres only; immutability, idempotency, reversal-uniqueness, lock-order/concurrency, day-boundary, cap, transition, deletion and reconciliation tests; no live change). **G2 waits for every decision its implementation depends on**: day boundary (1), cooldown (2), all caps and the budget (3), reversal policy including lifetime (4), deletion policy (5), retention (6), the accuracy argument (7) and who reviews holds (8). It does not start on 1-3 alone. -> **G3** badges, monthly challenges, seasonal collectibles and progress from real ledger data -> any reward activation or redemption only after its own owner gates (economics, cost, legal and accounting review, integration).
**Exterior photos:** the direction is approved for planning only, subject to review. It does not authorize uploads, storage, a vendor or purchased assets, and it does not resolve the existing `CLAUDE.md` constraint (no user-uploaded photos in v1), which needs an explicit scope decision before anything beyond planning. No deployment, production migration, merge, cost or merchant redemption is authorized by this document.
