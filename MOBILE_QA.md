# Mobile QA kit and device checklist (free, local, mock-only)

Status: kit built and self-tested here; **no native runtime, physical device or screen reader has been run by Claude.** Everything in "Results" below is NOT RUN until a person fills it in. Nothing here touches the live Supabase project, a real tile server, a paid service or any account.

## 1. Evidence split (what each kind of evidence proves)
| Level | What it proves | Status |
|---|---|---|
| A. Automated browser | DOM/ARIA, keyboard, axe, flows against the mock (Chromium, Firefox, WebKitGTK) | DONE (see `REDESIGN_DOD.md`) |
| B. Emulated viewport | Layout at 320-1280 px | DONE (Chromium emulation; Firefox genuine scaling to 500 CSS px) |
| C. Native emulator / simulator | The React Native code actually runs: tab bar, safe areas, rotation, keyboard avoidance, permission prompts, WebView map | **NOT RUN** (blockers in section 2) |
| D. Native physical device | Real touch, GPS, OS text scaling, Expo Go on hardware | **NOT RUN** |
| E. Real screen reader | VoiceOver / TalkBack actually speak the journeys | **NOT RUN** |
Tools that inspect the app without a person using a reader (Xcode Accessibility Inspector, Android Accessibility Scanner / `uiautomator` dumps, tree dumps, axe) are automated inspection at level C or D. They are **not** level E and never count as a VoiceOver/TalkBack pass; record them in their own line of the results template.
A native bundle that compiles (`expo export`, or `qa:selftest --metro`) is **not** runtime evidence. A screen reader that announces startup is **not** a pass.

## 2. What was attempted here (exact blockers)
| Attempt | Result |
|---|---|
| Android emulator | impossible: no `/dev/kvm`; `dl.google.com` (SDK, system images) unreachable from this network |
| iOS Simulator | impossible: needs macOS + Xcode |
| Expo Go for SDK 57 | **unverifiable here**: `api.expo.dev` and `expo.dev` are unreachable, so the Expo Go builds available for SDK 57 (Android APK, iOS App Store build or simulator build) could not be listed. App is on `expo ~57.0.26`. Check path in section 4. Do not assume a physical iPhone can run SDK 57 in the App Store Expo Go until you have seen it open the project. |
| Metro + native bundles against the mock | DONE: `npm run qa:selftest -- --metro` starts Metro (offline, Expo Go mode), serves iOS and Android manifests, builds both native bundles (8.0 / 8.6 MB), confirms they carry the mock URL and placeholder key and contain no live Supabase project reference |
| Browser engines | Chromium, Firefox 157, WebKitGTK 2.52 and the Firefox AT-SPI tree were run (level A/B only) |
| Orca screen reader | launched, spoke no page content: no pass claimed |

## 3. The fixture
Terminal 1 (leave running):
```
npm run qa:mock            # in-memory mock on 0.0.0.0:54800; prints nothing sensitive; holds no real data
```
Terminal 2:
```
npm run qa:app -- --target lan               # physical phone on the same Wi-Fi (default)
npm run qa:app -- --target android-emulator  # Android Studio AVD
npm run qa:app -- --target ios-simulator --ios
npm run qa:app -- --target web               # laptop browser
```
Options: `--port` (mock, default 54800), `--metro-port` (8081), `--ios` / `--android` (also open the platform), `--offline` (Expo offline mode). The script sets only `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (placeholder `qa-mock-anon-key`), `EXPO_PUBLIC_MAP_TILE_URL`, `EXPO_PUBLIC_MAP_ATTRIBUTION` and `EXPO_PUBLIC_LEAFLET_BASE_URL`, all pointing at the mock. No live keys and no tunnel (do not add `--tunnel`). **The launcher refuses to start (exit 3) while any `apps/mobile/.env*` file exists.** `EXPO_NO_DOTENV=1` is set too, but it is not enough: Expo's dev bundles read `.env*` files themselves and those values would override the mock settings (shown by `qa:selftest -- --dotenv`, which uses a throwaway canary file and never touches a real one). The launcher never reads, prints or moves such a file; easiest is to run the QA session from a fresh clone without `.env*` files. Otherwise park the file under a name OUTSIDE the `.env*` family (a name such as `.env.local.off` still starts with `.env.` and is still refused): `mv -n apps/mobile/.env.local apps/mobile/parked-env.local` and, afterwards, `mv -n apps/mobile/parked-env.local apps/mobile/.env.local`. `-n` makes `mv` refuse to overwrite; if nothing moved because the destination exists, stop and compare by hand. The self-test checks that this rename is accepted by the guard and that the restore cannot overwrite. These variables are baked in at bundle time: change target, restart `qa:app` (it uses `--clear`).

Checks (all local, mock only): `npm run qa:selftest` (mock-contract, guard and diagnostics checks; the CI step) / `-- --metro` (adds Metro offline, Expo Go manifests and both native bundles; Metro is probed on `localhost`, `127.0.0.1` and `[::1]` because Expo `--localhost` can listen on IPv6 only; a Metro failure prints the child's exit code, a bounded redacted output tail and versions, so it can be diagnosed from the report alone) / `-- --dotenv` (the .env guard). `npm run qa:browsercheck` exports the web app against the mock and drives headless Chromium through the fixture's controls: a real loading state, filtered-empty vs unfiltered-empty, and the expired-session path (8 checks). These prove the FIXTURE is reproducible in a browser; they are not native runtime evidence.

**Addresses.** The app must reach the mock from where the app runs:
| Where the app runs | Host the app uses | Why |
|---|---|---|
| Physical phone | this computer's LAN IP (chosen automatically) | `localhost` on a phone is the phone. Same Wi-Fi, no VPN, no client isolation ("guest" Wi-Fi often blocks it); allow Node through the computer's firewall on 54800 and 8081 |
| Android emulator | `10.0.2.2` | the emulator's alias for the host computer |
| iOS Simulator, web | `localhost` | shares the host network |
The fixtures are generated around whatever position the app last searched, so they appear around a phone's real location, an emulator's fake GPS or a simulator's chosen location. The mock is plain `http://`. Whether Expo Go (or an emulator/simulator build) lets the app and its WebView reach a cleartext LAN host is **to be verified at runtime**: if the app shows the offline/error state with the mock running and reachable from the device's browser (`http://<host>:54800/health`), record cleartext blocking as the cause instead of assuming it works.

**QA account:** `qa.user@open-stall.test` / `correct horse battery` (never use a real address). **Failures on demand** (`POST /__qa/mode`, JSON; `GET /__qa/state` shows what the mock recorded; `POST /__qa/reset` clears the mock's records, modes and deleted-account flag but does **not** sign anyone out; `POST /__qa/expire` invalidates every issued token; each `/__qa/mode` POST replaces the whole mode):
```
curl -X POST localhost:54800/__qa/mode -d '{"fail":"server","fn":"submit_report","times":1}'  # HTTP 500, nothing saved -> app must say it could not confirm
curl -X POST localhost:54800/__qa/mode -d '{"fail":"lose","fn":"submit_report","times":1}'    # saved, response lost -> app must NOT say nothing happened
curl -X POST localhost:54800/__qa/mode -d '{"fail":"reject","times":1}'                       # 53400 cap rejection -> specific "limit reached" message
curl -X POST localhost:54800/__qa/mode -d '{"fail":"auth","times":1}'                         # one call answers 401 PGRST301; the token stays valid afterwards
curl -X POST localhost:54800/__qa/expire                                                       # every old token, refresh token and /auth/v1/user call is refused until the next sign-in
curl -X POST localhost:54800/__qa/mode -d '{"delayMs":4000,"delayFn":"nearby_locations","delayTimes":1}'  # ONE nearby read takes 4 s (delay applies to public reads too; max 30000)
curl -X POST localhost:54800/__qa/mode -d '{"empty":true}'                                     # the server has no restrooms: "No restrooms found nearby yet"
curl -X POST localhost:54800/__qa/mode -d '{}'                                                 # clear all modes
```
Two different empty states: **unfiltered empty** is `{"empty":true}` (moving the location cannot do this, fixtures follow the searched position); **filtered empty** is the normal fixtures with the *Baby changing* filter on (no fixture has it) and shows "No restrooms match your filters". The deleted-account flag (set when the app calls `delete_my_account`) makes the mock refuse the old bearer, refresh and password sign-in until `/__qa/reset`; it enforces nothing else about accounts.
Offline: stop `qa:mock` (or turn the phone's Wi-Fi off). Server back = start the mock again.

**Permission and GPS simulation (no code, OS controls only):**
- Denied: first prompt "Don't allow" (Android: Deny; iOS: Don't Allow). Reset: iOS Settings > Expo Go > Location; Android Settings > Apps > Expo Go > Permissions.
- Precise vs approximate (Android 12+/iOS): choose "Approximate" / turn off Precise Location. A new-restroom submission must refuse a coarse or stale fix.
- Accuracy boundary: new restroom needs accuracy at most 50 m and a reading at most 2 minutes old. Test good outdoors, then indoors or Android emulator Extended controls > Location, wait over 2 minutes and retry (stale), iOS Simulator Features > Location (fixed point has good accuracy; test stale by waiting).
- Location services off: expect the plain "turn on location" recovery and a manual search path, never a blank screen.

**Map WebView network policy.** With `qa:app`, the Leaflet WebView loads **only** from the mock (`/leaflet/leaflet.js|css` and `/tiles/z/x/y.png`), so the run contacts no third party. Without the override (production default) the WebView loads Leaflet 1.9.4 from cdnjs with Subresource Integrity (sha256 pinned in `apps/mobile/src/map/config.ts`; a test locks the pins to the npm package) and tiles from the configured tile URL, which is the existing tile-provider decision (an owner/legal gate, untouched). The mock also lets you see requests: tiles must be flat grey squares, the attribution line must read "QA mock tiles", the map container must have an accessible label and its children must not be read separately (the list is the accessible equivalent).

## 4. Jake's shortest paths (pick one; each about 30-45 minutes the first time)
**(a) Existing Android phone (shortest, also gives TalkBack).**
1. Check what Expo Go supports: Play Store "Expo Go" > open > its listed SDK must include 57 (or sign in to expo.dev / the Expo Go "Supported SDK" line). If it opens a project and says "incompatible SDK", stop here and use (b) or (c); do not pay for a build.
2. On the computer: `npm ci`, Terminal 1 `npm run qa:mock`, Terminal 2 `npm run qa:app -- --target lan --android`. On the phone (same Wi-Fi) open Expo Go and scan the QR code shown in Terminal 2 (or type the `exp://<ip>:8081` URL).
3. Run the journeys (section 5), then the TalkBack checklist (section 6). Fill in section 8.

**(b) Mac with Xcode + one iOS runtime (simulator; gives Accessibility Inspector and large text, NOT VoiceOver speech on a real device).**
1. Xcode, Settings > Components > install one iOS runtime. `npm ci`; Terminal 1 `npm run qa:mock`.
2. Terminal 2 `npm run qa:app -- --target ios-simulator --ios` (the script already runs Expo Go mode; `--ios` opens the simulator and installs Expo Go for SDK 57 itself if the CLI can reach it). If the CLI cannot install a matching Expo Go, that is the answer to the SDK 57 question: record it in section 8.
3. Run journeys 1-5. Large text: Simulator Settings > Accessibility > Display & Text Size > Larger Text, or Xcode Environment Overrides (the slider icon) > Dynamic Type. Accessibility Inspector (Xcode > Open Developer Tool) audits labels and traits on the running app. VoiceOver in the simulator is allowed but is not a substitute for a device pass: record as "simulator".
A physical iPhone: only if the App Store Expo Go opens an SDK 57 project (see (a) step 1); otherwise it cannot run this app without a paid developer membership, which is not authorized.

**(c) Android Studio AVD (only if no Android phone).** Android Studio > Device Manager > create a Pixel with a recent Google Play image (the Play image supports TalkBack and Expo Go install); `npm run qa:app -- --target android-emulator --android`. Same journeys. Emulator Extended controls > Location sets GPS; Settings > Accessibility > Font size / Display size for large text; rotation with the toolbar buttons.

## 5. Journeys (run each with the mock; expected = what must be true)
Start from a fresh `curl -X POST localhost:54800/__qa/reset` (data only; add `/__qa/expire` when you need signed-out). "Expected" lines are acceptance expectations to observe on a device: web-verified behavior is stated as such; native behavior is NOT established by any existing test.
1. **Signed-out discovery.** Open app > allow location > nearby list in distance order with verified/unverified labels > open filters (selected state announced/shown) > switch List | Map (map region labeled; zoom controls at least 44 px; list remains) > open a restroom: unknown facts read "Not reported", never "No"; community rating labeled as community-only; unverified banner present. Back keeps filters and List/Map choice.
2. **Focus, labels, navigation, keyboard.** Tab bar items are `tab` with selected state and whole labels (no "Favo..."); on WEB, moving to a detail screen puts focus on its heading (`Screen moveFocus` is implemented for web only); on NATIVE, whether a screen reader lands on the heading after navigation is **not implemented or established** — observe and record it, do not assume it; back returns somewhere sensible; every control has a name; with an external keyboard (phone: Bluetooth keyboard, emulator: host keyboard) Tab reaches every control with a visible ring and Enter/Space activate; the focused text field stays visible with the keyboard up (record any field covered; no native keyboard-avoidance behavior is claimed).
3. **Account, favorites, session storage.** Sign in (QA account) > save a favorite > reload/kill and reopen the app: still signed in and favorite present > sign out > Favorites asks to sign in and carries the destination back after sign-in > wrong password shows a generic error > `POST /__qa/expire`, then open Favorites: observed on the web build as "We couldn’t load your favorites. Please sign in again." (not an empty-looking list); on native, record what is shown and whether the stale session is cleared after restart. Native session storage (SecureStore) is **not** covered by any browser result.
4. **Submissions, corrections, reporting, caps, permission failures.** Report a restroom (success; then the four failure modes above, each with the exact copy: "couldn't confirm" keeps the input, never auto-retries and never says it did not save; cap rejection is specific; expired session asks to sign in and keeps input). Suggest a correction (no GPS needed). Add a restroom at current location: GPS denied > recovery text; coarse/stale/inaccurate fix > refusal; good fix > success and the mock `state` shows the submission pending (never public). Double-tap submit: exactly one record in `/__qa/state`.
5. **Loading, offline, empty, error, uncertain.** Slow nearby (delayMs) shows a loading state; stop the mock: offline/error state with Try again; start it: Try again recovers; filtered-empty (Baby changing filter) says "No restrooms match your filters" with a way to remove the filter; unfiltered-empty (`{"empty":true}`) says "No restrooms found nearby yet" (the two must differ); the loading state is real with the delay command (the web build keeps "Looking for restrooms…" visible for the whole delay); the lost-response case from journey 4 shows the uncertain message.

**Native-only checks across the journeys:** OS large text (Android Font size Largest + Display size Largest; iOS Larger Text max and Bold Text): no clipped or overlapping text, controls remain reachable by scrolling. Safe areas: notch/Dynamic Island, gesture bar and the tab bar never overlap content. Orientation: the app is configured portrait-only (`app.json` `orientation: portrait`). Test that it stays portrait when the device is rotated (expected; Android and iPhone), and, on an iPad or a large Android tablet, record what actually happens. Landscape support is not promised and no feature is added for it. Keyboard: sign-in and correction forms with the keyboard up (see journey 2). Native tab behavior (expectation to observe, not a verified guarantee): state per tab is kept when switching, repeated tap on the active tab does not break the stack, Android hardware/gesture back leaves the app only from a root tab. WebView map: pinch/pan do not scroll the page under the map, zoom buttons work, the screen reader can leave the map. The WebView map container is labeled and hides its children from the reader by design, so the list is the accessible equivalent; the WebView/SRI path itself is untested at runtime until a device or emulator loads it.

## 6. Real screen reader checklists (NOT RUN)
**TalkBack (Android).** Enable: Settings > Accessibility > TalkBack (volume-key shortcut helps). Swipe right/left = next/previous item; double-tap = activate; two-finger swipe = scroll; swipe down then right (or up) = TalkBack local menu / reading controls; three-finger swipe = switch tabs in some apps; explore by touch to hear what is under a finger. Verify per journey: each item is announced with name + role + state ("Filters, button, collapsed"; "Near me, selected, tab 1 of 4"); reading order matches the visual order; the result card announces name, distance and verified/unverified status once, not repeated fragments; the map announces its label and is skippable; errors are announced when they appear (live region) and focus is not lost; the Report/Correct forms announce field errors.
**VoiceOver (iOS).** Enable: Settings > Accessibility > VoiceOver (triple-click side button shortcut). Flick right/left = next/previous; double-tap = activate; three-finger flick = scroll; two-finger tap = pause; rotor (twist two fingers) = Headings, Links, Form controls. Verify the same list, plus Headings rotor shows one level-1 heading per screen; selected/expanded traits are spoken; the tab bar reads "tab, 1 of 4".
Pass rule: every item above is heard correctly for all five journeys. Starting the reader, or hearing the app's name, is not a pass. Record device, OS version and reader version.

## 7. What Claude can and cannot say
Claude ran levels A and B only (plus Metro/bundle verification). C, D and E are NOT RUN. Any DOM or emulation result must never be reported as a device or screen-reader result.

## 8. Results template (copy, fill, commit under `docs/evidence/device/`)
```
Date / tester:
Path used (a/b/c) / device model / OS version / Expo Go version / SDK shown:
Expo Go opened the SDK 57 project? yes/no (if no: exact message)
Journey 1 PASS/FAIL notes:   Journey 2:   Journey 3:   Journey 4:   Journey 5:
Large text / safe areas / rotation / keyboard / tab behavior / WebView map:
GPS: denied / approximate / stale / inaccurate / good:
Inspector / Scanner / tree dump findings (automated inspection, NOT a reader pass):
TalkBack or VoiceOver ACTUALLY USED by a person (device vs simulator), version: journeys heard correctly: yes/no per journey
Defects (screenshot or screen recording; no real personal data):
```
