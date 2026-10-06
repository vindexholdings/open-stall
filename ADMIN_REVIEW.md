# Location validator (admin) for the seeded Cody records

Part of the admin app (`apps/admin`), the seed of Phase 3 moderation (OS-302/303). Scope: review the currently seeded records one by one.

## Access (LOCAL ONLY until OS-301)
The pages work only when ALL hold: `ADMIN_LOCAL_ONLY=true`, not on Vercel, the request Host is localhost/127.0.0.1, and `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set in `apps/admin/.env.local` (git-ignored). Anything else returns 404. The service-role key stays on the server (never sent to the browser). The app refuses to connect to any project other than the one in `ENVIRONMENT.md`. Real admin authorization (Supabase Auth + admin check) replaces `requireAdmin()` in OS-301; every page and action already calls it.

## What a review does (database function `apply_location_review`, service_role only)
- Exists + you select "Visited in person" + date -> **Verified** (`last_verified_at` = that date). This is the ONLY path to Verified.
- Exists, not ticked -> **Unverified** (public with badge; hidden candidates become public this way). Already-Verified records are not downgraded.
- Does not exist -> **Closed** (hidden). Imports never republish it.
- Unsure -> no status/fact change; notes recorded.
- Access and amenity answers are written exactly: Unknown = empty. Imported values are pre-filled so you see them; what you save replaces them.
- Provenance: the original OSM source row is never changed or deleted. Your review is recorded in `location_reviews` (private audit with previous state, notes, date) and, when you confirm existence, as a separate non-primary `open_stall` source row.
- Any reviewed record is protected from import overwrites and kept by `supabase/dev/osm-dev-cleanup.sql` if it was verified, edited or closed.

## Views
Unverified (public), Hidden candidates, Verified, Closed. "Save review and go to next" moves to the next unreviewed record in the same view.

## ODbL reminder
A Verified record still carries OSM-derived name/coordinates/address. Before launch, re-confirm those independently (or accept ODbL for the location layer) per OS-110c.

## Visit details (migration 20261005000002 applied)
- Username is a display alias. Repeat visits use a stable configured admin identity (`ADMIN_REVIEWER_ID`, default `local-admin`); they are history, not extra people. Admin ratings are stored in the review history/provenance only and do NOT contribute to the public rating (migration 20261008000001); the public average/count come from community ratings alone. Admin verification and observations still establish location facts.
- Customer-only access is separate from purchase-required source data. Key and fee requirements remain independent. Family bathroom is separate from gender neutral.
- The restroom checked (men, women, all gender, family, single occupancy, unspecified), optional stars, public comment, cleanliness score, water, seats/mirrors/stall doors/toilet paper/floor, and posted inspection log are stored per review. Transient conditions start unknown for each new visit.
- Existing private notes are never promoted to public comments. Public comments are captured for the later gated public review page; private audit tables remain unavailable to public users.
- Map is embedded above the form. Source/provenance detail is collapsed.

## Admin queue and authorization (Phase 3A; built locally, migrations 20261009000001-2 NOT applied, hosting NOT approved)
- Identity: a normal Supabase account that is listed in `admin_users` (not disabled) AND signed in with MFA (JWT `aal2`). User metadata grants nothing. The app uses the public anon key plus the admin's own session; no service-role key. Routes: `/signin`, `/mfa` (TOTP enrollment + verification, free Supabase MFA), `/queue`. The database re-checks admin + MFA inside every `admin_*` function.
- First admin (owner step, SQL as postgres, only after that person has created an account and enrolled MFA in the app): `insert into public.admin_users (user_id) select id from auth.users where email = '<admin email>';`. No function can create admins. To remove one: `update public.admin_users set disabled_at = now() where user_id = '<id>';` (their decisions keep their id; an active admin cannot delete their own account).
- Decisions (all via `admin_decide_submission` / `admin_resolve_report`): approve, edit-and-approve (edits recorded on the decision; the original proposal never changes), reject with one of six private codes (`other` needs a note), duplicate (links an existing restroom; never a rejection reason), hold/release (a held item stays pending and counts toward the contributor's caps; cannot be withdrawn). Admins cannot decide their own submissions or reports. Approving a new restroom makes it public as UNVERIFIED with a `community_submission` provenance row; approving a correction applies it and marks the record manually edited. Verification remains a separate act (the seeded-location validator).
- Provenance: `moderation_decisions` and `moderation_log` are append-only; decided submissions/reports survive account deletion with the submitter severed (user_id NULL); undecided and held items are removed with the account.
- Run locally: apps/admin/.env.local with `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (public values), then `npm run dev -w @open-stall/admin`. Not for Vercel until hosting is approved.
