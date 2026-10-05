#!/usr/bin/env node
// Signed-in check of the Phase 2 account functions against the LIVE project, using ONLY the public anon key
// plus a TEST account you created through the app (so email signup + confirmation are exercised by you).
//   LIVE_TEST_EMAIL=you+test@example.com LIVE_TEST_PASSWORD='...' npm run live:account [-- --contribute] [-- --delete]
// Default run is low-impact: it reads, toggles a favorite, saves then removes one rating, and confirms a far-away
// check-in is rejected. It restores everything it changes. --contribute also files ONE report and ONE
// submission (they stay pending until the account is deleted). --delete finishes with delete_my_account('DELETE')
// and verifies the account can no longer sign in. Credentials are read from the environment and never printed.
import { existsSync, readFileSync } from 'node:fs';

const args = new Set(process.argv.slice(2));
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]));
}
const file = loadEnvFile(new URL('../apps/mobile/.env.local', import.meta.url).pathname);
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? file.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? file.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const email = process.env.LIVE_TEST_EMAIL ?? '';
const password = process.env.LIVE_TEST_PASSWORD ?? '';
const expectedRef = /^Project ref:\s*([a-z0-9]+)/im.exec(readFileSync(new URL('../ENVIRONMENT.md', import.meta.url), 'utf8'))?.[1];
if (!url || !anon) { console.error('Missing Supabase URL/anon key (apps/mobile/.env.local).'); process.exit(2); }
if (!url.includes(`${expectedRef}.supabase.co`)) { console.error(`URL project does not match ENVIRONMENT.md (${expectedRef}); refusing.`); process.exit(2); }
if (!email || !password) { console.error('Set LIVE_TEST_EMAIL and LIVE_TEST_PASSWORD (a confirmed TEST account you created in the app).'); process.exit(2); }

let failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) failures++; };
const call = async (path, { token = anon, method = 'POST', body } = {}) => {
  const r = await fetch(`${url}${path}`, { method, headers: { apikey: anon, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = await r.json(); } catch { /* empty */ }
  return { status: r.status, json };
};

const login = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
if (login.status !== 200 || !login.json?.access_token) {
  console.error(`Sign-in failed (status ${login.status}). Confirm the email first (check your inbox) and re-check the password.`);
  process.exit(1);
}
const token = login.json.access_token;
check(true, 'email + password sign-in works for the test account');
const rpc = (fn, body = {}, t = token) => call(`/rest/v1/rpc/${fn}`, { token: t, body });

try {
  // anonymous callers are refused
  const anonFav = await rpc('get_my_profile', {}, anon);
  check([401, 403].includes(anonFav.status), 'account functions refuse the anonymous key', `status ${anonFav.status}`);

  // profile round trip (restored afterwards)
  const p0 = await rpc('get_my_profile');
  check(p0.status === 200 && p0.json?.[0]?.preferred_mode, 'profile exists (created by the signup trigger)', JSON.stringify(p0.json));
  const orig = p0.json?.[0] ?? { display_name: null, preferred_mode: 'plain', default_transport: 'walk' };
  const p1 = await rpc('update_my_profile', { p_display_name: 'Open Stall Tester', p_mode: 'risque', p_transport: 'bike' });
  check(p1.status === 400 && p1.json?.code === '22023', 'reserved display name (contains "Open Stall") is rejected', JSON.stringify(p1.json));
  const p2 = await rpc('update_my_profile', { p_display_name: 'Trail Tester', p_mode: 'risque', p_transport: 'bike' });
  check(p2.status === 200 && p2.json?.[0]?.preferred_mode === 'risque' && p2.json?.[0]?.default_transport === 'bike', 'preferences saved', JSON.stringify(p2.json));
  await rpc('update_my_profile', { p_display_name: orig.display_name, p_mode: orig.preferred_mode, p_transport: orig.default_transport });

  // pick a real public location (anonymous discovery path)
  const near = await rpc('nearby_locations', { p_lat: 44.5263, p_lng: -109.0565, p_radius_m: 16000, p_limit: 5, p_verified_only: false }, anon);
  const loc = Array.isArray(near.json) ? near.json[0] : null;
  check(!!loc?.id, 'public discovery returns a restroom without sign-in', `status ${near.status}`);
  if (!loc) throw new Error('no public location to test against');

  // favorites
  const f1 = await rpc('add_favorite', { p_location: loc.id });
  check(f1.status === 200 && f1.json?.limit === 5, 'favorite added (limit 5)', JSON.stringify(f1.json));
  const f2 = await rpc('add_favorite', { p_location: loc.id });
  check(f2.status === 200 && f2.json?.added === false, 'adding the same favorite again is a no-op');
  const fl = await rpc('list_my_favorites', { p_lat: null, p_lng: null });
  check(fl.status === 200 && fl.json?.some((l) => l.id === loc.id), 'favorite appears in my list');
  await rpc('remove_favorite', { p_location: loc.id });
  const fl2 = await rpc('list_my_favorites', { p_lat: null, p_lng: null });
  check(fl2.status === 200 && !fl2.json?.some((l) => l.id === loc.id), 'favorite removed');

  // rating + observations (restored: the rating is deleted again so the public average returns to its prior value)
  const before = (await rpc('get_public_location', { p_id: loc.id }, anon)).json?.[0];
  const bad = await rpc('submit_review', { p_location: loc.id, p_rating: 6, p_mode: 'plain', p_observations: [] });
  check(bad.status === 400, 'rating 6 is rejected by the database');
  const contra = await rpc('submit_review', { p_location: loc.id, p_rating: 4, p_mode: 'plain', p_observations: ['clean', 'dirty'] });
  check(contra.status === 400, 'contradictory observations are rejected');
  const rv = await rpc('submit_review', { p_location: loc.id, p_rating: 4, p_mode: 'plain', p_observations: ['clean', 'easy_to_find'] });
  check(rv.status === 200, 'rating with observations saved', JSON.stringify(rv.json));
  const mine = await rpc('get_my_review', { p_location: loc.id });
  check(mine.json?.rating === 4 && mine.json?.observations?.length === 2, 'my rating reads back');
  const mid = (await rpc('get_public_location', { p_id: loc.id }, anon)).json?.[0];
  check(mid && before && mid.rating_count === before.rating_count + 1, 'public rating count went up by one', `${before?.rating_count} -> ${mid?.rating_count}`);
  await rpc('delete_my_review', { p_location: loc.id });
  const after = (await rpc('get_public_location', { p_id: loc.id }, anon)).json?.[0];
  check(after && before && after.rating_count === before.rating_count, 'removing my rating restores the public count');

  // check-in: a far-away position must be refused (a real check-in needs you at the restroom; test that in the app)
  const far = await rpc('check_in', { p_location: loc.id, p_lat: 0, p_lng: 0 });
  check(far.status === 400 && /too far/i.test(far.json?.message ?? ''), 'check-in from far away is refused');

  if (args.has('--contribute')) {
    const rp = await rpc('submit_report', { p_location: loc.id, p_issue: 'other', p_comment: 'Automated test report - please ignore' });
    check(rp.status === 204 || rp.status === 200, 'report accepted', JSON.stringify(rp.json));
    // New restrooms must come from a current device fix: all of these are refused WITHOUT creating anything.
    const base = { p_proposed: { name: 'Automated test restroom' }, p_lat: 44.5, p_lng: -109.0, p_accuracy_m: 10, p_attested: true, p_note: null };
    const refused = async (label, patch) => { const r = await rpc('submit_location', { ...base, ...patch }); check(r.status === 400, label, `status ${r.status} ${JSON.stringify(r.json)}`); };
    await refused('new restroom without the public-place attestation is refused', { p_attested: false });
    await refused('new restroom without a position is refused', { p_lat: null, p_lng: null });
    await refused('new restroom without an accuracy reading is refused', { p_accuracy_m: null });
    await refused('new restroom with a poor location fix (500 m) is refused', { p_accuracy_m: 500 });
    await refused('new restroom with coordinates smuggled in the payload is refused', { p_proposed: { name: 'Automated test restroom', latitude: 44.5, longitude: -109.0 } });
    await refused('private-residence submission is refused', { p_proposed: { name: 'My house bathroom' } });
    const old = await rpc('submit_location', { p_proposed: { name: 'x', latitude: 44.5, longitude: -109.0 }, p_attested: true, p_note: null });
    check(old.status === 404, 'the old arbitrary-coordinate submit_location no longer exists', `status ${old.status}`);
    if (args.has('--submit-new')) {
      // Creates ONE pending test item on the live project (only when explicitly requested).
      const sub = await rpc('submit_location', { ...base, p_note: 'Automated test - please ignore' });
      check(sub.status === 200 && typeof sub.json?.coalesced === 'boolean', 'valid current-location submission accepted as pending', JSON.stringify(sub.json));
      const again = await rpc('submit_location', { ...base, p_note: 'again' });
      check(again.status === 400, 'the same account cannot create a duplicate moderation item for the same place', `status ${again.status}`);
      const pub = await rpc('nearby_locations', { p_lat: 44.5, p_lng: -109.0, p_radius_m: 5000, p_limit: 100, p_verified_only: false }, anon);
      check(!JSON.stringify(pub.json).includes('Automated test restroom'), 'pending submission is NOT visible in public discovery');
      const list = await rpc('list_my_submissions');
      check(list.json?.some((x) => x.status === 'pending'), 'my pending submission is listed');
    }
    console.log('NOTE: the test report (and any --submit-new item) stay pending until this account is deleted.');
  }

  if (args.has('--delete')) {
    const bad = await rpc('delete_my_account', { p_confirm: 'delete' });
    check(bad.status === 400, 'account deletion refuses a wrong confirmation');
    const del = await rpc('delete_my_account', { p_confirm: 'DELETE' });
    check(del.status === 204 || del.status === 200, 'account deleted', JSON.stringify(del.json));
    const again = await call('/auth/v1/token?grant_type=password', { body: { email, password } });
    check(again.status === 400, 'deleted account can no longer sign in', `status ${again.status}`);
  }
} catch (e) {
  console.error(`Aborted: ${e.message}`); failures++;
}
console.log(failures ? `\n${failures} check(s) failed.` : '\nLive account checks passed.');
process.exit(failures ? 1 : 0);
