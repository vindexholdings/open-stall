# Visibility, public data access, and real-location import

## 1. Visibility states (`locations.status`)
| Status | Meaning | Public? | UI |
|---|---|---|---|
| verified | Open Stall/admin/approved process confirmed the restroom | Yes | "Verified" badge |
| unverified | Real location with EXPLICIT external restroom evidence, not yet confirmed by Open Stall | Yes | "Unverified" badge + explanation; "Verified only" filter; nearest-verified hint |
| candidate | Inferred, held (recent source edit) or possible-duplicate record | No | never shown |
| pending | User submission awaiting moderation | No | never shown |
| closed | No longer available | No | never shown |

A business existing is never evidence of a public restroom. DB constraints: verified needs confirmation; only verified/closed may claim `restroom_verified`; unverified needs explicit evidence; a flagged possible duplicate cannot be public-unverified.

## 2. Public data access model (no direct table access)
- `anon` and `authenticated` have NO privileges on `locations`, `location_sources` or `import_runs` (RLS enabled with no policies, grants revoked).
- Clients call three `SECURITY DEFINER` functions (fixed `search_path`, input validation, hard caps):
  - `nearby_locations(lat, lng, radius_m ≤ 100 km, limit ≤ 100, verified_only)`: nearest first, server-side.
  - `get_public_location(id)`: one displayable location or nothing.
  - `nearest_verified_location(lat, lng, max_m ≤ 100 km)`: the single nearest verified location.
- They return only `verified`/explicit-evidence `unverified` rows and only these fields: id, name, address, lat/lng, `verification`, last_verified_at, opening_hours, fee/key/purchase, accessibility/amenities, access_location, rating, attribution, distance. NOT exposed: status internals, evidence level, sources/tags/hashes, edit flags, timestamps, country, duplicate links.
- Import functions are `service_role`-only; internal helpers are not executable by clients.

## 3. Data model
- `locations`: canonical Open Stall records (what the app shows).
- `location_sources`: per-source provenance (source, reference, license, attribution, raw tags, content hash, source edit time, hold reason, freshness, missing flag, primary flag). Many sources per location; new sources need no schema change.
- `import_runs`: one row per run: standard bounds `{south,west,north,east}` (validated), scope, `complete` flag, stats.

## 4. OSM evidence rules (`packages/importer/src/osmClassify.ts`)
- EXPLICIT (-> unverified): `amenity=toilets` with access unset/yes/permissive/public/customers; or `toilets=yes` with public/customers `toilets:access`. Customers-only sets `purchase_required`.
- INFERRED (-> hidden candidate): `toilets=yes` with unknown access; named fuel/library/town hall/community centre/camp, caravan, picnic site/visitor centre/rest area.
- SKIPPED: private/restricted access, residential buildings, disused, no coordinates, unnamed candidates, ordinary businesses.
- Also imported: `opening_hours` (raw, shown as "may be inaccurate") and `fee`. Contact details and editor identities are never stored.

## 5. Import and refresh safety (enforced in SQL, `service_role` only)
- Idempotent on `(source, source_reference)`; unchanged records only touch freshness fields.
- NEVER overwritten: verified, pending, closed, or manually edited locations. A trigger stamps `manually_edited_at` automatically on any non-importer edit (including dashboard edits); only the source row refreshes.
- Recent-edit hold: new or changed explicit records whose OSM timestamp is under 14 days old are held hidden (candidate) until they age; unchanged public records are not hidden by it.
- Possible duplicates: a new explicit record within 30 m of an existing restroom-level location AND (within 10 m, or same/generic name) is inserted hidden with `possible_duplicate_of`. NEVER auto-merged. Place-level inferred candidates are not compared. An admin resolves flags (Phase 3).
- Finalize (stale handling) requires a COMPLETE run (all tiles fetched, or a replay whose capture covers the run's area/scope). It judges only what the run queried (scope), flags missing sources, hides only unprotected unverified locations whose sources are all missing, and refuses to hide more than max(5, 10%) of the area's public unverified records, or anything when the run saw nothing, unless forced (`--force-finalize`). Verified/edited records are only flagged for review.

## 6. Running the importer (operator machine; the cloud sandbox cannot reach Overpass/Supabase)
```
npm run import:osm -- --area cody-area                         # dry run, writes nothing
npm run import:osm -- --bbox 44.45,-109.25,44.62,-108.85 --save-raw raw.json --report report.json
npm run import:osm -- --from-file raw.json --area cody-area    # replay (finalize only if capture matches)
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run import:osm -- --area cody-area --apply --confirm-project xzzbcejgprilmolvdaes
```
Dry run is the default. Apply needs the URL project to match `ENVIRONMENT.md` AND `--confirm-project`; all tiles are fetched before anything is written; the service-role key comes from the environment only. Presets are approximate; any `--bbox` works. NOTHING HAS BEEN IMPORTED; any import needs separate human approval.

## 7. Licensing gate (ODbL): HUMAN APPROVAL REQUIRED
OSM data is licensed under the ODbL (attribution + share-alike). Storing OSM-derived records separately in `location_sources` keeps provenance clean and lets OSM discovery be treated as a source layer, but it does NOT eliminate ODbL/share-alike obligations: a database that substantially incorporates OSM data, or combines it with other data, may be a "derived database".
Before ANY of the following, get explicit human approval after legal/licensing review:
1. commercial-scale OSM import (beyond a small development/validation area);
2. public launch containing OSM-derived data;
3. licensing, selling or sharing Open Stall location data;
4. combining substantial OSM-derived data with proprietary, community or third-party commercial datasets.
Until then: small geographic validation datasets only, after separate approval; attribution is stored (`location_sources.attribution`) and displayed in the app and on map tiles. Overpass use must follow its fair-use policy (descriptive User-Agent, tiled requests, delays, polite retries).

## 8. Refresh
Re-run the same command periodically; changed OSM data updates unprotected unverified/candidate records, never protected ones. A scheduled job needs the service-role secret and is a separate human-approved step.
