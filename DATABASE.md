# Database
UUID PKs, UTC timestamps, foreign keys, RLS.

Core tables:
profiles: auth user id, display_name, preferred_mode, default_transport, points_balance, timestamps. Never expose email publicly.
locations: name/address/lat/lng/status (candidate|pending|unverified|verified|closed, see IMPORT.md)/restroom_evidence/source/source_reference/license/attribution/restroom_verified/last_verified_at; nullable amenity/access booleans; access_location; average_rating/rating_count; timestamps. Nullable boolean means unknown differs from false.
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

Public reads: verified + explicit-evidence unverified only (RLS). Importer bookkeeping: import_runs, importer columns on locations; merge logic in service_role-only SQL functions (IMPORT.md).
