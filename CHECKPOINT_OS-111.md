# OS-111 Human MVP-Core Checkpoint (Phase 1)

STATUS: NOT APPROVED. Admin review success does not approve this checkpoint.
No main merge, production deployment, geography expansion, costs, or Phase 2.

## Current test data
Use the existing Cody dev seed. Do not add the obsolete research/manual samples.
65 total imported; initially 9 Unverified and 56 Candidate. Jake has since physically verified records through admin. Both Verified and Unverified can now be tested live; Candidates remain hidden. OSM attribution must remain visible on OSM-derived records.
Admin review migrations 20261005000001 and 20261005000002 are applied. The public-review feature remains deferred.

## Agent preparation
Configure apps/mobile/.env.local with the expected Supabase URL and public anon key only (never service-role). Verify public nearby/detail/nearest-verified/filter output and RLS. Start the local user app; keep it separate from the admin server. Report automated checks honestly.

## Human walkthrough (one operational step at a time)
1. Open the local user app. Tap Find Nearest Restroom and allow location. Expect a map and nearby list, or an honest empty state if outside the Cody radius.
2. Check nearby results are distance sorted with walk estimates; use a Cody test location if necessary. Candidates must not appear.
3. Open a list row and map marker. Confirm detail facts, Unknown/Not reported wording, hours caveat, distance and travel estimates, and OSM attribution.
4. Check Verified and amber Unverified presentation. Nearest-verified hint must refer to a Verified location. Verified-only filtering must return Verified rows; clearing it restores mixed public results.
5. Check Google navigation modes (walk/bike/drive). On iPhone check Apple navigation; Apple option absent on web/Android.
6. Deny location, then retry after allowing it. Confirm helpful denial/retry behavior; check unavailable location services.
7. After a successful load, disconnect network and refresh. Confirm cached list/details and offline warnings.
8. Report platform (web/iPhone/Android) and PASS/FAIL for each step. Fix defects before explicit OS-111 sign-off.

## Evidence and limits
Automated checks and live API/RLS probes supplement human experience; they do not prove device permission UX, maps/navigation, offline behavior, or physical restroom accuracy.
Map tiles and embedded OSM map are development only. Production tile provider/ODbL gates remain pending. No cleanup or deletion is needed for this checkpoint.
