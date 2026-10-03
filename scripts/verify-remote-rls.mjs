#!/usr/bin/env node
// Read-only verification of public access rules on a REMOTE Supabase project, using only the
// public anon key. Run by a human after migrations are applied:
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... node scripts/verify-remote-rls.mjs
// Write probes are designed to be harmless even if protection were missing: the insert violates
// a CHECK constraint (so no row can be created) and update/delete target a non-existent id.
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

const read = await call('GET', 'locations?select=id,status,restroom_verified&limit=1000');
check('anon can read locations endpoint', read.status === 200, JSON.stringify(read));
check(
  'anon sees only verified+confirmed rows',
  Array.isArray(read.json) && read.json.every((l) => l.status === 'verified' && l.restroom_verified === true),
);
const hidden = await call('GET', 'locations?select=id&status=neq.verified');
check('non-verified rows are invisible to anon', hidden.status === 200 && Array.isArray(hidden.json) && hidden.json.length === 0);

const ins = await call('POST', 'locations', { name: 'probe', latitude: 999, longitude: 0, source: 'osm' });
check('anon insert is denied by privileges (42501, not a constraint error)', ins.json?.code === '42501', JSON.stringify(ins));
const upd = await call('PATCH', `locations?id=eq.${NIL}`, { name: 'probe' });
check('anon update is denied (42501)', upd.json?.code === '42501', JSON.stringify(upd));
const del = await call('DELETE', `locations?id=eq.${NIL}`);
check('anon delete is denied (42501)', del.json?.code === '42501', JSON.stringify(del));

if (failed) process.exit(1);
console.log('Remote RLS verification passed.');
