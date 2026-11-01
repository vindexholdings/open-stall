# Public community reviews: feasibility, privacy and moderation plan

Status: PLANNING ONLY (2026-10-17, assigned by Work 2026-10-12, owner's DESIGN/PLANNING ONLY authority). Nothing here is approved, built or scheduled. No UI, schema, RPC, migration or live query was created or run. Evidence is existing Open Stall source, migrations and docs only; no live rows were read.

## 1. Recommendation (read this first)

1. **Showing the latest 2-3 ratings with a comment cannot be built from what exists.** Reviews have no comment field at all. `reviews` holds a 1-5 rating, a plain/risque presentation mode and timestamps; `review_observations` holds six fixed values. The only free text in the account layer is a 300-character note on a submission and a 300-character comment on a report, both private to admins. Public comments therefore need a new column or table, which is Phase 3B/backend expansion and an owner gate.
2. **No existing rating may be shown individually, ever, by retroactive publication.** Those users rated into a public average. They were not asked to publish a line under a restroom. Publication must be a new, separate, explicit act per review, default off.
3. **Recommended staging (best return on attention and risk):**
   - **Stage 0 (now):** nothing built. Decide the owner questions in section 10 and measure demand (section 9).
   - **Stage 1 (only if demand is real):** a structured-only "What people reported" summary built from the six existing observations (for example "4 of 6 people marked it clean"), shown only when a minimum number of people agree, with no free text, no names and no per-person rows. It reuses data that exists, needs no text moderation and cannot carry harassment, residences or personal data.
   - **Stage 2 (only after Stage 1 and a staffed takedown path):** opt-in public comments, pre-moderated, anonymous, 280 characters, one per person per restroom.
4. **Challenge to the premise:** with a young user base, most restrooms will have zero public comments for a long time, so the common screen is the empty state, and the first moderation incident (a named employee, a home address, a defamatory claim about a business) costs more attention than the feature earns. Do not build Stage 2 until rating volume proves comments would appear. This is a good idea for a mature product and a weak one for an MVP. Good business: maybe later. Good business for Jake right now: no, unless ratings already cluster.

## 2. Public versus private inventory (from migrations and docs)

| Datum | Where | Public today? | May become public? |
| --- | --- | --- | --- |
| `average_rating`, `rating_count` | `locations` (community-only since 20261008000001) | Yes, via `nearby_locations` and the public by-id read | Already public; unchanged |
| Individual rating, mode, timestamps, `user_id` | `reviews` (RLS on, no policies, all client privileges revoked) | No | Only through a new explicit publication act, minimized (section 5) |
| Observations (six enums) | `review_observations` (same lockdown) | No | Aggregated only in Stage 1; per-person only if that person opts in |
| Review comment text | **does not exist** | n/a | New field required; opt-in; moderated |
| Display name | `profiles.display_name` (own-profile read only; restricted by `valid_display_name`) | No | Not recommended (section 5) |
| Submission note | `submissions.note`, 300 chars, `free_text_ok` | No (admin only) | **Never** |
| Report comment | `reports.comment`, 300 chars | No (admin only) | **Never** |
| Moderation notes and decisions | `moderation_decisions`, `moderation_log` | No (admin only) | **Never** |
| Check-ins | `checkins`, no coordinate column | No | Not linked; see "verified visit" below |
| Admin ratings | `location_reviews` | No | Never part of public reviews (history only) |

Existing private notes never become public. A public comment must be written in a new field through a new function; no migration, backfill, copy or view may read `submissions.note`, `reports.comment` or `moderation_decisions.note` into anything public.

Existing text validation is not enough on its own. `free_text_ok` rejects angle brackets, control characters, URLs, emails and phone-like numbers, and `looks_residential` is an ASCII regex. Neither screens profanity, slurs, threats, named individuals, addresses written out in words, spelled-out domains ("dot com"), full-width or look-alike characters, or advertising. Treat them as a first filter, never as the moderation decision.

## 3. Required explicit publication intent

- A separate "Share this comment publicly" choice, off by default, never combined with submitting the rating, with plain wording: what is shown (the text, the star rating, the month), what is not (name, account, exact time), and that it can be removed at any time.
- Intent is per review and per text version: editing the text clears publication and re-enters moderation; deleting the rating deletes the public post.
- Existing review rows get no public state. A test asserts that legacy rows never appear in any public read.
- The rating itself can keep counting toward the public average as it does now (the app already presents the average as community-derived; confirm the in-app wording says so before Stage 2, an owner decision).

## 4. Data model proposal (not built)

A new table, never a view over `reviews`:

- `review_public_posts(id, review_id references reviews on delete cascade, body text 1..280, state pending|published|rejected|removed, created_at, published_at, moderated_at)`; RLS on, no policies, all client privileges revoked, like every account table.
- State changes go through admin functions that call `require_admin()`, record only post id, location id, decision and reason code in a moderation record, and **never copy the body**, so deleting a post truly removes the words.
- Cascade chain: deleting the rating, the account or the restroom removes the post; the aggregate recompute trigger already handles ratings.
- Body validation: `free_text_ok` plus a new reject list and Unicode normalization (NFKC, strip zero-width), single paragraph, no repeated-character floods.

## 5. Public API and RLS boundary (not built)

- One new read function, `list_public_reviews(p_location uuid, p_limit int)`: `SECURITY DEFINER`, `search_path=''`, granted to `anon` and `authenticated`, limit clamped to 3, returns only `{post_id (opaque), rating, month, body}`. No user id, display name, review id, exact timestamp or mode. Month granularity limits re-identification at obscure places with few reviewers.
- Returns rows only when `state = 'published'` and the location passes `is_publicly_displayable`; a restroom taken down returns nothing.
- Anonymous attribution ("Community member") is recommended. A display name invites impersonation and identification; `valid_display_name` limits form, not accuracy.
- Order: `published_at` descending. The UI must say it shows the latest few of N ratings, since most ratings carry no comment.
- All tables stay lockdown (no policies); no new anon table privilege; privilege catalog diff must show only the one new function.
- "Verified visit" badges are out of scope: check-ins discard coordinates and are not tied to reviews, and linking them would raise a privacy question this plan does not open.

## 6. Moderation, abuse and takedown

- **Pre-moderation at launch.** Post-moderation is unacceptable without a review tool and a person on call. Every comment starts `pending`.
- Review tool: extend the admin queue pattern (`admin_list_submissions`, `moderation_decisions`) with a post kind; approve, reject (reason code), remove after publication.
- Report path: "Report this comment" on every public item, 48 px target, no account needed to read but sign-in to report (matches reports today). A report auto-hides the item pending admin decision once a small threshold is reached (owner decision).
- Abuse classes to name in Community Guidelines and reason codes: named private individuals or staff, private residences and addresses, threats and harassment, hate, sexual content, advertising or spam, medical or criminal claims about people or businesses, personal data, off-topic.
- Posting limits: one public comment per person per restroom, 3 per day, accounts under 24 hours flagged (reuses the `new_account` signal) and a minimum account age before posting is an owner decision.
- Takedown service level (for example 24 hours for a reported item) is an owner decision and needs a named responder; none exists today.

## 7. Deletion and provenance

- `delete_my_review` and `delete_my_account` already cascade; the post table must cascade from `reviews` so a deleted rating leaves no comment.
- Moderation records keep ids and reason codes, not text (section 4), so a removed or deleted comment is gone from the database.
- Offline cache: the app can show cached public details when offline. Cached comments must carry their fetch age, be dropped on a refetch that no longer returns them, and the plan must state that a copy already on a device cannot be recalled.
- Backups and restore are outside this plan; note the retention window in Privacy before Stage 2.

## 8. Minimal UI states (Details, below the rating)

- **Loading:** neutral line, no layout jump.
- **None yet:** "No public comments yet. Ratings from the community are counted above." (also the common state.)
- **Unavailable:** "Comments couldn't load. The rating above still counts." with Try again; never hides restroom facts.
- **Offline cache:** "Saved comments, may be out of date."
- Each comment: rating as words ("4 of 5"), month, text, Report. List semantics, readable order, text wraps at 320 px and 1.6x, no avatar, no name. Presentation of the rating follows the viewer's plain or risque mode; the stored value stays numeric.

## 9. Gates and demand check (before any build)

- Demand gate: do not build Stage 2 until a meaningful number of restrooms show at least 3 community ratings. The aggregate counts are already public; the owner or Work can read them through the existing authorized path. This plan did not query live data.
- Phase 3B / backend expansion gates (each a separate owner approval, none granted by this document): new migration and live apply; admin-tool extension; Terms, Privacy and Community Guidelines (SECURITY.md already lists them as pre-launch); app-store user-generated-content requirements (generally a report mechanism, filtering, a way to block abusive users and published contact; verify against current store text at the time); a named moderator and takedown service level.

## 10. Test and evidence requirements (when and if authorized)

- Disposable local Postgres: anon and authenticated cannot read any new or old table; the only new executable function is the list function; pending, rejected and removed never returned; hidden or closed restroom returns none; legacy rating rows never returned; limit clamps to 3; edit clears publication; rating delete, account delete and restroom removal each remove the post and fix the aggregate; moderation record holds no body; body validation including normalization and look-alike bypasses; per-day and per-restroom limits; concurrency of edit versus approve; privilege catalog diff; mutation checks on publication state, location gate and cascade.
- Domain: public review parsing rejects extra fields and out-of-range values.
- Browser (Chromium, local mocks, browser evidence only): the four states, Report action, no names or ids rendered, 320 px, 1.6x text, axe clean. Device and screen-reader evidence stays NOT RUN until a person runs it.

## 11. Genuinely unresolved owner decisions

1. Go or no-go on public text at all before launch, versus Stage 1 structured-only first (recommendation: Stage 1 first, Stage 2 only after the demand gate).
2. Attribution: anonymous "Community member" (recommended) or display name.
3. Who moderates, with what takedown service level, and pre-moderation confirmed (recommended).
4. Confirm no retroactive publication of existing ratings and the minimum account age to post.
5. Legal owner for Terms, Privacy and Community Guidelines wording, and store UGC compliance review.
