# Location validator (admin) for the seeded Cody records

Part of the admin app (`apps/admin`), the seed of Phase 3 moderation (OS-302/303). Scope: review the currently seeded records one by one.

## Access (LOCAL ONLY until OS-301)
The pages work only when ALL hold: `ADMIN_LOCAL_ONLY=true`, not on Vercel, the request Host is localhost/127.0.0.1, and `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` are set in `apps/admin/.env.local` (git-ignored). Anything else returns 404. The service-role key stays on the server (never sent to the browser). The app refuses to connect to any project other than the one in `ENVIRONMENT.md`. Real admin authorization (Supabase Auth + admin check) replaces `requireAdmin()` in OS-301; every page and action already calls it.

## What a review does (database function `apply_location_review`, service_role only)
- Exists + you tick "I personally verified" + date -> **Verified** (`last_verified_at` = that date). This is the ONLY path to Verified.
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
