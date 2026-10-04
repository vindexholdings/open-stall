# OS-111 Human MVP-Core Checkpoint (Phase 1)

STATUS: NOT APPROVED. Blocked on the live end-to-end test below. Do not mark OS-111 complete until the human reports results.
Scope guard: no OSM/other imports, no merge to main, no production deploy, no new costs, no Phase 2.

## What is already verified
- Backend LIVE and verified: `npm run verify:remote-rls` passed (no direct table access; constrained public functions; importer functions server-only).
- Automated: `npm run check`, `npm run test:db` (incl. the manual-entry SQL below), `npm run test:e2e`.
- NOT yet proven: the app against the live project with real rows; iOS/Android behavior; map tiles (public OSM server = dev only).

## Test-data approach (REVISED): externally researched UNVERIFIED records
We do not claim personal observation. Three real Cody gas stations are added as externally researched UNVERIFIED development records: Maverik (2321 Big Horn Ave), Conoco (1737 17th St), Exxon / Good 2 Go (1543 Depot Dr), all Cody, WY 82414.
- Status `unverified` only (the tool refuses anything else): `restroom_evidence = explicit`, `restroom_verified = false`. Never Verified, never labelled first-party/manual.
- Provenance is separate from the canonical record: a `location_sources` row with `source = 'research'`, a license note, and tags holding your evidence URL + summary, researcher, date, and coordinate provenance. Tagged `purpose: os111-dev-test`, refs `os111-*`.
- No OSM, no Google. Evidence must be a public business/official web page you cite (map-database hosts such as openstreetmap.org, google.*, maps.apple.com are rejected). You record facts only (do not paste page text) and attest to both points.
- Coordinates: US Census Bureau Geocoder (U.S. government data, public domain; storing it is allowed). They are address-range interpolations, so street-level approximate (tens of meters, sometimes ~100 m): fine for OS-111, replace with surveyed coordinates before launch. I could not read the live Census terms from the sandbox; they are the same public-domain U.S. government data, but glance at census.gov/data/developers if you want to double-check. Safest alternative if Census ever fails: stand at the station with your phone GPS and record coordinates yourself (a measurement, not a restroom-observation claim).
- Cleanly removable: `npm run research:sql -- --cleanup` prints SQL that deletes ONLY `source = 'research'` / `os111-%` records (cascades to their source rows). Human-run only.
- No schema change, no new migration. Importers (`source = 'osm'`) never touch these; a later OSM record on top of one is flagged as a duplicate and stays hidden.
- The earlier manual-observation tooling (`npm run manual:sql`) is NOT used for OS-111.

## What this test CAN and CANNOT prove (be honest)
All three records are Unverified, so the live database will have NO Verified record. Therefore live tests of the Verified badge, the "Nearest verified" hint, and the verified-only filter (with results) are not possible. Those remain covered by automated tests only (domain, DB suite, smoke) until a real restroom is confirmed by a person (later, via manual tool or Phase 3 admin). In C6-C8 below you check the Unverified side and the empty-state behaviour. Decide at sign-off whether that is enough for OS-111; I will not mark it complete on my own.

## Part A. Add the three researched records (one step at a time)
1. Pull and copy the template: `git pull origin claude/pensive-brahmagupta-wrrhxn && npm install && cp os111-research-records.json os111-research.local.json`
2. Edit `os111-research.local.json` (git-ignored). For each record fill ONLY: `evidence_url` (https page that says restrooms exist), `evidence_summary` (one sentence, facts only), `researched_on` (YYYY-MM-DD), `researched_by` (your name); set both attestations to `true`. Leave names/addresses as given.
3. Generate SQL (calls the Census geocoder; writes nothing to any database): `npm run research:sql -- --file os111-research.local.json --out os111-research.sql --save-geocodes os111-geocodes.local.json`. It prints each matched address and coordinates. Check they look right for Cody (about 44.5, -109.1); if a station is far off or unmatched, tell me.
4. Read `os111-research.sql`. In the Supabase dashboard (project `xzzbcejgprilmolvdaes`), SQL Editor: paste, Run. The last query lists the rows (all `unverified`, `restroom_verified` = false).
5. Public-API check with the anon key only (Settings, API): `EXPO_PUBLIC_SUPABASE_URL=https://xzzbcejgprilmolvdaes.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key> npm run live:nearby -- 44.5263 -109.0565` Expect three `unverified` rows, nearest first, `PASS distance-sorted`.
6. Same env vars: `npm run verify:remote-rls`. Expect all PASS.

## Part B. Run the app against the live project
1. Create `apps/mobile/.env.local` (git-ignored) with the two PUBLIC values:
   `EXPO_PUBLIC_SUPABASE_URL=https://xzzbcejgprilmolvdaes.supabase.co`
   `EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key>`
2. `cd apps/mobile && npx expo start -c` (the `-c` clears the cache so env values load).
3. Web: press `w`. Phone: install Expo Go and scan the QR code (same Wi-Fi). No cost involved. If your network blocks it, tell me before using `--tunnel`.
4. To test from another spot without travelling (web): Chrome DevTools (F12), three-dot menu, More tools, Sensors, Location, Other, enter lat/lng. Reload after changing.

## Part C. The test script (write PASS/FAIL and notes for each)
1. **Location allowed.** Tap "Find Nearest Restroom". Allow the browser/phone prompt (phone: While Using the App). Expect "Finding your location...", then a map plus a list. [web ___ iOS ___ Android ___]
2. **Nearby + distance sorted.** Expect only your records, nearest first, each with distance and walk ETA. Compare with `npm run live:nearby -- <your lat> <lng>`: same order, distances within a few percent. Move the Sensors location to a different spot, reload, and confirm the order changes accordingly.
3. **Detail page.** Tap a row (and a map marker). Expect: name, address (if entered), badge, distance and walk/bike/drive ETAs, Access section (unknown facts read "Not reported", never "No"), Hours ("may be inaccurate" caveat, or "Not reported"), Amenities. No attribution line is expected for manual records. Web: also open `http://localhost:8081/location/<uuid>` directly, and `/location/not-a-uuid` (expect "This restroom link isn't valid.").
4. **Google Maps.** On detail, pick Walk, then Bike, then Drive, tap "Navigate with Google Maps". Expect the Google Maps app (or google.com/maps in a browser) with directions TO the restroom's coordinates, travel mode matching your pick, origin = your current location. Web: check the URL has `destination=<lat>,<lng>` and no origin parameter.
5. **Apple Maps (iPhone only).** "Navigate with Apple Maps" should appear ONLY on iOS. Tap it: Apple Maps directions to the restroom. Bike falls back to walking (known limitation). On Android and web the button must be absent.
6. **Unverified presentation.** List rows show an amber "? Unverified" badge (text, not color alone); map markers are amber with "(unverified)" in the tooltip; each detail page shows the amber explanation card ("comes from public sources...") and no attribution line. Screen reader announces "Unverified". (Verified styling cannot be seen live: no Verified record exists. See limits above.)
7. **Nearest-verified hint.** Expect NO "Nearest verified" line, because no verified restroom exists. (Hint logic is covered by automated tests.)
8. **Verified-only filter.** Filters, Features, "Verified only": expect the list and map to empty with "No restrooms match your filters. Try clearing some." and "Filters (1)"; Clear restores all three. Also try a 1 mi radius that excludes some stations.
9. **Permission denied and retry.**
   - Web: lock icon in the address bar, Site settings, Location, Block, reload, tap "Find Nearest Restroom". Expect a message telling you to allow location from the address bar and a "Try again" button. Unblock, tap "Try again": results load without reloading.
   - iPhone: Settings, Expo Go, Location, Never. Reopen, tap the button. Expect "Open Settings" and "Try again". Tap Open Settings, set "While Using", return, tap "Try again": results load.
   - Android: deny twice or set the app permission to Deny; same expectations.
   - Also test turning device location services OFF: expect "We couldn't get your location right now..." with "Try again".
10. **Offline.** After a successful load, enable airplane mode and reload/refresh the list: expect the amber "You're offline. Showing saved restrooms..." banner. Open a detail you viewed before: "Offline: showing saved details...".
11. **Automated tests after the live run.** From the repo root: `npm run check`, `npm run test:db` (needs local Postgres 16 binaries; skip and say so if unavailable), `EXPO_OFFLINE=1 npm run test:e2e` (the env var is only needed in networks that block Expo), and `npm run verify:remote-rls` with the env vars set. Expect all green.

## Report back
Send: PASS/FAIL (+ notes/screenshots) for C1 to C11, which platforms you tested (web / iPhone / Android), the three matched addresses/coordinates from step A3, and anything surprising. Do NOT send keys or passwords. I will then record results, fix any defects, and ask you to confirm OS-111.

## Optional cleanup (DESTRUCTIVE, human-run only, only when you want the test records gone)
`npm run research:sql -- --cleanup` prints SQL that deletes ONLY the OS-111 `source = 'research'` / `os111-%` records. Do not run it until you have finished testing and decided.

## Known limits (not defects)
Map tiles use the public OSM server (dev only); no production tile provider yet. The admin app is a placeholder, so Verified status can only be set by SQL. Deep links via `openstall://` need a dev/standalone build (Expo Go uses `exp://`). iOS and Android device behavior is untested until you do this checklist.
