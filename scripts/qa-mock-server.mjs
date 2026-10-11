#!/usr/bin/env node
// Local QA mock backend for manual mobile/browser testing. Speaks just enough of the auth (GoTrue) and REST (RPC) API
// for every consumer journey, plus tiles and Leaflet files so the map needs NO third-party host, plus a small control
// API to switch on failures. It holds all data in memory, contains NO real keys or records, and never contacts anything.
//
//   node scripts/qa-mock-server.mjs            # listens on 0.0.0.0:54800 (QA_PORT / QA_HOST override)
//
// Restrooms are generated RELATIVE to the position the app asks about (the last nearby search), so the same fixtures
// appear around a phone, an emulator's fake GPS or a simulator's location, wherever it is.
// QA account (any phone number or real address is never needed):  qa.user@open-stall.test  /  correct horse battery
//
// Control API (JSON, no auth):  GET /__qa/state    counters and records the mock has received (verify what was written)
//                               POST /__qa/reset   forget the records the mock holds, the failure/delay/empty settings and the
//                                                  deleted-account flag. It does NOT sign anyone out: a bearer token issued earlier
//                                                  keeps working (use /__qa/expire for an expired session).
//                               POST /__qa/expire  invalidate every token issued so far: the next RPC with an old bearer returns
//                                                  401 PGRST301 (JWT expired), /auth/v1/user returns 401, and a refresh-token
//                                                  request is refused (400 refresh_token_not_found), so the app must fall back
//                                                  to its signed-out state. Signing in again issues a fresh working token.
//                               POST /__qa/mode    replaces the WHOLE mode (omit a field to clear it):
//                                 {"fail":"none|server|reject|auth|lose","fn":"submit_report","times":1,
//                                  "delayMs":0,"delayFn":null,"delayTimes":null,"empty":false}
//     fail=server  the next `times` calls to `fn` (default: any write) return HTTP 500 without a database error code (an UNCONFIRMED outcome)
//     fail=reject  ... return HTTP 400 with code 53400 (a confirmed cap rejection)
//     fail=auth    ... return 401 PGRST301 (expired session) for that call only; the token stays valid for later calls
//     fail=lose    ... the write IS recorded, then the connection is cut (the response is lost)
//     delayMs      wait this long (bounded to 30000) before answering ANY RPC, public reads included (nearby_locations,
//                  get_public_location, nearest_verified_location); `delayFn` limits it to one function, `delayTimes` to N calls
//     empty        nearby_locations returns no restrooms at all (the UNFILTERED empty state; "no restrooms nearby yet")
// The deleted-account flag (set by delete_my_account) is enforced consistently: until /__qa/reset, the old bearer is refused
// (401 28000), password sign-in is refused and refresh is refused. The mock enforces nothing else about accounts.
import { Buffer } from 'node:buffer';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

const root = new URL('..', import.meta.url).pathname;
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'qa.user@open-stall.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const PASSWORD = 'correct horse battery';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const MAX_DELAY_MS = 30000;
const makeJwt = (gen) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', exp: 4102444800, gen })}.qa-mock`;
const session = (gen) => ({ access_token: makeJwt(gen), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `qa-refresh-token-${gen}`, user: USER });
const WRITES = ['add_favorite', 'remove_favorite', 'submit_review', 'delete_my_review', 'submit_report', 'check_in', 'submit_location', 'submit_location_edit', 'update_my_profile', 'delete_my_account'];

const id = (n) => `3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d${String(n).padStart(2, '0')}`;
// [id, name, address, dLat, dLng, verification, facts...]
const FIXTURES = [
  { id: id(31), name: 'QA Library Restroom', address: '1 Library Way', dLat: 0.0014, dLng: 0.0004, verification: 'verified', key: false, purchase: false, wheelchair: true, baby: false, hours: 'Mo-Su 06:00-22:00', where: 'Behind the main desk', rating: 4.5, count: 12, attribution: 'QA fixture data' },
  { id: id(32), name: 'QA Park Pavilion (unverified, all facts unknown)', dLat: 0.003, dLng: 0.001, verification: 'unverified' },
  { id: id(33), name: 'QA Gas Station (key and purchase)', address: '9 Main St', dLat: -0.005, dLng: -0.0006, verification: 'verified', key: true, purchase: true, fee: false, rating: 3, count: 4 },
  { id: id(34), name: 'QA Trailhead (wheelchair, no rating)', dLat: 0.012, dLng: -0.002, verification: 'unverified', wheelchair: true },
];
const row = (f, c) => ({ id: f.id, name: f.name, address_line: f.address ?? null, city: 'QA City', region: 'QA', postal_code: null, latitude: c.latitude + f.dLat, longitude: c.longitude + f.dLng,
  verification: f.verification, last_verified_at: f.verification === 'verified' ? '2026-09-01T00:00:00Z' : null, opening_hours: f.hours ?? null, fee_required: f.fee ?? null,
  key_required: f.key ?? null, purchase_required: f.purchase ?? null, wheelchair_accessible: f.wheelchair ?? null, gender_neutral: null, baby_changing: f.baby ?? null,
  has_hot_water: null, has_cold_water: null, access_location: f.where ?? null, average_rating: f.rating ?? null, rating_count: f.count ?? 0, attribution: f.attribution ?? null, distance_m: null });

function png(w, h, rgb) { // a flat-colour PNG, built with zlib only
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; for (let x = 0; x < w; x++) { raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3); } }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const TILE = png(256, 256, [221, 224, 229]);

// names: optional display names for the four fixtures (the visual packet uses realistic ones; the QA kit keeps its "QA ..." names)
export function startQaMock({ port = 54800, host = '0.0.0.0', names = null } = {}) {
  let gen = 0; // token generation; /__qa/expire bumps it and every older token stops working
  const bearerGen = (req) => { const m = /^Bearer (.+)$/.exec(req.headers.authorization ?? ''); if (!m) return null; try { return JSON.parse(Buffer.from(m[1].split('.')[1], 'base64url').toString()).gen ?? null; } catch { return null; } };
  const fresh = () => ({ center: { latitude: 44.5263, longitude: -109.0565 }, favorites: [], review: null, reports: [], submissions: [], edits: [], checkins: 0, deleted: false, profile: { name: null, mode: 'plain', transport: 'walk' }, signups: 0, logins: 0, calls: {} });
  let st = fresh();
  const NO_MODE = { fail: 'none', fn: null, times: 0, delayMs: 0, delayFn: null, delayTimes: null, empty: false };
  let mode = { ...NO_MODE };
  const rowsFor = () => FIXTURES.map((f, i) => row(names?.[i] ? { ...f, name: names[i] } : f, st.center));
  const server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    const cors = { connection: 'close', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let body = ''; for await (const c of req) body += c;
    let data = {}; try { data = body ? JSON.parse(body) : {}; } catch { /* not JSON */ }
    const json = (status, obj, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...cors, ...extra }); res.end(JSON.stringify(obj)); };
    const p = u.pathname;
    if (p === '/health') return json(200, { ok: true, mock: 'open-stall-qa' });
    if (p === '/__qa/state') return json(200, { ...st, favoritesCount: st.favorites.length, mode });
    if (p === '/__qa/reset') { st = fresh(); mode = { ...NO_MODE }; return json(200, { ok: true, note: 'records, modes and the deleted flag cleared; existing sessions still work (use /__qa/expire)' }); }
    if (p === '/__qa/expire') { gen++; return json(200, { ok: true, generation: gen }); }
    if (p === '/__qa/mode') {
      const delayMs = Math.min(MAX_DELAY_MS, Math.max(0, Number(data.delayMs) || 0));
      mode = { fail: data.fail ?? 'none', fn: data.fn ?? null, times: data.times ?? 1, delayMs, delayFn: data.delayFn ?? null, delayTimes: delayMs && Number.isInteger(data.delayTimes) ? data.delayTimes : null, empty: data.empty === true };
      return json(200, mode);
    }
    const m = p.match(/^\/tiles\/\d+\/\d+\/\d+\.png$/);
    if (m) { res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'max-age=3600', ...cors }); return res.end(TILE); }
    if (p === '/leaflet/leaflet.js' || p === '/leaflet/leaflet.css') {
      const f = `${root}node_modules/leaflet/dist/${p.split('/').pop()}`;
      if (!existsSync(f)) return json(404, { msg: 'leaflet not installed (run npm install)' });
      res.writeHead(200, { 'content-type': p.endsWith('.js') ? 'text/javascript' : 'text/css', ...cors }); return res.end(readFileSync(f));
    }
    if (p === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') { st.logins++; return !st.deleted && data.email === USER.email && data.password === PASSWORD ? json(200, session(gen)) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); }
    if (p === '/auth/v1/token') { // refresh: only a refresh token of the current generation works
      const ok = !st.deleted && data.refresh_token === `qa-refresh-token-${gen}`;
      return ok ? json(200, session(gen)) : json(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token: Refresh Token Not Found' });
    }
    if (p === '/auth/v1/signup') { st.signups++; return json(200, { ...USER, id: '99999999-2222-4333-8444-555555555555', email: data.email, confirmation_sent_at: new Date().toISOString() }); }
    if (p === '/auth/v1/recover') return json(200, {});
    if (p === '/auth/v1/user') return bearerGen(req) === gen && !st.deleted ? json(200, USER) : json(401, { error_code: 'bad_jwt', msg: 'invalid or expired JWT' });
    if (p === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
    if (p.startsWith('/rest/v1/rpc/')) {
      const fn = p.slice('/rest/v1/rpc/'.length);
      st.calls[fn] = (st.calls[fn] ?? 0) + 1;
      if (mode.delayMs && (!mode.delayFn || mode.delayFn === fn) && (mode.delayTimes === null || mode.delayTimes > 0)) {
        if (mode.delayTimes !== null) mode.delayTimes--;
        await new Promise((r) => setTimeout(r, mode.delayMs));
      }
      if (fn === 'nearby_locations') { if (typeof data.p_lat === 'number' && typeof data.p_lng === 'number') st.center = { latitude: data.p_lat, longitude: data.p_lng }; return json(200, mode.empty ? [] : rowsFor().filter((r) => !data.p_verified_only || r.verification === 'verified')); }
      if (fn === 'nearest_verified_location') return json(200, []);
      if (fn === 'get_public_location') return json(200, rowsFor().filter((r) => r.id === data.p_id));
      const g = bearerGen(req);
      if (g === null) return json(401, { code: '28000', message: 'not authenticated' });
      if (g !== gen) return json(401, { code: 'PGRST301', message: 'JWT expired' });
      if (st.deleted) return json(401, { code: '28000', message: 'not authenticated (account deleted)' });
      const isWrite = WRITES.includes(fn);
      let lose = false;
      if (isWrite && mode.fail !== 'none' && mode.times > 0 && (!mode.fn || mode.fn === fn)) {
        mode.times--;
        if (mode.fail === 'server') return json(500, { message: 'qa mock: internal error' });
        if (mode.fail === 'reject') return json(400, { code: '53400', message: 'qa mock: limit reached' });
        if (mode.fail === 'auth') return json(401, { code: 'PGRST301', message: 'JWT expired' });
        if (mode.fail === 'lose') lose = true;
      }
      const out = lose ? () => req.socket.destroy() : json;
      if (fn === 'list_my_favorites') return out(200, st.favorites);
      if (fn === 'add_favorite') { const r = rowsFor().find((x) => x.id === data.p_location); if (r && !st.favorites.some((x) => x.id === r.id)) st.favorites.push(r); return out(200, { added: true, count: st.favorites.length, limit: 5 }); }
      if (fn === 'remove_favorite') { st.favorites = st.favorites.filter((x) => x.id !== data.p_location); return out(200, null); }
      if (fn === 'get_my_review') return out(200, st.review);
      if (fn === 'submit_review') { st.review = { rating: data.p_rating, mode: data.p_mode, observations: data.p_observations }; return out(200, { rating: data.p_rating }); }
      if (fn === 'delete_my_review') { st.review = null; return out(200, null); }
      if (fn === 'submit_report') { st.reports.push(data); return out(200, null); }
      if (fn === 'check_in') { st.checkins++; return out(200, { checkin_id: 'qa-checkin' }); }
      if (fn === 'submit_location') { st.submissions.push(data); return out(200, { submission_id: `qa-sub-${st.submissions.length}` }); }
      if (fn === 'submit_location_edit') { st.edits.push(data); return out(200, 'qa-edit'); }
      if (fn === 'get_my_profile') return out(200, [{ display_name: st.profile.name, preferred_mode: st.profile.mode, default_transport: st.profile.transport, points_balance: 0 }]);
      if (fn === 'update_my_profile') { st.profile = { name: data.p_display_name, mode: data.p_mode, transport: data.p_transport }; return out(200, []); }
      if (fn === 'delete_my_account') { st.deleted = true; return out(200, null); }
    }
    return json(404, { msg: 'qa mock: not mocked' });
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve({ server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.QA_PORT ?? 54800);
  const { port: p } = await startQaMock({ port, host: process.env.QA_HOST ?? '0.0.0.0' });
  console.log(`Open Stall QA mock listening on 0.0.0.0:${p}  (health: /health, state: /__qa/state)`);
  console.log(`QA account: ${USER.email} / ${PASSWORD}`);
  console.log('No real data, keys or services. Ctrl+C to stop.');
}
