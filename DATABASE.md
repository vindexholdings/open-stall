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

Public reads: via constrained functions only (no direct table access); verified + explicit-evidence unverified rows; trimmed fields (IMPORT.md).
