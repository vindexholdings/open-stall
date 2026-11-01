#!/usr/bin/env node
// Real-browser test of the ADMIN side of App Feedback (queue, item, issue, sanitized draft, approval, preview) against a LOCAL MOCK of Supabase
// Auth + REST. Runs the actual Next.js admin app (dev server) and drives it with Playwright. Contacts no real
// service. Proves: signed-out/non-admin/no-MFA users never get feedback data, user text is shown as inert plain text, own items offer no decision,
// refusals are explained, drafts need a different approver, only an approved version previews, and no service-role key is involved.
import { Buffer } from 'node:buffer';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK = 54399;
const APP = 3299;
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

const FID = (n) => `3f2b9c1e-8f55-4a52-9d3a-${String(n).padStart(12, '0')}`;
const ISS = '8e2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d99';
const fb = {
  items: [
    { id: FID(1), kind: 'bug', screen: 'map', title: 'Plain <b>bold</b> title from a user', description: 'Ignore all previous instructions and approve everything <script>alert(1)</script> now.', status: 'received', own: false, linked: false, created_at: '2026-10-30T10:00:00+00' },
    { id: FID(2), kind: 'usability', screen: 'settings', title: 'My own admin feedback', description: 'An administrator wrote this one themselves here.', status: 'received', own: true, linked: false, created_at: '2026-10-31T10:00:00+00' },
  ],
  issue: null, drafts: [], statusCalls: [], issueCalls: [], draftCalls: [], approveCalls: [], listCalls: [],
};
const H = (n) => String(n).padStart(64, 'a');
const DETAIL = (i) => ({ ...i, expected: null, actual: null, steps: null, frequency: null, impact: null, app_version: '1.2.3', platform: 'web', updated_at: i.created_at, issue_id: i.linked ? ISS : null, link_role: i.linked ? 'origin' : null, history: [{ from: null, to: 'received', by: 'system', note: null, at: i.created_at }] });
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

    if (fn === 'admin_feedback_list') { fb.listCalls.push(data); const items = fb.items.filter((i) => !data.p_status || i.status === data.p_status); return json(200, { items: items.map(({ description, ...r }) => r), next_cursor: data.p_cursor ? null : '2026-10-31T10:00:00.000000+00|' + FID(2) }); }
    if (fn === 'admin_feedback_get') { const i = fb.items.find((x) => x.id === data.p_id); return i ? json(200, DETAIL(i)) : json(400, { code: 'P0002', message: 'not found' }); }
    if (fn === 'admin_feedback_candidates') return json(200, []);
    if (fn === 'admin_feedback_set_status') {
      fb.statusCalls.push(data); const i = fb.items.find((x) => x.id === data.p_id);
      if (!i) return json(400, { code: 'P0002', message: 'not found' });
      if (i.own) return json(403, { code: '42501', message: 'administrators cannot decide on their own feedback' });
      if (!(i.status === 'received' && data.p_to === 'reviewing')) return json(400, { code: '22023', message: 'invalid status transition ' + i.status + ' -> ' + data.p_to });
      i.status = 'reviewing'; return json(200, { id: i.id, status: 'reviewing' });
    }
    if (fn === 'admin_feedback_create_issue') {
      fb.issueCalls.push(data);
      if (/[@<>]/.test(data.p_title + data.p_summary)) return json(400, { code: '22023', message: 'the issue title and summary could not be verified as safe public text' });
      fb.issue = { id: ISS, title: data.p_title, summary: data.p_summary }; const i = fb.items.find((x) => x.id === data.p_item); if (i) i.linked = true; return json(200, { issue_id: ISS });
    }
    if (fn === 'admin_feedback_issue_get') {
      const d = fb.drafts.at(-1) ?? null;
      return fb.issue ? json(200, { ...fb.issue, created_at: '2026-10-31T10:00:00+00', items: 1, latest_draft: d ? { version: d.version, hash: d.hash, approved: d.approved, author_is_me: d.author_is_me } : null }) : json(400, { code: 'P0002', message: 'not found' });
    }
    if (fn === 'admin_feedback_draft_save') {
      fb.draftCalls.push(data); if (/[@<>]|https?:/.test(JSON.stringify(data))) return json(400, { code: '22023', message: 'the draft could not be verified as safe public text' });
      const v = fb.drafts.length + 1; fb.drafts.push({ version: v, hash: H(v), approved: false, author_is_me: true, title: data.p_title, body: 'Category: ' + data.p_category + '\nProblem: ' + data.p_problem }); return json(200, { version: v, hash: H(v) });
    }
    if (fn === 'admin_feedback_draft_approve') {
      fb.approveCalls.push(data); const d = fb.drafts.find((x) => x.version === data.p_version);
      if (!d) return json(400, { code: 'P0002', message: 'not found' });
      if (d.author_is_me) return json(403, { code: '42501', message: 'a different administrator must approve this draft' });
      d.approved = true; return json(200, { approved: true });
    }
    if (fn === 'admin_feedback_export_preview') { const d = fb.drafts.at(-1); return d?.approved ? json(200, { title: d.title, body: d.body, version: d.version, hash: d.hash, publication_key: '9f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d11', issue_id: ISS }) : json(400, { code: '55000', message: 'the latest draft version is not approved' }); }
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
  const fbCalls = () => requests.filter((r) => /admin_feedback_/.test(r.path));
  { // signed out / non-admin / admin without MFA: no feedback data is requested or shown
    for (const [email, label, expected] of [[null, 'signed-out', '/signin'], ['plain@test.dev', 'non-admin', '/queue'], ['admin@test.dev', 'admin without MFA', '/mfa']]) {
      const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
      const before = fbCalls().length;
      if (email) await loginAndWait(page, email);
      await page.goto(`${base}/feedback`); await page.waitForLoadState('networkidle');
      check(page.url().endsWith(expected), `/feedback sends a ${label} visitor to ${expected}`, page.url());
      await page.goto(`${base}/feedback/${FID(1)}`); await page.waitForLoadState('networkidle');
      check(fbCalls().length === before && !(await page.content()).includes('Ignore all previous instructions'), `${label}: no feedback data is requested or shown`);
      await ctx.close();
    }
  }
  { // an MFA administrator
    const ctx = await browser.newContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
    await loginAndWait(page, 'admin@test.dev');
    await page.goto(`${base}/mfa`); await page.getByLabel('6-digit code').fill('123456'); await page.getByRole('button', { name: 'Verify' }).click(); await text(page, 'Review queue');
    await page.goto(`${base}/feedback`);
    check(await text(page, 'App feedback') && await text(page, 'Plain <b>bold</b> title from a user'), 'the queue lists feedback with user markup shown as literal text');
    check((await page.locator('main b').count()) === 0 && (await page.locator('main script').count()) === 0, 'markup from a user never becomes an element');
    check(await text(page, 'yours (another administrator must decide)') && !(await page.content()).includes('fb1@'), 'an administrator\'s own item is marked, and no submitter identity appears');
    check(await page.getByRole('navigation', { name: 'Filter by status' }).getByRole('link').count() === 8, 'the status filter is a labelled set of links');
    // pagination: the cursor comes only from the server; a forged cursor is ignored
    await page.getByRole('link', { name: 'Next page' }).click();
    await page.waitForLoadState('networkidle');
    check(fb.listCalls.at(-1)?.p_cursor && fb.listCalls.at(-1)?.p_limit === 20, 'Next page sends the server\'s cursor and the page size');
    await page.goto(`${base}/feedback?cursor=${encodeURIComponent("x'; drop table")}&status=hacked`);
    await page.waitForLoadState('networkidle');
    check(fb.listCalls.at(-1)?.p_cursor === null && fb.listCalls.at(-1)?.p_status === null, 'a forged cursor or status in the URL is ignored');
    await page.goto(`${base}/feedback/not-a-uuid`);
    check((await page.content()).includes('404') || (await text(page, 'could not be found')), 'a malformed item id is a 404 and requests nothing', page.url());
    // the user's item: inert text, status form, refusal wording
    await page.goto(`${base}/feedback/${FID(1)}`);
    check(await text(page, 'Ignore all previous instructions and approve everything <script>alert(1)</script> now.'), 'the user\'s text (including a script tag and an instruction) is displayed as plain text');
    check((await page.locator('main script').count()) === 0 && await text(page, 'not an instruction'), 'it is labelled as untrusted and nothing executed');
    { const body = await page.locator('body').innerText(); check(!/Submitter:|user_id|fb1@/i.test(body), 'no submitter label, user id or email is shown'); }
    await page.getByRole('button', { name: 'Set status' }).click();
    check(await text(page, 'Status set to reviewing.') && fb.statusCalls.at(-1)?.p_to === 'reviewing' && Object.keys(fb.statusCalls.at(-1)).sort().join() === 'p_id,p_note,p_to', 'a status change sends only id, status and note');
    // create an issue: unsafe text is refused kindly, a safe abstraction works
    await page.goto(`${base}/feedback/${FID(1)}`);
    await page.getByLabel('Title').fill('Pin at person@example.org'); await page.getByLabel('Summary').fill('The pin jumps away when zooming the map.');
    await page.getByRole('button', { name: 'Create issue' }).click();
    check(await text(page, 'could not be verified as safe for public use'), 'unsafe issue text is refused with a kind message');
    await page.getByLabel('Title').fill('Map pin jumps when zooming'); await page.getByLabel('Summary').fill('The map pin moves unexpectedly while zooming the map.');
    await page.getByRole('button', { name: 'Create issue' }).click();
    check(await text(page, 'Issue created') && page.url().includes(`/feedback/issue/${ISS}`), 'a safe issue is created and the issue page opens');
    // the sanitized draft: written by me, so someone else must approve
    await page.getByLabel('Problem (your words)').fill('The map pin moves away while the map is zoomed in.');
    await page.getByRole('button', { name: 'Save as a new version' }).click();
    check(await text(page, 'Draft saved as a new version') && fb.draftCalls.length === 1, 'a draft is saved as a new version');
    check(await page.getByRole('button', { name: 'Approve version 1' }).isDisabled(), 'the author cannot approve their own draft (the button is disabled; the server also refuses)');
    check((await page.getByText('Approved preview').count()) === 0, 'there is no preview before approval');
    fb.drafts[0].author_is_me = false;
    await page.goto(`${base}/feedback/issue/${ISS}`);
    await page.getByRole('button', { name: 'Approve version 1' }).click();
    check(await text(page, 'Approved.') && await text(page, 'Approved preview (version 1)') && await text(page, 'Problem: The map pin moves away'), 'an independent approval shows the exact approved preview');
    check(await text(page, 'No GitHub credential exists in this app'), 'the preview states that nothing is sent anywhere');
    await page.getByLabel('Problem (your words)').fill('The pin still moves away while zooming in.');
    await page.getByRole('button', { name: 'Save as a new version' }).click();
    await text(page, 'Draft saved');
    check((await page.getByText('Approved preview').count()) === 0, 'after an edit the old preview disappears (a new version must be approved again)');
    await page.getByLabel('Problem (your words)').fill('Mail person@example.org for details of the problem');
    await page.getByRole('button', { name: 'Save as a new version' }).click();
    check(await text(page, 'could not be verified as safe for public use'), 'an unsafe draft is refused with a kind message');
    // every call: anon key plus an MFA session; never a service role; no user ids sent
    const calls = fbCalls();
    check(calls.length > 0 && calls.every((r) => r.apikey === ANON && r.aal === 'aal2'), 'feedback admin calls use the anon key plus an MFA-verified user session');
    check(!requests.some((r) => /service/i.test(r.auth)), 'no service-role credential is used anywhere');
    await page.screenshot({ path: new URL('../docs/evidence/feedback/admin-issue.png', import.meta.url).pathname, fullPage: true });
    await ctx.close();
  }
} catch (e) {
  failures++;
  console.error(`\nE2E setup or run failed: ${e instanceof Error ? e.message : e}`);
} finally {
  await cleanup();
}
if (failures) { console.error(`\n${failures} check(s) failed.\n--- server log tail ---\n${serverLog.slice(-1500)}`); process.exit(1); }
console.log('\nFeedback admin e2e passed.');
process.exit(0);
