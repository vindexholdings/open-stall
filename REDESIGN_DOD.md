# Consumer redesign milestone: definition of done and coverage matrix (R1-R4, local only)

Status: R4 delivered for Work's review (2026-10-09). Nothing here is deployed. Work owns acceptance; this file records evidence and what is NOT claimed.

## Definition-of-done checklist
| # | Criterion | Evidence | State |
|---|---|---|---|
| 1 | Public discovery usable signed out: locate, list/map, filters, detail, navigation | e2e-discovery (75), e2e-detail (83), e2e-integrated journey | done (local) |
| 2 | Every state has a plain-language recovery path: loading, empty, filtered-empty, denied, offline, error, uncertain, success | discovery/detail/accounts suites; StatusBanner everywhere | done (local) |
| 3 | Unknown never shown as "No"; ratings community-only and labeled; unverified is visible; provenance never overclaims | domain tests (factMark, communityRatingDetail, provenanceNotes, UNVERIFIED_EXPLANATION); detail suite | done |
| 4 | Accessibility: one h1, labeled controls, correct roles/states, visible focus, keyboard operation incl. Enter on result cards, focus moved to the new page heading, landmarks | e2e-integrated: axe-core 0 violations on 35 screen/width audits (phone + 1280), keyboard sweep, focus check; discovery/detail/accounts role checks | done (DOM level) |
| 5 | Responsive: phone, wide, 200% and 400% zoom equivalents, no horizontal scroll, sticky navigation never hides a control, tab labels whole | e2e-integrated (clickability sweep on 16 screens x 4 viewports) | done |
| 6 | Truthful write outcomes: certain only for contract rejection codes; unknown outcomes say "couldn't confirm", keep input, never auto-retry; confirmed deletion stays confirmed | domain/api/accounts/detail tests with lost responses | done |
| 7 | Privacy/auth boundaries: public reads anon-only, favorites never carry coordinates, only the map tile provider is contacted (z/x/y paths), new restroom needs fresh device fix, corrections need none, safe `next` | accounts + integrated suites | done |
| 8 | Docs reconciled: DESIGN_SYSTEM, TESTING, PROJECT_STATE, BACKLOG, this file | this commit | done |
| 9 | Tests/typecheck/lint/secret scan/native bundles | `npm run check` exit 0; android + ios `expo export` bundle (Hermes .hbc) | done |

## Browser / runtime coverage matrix
| Environment | Covered? | How | Gap / severity |
|---|---|---|---|
| Chromium (Playwright headless 1194), Linux | YES | all browser suites | n/a |
| Emulated phone (390x844), desktop (1280x800), zoom equivalents 640x360 (200%) and 320x180 (400%) | YES | viewport emulation | not physical zoom or OS text scaling |
| Firefox, WebKit/Safari | NO | not installed in this container; no install allowed (`playwright install` is out of bounds) | medium: layout/focus differences possible; owner action: run the suites in Safari/Firefox or approve a runner that has them |
| iOS / Android runtime (simulator or device) | NO | none available here; `expo export` for both platforms compiles to Hermes bundles | high for launch, none for this local milestone: native roving focus/keyboard code is web-only; native a11y props (roles, checked/expanded, labels) are type-checked, not exercised |
| Screen readers (VoiceOver, TalkBack, NVDA, JAWS) | NO | none available; axe-core + DOM role/name/state checks are a substitute, not equivalent | high for launch: owner/QA with real assistive tech |
| Physical touch devices, real GPS | NO | emulated geolocation only | medium |
| Text-only browser zoom / OS font scaling | PARTIAL | page zoom emulated; web text is px-based (React Native Web), so "text size only" settings are not honored on web | medium; candidate follow-up |
| Color contrast | YES (automated) | token AA tests + axe color-contrast on every audited screen (0 violations); no manual review of Leaflet tile colors | low |
| Map (Leaflet) | PARTIAL | local fixtures, tiles blocked: labeled region, attribution present, zoom controls 44 px with focus ring and Tab reachable; markers are SVG circles (not focusable) so the list is the accessible equivalent | tiles/legal provider decision stays an owner/legal gate |

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

## Unresolved gates (not part of the local redesign)
Deployment, merge, live data/migrations, tile provider and ODbL/licensing decisions, native/hardware/screen-reader/Safari/Firefox verification, live review-save test (OS-301b), costs.
