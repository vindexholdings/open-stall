# OS-111 Human MVP-Core Checkpoint (Phase 1)

STATUS: NOT APPROVED. Blocked on the live end-to-end test below. Do not mark OS-111 complete until the human reports results.
Scope guard: no OSM/other imports, no merge to main, no production deploy, no new costs, no Phase 2.

## What is already verified
- Backend LIVE and verified: `npm run verify:remote-rls` passed (no direct table access; constrained public functions; importer functions server-only).
- Automated: `npm run check`, `npm run test:db` (incl. the manual-entry SQL below), `npm run test:e2e`.
- NOT yet proven: the app against the live project with real rows; iOS/Android behavior; map tiles (public OSM server = dev only).

## Manual-record policy (licensing and safety)
- Records are FIRST-PARTY observations: `source = 'manual'`, license "Open Stall original data (first-party on-site observation); no third-party data", no attribution needed. They contain no OpenStreetMap, Google or other database content, so no ODbL/third-party licensing applies. (Importers only touch `source = 'osm'`; OS-110c still governs any OSM import.)
- Enter ONLY what you personally observed on site: the name as posted, and coordinates measured by your phone's GPS while standing at the entrance. Do NOT copy names, addresses, hours or coordinates out of Google Maps/OSM listings. (Reading your own GPS fix is fine.)
- ONLY genuinely public restrooms. Never a private residence. The tool makes you attest to both.
- `verified` = you personally confirmed the restroom exists and is publicly usable (date + your name required). `unverified` = real, but not fully confirmed (a written basis is required). Do not invent anything to fill the test: if you only have 2 real records, use 1 verified + 1 unverified.
- Records are tagged `dev-test-*` / purpose `mvp-checkpoint-dev-test` so they are easy to find and remove. They are visible through the public API (the live project is unlaunched).
- Max 3 records. Generated SQL is atomic and idempotent (re-running adds nothing).

## Part A. Add 1-3 manual records
1. `git pull` on branch `claude/pensive-brahmagupta-wrrhxn`, then `npm install`.
2. Copy the template: `cp manual-locations.example.json manual-locations.local.json` (`*.local.json` is git-ignored). Edit it:
   - `ref`: `dev-test-<short-lowercase-id>` (for example `dev-test-cody-a`), unique per record.
   - `name`, `latitude`, `longitude` (decimal degrees from your phone, standing at the entrance; Cody is about 44.52, -109.06), `city`, `region`, optional address.
   - `state`: `verified` (set `confirmed_on` as YYYY-MM-DD and `confirmed_by` as your name) or `unverified` (set `basis`, 10+ characters, e.g. "Saw the posted sign; access not checked").
   - Amenity facts: `true`, `false`, or `null` for unknown. Leave `null` when you did not check.
   - Set `"original_observation": true` and `"attested_public": true` only if both are true.
   - Best test set: 2 verified + 1 unverified, a few hundred meters to a few miles apart. Make sure the UNVERIFIED one is NEARER to one test spot than any verified one (needed to see the "Nearest verified" hint).
3. Generate the SQL: `npm run manual:sql -- --file manual-locations.local.json --out manual-locations.sql`. Validation errors stop it and print what to fix. Nothing touches any database.
4. Open `manual-locations.sql` and read it. Open the Supabase dashboard, confirm the project is Open Stall (`xzzbcejgprilmolvdaes`), SQL Editor, paste, Run. The final query lists the rows (expect `protected` = false).
5. Confirm what the PUBLIC API returns (anon key only): get the anon (public) key from Supabase Project Settings, API. Never use the service_role key.
   `EXPO_PUBLIC_SUPABASE_URL=https://xzzbcejgprilmolvdaes.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key> npm run live:nearby -- <lat> <lng>`
   Expect your records nearest first, `PASS distance-sorted`, and a nearest-verified line.
6. Re-run the live access check, now with real rows present: same two env vars, `npm run verify:remote-rls`. Expect all PASS.

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
6. **Verified vs Unverified.** List: green "✓ Verified Mon YYYY" vs amber "? Unverified" (text, not color alone). Map: unverified marker is amber and its tooltip says "(unverified)". Detail of the unverified record shows the amber explanation card; the verified one does not. With a screen reader on (VoiceOver/TalkBack), the badge is announced as "Verified..." / "Unverified".
7. **Nearest-verified hint.** Stand (or set Sensors) nearer the unverified record than any verified one. Expect the green "Nearest verified: X mi · name" line above the list, and tapping it opens that verified record. Standing nearest a verified record: no hint.
8. **Verified-only filter.** Filters, Features, "Verified only". Expect the unverified record to disappear from list and map, no hint, and the filter count "Filters (1)". Tap Clear: everything returns. Also try a 1 mi radius that excludes some records.
9. **Permission denied and retry.**
   - Web: lock icon in the address bar, Site settings, Location, Block, reload, tap "Find Nearest Restroom". Expect a message telling you to allow location from the address bar and a "Try again" button. Unblock, tap "Try again": results load without reloading.
   - iPhone: Settings, Expo Go, Location, Never. Reopen, tap the button. Expect "Open Settings" and "Try again". Tap Open Settings, set "While Using", return, tap "Try again": results load.
   - Android: deny twice or set the app permission to Deny; same expectations.
   - Also test turning device location services OFF: expect "We couldn't get your location right now..." with "Try again".
10. **Offline.** After a successful load, enable airplane mode and reload/refresh the list: expect the amber "You're offline. Showing saved restrooms..." banner. Open a detail you viewed before: "Offline: showing saved details...".
11. **Automated tests after the live run.** From the repo root: `npm run check`, `npm run test:db` (needs local Postgres 16 binaries; skip and say so if unavailable), `EXPO_OFFLINE=1 npm run test:e2e` (the env var is only needed in networks that block Expo), and `npm run verify:remote-rls` with the env vars set. Expect all green.

## Report back
Send: PASS/FAIL (+ notes/screenshots) for C1 to C11, which platforms you tested (web / iPhone / Android), how many records and their states, and anything surprising. Do NOT send keys or passwords. I will then record results, fix any defects, and ask you to confirm OS-111.

## Optional cleanup (DESTRUCTIVE, human-run only, only when you want the test records gone)
`npm run manual:sql -- --cleanup` prints SQL that deletes ONLY `source = 'manual'` / `dev-test-%` records. Do not run it until you have finished testing and decided.

## Known limits (not defects)
Map tiles use the public OSM server (dev only); no production tile provider yet. The admin app is a placeholder, so Verified status can only be set by SQL. Deep links via `openstall://` need a dev/standalone build (Expo Go uses `exp://`). iOS and Android device behavior is untested until you do this checklist.
