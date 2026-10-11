# VIP / rewards plan (G1: design only)

Status: DESIGN ONLY, written 2026-10-11 for Work's review. Nothing here is built, migrated or shown to users. No live database change, no UI, no merchant redemption. Rules below marked **(approved)** come from Jake via Work; everything else is a proposal, and decisions that change product behavior are listed in section 9 for the owner.

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
1. **Visit recording** (append-only `visits`): one row per accepted visit with server `occurred_at`, the location, a client-generated idempotency key (`unique (user_id, idempotency_key)`; a retry returns the same visit and never double-awards), and minimal evidence (distance bucket, client-reported accuracy bucket, no coordinates). Recording is always allowed within abuse limits.
2. **Reward eligibility** (a pure, versioned policy function evaluated inside the same transaction): counts the user's rewarded visits at that location in the current policy day (< 4), applies the cooldown (section 9), and reports one of `eligible`, `eligible_first_daily`, `recorded_only` (cap or cooldown), `held` (abuse signal). The result and the policy version are stored with the visit.
3. **Abuse limits** (kept separate and stricter than the reward cap): per-user visits recorded per day (replacing today's 10/day; proposal 30), per user/location visits recorded per day (proposal 12), velocity/plausibility (consecutive visits farther apart than a plausible travel speed become `held`), and the existing `enforce_rate_limit`. Hitting an abuse limit holds or refuses; it never silently grants points.
**Concurrency:** one advisory lock keyed on (user, location, policy day) around count-then-insert (the existing pattern); the ledger rows are inserted in the same transaction, so two simultaneous taps cannot exceed the cap. Tested like `supabase/tests/concurrency.sh`.

## 4. Ledger (design)
- `reward_policy_versions` (immutable): `id`, `effective_from`, `spendable_per_visit` (5), `lifetime_first_daily` (5), `max_rewarded_per_location_day` (4), `cooldown_minutes`, `day_boundary` (section 9), `created_by`, `created_at`. A change inserts a new row; visits use the version in effect at `occurred_at` (server time).
- `reward_ledger` (append-only, same UPDATE/DELETE-denying trigger pattern as `moderation_decisions`): `id`, `visit_id`, `user_id`, `policy_version`, `kind` (`spendable` | `lifetime`), `amount`, `reason` (`eligible_checkin` | `first_daily_checkin` | `reversal`), `created_at`. `unique (visit_id, kind)` makes awarding idempotent. A correction is a new reversing row that references the original and an admin decision; rows are never edited.
- **Balances are derived**: spendable = sum of spendable rows (minus future redemptions, none now); lifetime = sum of lifetime rows. `profiles.points_balance` becomes a cache written only by the award function and checked by a reconciliation query (cache vs ledger sum) that is part of the test suite and a periodic admin check. Clients never write any of it.
- All awards happen inside one security-definer function with server time; the client sends only the location, coordinates, idempotency key.

## 5. Evidence limits and fraud (honest)
Coordinates alone do not prove presence: a client can send any coordinates. The design bounds the damage instead of pretending to prevent spoofing: low per-visit value, the per-day caps above, an accuracy ceiling consistent with the new-restroom rule, velocity checks, and a hold-for-review path. Device attestation is a possible later layer and is not assumed.
**Signals to monitor (minimal retention):** rapid repeat visits, implausible movement or accuracy, cap and rate-limit hits, retry duplicates, many accounts converging on the same few locations or devices. Keep per-visit signal data for a short window (proposal 90 days) and only aggregate counters after that.
**Suspicious is not fraud.** States: `eligible` -> `held` (reversible, reason recorded) -> `cleared` or `confirmed_fraud` (reversing ledger rows). Every change goes through the existing admin identity, MFA and `moderation_log` audit pattern; no self-adjudication; no automatic punitive account action without human review. The existing Phase 3A rules (immutable originals, append-only decisions, self-adjudication block, provenance kept with the person severed) are preserved, not re-litigated.

## 6. Economics model
- Spendable issuance = 5 x eligible visits. Lifetime points are achievement, not a liability.
- Maximum exposure per user/location/day = 20 spendable; with a global per-user daily cap (proposal 60 spendable across all locations) the worst case per user per day is bounded regardless of how many places they visit.
- Outstanding liability = outstanding spendable points x prospective redemption cost per point x expected redemption rate. **There is no redemption and no price today, so liability is zero now**; the model matters before any redemption exists.
- Illustration only, not a forecast: 1,000 active users averaging 2 rewarded visits a day issue 10,000 points a day, 300,000 a month. At a hypothetical redemption cost of $0.002 per point that is $600 a month if every point were redeemed. Real numbers need a priced redemption.
- Controls: per-user and global daily issuance caps, a campaign budget switch that can pause issuance prospectively, versioned configuration, and user-facing copy that says points have no cash value.

## 7. Privacy and deletion
Today deleting an account cascades its check-ins. Proposal: visits and ledger rows for the user are deleted with the account; only (a) records that were `held` or `confirmed_fraud` keep the audit provenance with the person severed (the same rule Phase 3A applied to decided moderation items) and (b) anonymous daily aggregates (counts, no user id) remain for economics reconciliation. Coordinates are never stored. Data retention windows in section 5 apply. The reconciliation job must tolerate deleted users (aggregate comparison, not per-user).

## 8. Later packages that depend on this (not designed in detail here)
- Lifetime badges, monthly challenges, seasonal collectible badges and progress: derived only from actual earned ledger data; no fabricated progress; none shown until the ledger exists.
- Exterior photos: planning must cover moderation, faces and license plates, privacy, EXIF/location stripping, ownership, licensing and takedown, storage and egress cost, and a vendor decision. **`CLAUDE.md` says no user-uploaded photos in v1**, so this needs an explicit scope decision before any design beyond planning; no uploads, storage vendor or purchased assets without reviewed approval.

## 9. Decisions needed from the owner (material product impact; I will not choose silently)
1. **Reward day boundary.** Options: (a) UTC calendar day (simplest, odd for users), (b) the location's local calendar day (needs a time zone per location; the current Cody-area seed would use `America/Denver`), (c) a rolling 24 hours (no time-zone data, but "daily" is blurry and the first-daily lifetime bonus is harder to explain). **Recommendation: (b)**, storing an IANA time zone on each location at import.
2. **Cooldown between rewarded visits at the same place.** Options: none, 60 minutes, 2 hours. **Recommendation: 60 minutes**; it stops rapid-tap farming and still allows four in a day. Without a decision the build would have no cooldown, which is the weakest choice.
3. **Global per-user daily cap across locations** (proposal 60 spendable) and the abuse limits in section 3.
4. **Whether a confirmed-fraud reversal may reduce lifetime points** (rule says lifetime is never decremented by spending; reversal for fraud is a different case). Recommendation: yes, only by an audited reversing row.
5. **Ledger handling on account deletion** (section 7 proposal).
6. **Fraud signal retention window** (proposal 90 days).

## 10. Sequence and pending gates
D1 dashboard and the password correction (done, in review) -> Work review and the owner's visual checkpoint -> feedback-driven dashboard correction -> **G2**: local-only policy, ledger and configuration with source migrations on disposable Postgres only (immutability, idempotency, concurrency, day-boundary, cap, deletion and reconciliation tests; no live change) **after** decisions 1-3 are made -> **G3** badges, monthly challenges, seasonal collectibles and progress from real ledger data -> any reward activation or exterior photos only after their own owner gates (redemption terms and economics, photo legal/privacy/cost and the v1 photo rule). No deployment, production migration, merge, cost or merchant redemption is authorized by this document.
