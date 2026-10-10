#!/usr/bin/env node
// Self-test of the mobile QA kit WITHOUT any device: starts the mock on a free port and checks every route the app uses
// (auth, discovery, account writes, the failure switches, tiles, Leaflet files); with --metro it also starts the Expo
// dev server (Expo Go flow, offline, localhost) pointed at the mock and fetches the iOS and Android manifests and
// bundles, proving the native JavaScript bundles build with the mock's configuration baked in.
// It does NOT run the app on a phone, simulator or emulator; native runtime remains a manual step (MOBILE_QA.md).
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { startQaMock } from './qa-mock-server.mjs';

let passed = 0; let failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (ok) passed++; else failures++; };
const mock = await startQaMock({ port: 0, host: '127.0.0.1' });
const U = mock.url;
const rpc = (fn, body, token) => fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
const state = async () => (await fetch(`${U}/__qa/state`)).json();
const mode = (m) => fetch(`${U}/__qa/mode`, { method: 'POST', body: JSON.stringify(m) });

try {
  check((await (await fetch(`${U}/health`)).json()).ok === true, 'health');
  // fixtures follow the position the app asks about (a phone anywhere sees them nearby)
  const rows = await (await rpc('nearby_locations', { p_lat: 37.3349, p_lng: -122.009, p_radius_m: 8000 })).json();
  const km = (r) => Math.hypot((r.latitude - 37.3349) * 111.2, (r.longitude + 122.009) * 111.2 * Math.cos(37.3349 * Math.PI / 180));
  check(rows.length === 4 && rows.every((r) => km(r) < 2), 'nearby restrooms are generated around the requested position (4 within 2 km)', JSON.stringify(rows.map((r) => km(r).toFixed(2))));
  check(rows.some((r) => r.verification === 'unverified' && r.wheelchair_accessible === null && r.key_required === null), 'an unverified restroom with every fact unknown is included');
  const one = await (await rpc('get_public_location', { p_id: rows[0].id })).json();
  check(one.length === 1 && one[0].name === rows[0].name, 'detail by id works');
  // auth
  const bad = await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email: 'x@y.z', password: 'nope' }) });
  check(bad.status === 400, 'wrong password is refused');
  const ok = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email: 'qa.user@open-stall.test', password: 'correct horse battery' }) })).json();
  check(typeof ok.access_token === 'string' && ok.user.email === 'qa.user@open-stall.test', 'the QA account signs in');
  const T = ok.access_token;
  check((await rpc('add_favorite', { p_location: rows[0].id })).status === 401, 'account functions refuse a request without the token');
  check((await rpc('add_favorite', { p_location: rows[0].id }, T)).status === 200 && (await state()).favoritesCount === 1, 'a favorite is stored for the signed-in user');
  // failure switches
  await mode({ fail: 'server', fn: 'submit_report', times: 1 });
  const r500 = await rpc('submit_report', { p_location: rows[0].id, p_issue: 'other' }, T);
  check(r500.status === 500 && (await r500.json()).code === undefined && (await state()).reports.length === 0, 'fail=server: HTTP 500 without an error code, nothing recorded (an UNCONFIRMED outcome in the app)');
  await mode({ fail: 'reject', fn: 'add_favorite', times: 1 });
  const rej = await rpc('add_favorite', { p_location: rows[1].id }, T);
  check(rej.status === 400 && (await rej.json()).code === '53400', 'fail=reject: HTTP 400 with code 53400 (a confirmed cap)');
  await mode({ fail: 'auth', fn: 'submit_review', times: 1 });
  check((await rpc('submit_review', { p_location: rows[0].id, p_rating: 4, p_mode: 'plain', p_observations: [] }, T)).status === 401, 'fail=auth: expired session');
  await mode({ fail: 'lose', fn: 'submit_report', times: 1 });
  let cut = false; try { await rpc('submit_report', { p_location: rows[0].id, p_issue: 'other' }, T); } catch { cut = true; }
  check(cut && (await state()).reports.length === 1, 'fail=lose: the connection is cut but the report WAS recorded');
  await mode({ fail: 'none' });
  check((await rpc('submit_report', { p_location: rows[0].id, p_issue: 'closed' }, T)).status === 200 && (await state()).reports.length === 2, 'normal writes work again after the switches are used up');
  // tiles and Leaflet (no third-party host needed for the map)
  const tile = Buffer.from(await (await fetch(`${U}/tiles/14/3000/6000.png`)).arrayBuffer());
  check(tile.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'tiles are valid PNG images');
  const js = await fetch(`${U}/leaflet/leaflet.js`);
  check(js.status === 200 && (await js.text()).includes('Leaflet 1.9.4'), 'Leaflet JS is served locally');
  check((await fetch(`${U}/leaflet/leaflet.css`)).status === 200, 'Leaflet CSS is served locally');
  await fetch(`${U}/__qa/reset`, { method: 'POST' });
  check((await state()).favoritesCount === 0 && (await state()).reports.length === 0, 'reset forgets everything');

  if (process.argv.includes('--metro')) {
    const MP = 8199;
    const env = { ...process.env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_PUBLIC_SUPABASE_URL: U, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'qa-mock-anon-key', EXPO_PUBLIC_MAP_TILE_URL: `${U}/tiles/{z}/{x}/{y}.png`, EXPO_PUBLIC_LEAFLET_BASE_URL: `${U}/leaflet` };
    const metro = spawn('npx', ['expo', 'start', '--go', '--localhost', '--port', String(MP), '--clear'], { cwd: new URL('../apps/mobile', import.meta.url).pathname, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; metro.stdout.on('data', (d) => { log += d; }); metro.stderr.on('data', (d) => { log += d; });
    const up = async () => { for (let i = 0; i < 120; i++) { try { const r = await fetch(`http://127.0.0.1:${MP}/status`); if (r.ok) return true; } catch { /* starting */ } await new Promise((r) => setTimeout(r, 1000)); } return false; };
    check(await up(), 'Metro dev server starts (Expo Go flow, offline, localhost)', log.slice(-400));
    for (const platform of ['android', 'ios']) {
      const man = await fetch(`http://127.0.0.1:${MP}/`, { headers: { 'expo-platform': platform, accept: 'multipart/mixed,application/expo+json,application/json' } });
      const text = await man.text();
      const m = text.match(/"launchAsset":\{[^}]*"url":"([^"]+)"/) ?? text.match(/"url":"(http[^"]+\.bundle[^"]*)"/);
      check(man.status === 200 && !!m, `${platform}: Metro serves an Expo Go manifest`, text.slice(0, 200));
      if (m) {
        const bundleUrl = m[1].replace(/\\u0026/g, '&');
        const b = await fetch(bundleUrl);
        const code = await b.text();
        check(b.status === 200 && code.length > 500_000, `${platform}: the native JavaScript bundle builds (${(code.length / 1e6).toFixed(1)} MB)`, `status ${b.status} len ${code.length}`);
        check(code.includes(U) && code.includes('qa-mock-anon-key'), `${platform}: the bundle carries the mock URL and placeholder key`);
        check(!code.includes('xzzbcejgprilmolvdaes'), `${platform}: the bundle contains no live Supabase project reference`);
      }
    }
    metro.kill('SIGTERM');
  }
} catch (e) {
  console.error('QA selftest error:', e);
  failures++;
} finally {
  await mock.close();
}
console.log(`\n${passed} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
