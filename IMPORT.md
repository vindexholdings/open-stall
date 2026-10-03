# Visibility rules and real-location import

## Visibility states (`locations.status`)
| Status | Meaning | Public read? | UI |
|---|---|---|---|
| verified | Open Stall/admin/approved process confirmed the restroom (`restroom_verified`, `last_verified_at`) | Yes | "Verified" badge |
| unverified | Real location with EXPLICIT external restroom evidence (`restroom_evidence = explicit`), not yet confirmed by Open Stall | Yes | "Unverified" badge + explanation, filterable via "Verified only" |
| candidate | Imported/inferred possible location without sufficient evidence | No | never shown |
| pending | User submission awaiting moderation | No | never shown |
| closed | No longer available | No | never shown |

Public RLS policy: `(status='verified' AND restroom_verified) OR (status='unverified' AND restroom_evidence='explicit' AND NOT restroom_verified)`.
DB constraints: verified needs confirmation; only verified/closed may claim `restroom_verified`; unverified needs explicit evidence.
Domain (`isPubliclyVisible`, `toPublicLocation`) mirrors this and re-checks client-side. Public roles can read only listed columns (no importer/bookkeeping columns).
A business existing is never evidence of a public restroom.

## OSM evidence rules (`packages/importer/src/osmClassify.ts`)
- EXPLICIT (-> unverified): `amenity=toilets` with access unset/yes/permissive/public/customers; or `toilets=yes` with `toilets:access` public/customers. Customers-only sets `purchase_required=true`.
- INFERRED (-> hidden candidate): `toilets=yes` with unknown access; or a named place of a type that often has restrooms (fuel, library, town hall, community centre, camp/caravan/picnic site, visitor centre, rest area/services).
- SKIPPED (not stored): private/restricted/permit access, residential buildings, disused/abandoned, no coordinates, unnamed candidates, ordinary businesses (restaurants, cafes, shops, bars).
- Provenance kept: source=osm, source_reference=`node|way|relation/<id>`, license `ODbL-1.0`, attribution `© OpenStreetMap contributors`, whitelisted source tags (no contact details), content hash.

## Merge rules (enforced in SQL: `import_locations`, service_role only)
- Idempotent on `(source, source_reference)`; reruns update, never duplicate; unchanged records only touch last-seen fields.
- New: explicit -> unverified, else candidate.
- Existing verified/pending/closed or admin-edited (`manually_edited_at`) records are NEVER overwritten; only provenance (tags, hash, last seen) refreshes.
- Existing unverified/candidate records refresh from source; status follows current evidence (upgrade/downgrade).
- `finalize_import_run` (only after a COMPLETE successful pass): records of that source inside the run bounds not seen again get `source_missing_since`; unverified ones are hidden (-> candidate); verified/admin-edited ones are only flagged for admin review. Rows outside the bounds are untouched.

## Running the importer (human machine; sandbox cannot reach Overpass/Supabase)
```
npm run import:osm -- --area cody-area                         # dry run, writes nothing
npm run import:osm -- --bbox 44.45,-109.25,44.62,-108.85 --save-raw raw.json --report report.json
npm run import:osm -- --from-file raw.json --area cody-area    # replay offline
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  npm run import:osm -- --area cody-area --apply --confirm-project xzzbcejgprilmolvdaes
```
Safety: dry run is the default; apply requires the URL project to match `ENVIRONMENT.md` AND `--confirm-project`; all tiles are fetched before anything is written (any failed tile aborts); the service-role key is read from env only and never logged or committed. Presets (`cody-area`, `big-horn-basin`) are approximate conveniences; any `--bbox` works.

## Refresh
Re-run the same command periodically. Changed OSM data updates unverified/candidate records; verified data is never overwritten. A scheduled job (e.g. GitHub Action) needs the service-role secret and is a separate human-approved step.

## Licensing (review before launch)
OSM data is ODbL: attribution is stored and shown in the app (detail screen, map tiles). A public derived database may carry share-alike obligations; include in the pre-launch licensing review (SECURITY.md). Overpass use must follow its fair-use policy (importer sends a descriptive User-Agent, tiles requests, delays, retries politely).
