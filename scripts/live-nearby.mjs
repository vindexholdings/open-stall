#!/usr/bin/env node
// Read-only: shows exactly what the PUBLIC API returns near a point (anon key only).
//   EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... npm run live:nearby -- 44.5263 -109.0565 [radius_m]
const [latArg, lngArg, radiusArg] = process.argv.slice(2);
const url = process.env.EXPO_PUBLIC_SUPABASE_URL?.replace(/\/$/, '');
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const lat = Number(latArg), lng = Number(lngArg), radius = Number(radiusArg ?? 8047);
if (!url || !key || !Number.isFinite(lat) || !Number.isFinite(lng)) {
  console.error('Usage: EXPO_PUBLIC_SUPABASE_URL=... EXPO_PUBLIC_SUPABASE_ANON_KEY=... npm run live:nearby -- <lat> <lng> [radius_m]');
  process.exit(2);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const rpc = async (name, body) => (await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) })).json();
const mi = (m) => (m / 1609.344).toFixed(2) + ' mi';

const rows = await rpc('nearby_locations', { p_lat: lat, p_lng: lng, p_radius_m: Math.round(radius), p_limit: 100, p_verified_only: false });
if (!Array.isArray(rows)) { console.error('Error:', JSON.stringify(rows)); process.exit(1); }
console.log(`nearby_locations (${rows.length} row(s), nearest first):`);
for (const r of rows) console.log(`  ${mi(r.distance_m).padStart(9)}  ${r.verification.padEnd(10)}  ${r.name}${r.opening_hours ? `  [hours: ${r.opening_hours}]` : ''}${r.attribution ? `  [${r.attribution}]` : ''}`);
const nv = await rpc('nearest_verified_location', { p_lat: lat, p_lng: lng });
console.log('nearest_verified_location:', Array.isArray(nv) && nv[0] ? `${nv[0].name} (${mi(nv[0].distance_m)})` : 'none');
const sorted = rows.every((r, i) => i === 0 || rows[i - 1].distance_m <= r.distance_m);
console.log(sorted ? 'PASS distance-sorted' : 'FAIL not distance-sorted');
if (!sorted) process.exit(1);
