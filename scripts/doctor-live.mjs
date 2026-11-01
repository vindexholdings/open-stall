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

// 1. Database objects. Every table is private: with the anon key a table that exists answers 42501 (or 401/403);
//    a missing one answers PGRST205/404. `select=*` is used because tables differ in key columns (profiles uses
//    user_id; favorites/review_observations have composite keys), and an unknown column would answer 42703
//    before the permission check.
const tables = ['locations', 'location_sources', 'import_runs', 'location_reviews', 'profiles', 'favorites', 'reviews', 'review_observations', 'checkins', 'submissions', 'reports', 'action_log'];
for (const t of tables) {
  const r = await get(`/rest/v1/${t}?select=*&limit=1`);
  const exists = r.json?.code === '42501' || r.status === 401 || r.status === 403;
  const missing = r.json?.code === 'PGRST205' || r.status === 404;
  row(exists, `table ${t}`, exists ? 'installed, private (anon denied)' : missing ? 'NOT installed' : `UNEXPECTED status ${r.status} ${r.json?.code ?? ''}`);
}
// Account functions: installed and NOT callable anonymously (denied = 401/403 + 42501; missing = PGRST202/404).
const U = '00000000-0000-0000-0000-000000000000';
const accountFns = {
  get_my_profile: {}, update_my_profile: { p_display_name: null, p_mode: 'plain', p_transport: 'walk' },
  add_favorite: { p_location: U }, remove_favorite: { p_location: U }, list_my_favorites: { p_lat: null, p_lng: null },
  submit_review: { p_location: U, p_rating: 3, p_mode: 'plain', p_observations: [] }, get_my_review: { p_location: U }, delete_my_review: { p_location: U },
  check_in: { p_location: U, p_lat: 0, p_lng: 0 }, submit_location: { p_proposed: {}, p_lat: 0, p_lng: 0, p_accuracy_m: 1, p_attested: true, p_note: null },
  submit_location_edit: { p_location: U, p_proposed: {}, p_attested: true, p_note: null }, list_my_submissions: {}, withdraw_my_submission: { p_id: U },
  submit_report: { p_location: U, p_issue: 'other', p_comment: null }, delete_my_account: { p_confirm: 'x' },
  // Phase 3A (installed only after migrations 20261009000001-2): callable by authenticated users but they refuse non-admins; anon is denied.
  am_i_admin: {}, admin_list_submissions: { p_limit: 1 }, admin_list_reports: { p_limit: 1 },
  admin_decide_submission: { p_id: U, p_decision: 'hold', p_reason: null, p_note: null, p_edits: null, p_duplicate_of: null }, admin_resolve_report: { p_id: U, p_resolution: 'resolved', p_note: null },
};
for (const [fn, args] of Object.entries(accountFns)) {
  const r = await get(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  const denied = r.json?.code === '42501' || r.status === 401 || r.status === 403;
  const missing = r.json?.code === 'PGRST202' || r.status === 404;
  row(denied, `function ${fn}`, denied ? 'installed, anon denied' : missing ? 'NOT installed' : `UNEXPECTED status ${r.status} ${r.json?.code ?? ''} (anon may be able to call it!)`);
}
// Authenticated seed review (migration 20261010000001): NOT applied live until the owner approves it, so "missing" is INFO, never a failure.
const pendingFns = {
  admin_location_counts: {}, admin_list_locations: { p_status: 'candidate', p_limit: 1 }, admin_get_location: { p_id: U },
  admin_apply_location_review: { p_location: U, p_reviewer: 'x', p_existence: 'unsure', p_personally_verified: false, p_verified_on: null, p_answers: {} },
};
for (const [fn, args] of Object.entries(pendingFns)) {
  const r = await get(`/rest/v1/rpc/${fn}`, { method: 'POST', body: JSON.stringify(args) });
  const denied = r.json?.code === '42501' || r.status === 401 || r.status === 403;
  const missing = r.json?.code === 'PGRST202' || r.status === 404;
  if (missing) row(null, `function ${fn}`, 'not installed yet (migration 20261010000001 awaits owner approval)');
  else row(denied, `function ${fn}`, denied ? 'installed, anon denied' : `UNEXPECTED status ${r.status} ${r.json?.code ?? ''} (anon may be able to call it!)`);
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
