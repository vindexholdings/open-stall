#!/usr/bin/env node
// Self-test of the mobile QA kit WITHOUT any device: starts the mock on a free port and checks every route the app uses
// (auth, discovery, account writes, the failure switches, tiles, Leaflet files); with --metro it also starts the Expo
// dev server (Expo Go flow, offline, localhost) pointed at the mock and fetches the iOS and Android manifests and
// bundles, proving the native JavaScript bundles build with the mock's configuration baked in.
// It does NOT run the app on a phone, simulator or emulator; native runtime remains a manual step (MOBILE_QA.md).
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { envFilesIn } from './qa-env-guard.mjs';
import { environmentSummary, freePort, hintsFor, probeStatus, reachableUrl, redactor, startMetro } from './qa-metro.mjs';
import { startQaMock } from './qa-mock-server.mjs';

let passed = 0; let failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (ok) passed++; else failures++; };

let mockUrl = '';
const mock = await startQaMock({ port: 0, host: '127.0.0.1' });
const U = mock.url; mockUrl = U;
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
  // ---- delay applies to PUBLIC reads (Work reproduced a 22 ms answer with delayMs 500), bounded and countable
  const timed = async (fn, body, token) => { const t = Date.now(); const r = await rpc(fn, body, token); await r.text(); return Date.now() - t; };
  await mode({ delayMs: 500, delayFn: 'nearby_locations', delayTimes: 1 });
  const slow = await timed('nearby_locations', { p_lat: 1, p_lng: 1 });
  const fast = await timed('nearby_locations', { p_lat: 1, p_lng: 1 });
  check(slow >= 480 && fast < 300, `delayMs delays a public read once (${slow} ms, then ${fast} ms)`);
  await mode({ delayMs: 400 });
  const slowDetail = await timed('get_public_location', { p_id: rows[0].id });
  check(slowDetail >= 380, `delayMs also delays public detail reads (${slowDetail} ms)`);
  await mode({ delayMs: 999999 });
  check((await (await fetch(`${U}/__qa/state`)).json()).mode.delayMs === 30000, 'delay is bounded to 30000 ms');
  await mode({});
  // ---- the two empty states are separate
  await mode({ empty: true });
  check((await (await rpc('nearby_locations', { p_lat: 1, p_lng: 1 })).json()).length === 0, 'empty=true: no restrooms at all (the UNFILTERED empty state)');
  await mode({});
  const verifiedOnly = await (await rpc('nearby_locations', { p_lat: 1, p_lng: 1, p_verified_only: true })).json();
  check(verifiedOnly.length === 2 && verifiedOnly.every((r) => r.verification === 'verified'), 'p_verified_only is honored (2 verified rows)');
  const everything = await (await rpc('nearby_locations', { p_lat: 1, p_lng: 1 })).json();
  check(everything.length === 4 && everything.every((r) => r.baby_changing !== true), 'with filters off 4 rows return and none has baby changing, so the Baby changing filter gives the FILTERED empty state');
  // ---- sessions: reset does not sign out; expire does, deliberately
  await fetch(`${U}/__qa/reset`, { method: 'POST' });
  check((await rpc('list_my_favorites', {}, T)).status === 200, 'reset clears data but the existing token still works (documented)');
  const refreshTok = ok.refresh_token;
  await fetch(`${U}/__qa/expire`, { method: 'POST' });
  const expired = await rpc('list_my_favorites', {}, T);
  check(expired.status === 401 && (await expired.json()).code === 'PGRST301', 'expire: the old bearer is refused with 401 PGRST301');
  check((await fetch(`${U}/auth/v1/user`, { headers: { authorization: `Bearer ${T}` } })).status === 401, 'expire: /auth/v1/user refuses the old bearer');
  const refused = await fetch(`${U}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: JSON.stringify({ refresh_token: refreshTok }) });
  check(refused.status === 400 && (await refused.json()).error_code === 'refresh_token_not_found', 'expire: the old refresh token is refused (the app must fall back to signed out)');
  check((await rpc('nearby_locations', { p_lat: 1, p_lng: 1 })).status === 200, 'expire: public discovery still works signed out');
  const again = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email: 'qa.user@open-stall.test', password: 'correct horse battery' }) })).json();
  check((await rpc('list_my_favorites', {}, again.access_token)).status === 200, 'expire: signing in again issues a working token');
  const refreshed = await fetch(`${U}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', body: JSON.stringify({ refresh_token: again.refresh_token }) });
  check(refreshed.status === 200, 'the current refresh token works');
  // ---- deleted-account flag is enforced consistently
  await rpc('delete_my_account', {}, again.access_token);
  check((await state()).deleted === true, 'delete_my_account sets the deleted flag');
  check((await rpc('list_my_favorites', {}, again.access_token)).status === 401, 'deleted: the old bearer is refused');
  const noLogin = await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email: 'qa.user@open-stall.test', password: 'correct horse battery' }) });
  check(noLogin.status === 400, 'deleted: password sign-in is refused until reset');
  await fetch(`${U}/__qa/reset`, { method: 'POST' });
  const back = await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', body: JSON.stringify({ email: 'qa.user@open-stall.test', password: 'correct horse battery' }) });
  check(back.status === 200, 'reset clears the deleted flag');

  await fetch(`${U}/__qa/reset`, { method: 'POST' });
  check((await state()).favoritesCount === 0 && (await state()).reports.length === 0, 'reset forgets everything');

  // ---- always-on, cheap: the env-file guard and the Metro diagnostics helper (no Metro needed)
  {
    const dir = mkdtempSync(join(tmpdir(), 'qa-guard-'));
    try {
      check(envFilesIn(dir).length === 0, 'guard: an empty directory is accepted');
      for (const name of ['.env', '.env.local', '.env.development.local', '.env.local.off']) {
        writeFileSync(join(dir, name), 'X=1\n');
        check(envFilesIn(dir).includes(name), `guard: ${name} is refused`);
        rmSync(join(dir, name));
      }
      // the documented workaround: a name OUTSIDE the .env* namespace, moved without overwriting (mv -n)
      writeFileSync(join(dir, '.env.local'), 'X=1\n');
      const mv1 = spawnSync('mv', ['-n', join(dir, '.env.local'), join(dir, 'parked-env.local')]);
      check(mv1.status === 0 && envFilesIn(dir).length === 0 && existsSync(join(dir, 'parked-env.local')), 'guard: the documented rename (parked-env.local) is accepted');
      writeFileSync(join(dir, '.env.local'), 'NEW=1\n'); // a second file now sits at the original name
      spawnSync('mv', ['-n', join(dir, 'parked-env.local'), join(dir, '.env.local')]); // restore must NOT overwrite it
      check(existsSync(join(dir, 'parked-env.local')) && readFileSync(join(dir, '.env.local'), 'utf8') === 'NEW=1\n', 'guard: mv -n restore never overwrites an existing destination (parked file stays parked)');
    } finally { rmSync(dir, { recursive: true, force: true }); }
    const fake = redactor({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'super-secret-value-123', PATH: '/usr/bin' })('token super-secret-value-123 Bearer abcdefghijklmnop1234 eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0NTY3.abcdefgh');
    check(!fake.includes('super-secret-value-123') && !fake.includes('abcdefghijklmnop1234') && !fake.includes('eyJhbGci') && fake.includes('[redacted]'), 'diagnostics: secret env values, bearer tokens and JWTs are redacted from child output');
    // a stand-in child that dies at once must produce a diagnosable error, not a silent timeout
    const t = Date.now();
    let msg = '';
    try { await startMetro({ env: { ...process.env, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'super-secret-value-123' }, command: ['node', '-e', "console.error('boom: port in use super-secret-value-123'); process.exit(3)"], startupMs: 20000 }); } catch (e) { msg = String(e.message); }
    check(Date.now() - t < 10000 && msg.includes('exited early (code 3') && msg.includes('boom: port in use') && !msg.includes('super-secret-value-123') && msg.includes('node v'), 'diagnostics: an early-exiting child is reported at once with exit code, output tail (redacted) and versions', msg.slice(0, 300));
    check(hintsFor('Error: EMFILE: too many open files, watch').some((h) => h.includes('watchman')) && hintsFor('listen EADDRINUSE :::8081').length === 1 && hintsFor('all good').length === 0, 'diagnostics: known startup failures (EMFILE, EADDRINUSE) get a likely-cause hint, clean output gets none');

    // ---- loopback compatibility: Expo --localhost can listen on ::1 only (some Macs); probes must not assume 127.0.0.1
    // `advertise` is the origin the stand-in PUTS INTO the manifest (real Expo advertises 127.0.0.1 even when only ::1 answers); null reflects the request host
    const standIn = (host, advertise = null) => (port) => ['node', '-e', `const h=require('http');const big='x'.repeat(600000);h.createServer((q,r)=>{if(q.url==='/status')return r.end('packager-status:running');if(q.url.startsWith('/bundle.js'))return r.end(big);r.setHeader('content-type','application/json');r.end(JSON.stringify({launchAsset:{url:${advertise ? `'${advertise.replace('PORT', '')}'+${port}+'/bundle.js?platform=android&dev=true'` : "'http://'+q.headers.host+'/bundle.js'"}}}))}).listen(${port},'${host}')`];
    {
      const only4 = await freePort();
      const srv = await startMetro({ env: process.env, command: standIn('127.0.0.1'), startupMs: 20000 });
      try {
        const b = await srv.bundle('android');
        check(srv.base !== null && b.code.length >= 600000, `loopback: an IPv4-bound stand-in server is found (${srv.base}) and its manifest and bundle are fetched through the same address`);
      } finally { await srv.stop(); }
      check(only4 > 0 && (await probeStatus(await freePort(), { timeoutMs: 300 })) === null, 'loopback: nothing listening gives null (no false "running")');

      // the Mac case, mirrored so it is testable on an IPv4-only host: the server answers on 127.0.0.1/localhost, but the manifest
      // advertises [::1] (unreachable here). bundle() must re-point the advertised URL at the base that answered.
      {
        const m = await startMetro({ env: process.env, command: standIn('127.0.0.1', 'http://[::1]:PORT'), startupMs: 20000 });
        try {
          const b = await m.bundle('android');
          check(b.code.length >= 600000, 'bundle: a manifest advertising an UNREACHABLE loopback spelling ([::1]) is fetched through the reachable base, path and query kept');
        } finally { await m.stop(); }
      }
      check(reachableUrl('http://127.0.0.1:5000/a/b.bundle?x=1&y=2', 'http://[::1]:5000', 5000) === 'http://[::1]:5000/a/b.bundle?x=1&y=2', 'bundle: reachableUrl keeps path and query and swaps only the origin');
      for (const [url, why] of [['http://evil.example:5000/a.bundle', 'a foreign host'], ['http://127.0.0.1:5001/a.bundle', 'another port'], ['http://localhost.evil.example:5000/x', 'a look-alike host'], ['file:///etc/passwd', 'a non-http scheme'], ['not a url', 'garbage']]) {
        let err = ''; try { reachableUrl(url, 'http://localhost:5000', 5000); } catch (e) { err = e.message; }
        check(err !== '', `bundle: an advertised URL with ${why} is refused, not fetched`, err);
      }
      {
        const foreign = await startMetro({ env: process.env, command: standIn('127.0.0.1', 'http://evil.example:PORT'), startupMs: 20000 });
        let err = ''; try { await foreign.bundle('android'); } catch (e) { err = e.message; } finally { await foreign.stop(); }
        check(err.includes('refusing to fetch'), 'bundle: a Metro whose manifest advertises a foreign origin makes bundle() fail with a clear refusal');
      }
      // the Mac case: only [::1] answers; 127.0.0.1 is refused. Simulated with a probe that fails for every other spelling.
      const onlyV6 = async (url, init) => { if (!String(url).startsWith('http://[::1]:')) throw new Error('ECONNREFUSED'); return { ok: true }; };
      check((await probeStatus(1234, { fetchImpl: onlyV6 })) === 'http://[::1]:1234', 'loopback: when only [::1] answers (the Mac result Work captured) the probe finds it after 127.0.0.1 is refused');
      const k = await startMetro({ env: process.env, command: ['node', '-e', 'setTimeout(()=>{},30000)'], probeFetch: onlyV6, startupMs: 20000 });
      try { check(k.base === `http://[::1]:${k.port}`, 'loopback: startMetro accepts an IPv6-only /status answer as "started" (stub child; this is NOT a real ::1 Metro)'); } finally { await k.stop(); }
      // a real IPv6 stand-in where the host supports it (this Linux sandbox does not)
      const v6 = await new Promise((resolve) => { const t = createServer(); t.on('error', (e) => resolve(e.code)); t.listen(0, '::1', () => t.close(() => resolve('ok'))); });
      if (v6 === 'ok') {
        const s6 = await startMetro({ env: process.env, command: standIn('::1', 'http://127.0.0.1:PORT'), startupMs: 20000 });
        try { const b6 = await s6.bundle('ios'); check(s6.base !== null && b6.code.length >= 600000, `loopback: a REAL ::1-only stand-in that advertises a 127.0.0.1 launch-asset URL (the Mac behavior) is found (${s6.base}) and its bundle fetched through ::1`); } finally { await s6.stop(); }
      } else console.log(`INFO loopback: this host has no usable IPv6 loopback (${v6}); the real ::1 case is NOT exercised here and must be confirmed on a host where localhost resolves to ::1 (Work's Mac)`);
    }
    let missing = '';
    try { await startMetro({ env: process.env, command: ['definitely-not-a-real-binary-qa'], startupMs: 5000 }); } catch (e) { missing = String(e.message); }
    check(missing.includes('could not be launched') && missing.includes('ENOENT'), 'diagnostics: a missing binary is reported as a launch failure (ENOENT)', missing.slice(0, 200));
  }

  const qaEnv = (extra = {}) => { const b = { ...process.env, CI: '1', EXPO_OFFLINE: '1', EXPO_NO_TELEMETRY: '1', EXPO_NO_DOTENV: '1', EXPO_PUBLIC_SUPABASE_URL: U, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'qa-mock-anon-key', EXPO_PUBLIC_MAP_TILE_URL: `${U}/tiles/{z}/{x}/{y}.png`, EXPO_PUBLIC_LEAFLET_BASE_URL: `${U}/leaflet`, ...extra }; delete b.EXPO_PUBLIC_MAP_ATTRIBUTION; return b; };
  const withMetro = async (env, fn) => { const m = await startMetro({ env }); try { return await fn(m); } finally { await m.stop(); } };

  if (process.argv.includes('--dotenv')) {
    console.log(`INFO ${environmentSummary()}`);
    // A throwaway .env.local holding a canary (fake value) is written only if the slot is empty, and ALWAYS removed.
    const dotenv = new URL('../apps/mobile/.env.local', import.meta.url).pathname;
    if (existsSync(dotenv)) check(false, 'dotenv test needs an empty slot: apps/mobile/.env.local already exists (not touched)');
    else {
      const CANARY = `DOTENV-CANARY-${Date.now()}`;
      writeFileSync(dotenv, `EXPO_PUBLIC_MAP_ATTRIBUTION=${CANARY}\n`);
      try {
        // 1. the launcher fails closed: exit 3, says why, starts no Metro, prints nothing from the file
        const probePort = await freePort();
        const run = spawnSync('node', ['scripts/qa-app.mjs', '--target', 'web', '--metro-port', String(probePort)], { cwd: new URL('..', import.meta.url).pathname, encoding: 'utf8', timeout: 30000 });
        const said = `${run.stdout}${run.stderr}`;
        const listening = (await probeStatus(probePort, { timeoutMs: 1500 })) !== null;
        check(run.status === 3 && said.includes('.env.local') && said.includes('mv -n') && !said.includes(CANARY) && !listening, 'qa-app refuses to start while apps/mobile/.env.local exists (exit 3, no Metro, safe rename advice, file contents not printed)', `status ${run.status} ${said.slice(0, 200)}`);
        // 2. why a refusal is needed: EXPO_NO_DOTENV=1 alone does not keep a dev bundle from reading the file (informational)
        const withFlag = await withMetro(qaEnv(), (m) => m.bundle('android'));
        console.log(`INFO with EXPO_NO_DOTENV=1 alone a Metro dev bundle ${withFlag.code.includes(CANARY) ? 'STILL CONTAINS' : 'does not contain'} the .env.local canary (${withFlag.code.includes(CANARY) ? 'this is why qa-app refuses to run' : 'Expo behavior changed; the refusal is now redundant but harmless'})`);
      } catch (e) {
        check(false, 'dotenv experiment could not complete', String(e.message ?? e));
      } finally { rmSync(dotenv, { force: true }); }
      check(!existsSync(dotenv), 'the throwaway .env.local was removed');
      // 3. with the file gone, the same configuration carries no canary and does carry the mock values
      try {
        const clean = await withMetro(qaEnv(), (m) => m.bundle('android'));
        check(!clean.code.includes('DOTENV-CANARY') && clean.code.includes(U) && clean.code.includes('qa-mock-anon-key'), 'with no .env file the QA configuration is exactly the mock values');
      } catch (e) { check(false, 'clean-configuration bundle could not be built', String(e.message ?? e)); }
    }
  }
  if (process.argv.includes('--metro')) {
    console.log(`INFO ${environmentSummary()}`);
    if (envFilesIn(new URL('../apps/mobile', import.meta.url).pathname).length) throw new Error('apps/mobile has .env* files; park them first (see MOBILE_QA.md section 3 and scripts/qa-env-guard.mjs)');
    let metro = null;
    try { metro = await startMetro({ env: qaEnv() }); check(true, 'Metro dev server starts (Expo Go flow, offline, localhost)'); }
    catch (e) { check(false, 'Metro dev server starts (Expo Go flow, offline, localhost)', `\n${e.message}`); }
    if (metro) {
      try {
        for (const platform of ['android', 'ios']) {
          try {
            const { manifest, code } = await metro.bundle(platform);
            check(manifest.length > 0, `${platform}: Metro serves an Expo Go manifest`);
            check(code.length > 500_000, `${platform}: the native JavaScript bundle builds (${(code.length / 1e6).toFixed(1)} MB)`, `len ${code.length}`);
            check(code.includes(U) && code.includes('qa-mock-anon-key'), `${platform}: the bundle carries the mock URL and placeholder key`);
            check(!code.includes('xzzbcejgprilmolvdaes'), `${platform}: the bundle contains no live Supabase project reference`);
          } catch (e) { check(false, `${platform}: native bundle`, `\n${e.message}`); }
        }
      } finally { await metro.stop(); }
    }
  }
} catch (e) {
  console.error('QA selftest error:', e);
  failures++;
} finally {
  await mock.close();
}
console.log(`\n${passed} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
