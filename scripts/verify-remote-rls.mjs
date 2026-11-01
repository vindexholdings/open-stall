#!/usr/bin/env node
// Read-only verification of the public access model on a REMOTE Supabase project, using only the
// public anon key. Run by a human after migrations are applied:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... node scripts/verify-remote-rls.mjs
// Write probes are harmless even if protection were missing: the insert violates a CHECK constraint
// (no row can be created) and update/delete target a non-existent id.
const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !key) {
  console.error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY (public anon key only).');
  process.exit(2);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const NIL = '00000000-0000-0000-0000-000000000000';
const call = async (method, path, body) => {
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch { /* empty body */ }
  return { status: r.status, json };
};

let failed = false;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`);
  failed ||= !ok;
};
const denied = (res) => res.json?.code === '42501' || res.status === 401 || res.status === 403;

// 1. No direct table access of any kind.
for (const table of ['locations', 'location_sources', 'import_runs', 'location_reviews']) {
  check(`anon cannot read table ${table}`, denied(await call('GET', `${table}?select=id&limit=1`)), 'readable!');
}
const ins = await call('POST', 'locations', { name: 'probe', latitude: 999, longitude: 0 });
check('anon insert denied by privileges (42501, not a constraint error)', ins.json?.code === '42501', JSON.stringify(ins));
check('anon update denied', denied(await call('PATCH', `locations?id=eq.${NIL}`, { name: 'probe' })), 'update allowed?');
check('anon delete denied', denied(await call('DELETE', `locations?id=eq.${NIL}`)), 'delete allowed?');

// 2. Public functions return only the intended fields and displayable verification values.
const ALLOWED = new Set(['id', 'name', 'address_line', 'city', 'region', 'postal_code', 'latitude', 'longitude', 'verification', 'last_verified_at', 'opening_hours', 'fee_required', 'key_required', 'purchase_required', 'wheelchair_accessible', 'gender_neutral', 'baby_changing', 'has_hot_water', 'has_cold_water', 'access_location', 'average_rating', 'rating_count', 'attribution', 'distance_m']);
const near = await call('POST', 'rpc/nearby_locations', { p_lat: 44.5263, p_lng: -109.0565, p_radius_m: 100000, p_limit: 100000 });
check('nearby_locations callable by anon', near.status === 200 && Array.isArray(near.json), JSON.stringify(near).slice(0, 200));
if (Array.isArray(near.json)) {
  check('row cap of 100 enforced', near.json.length <= 100);
  check('only verified/unverified returned', near.json.every((r) => r.verification === 'verified' || r.verification === 'unverified'));
  check('no internal fields exposed', near.json.every((r) => Object.keys(r).every((k) => ALLOWED.has(k))), 'unexpected field');
  const d = near.json.map((r) => r.distance_m);
  check('ordered nearest first', d.every((v, i) => i === 0 || d[i - 1] <= v));
}
const bad = await call('POST', 'rpc/nearby_locations', { p_lat: 91, p_lng: 0 });
check('invalid coordinates rejected (22023)', bad.json?.code === '22023', JSON.stringify(bad));
const ghost = await call('POST', 'rpc/get_public_location', { p_id: NIL });
check('unknown id returns nothing', ghost.status === 200 && Array.isArray(ghost.json) && ghost.json.length === 0);
const nv = await call('POST', 'rpc/nearest_verified_location', { p_lat: 44.5263, p_lng: -109.0565 });
check('nearest_verified_location callable; verified only', nv.status === 200 && Array.isArray(nv.json) && nv.json.every((r) => r.verification === 'verified'));

// 3. Importer functions are server-only.
const imp = await call('POST', 'rpc/import_locations', { p_run: NIL, p_records: [] });
check('anon cannot execute import_locations', denied(imp) || imp.status === 404, JSON.stringify(imp));
const fin = await call('POST', 'rpc/finalize_import_run', { p_run: NIL });
check('anon cannot execute finalize_import_run', denied(fin) || fin.status === 404, JSON.stringify(fin));

// 4. Admin review RPCs remain inaccessible to public clients.
const review = await call('POST', 'rpc/apply_location_review', {
  p_location: NIL, p_reviewer: 'access-probe', p_existence: 'unsure', p_access: 'unknown',
  p_wheelchair: null, p_gender_neutral: null, p_baby_changing: null,
  p_hot_water: null, p_cold_only: null, p_notes: null, p_personally_verified: false, p_verified_on: null,
});
check('anon cannot execute apply_location_review', denied(review) || review.status === 404, JSON.stringify(review));
const visit = await call('POST', 'rpc/apply_location_review_v2', {
  p_location: NIL, p_reviewer: 'access-probe', p_reviewer_identity: 'probe',
  p_existence: 'unsure', p_personally_verified: false, p_verified_on: null, p_answers: {},
});
check('anon cannot execute apply_location_review_v2', denied(visit) || visit.status === 404, JSON.stringify(visit));

if (failed) process.exit(1);
console.log('Remote access-model verification passed.');
