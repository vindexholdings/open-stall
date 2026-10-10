# Consumer redesign milestone: definition of done and coverage matrix (R1-R4, local only)

Status: R4 corrected and re-delivered for Work's review (2026-10-10). Nothing here is deployed. Work owns acceptance; this file records evidence and what is NOT claimed.

## Definition-of-done checklist
| # | Criterion | Evidence | State |
|---|---|---|---|
| 1 | Public discovery usable signed out: locate, list/map, filters, detail, navigation | e2e-discovery (75), e2e-detail (83), e2e-integrated journey | done (local) |
| 2 | Every state has a plain-language recovery path: loading, empty, filtered-empty, denied, offline, error, uncertain, success | discovery/detail/accounts suites; StatusBanner everywhere | done (local) |
| 3 | Unknown never shown as "No"; ratings community-only and labeled; unverified is visible; provenance never overclaims | domain tests (factMark, communityRatingDetail, provenanceNotes, UNVERIFIED_EXPLANATION); detail suite | done |
| 4 | Accessibility: one h1, labeled controls, correct roles/states, visible focus, keyboard operation incl. Enter on result cards, focus moved to the new page heading, landmarks, coherent navigation semantics | e2e-integrated (58): axe-core 0 violations on 35 screen/width audits, keyboard sweep, focus, navigation semantics; Firefox 26, WebKitGTK 23, Firefox AT-SPI tree 24 | done at DOM/accessibility-API level; screen readers NOT run |
| 5 | Responsive: phone, wide, 200% and 400% zoom, no horizontal scroll, sticky navigation never hides a control, nav labels whole | Chromium emulated viewports (16 screens x 4); Firefox GENUINE zoom 200%/400% and minimum font size | done |
| 6 | Truthful write outcomes: certain only for contract rejection codes; unknown outcomes say "couldn't confirm", keep input, never auto-retry; confirmed deletion stays confirmed | domain/api/accounts/detail tests with lost responses | done |
| 7 | Privacy/auth boundaries: public reads anon-only, favorites never carry coordinates, only the map tile provider is contacted (z/x/y paths), new restroom needs fresh device fix, corrections need none, safe `next` | accounts + integrated suites | done |
| 8 | Docs reconciled: DESIGN_SYSTEM, TESTING, PROJECT_STATE, BACKLOG, this file | this commit | done |
| 9 | Tests/typecheck/lint/secret scan/native bundles | `npm run check` exit 0; android + ios `expo export` bundle (Hermes .hbc) | done |

## Browser / runtime coverage matrix (final source, 2026-10-10)
Exact environments and results are in `docs/evidence/r4/xbrowser-results.txt` and the Playwright suite output. "Genuine" means the browser itself applied the setting; "emulated" means a viewport/window size was set.
| Environment | Executed? | How / exact runtime | Result and limits |
|---|---|---|---|
| Chromium 141.0.7390.37 (Playwright headless shell 1194), Linux x86_64 | YES | all five Playwright suites (discovery 75, detail 83, accounts 98, integrated 58, auth + smoke) | pass. Zoom is EMULATED (viewport 640x360 and 320x180). A genuine-zoom attempt through `--force-device-scale-factor` changed devicePixelRatio but not the CSS layout width (headless window size is in CSS px), so it was removed rather than reported as zoom. |
| Firefox 157.0.1 (conda-forge build, x86_64 Linux, headless) via geckodriver 0.37.1 + selenium-webdriver 4.51.0 | YES | `scripts/xbrowser-check.mjs firefox` (26 checks) | pass: render, locate, results, Enter opens a card, focus to heading, no focusable controls in inactive screens, visible focus on every Tab stop, radio arrow keys, labeled inputs, navigation landmark with aria-current. GENUINE zoom through `layout.css.devPixelsPerPx` 2 and 4 (viewport 640x317 / 320x159 CSS px): no horizontal scroll, whole nav labels, no covered control. Browser "minimum font size" = 24 px: no overflow, nothing covered. |
| WebKit engine: WebKitGTK 2.52.6 (Ubuntu 24.04 `webkit2gtk-driver` / MiniBrowser) under Xvfb | YES | `scripts/xbrowser-check.mjs webkit` (23 checks) | pass. This is the WebKit ENGINE on Linux, NOT Safari on macOS/iOS. Zoom EMULATED by window size (no zoom control through the driver). WebDriver key events do not set `:focus`/`:focus-visible` in this build, so focus rings are asserted only for state-driven rings (all controls incl. the navigation links now use them). |
| Firefox platform accessibility tree via AT-SPI 2.52 (what a screen reader such as Orca consumes), real Xvfb window | YES | `scripts/xbrowser-atspi.sh` (24 checks) | pass: level-1/level-2 headings, checked radio buttons (exactly one selected), expanded disclosure button, navigation landmark, four links, no tab roles in the document, unknown fact exposed as "Not reported", labeled entry and password fields. This verifies exposure of roles/names/states; it is NOT a screen-reader run. |
| Orca 46.1 screen reader on Linux | ATTEMPTED, NO PASS CLAIMED | installed from Ubuntu; it launched once and announced "Screen reader on" | I could not make it follow page focus or speak page content in this container (launch hung intermittently; WebDriver-driven focus did not produce speech and the xdotool route never got that far). Unperformed. |
| Safari on macOS/iOS, Chrome/Edge on Windows/macOS | NO | not available on this Linux container | high for launch; smallest owner action: run `npm run test:e2e:integrated` (or open the deployed preview) in Safari and Edge |
| iOS / Android runtime | NO | `expo export` for both platforms compiles to Hermes bundles (4 MB / 4.3 MB). No Android emulator is possible here (no /dev/kvm, `dl.google.com` blocked) and iOS needs macOS | high for launch; native roving focus/keyboard code is web-only; native a11y props (roles, checked/expanded, labels, tab role for the native bar) are type-checked, not exercised. Smallest owner action: one run on a real iPhone and one Android phone with VoiceOver/TalkBack |
| VoiceOver, TalkBack, NVDA, JAWS | NO | none runnable here | high for launch; smallest owner action as above (about 30 minutes: the five journeys in `REDESIGN_DOD.md` with each screen reader) |
| Physical touch devices, real GPS | NO | emulated geolocation only | medium |
| Text-only browser zoom / OS font scaling | PARTIAL | Firefox minimum-font-size 24 px was exercised; React Native Web sizes text in px, so "text size only" settings that scale relative to the default are not honored on web, and OS font scaling is native-only | medium; candidate follow-up (rem-based web typography) |
| Color contrast | YES (automated) | token AA tests + axe color-contrast on 35 audits (0 violations); no manual review of map tile colors | low |
| Map (Leaflet) | PARTIAL | local fixtures, tiles blocked: labeled region, attribution, 44 px zoom controls with focus ring, Tab reachable; markers are SVG circles (not focusable) so the list is the accessible equivalent | tile provider / ODbL decision stays an owner/legal gate |

## Leaflet CSS asset warnings (inspected)
The Expo export prints "Importing local resources in CSS is not supported yet" for `leaflet.css` lines 359-407: the layers-control toggle sprite and the default marker icon path. The app uses neither (no layers control, markers are `circleMarker` vectors), so the warning has no runtime effect and no broken request is made (verified: the only third-party request in the browser run is the tile layer). Left as is; no vendor CSS fork.

## Defects found and fixed during R4 (all demonstrated by the integrated suite)
1. Going back from a restroom reset the discovery filters and List/Map choice (now kept for the session: `state/discoverySession.ts`).
2. Result cards could not be opened with Enter (react-native-web does not activate `role=link` Pressables): `enterActivates`.
3. Focus stayed on the hidden list after opening a restroom: pushed screens now move focus to their heading (`Screen moveFocus`).
4. No visible focus indicator on tab bar links and text inputs: global focus-visible rule + `TextField` ring.
5. Leaflet zoom controls were 30 px and had no focus ring: 44 px targets + ring.
6. Tab labels truncated at 320 px ("Favo..."): side padding removed, 13 px label.
7. axe: content outside landmarks (`region`) and heading order: `main` landmark per screen, tab bar marked as navigation, card headings are level 2.
8. Uncertainty copy: certain outcomes restricted to the contract's rejection codes; the deletion message no longer concludes deletion from a failed sign-in.

9. (Work review 6474c9f) The navigation used `tablist`/`tab` roles without arrow-key behavior: replaced by a labeled `navigation` landmark of ordinary links (`MainNav`) with `aria-current="page"`; native keeps real tab semantics.
10. (found by the Firefox run) After client-side navigation the previous screens stayed focusable (aria-hidden but Tab-reachable): `enableScreens(true)` on web makes inactive screens `display:none` while keeping their state.
11. The committed 400% screenshot came from a mutation-check build (my error: the mutation run overwrote evidence after the final run). All evidence images were regenerated from the final source in one clean sequential pass and viewed; mutation runs must be followed by `git checkout docs/evidence`.

## Unresolved gates (not part of the local redesign)
Deployment, merge, live data/migrations, tile provider and ODbL/licensing decisions, native/hardware/screen-reader/Safari/Firefox verification, live review-save test (OS-301b), costs.
