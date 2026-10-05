#!/usr/bin/env node
// Read-only health check of the LIVE Open Stall Supabase project using ONLY the public anon key from
// apps/mobile/.env.local (or the environment). Safe to run any time; writes nothing.
//   npm run doctor
import { existsSync, readFileSync } from 'node:fs';

function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(
    readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, '')]),
  );
}
const file = loadEnvFile(new URL('../apps/mobile/.env.local', import.meta.url).pathname);
const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? file.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const key = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? file.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';
const expectedRef = /^Project ref:\s*([a-z0-9]+)/im.exec(readFileSync(new URL('../ENVIRONMENT.md', import.meta.url), 'utf8'))?.[1];
if (!url || !key) { console.error('Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (apps/mobile/.env.local).'); process.exit(2); }
if (!url.includes(`${expectedRef}.supabase.co`)) { console.error(`URL project does not match ENVIRONMENT.md (${expectedRef}); refusing.`); process.exit(2); }

const H = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
const get = async (path, init = {}) => {
  const r = await fetch(`${url}${path}`, { headers: H, redirect: 'manual', ...init });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json, location: r.headers.get('location') };
};
let bad = 0;
const row = (ok, name, detail = '') => { console.log(`${ok === null ? 'INFO' : ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`); if (ok === false) bad++; };

// 1. Database objects (a table that exists but is not granted answers 42501; a missing one answers PGRST205/404).
const tables = ['locations', 'location_sources', 'import_runs', 'location_reviews', 'profiles', 'favorites', 'reviews', 'review_observations', 'checkins', 'submissions', 'reports', 'action_log'];
for (const t of tables) {
  const r = await get(`/rest/v1/${t}?select=id&limit=1`);
  const exists = r.json?.code === '42501' || r.status === 401 || r.status === 403;
  const missing = r.json?.code === 'PGRST205' || r.status === 404;
  row(null, `table ${t}`, exists ? 'installed (private)' : missing ? 'NOT installed yet' : `status ${r.status} ${r.json?.code ?? ''}`);
}
const near = await get('/rest/v1/rpc/nearby_locations', { method: 'POST', body: JSON.stringify({ p_lat: 44.5263, p_lng: -109.0565, p_radius_m: 16000, p_limit: 100, p_verified_only: false }) });
row(near.status === 200 && Array.isArray(near.json), 'public nearby_locations works', Array.isArray(near.json) ? `${near.json.length} public rows near Cody` : `status ${near.status}`);

// 2. Auth configuration (public settings endpoint).
const s = await get('/auth/v1/settings');
if (s.status !== 200) row(false, 'auth settings reachable', `status ${s.status}`);
else {
  const ext = s.json.external ?? {};
  row(ext.email === true, 'email provider enabled');
  row(s.json.mailer_autoconfirm !== true, 'email confirmation required (recommended)', s.json.mailer_autoconfirm ? 'auto-confirm is ON' : 'on');
  row(s.json.disable_signup !== true, 'sign-ups allowed');
  row(null, 'Google provider', ext.google ? 'enabled' : 'NOT enabled');
  row(null, 'Apple provider', ext.apple ? 'enabled' : 'not enabled (skipped for now)');
}
// 3. Google OAuth is really configured: authorize redirects to Google.
const g = await get(`/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent('http://localhost:8081/auth/callback')}`);
row(null, 'Google authorize redirect', g.status === 302 && /accounts\.google\.com/.test(g.location ?? '') ? 'OK (redirects to accounts.google.com)' : `not ready (status ${g.status}${g.json?.msg ? `: ${g.json.msg}` : ''})`);
// 4. Wrong credentials produce the generic error (no account enumeration) and nothing is created.
const w = await get('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email: 'doctor-check@example.invalid', password: 'not-a-real-password-123' }) });
row(w.status === 400 && /invalid/i.test(`${w.json?.error_code ?? ''}${w.json?.msg ?? ''}`), 'wrong credentials rejected generically', `status ${w.status}`);
console.log(bad ? `\n${bad} check(s) failed.` : '\nNo failures. INFO lines show what is or is not set up yet.');
process.exit(bad ? 1 : 0);
