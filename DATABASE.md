# Database
UUID PKs, UTC timestamps, foreign keys, RLS.

Core tables:
profiles: auth user id, display_name, preferred_mode, default_transport, points_balance, timestamps. Never expose email publicly.
locations: canonical Open Stall records: name/address/lat/lng, status (candidate|pending|unverified|verified|closed), restroom_evidence, restroom_verified/last_verified_at, nullable amenity/access/fee booleans, opening_hours, access_location, rating aggregates, manually_edited_at, possible_duplicate_of. Source/provenance lives in location_sources (many per location: source, reference, license, attribution, tags, hash, freshness). import_runs tracks importer runs. See IMPORT.md.
reviews: location/user/rating 1–5/mode/timestamps.
review_observations: structured factual observations.
submissions: user/type/target/proposed_data jsonb/status/moderator/reviewed timestamps. Pending data never canonical/public.
reports: location/user/controlled issue_type/optional comment/status/timestamps.
favorites: unique user+location.
checkins: user/location/time with anti-abuse.
point_ledger: append-only user/event/points/source/time.
achievements + user achievements.
referrals: inviter/invitee/status/reward eligibility/anti-abuse.
subscriptions: app entitlement state; billing provider remains source of truth.
moderation_log: material admin actions.

Enable PostGIS if appropriate and geospatial index.
Flag duplicate candidates by normalized address or roughly 50m proximity for admin review; do not auto-merge on distance alone.

Account layer (migrations 20261006000001-3): action_log (rate limiting), profiles (auto-created by trigger on auth.users; preferred_mode plain|risque, default_transport walk|drive|bike, display_name restricted, points_balance server-only), favorites, reviews (one per user+location, rating 1-5, mode) + review_observations (6 fixed values, no free text; trigger keeps locations.average_rating/rating_count current from COMMUNITY rows only, including on deletion; recompute locks the location row FOR NO KEY UPDATE first so concurrent reviewers cannot overwrite each other; admin ratings live in location_reviews as history and never touch the aggregate, migration 20261008000001), checkins (no coordinates), submissions (+ capture_accuracy_m, flags[], duplicate_submission_ids[] (admin-only); no coalescing: each proposal is its own row (an exact own retry within 10 min returns the same row), possible_duplicate_of/flags are private duplicate hints; legacy submission_supporters from 20261007000001 is kept but unused; new_location rows come only from submit_location(p_proposed, p_lat, p_lng, p_accuracy_m, p_attested, p_note) which returns {submission_id}; kind new_location|edit_location, whitelisted `proposed` jsonb, attestation, possible_duplicate_of, status pending|approved|rejected; approval workflow is Phase 3), reports (7 issue types, one open report per user+location+type). All access via authenticated-only SECURITY DEFINER functions; tests in supabase/tests/account.test.sql.

Public reads: via constrained functions only (no direct table access); verified + explicit-evidence unverified rows; trimmed fields (IMPORT.md).
