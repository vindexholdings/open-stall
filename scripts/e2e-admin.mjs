#!/usr/bin/env node
// Real-browser test of the admin sign-in, MFA and review queue (Phase 3A) against a LOCAL MOCK of Supabase
// Auth + REST. Runs the actual Next.js admin app (dev server) and drives it with Playwright. Contacts no real
// service. Proves: signed-out/non-admin/no-MFA users never get queue data, MFA enrollment + verification works,
// decision forms validate before any request, own items offer no decision, and no service-role key is involved.
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK = 54299;
const APP = 3199;
const ANON = 'mock-anon-key-not-real';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub, aal) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub, aal, role: 'authenticated', exp: 4102444800 })}.sig`;
const USERS = {
  'admin@test.dev': { id: '11111111-0000-4000-8000-000000000001', admin: true, factors: [{ id: 'fa1', factor_type: 'totp', status: 'verified' }] },
  'plain@test.dev': { id: '11111111-0000-4000-8000-000000000002', admin: false, factors: [] },
  'newadmin@test.dev': { id: '11111111-0000-4000-8000-000000000003', admin: true, factors: [] },
};
const PW = 'correct horse battery';
const userFor = (u, aalFactors = u.factors) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: Object.keys(USERS).find((k) => USERS[k] === u), app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z', factors: aalFactors });
const session = (u, aal) => ({ access_token: jwt(u.id, aal), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `r-${u.id}-${aal}`, user: userFor(u) });
const byToken = (auth) => { const t = (auth ?? '').replace('Bearer ', ''); try { const p = JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()); return { user: Object.values(USERS).find((x) => x.id === p.sub), aal: p.aal }; } catch { return {}; } };

const ITEM = { id: '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d5e', kind: 'new_location', location_id: null, location_name: null, proposed: { name: 'Mock Library Restroom', latitude: 44.5, longitude: -109.05 }, note: 'By the entrance',
  flags: ['low_accuracy'], possible_duplicate_of: null, duplicate_submission_ids: [], capture_accuracy_m: 30, created_at: '2026-10-06T00:00:00Z', held: false, is_mine: false, decisions: [] };
const OWN = { ...ITEM, id: '4a2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d5f', proposed: { name: 'Admin own restroom' }, is_mine: true, flags: [] };
const REPORT = { id: '5b2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d60', location_id: '6c2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d61', location_name: 'Mock Park', issue_type: 'closed', comment: 'Locked all week', created_at: '2026-10-06T01:00:00Z', is_mine: false };

const LOC = { id: '7d2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d62', name: 'Mock Hidden Candidate', address_line: '1 Test St', city: 'Cody', region: 'WY', postal_code: null, latitude: 44.5, longitude: -109.05,
  status: 'candidate', restroom_evidence: 'inferred', restroom_verified: false, last_verified_at: null, wheelchair_accessible: null, gender_neutral: null, baby_changing: null, has_hot_water: null, has_cold_water: null,
  customers_only: null, family_bathroom: null, key_required: null, purchase_required: null, fee_required: null, opening_hours: null, possible_duplicate_of: null,
  location_sources: [{ source: 'osm', source_reference: 'node/1', is_primary: true, tags: { amenity: 'toilets' }, license: 'ODbL', attribution: 'OpenStreetMap contributors' }], location_reviews: [] };
const reviews = [];
const requests = [];
const decisions = [];
let enrolled = false;
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK}`);
  let body = ''; for await (const c of req) body += c;
  const data = body ? JSON.parse(body) : {};
  const json = (s, o) => { res.writeHead(s, { 'content-type': 'application/json' }); res.end(o === undefined ? '' : JSON.stringify(o)); };
  const { user, aal } = byToken(req.headers.authorization);
  requests.push({ path: u.pathname, auth: req.headers.authorization ?? '', aal, apikey: req.headers.apikey });
  if (u.pathname === '/auth/v1/token') {
    const e = USERS[data.email]; return e && data.password === PW ? json(200, session(e, 'aal1')) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (u.pathname === '/auth/v1/user') return user ? json(200, userFor(user, user.id === USERS['newadmin@test.dev'].id && enrolled ? [{ id: 'fn1', factor_type: 'totp', status: 'verified' }] : user.factors)) : json(401, { msg: 'no' });
  if (u.pathname === '/auth/v1/logout') { res.writeHead(204); return res.end(); }
  if (u.pathname === '/auth/v1/factors' && req.method === 'POST') return json(200, { id: 'fn1', type: 'totp', friendly_name: 'admin authenticator', totp: { qr_code: 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', secret: 'MOCKSECRET234', uri: 'otpauth://totp/x' } });
  const m = /^\/auth\/v1\/factors\/([^/]+)\/(challenge|verify)$/.exec(u.pathname);
  if (m && m[2] === 'challenge') return json(200, { id: 'ch1', type: 'totp', expires_at: 4102444800 });
  if (m && m[2] === 'verify') { if (data.code !== '123456') return json(400, { error_code: 'mfa_verification_failed', msg: 'bad code' }); if (m[1] === 'fn1') enrolled = true; return json(200, session(user, 'aal2')); }
  if (u.pathname.startsWith('/auth/v1/factors/') && req.method === 'DELETE') return json(200, { id: 'x' });
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = u.pathname.slice('/rest/v1/rpc/'.length);
    if (!user) return json(401, { code: '42501', message: 'not authenticated' });
    if (fn === 'am_i_admin') return json(200, { admin: user.admin, mfa: aal === 'aal2' });
    if (!user.admin) return json(403, { code: '42501', message: 'not an administrator' });
    if (aal !== 'aal2') return json(403, { code: '42501', message: 'multi-factor authentication required' });
    if (fn === 'admin_list_submissions') return json(200, [ITEM, OWN]);
    if (fn === 'admin_list_reports') return json(200, [REPORT]);
    if (fn === 'admin_location_counts') return json(200, { candidate: 1, unverified: 0, verified: 0, closed: 0 });
    if (fn === 'admin_list_locations') return json(200, data.p_status === 'candidate' ? [LOC] : []);
    if (fn === 'admin_get_location') return json(200, data.p_id === LOC.id ? LOC : null);
    if (fn === 'admin_apply_location_review') { reviews.push(data); return json(200, { review_id: 'r1', status: 'unverified', restroom_verified: false, public: true }); }
    if (fn === 'admin_decide_submission') { decisions.push(data); return json(200, { status: 'approved' }); }
    if (fn === 'admin_resolve_report') { decisions.push({ report: data }); return json(204); }
  }
  return json(404, { msg: 'not mocked' });
});

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const p of ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']) if (existsSync(p)) return p;
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

// The admin app runs WITHOUT any service-role credential: only the public URL + anon key.
const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK}`, NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON, ADMIN_ALLOW_LOCAL_BACKEND: 'true', NEXT_TELEMETRY_DISABLED: '1' };
delete env.SUPABASE_SERVICE_ROLE_KEY; delete env.SUPABASE_URL;
// ---- lifecycle: everything that can fail while starting up lives inside the single try/finally below, so a
// startup, readiness or browser-launch failure is finite, reported, and always cleans up THIS run's processes only.
const STARTUP_MS = Number(process.env.E2E_ADMIN_STARTUP_TIMEOUT_MS ?? 120000);
const base = `http://127.0.0.1:${APP}`;
let server = null; let serverExited = false; let serverLog = ''; let browser = null; let mockStarted = false; let cleaned = false;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms} ms`)), ms).unref())]);

const startMock = () => new Promise((resolve, reject) => {
  mock.once('error', reject);
  mock.listen(MOCK, '127.0.0.1', () => { mockStarted = true; mock.off('error', reject); resolve(); });
});
function startServer() {
  server = spawn('npx', ['next', 'dev', '-H', '127.0.0.1', '-p', String(APP)], { cwd: join(root, 'apps/admin'), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
  server.on('exit', () => { serverExited = true; });
  server.on('error', (e) => { serverLog += `spawn error: ${e.message}\n`; serverExited = true; });
}
async function waitReady() {
  const deadline = Date.now() + STARTUP_MS;
  while (Date.now() < deadline) {
    if (serverExited) throw new Error('the admin dev server exited before it became ready');
    try {
      const r = await fetch(`${base}/signin`, { signal: AbortSignal.timeout(3000) });
      if (r.status === 200) return;
    } catch { /* still starting, or this request timed out: try again until the overall deadline */ }
    await sleep(500);
  }
  throw new Error(`the admin dev server was not ready within ${STARTUP_MS} ms`);
}
/** Idempotent. Stops only what this run started: its browser, its server process group, its mock. */
async function cleanup() {
  if (cleaned) return; cleaned = true;
  if (browser) await withTimeout(browser.close(), 10000, 'browser close').catch(() => {});
  if (server && !serverExited) {
    const gone = new Promise((r) => server.once('exit', r));
    try { process.kill(-server.pid, 'SIGTERM'); } catch { try { server.kill('SIGTERM'); } catch { /* already gone */ } }
    await withTimeout(gone, 5000, 'server stop').catch(() => { try { process.kill(-server.pid, 'SIGKILL'); } catch { /* already gone */ } });
  }
  if (mockStarted) { mock.closeAllConnections?.(); await new Promise((r) => mock.close(() => r())); }
}
for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(sig, () => { cleanup().finally(() => process.exit(code)); });

let failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) failures++; };
const text = (page, t) => page.getByText(t, { exact: false }).first().waitFor({ state: 'visible', timeout: 20000 }).then(() => true, () => false);
const login = async (page, email) => { await page.goto(`${base}/signin`); await page.getByLabel('Email').fill(email); await page.getByLabel('Password').fill(PW); await page.getByRole('button', { name: 'Sign in' }).click(); };
const loginAndWait = async (page, email) => { await login(page, email); await page.waitForURL((u) => !u.pathname.endsWith('/signin'), { timeout: 30000 }); };
const locCalls = () => requests.filter((r) => /admin_(location_counts|list_locations|get_location|apply_location_review)$/.test(r.path));
const listCalls = () => requests.filter((r) => r.path.endsWith('/admin_list_submissions'));

try {
  await startMock();
  startServer();
  await waitReady();
  browser = await withTimeout(chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] }), 60000, 'browser launch');
  { // signed out / wrong password / non-admin
    const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    await page.goto(`${base}/queue`);
    check(page.url().endsWith('/signin'), 'signed-out visitors are sent to sign-in', page.url());
    await page.getByLabel('Email').fill('admin@test.dev'); await page.getByLabel('Password').fill('wrong'); await page.getByRole('button', { name: 'Sign in' }).click();
    check(await text(page, 'Email or password is incorrect.'), 'wrong password gives the generic message');
    check(listCalls().length === 0, 'no queue data requested before sign-in');
    await login(page, 'plain@test.dev');
    check(await text(page, 'Not authorized'), 'a non-admin account sees only "Not authorized"');
    check(listCalls().length === 0 && !(await page.getByText('Review queue').count()), 'non-admin never requests or sees queue data');
    await ctx.close();
  }
  { // admin: MFA required, then queue
    const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    await login(page, 'admin@test.dev');
    check(await text(page, 'Multi-factor verification') && page.url().endsWith('/mfa'), 'an admin without MFA is sent to the MFA step', page.url());
    await page.goto(`${base}/queue`);
    check(page.url().endsWith('/mfa'), 'the queue redirects back to MFA at aal1');
    check(listCalls().length === 0, 'no queue data is requested at aal1');
    await page.goto(`${base}/mfa`);
    await page.getByLabel('6-digit code').fill('000000'); await page.getByRole('button', { name: 'Verify' }).click();
    check(await text(page, 'That code did not work.'), 'a wrong MFA code is refused');
    await page.getByLabel('6-digit code').fill('123456'); await page.getByRole('button', { name: 'Verify' }).click();
    check(await text(page, 'Review queue') && page.url().endsWith('/queue'), 'a valid MFA code opens the queue', page.url());
    check(await text(page, 'Mock Library Restroom') && await text(page, 'low_accuracy'), 'queue shows the proposal, GPS accuracy and private flags');
    check(await text(page, 'Locked all week'), 'queue shows open reports');
    check(!(await page.content()).match(/user_id|@test\.dev/), 'the queue page shows no contributor identity');
    check(await text(page, 'another admin must decide'), 'own items are marked and offer no decision form');
    check(await page.getByRole('button', { name: 'Approve (public, unverified)' }).count() === 1, 'only decidable items have decision buttons');

    // validation happens before any request
    const before = decisions.length;
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    check(await text(page, 'Choose a rejection reason.') && decisions.length === before, 'reject without a reason is refused locally');
    await page.getByLabel('Rejection reason').selectOption('other');
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    check(await text(page, 'A note is required when the reason is Other.') && decisions.length === before, 'Other needs a note');
    await page.getByRole('button', { name: 'Mark duplicate' }).click();
    check(await text(page, 'Enter the id of the existing restroom') && decisions.length === before, 'duplicate needs a linked restroom');
    await page.getByLabel('Rejection reason').selectOption('spam_or_abuse');
    await page.getByRole('button', { name: 'Reject', exact: true }).click();
    check(await text(page, 'Decision recorded: reject') && decisions.at(-1)?.p_reason === 'spam_or_abuse' && decisions.at(-1)?.p_decision === 'reject', 'a valid rejection is sent with its reason code');
    await page.getByRole('button', { name: 'Approve (public, unverified)' }).click();
    check(await text(page, 'Decision recorded: approve') && decisions.at(-1)?.p_decision === 'approve', 'approve is sent');
    await page.getByRole('button', { name: 'Resolved' }).click();
    check(await text(page, 'Report resolved.') && decisions.at(-1)?.report?.p_resolution === 'resolved', 'a report can be resolved');
    // every admin request used the signed-in session and the anon key only
    const admin = requests.filter((r) => r.path.includes('/rest/v1/rpc/admin_'));
    check(admin.length > 0 && admin.every((r) => r.apikey === ANON && r.aal === 'aal2'), 'admin calls use the anon key plus an MFA-verified user session');
    check(!requests.some((r) => /service/i.test(r.auth)), 'no service-role credential is used anywhere');
    await ctx.close();
  }
  { // seeded-location review: refused without admin + MFA, no data requested
    for (const [email, label] of [[null, 'signed-out'], ['plain@test.dev', 'non-admin'], ['admin@test.dev', 'admin without MFA']]) {
      const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
      const before = locCalls().length;
      if (email) await loginAndWait(page, email);
      await page.goto(`${base}/review`);
      await page.waitForLoadState('networkidle');
      const where = page.url();
      const expected = email === null ? '/signin' : email.startsWith('plain') ? '/queue' : '/mfa';
      check(where.endsWith(expected), `/review sends a ${label} visitor to ${expected}`, where);
      await page.goto(`${base}/review/${LOC.id}`);
      await page.waitForLoadState('networkidle');
      check(locCalls().length === before && !(await page.content()).includes('Mock Hidden Candidate'), `${label}: no seeded-location data is requested or shown`);
      await ctx.close();
    }
  }
  { // seeded-location review with admin + MFA
    const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    await loginAndWait(page, 'admin@test.dev');
    await page.goto(`${base}/mfa`);
    await page.getByLabel('6-digit code').fill('123456'); await page.getByRole('button', { name: 'Verify' }).click();
    await text(page, 'Review queue');
    await page.goto(`${base}/review?view=candidates`);
    check(await text(page, 'Mock Hidden Candidate'), 'an MFA admin sees hidden candidates in the seeded-location list');
    check(await page.getByRole('navigation', { name: 'Views' }).getByRole('link').count() === 4, 'view tabs are real labelled links');
    await page.getByRole('link', { name: 'Review', exact: true }).click();
    check(await text(page, 'Does the restroom exist?'), 'the review form opens');
    // keyboard operation + labelled controls
    await page.getByLabel('Yes, a restroom exists here').focus();
    await page.keyboard.press('Space');
    check(await page.getByLabel('Yes, a restroom exists here').isChecked(), 'existence can be chosen with the keyboard');
    check((await page.getByLabel('Username').count()) === 1 && (await page.getByLabel('Visited in person').count()) === 1, 'form controls are labelled');
    await page.getByLabel('Username').fill('Jake alias');
    await page.getByRole('button', { name: 'Save review and go to next' }).press('Enter');
    await text(page, 'Saved');
    const sent = reviews.at(-1);
    check(sent?.p_location === LOC.id && sent?.p_existence === 'exists' && sent?.p_reviewer === 'Jake alias' && sent?.p_personally_verified === false, 'the review is sent through admin_apply_location_review', JSON.stringify(sent));
    check(sent && !('p_reviewer_identity' in sent), 'the browser never supplies a reviewer identity (the database uses the signed-in admin)');
    const calls = locCalls();
    check(calls.length > 0 && calls.every((r) => r.apikey === ANON && r.aal === 'aal2'), 'seeded-location calls use the anon key plus an MFA-verified user session');
    check(!requests.some((r) => /service/i.test(r.auth) || r.path.includes('/rest/v1/locations')), 'no service-role credential and no direct table access');
    await ctx.close();
  }
  { // first-time enrollment
    const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    await login(page, 'newadmin@test.dev');
    check(await text(page, 'Set up authenticator'), 'an admin with no factor is offered enrollment');
    await page.getByRole('button', { name: 'Set up authenticator' }).click();
    check(await text(page, 'MOCKSECRET234'), 'enrollment shows the secret (and QR) once');
    await page.getByLabel('6-digit code').fill('123456'); await page.getByRole('button', { name: 'Verify and finish setup' }).click();
    check(await text(page, 'Review queue'), 'verifying the first code completes enrollment and opens the queue');
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.error(`\nE2E setup or run failed: ${e instanceof Error ? e.message : e}`);
} finally {
  await cleanup();
}
if (failures) { console.error(`\n${failures} check(s) failed.\n--- server log tail ---\n${serverLog.slice(-1500)}`); process.exit(1); }
console.log('\nAdmin e2e passed.');
process.exit(0);
