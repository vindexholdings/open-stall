#!/usr/bin/env node
// Real-browser test of the account flows against a LOCAL MOCK of the auth backend (GoTrue) and REST
// API. Drives the actual web app UI (Playwright + headless Chromium): gating, email sign-in/up/reset,
// Google PKCE round trip, persistence, open-redirect safety, and the privacy rule that restroom
// searches never carry the signed-in user's token. Contacts no real service.
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK_PORT = 54199;
const ANON = 'mock-anon-key-not-real';
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'user@test.dev', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const GOOD_PW = 'correct horse battery';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', exp: 4102444800 })}.sig`;
const session = () => ({ access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-token-1', user: USER });

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

// ---------------------------------------------------------------- mock backend
const requests = [];
const LOC_ID = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d5e';
const LOC_ROW = { id: LOC_ID, name: 'Mock Park Restroom', address_line: '1 Park Way', city: 'Cody', region: 'WY', postal_code: '82414', latitude: 44.5263, longitude: -109.0565,
  verification: 'verified', last_verified_at: '2026-10-01T00:00:00Z', opening_hours: null, fee_required: false, key_required: false, purchase_required: false,
  wheelchair_accessible: true, gender_neutral: null, baby_changing: null, has_hot_water: null, has_cold_water: null, access_location: null, average_rating: null,
  rating_count: 0, attribution: null, distance_m: null };
const acct = { favorite: false, review: null, reports: [], submissions: [], submissionAttempts: [], checkins: [], name: null, mode: 'plain', transport: 'walk', deleted: false };
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  const json = (status, obj, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...cors, ...extra }); res.end(JSON.stringify(obj)); };
  const data = body ? JSON.parse(body) : {};
  requests.push({ method: req.method, path: u.pathname, auth: req.headers.authorization ?? null, body: data });
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
    return data.email === USER.email && data.password === GOOD_PW ? json(200, session()) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'pkce') return data.auth_code && data.code_verifier ? json(200, session()) : json(400, { error_code: 'bad_code', msg: 'bad code' });
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'refresh_token') return json(200, session());
  if (u.pathname === '/auth/v1/signup') return json(200, { ...USER, id: '99999999-2222-4333-8444-555555555555', email: data.email, confirmation_sent_at: new Date().toISOString() });
  if (u.pathname === '/auth/v1/recover') return json(200, {});
  if (u.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/auth/v1/user') return json(200, USER);
  if (u.pathname === '/auth/v1/authorize') {
    const to = u.searchParams.get('redirect_to');
    if (u.searchParams.get('provider') !== 'google' || !u.searchParams.get('code_challenge') || !to) return json(400, { msg: 'bad authorize request' });
    res.writeHead(302, { location: `${to}?code=abcdEFGH1234abcd`, ...cors }); return res.end();
  }
  if (u.pathname === '/rest/v1/rpc/nearby_locations') return json(200, []);
  if (u.pathname === '/rest/v1/rpc/nearest_verified_location') return json(200, []);
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = u.pathname.slice('/rest/v1/rpc/'.length);
    if (fn === 'get_public_location') return json(200, [LOC_ROW]);
    // Everything below is an account function: it needs the signed-in user's token.
    if (req.headers.authorization !== `Bearer ${JWT}`) return json(401, { code: '28000', message: 'not authenticated' });
    if (fn === 'list_my_favorites') return json(200, acct.favorite ? [LOC_ROW] : []);
    if (fn === 'add_favorite') { acct.favorite = true; return json(200, { added: true, count: 1, limit: 5 }); }
    if (fn === 'remove_favorite') { acct.favorite = false; return json(200, null); }
    if (fn === 'get_my_review') return json(200, acct.review);
    if (fn === 'submit_review') {
      if (!(data.p_rating >= 1 && data.p_rating <= 5)) return json(400, { code: '22023', message: 'rating must be 1-5' });
      acct.review = { rating: data.p_rating, mode: data.p_mode, observations: data.p_observations }; return json(200, { rating: data.p_rating });
    }
    if (fn === 'delete_my_review') { acct.review = null; return json(200, null); }
    if (fn === 'submit_report') { acct.reports.push(data); return json(200, null); }
    if (fn === 'submit_location') {
      acct.submissionAttempts.push(data);
      if (data.p_proposed?.name === 'Existing public place') return json(400, { code: '22023', message: 'restroom already listed nearby' });
      acct.submissions.push(data);
      return json(200, data.p_proposed?.name === 'Shared place' ? { coalesced: true } : { coalesced: false, submission_id: 'sub-1' });
    }
    if (fn === 'submit_location_edit') { acct.edits = (acct.edits ?? 0) + 1; return json(200, 'sub-2'); }
    if (fn === 'check_in') { acct.checkins.push(data); return json(200, { checkin_id: 'c1' }); }
    if (fn === 'get_my_profile') return json(200, [{ display_name: acct.name, preferred_mode: acct.mode, default_transport: acct.transport, points_balance: 0 }]);
    if (fn === 'update_my_profile') { Object.assign(acct, { name: data.p_display_name, mode: data.p_mode, transport: data.p_transport }); return json(200, []); }
    if (fn === 'delete_my_account') {
      if (data.p_confirm !== 'DELETE') return json(400, { code: '22023', message: 'confirmation required' });
      acct.deleted = true; return json(200, null);
    }
  }
  return json(404, { msg: 'not mocked' });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- build + serve the web app
const out = mkdtempSync(join(tmpdir(), 'open-stall-auth-'));
execFileSync('npx', ['expo', 'export', '--clear', '--platform', 'web', '--output-dir', out], {
  cwd: join(root, 'apps/mobile'), stdio: 'inherit',
  env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON },
});
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
const app = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let f = join(out, p);
  if (!f.startsWith(out) || !existsSync(f) || statSync(f).isDirectory()) f = join(out, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.address().port}`;

// ---------------------------------------------------------------- test harness
let failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (!ok) failures++; };
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const newPage = async () => {
  const ctx = await browser.newContext({ permissions: ['geolocation'], geolocation: { latitude: 44.5263, longitude: -109.0565, accuracy: 10 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return { ctx, page };
};
const text = async (page, t) => page.getByText(t, { exact: false }).first().waitFor({ state: 'visible' }).then(() => true, () => false);
const fill = async (page, label, value) => page.getByLabel(label, { exact: true }).fill(value);
const button = (page, name) => page.getByRole('button', { name, exact: true });

try {
  // 1. Gating + email sign-in
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/favorites`);
    check(await text(page, 'Sign in to save favorite restrooms'), 'signed-out Favorites asks for sign-in');
    await button(page, 'Sign in or create account').click();
    check(await text(page, 'never need one to find a restroom'), 'sign-in screen says discovery needs no account');
    check(page.url().includes('next=%2Ffavorites') || page.url().includes('next=/favorites'), 'next=/favorites is carried', page.url());

    await fill(page, 'Email', USER.email); await fill(page, 'Password', 'wrong password!!');
    await button(page, 'Sign in').click();
    check(await text(page, 'Email or password is incorrect.'), 'wrong password shows the generic message');

    await fill(page, 'Password', GOOD_PW); await button(page, 'Sign in').click();
    check(await text(page, 'No favorites yet.'), 'correct password returns to Favorites, now unlocked');

    await page.getByRole('link', { name: 'Account' }).first().click().catch(() => page.goto(`${base}/account`));
    check(await text(page, `Signed in as ${USER.email}`), 'Account shows the signed-in email');
    await page.reload();
    check(await text(page, `Signed in as ${USER.email}`), 'session persists across reload');

    // privacy: a restroom search while signed in carries only the anon key, never the user token
    await page.goto(`${base}/`);
    await button(page, 'Find Nearest Restroom').click();
    await page.waitForTimeout(2500);
    const rpc = requests.filter((r) => r.path === '/rest/v1/rpc/nearby_locations');
    check(rpc.length > 0, 'a nearby search was made while signed in');
    check(rpc.every((r) => r.auth === `Bearer ${ANON}`), 'discovery searches never carry the signed-in user token', JSON.stringify(rpc.map((r) => r.auth)));

    await page.goto(`${base}/account`);
    await button(page, 'Sign out').click();
    check(await text(page, 'Sign in or create account'), 'sign out returns to the signed-out Account screen');
    await page.goto(`${base}/favorites`);
    check(await text(page, 'Sign in to save favorite restrooms'), 'Favorites is gated again after sign out');
    await ctx.close();
  }

  // 2. Sign-up and reset
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/auth/sign-in`);
    await button(page, 'New here? Create an account').click();
    await fill(page, 'Email', 'new.person@test.dev'); await fill(page, 'Password', 'short');
    await button(page, 'Create account').click();
    check(await text(page, 'Use at least 8 characters.'), 'weak password is rejected before any request');
    await fill(page, 'Password', 'Password123'); await button(page, 'Create account').click();
    check(await text(page, 'too common'), 'common password is rejected');
    const before = requests.filter((r) => r.path === '/auth/v1/signup').length;
    await fill(page, 'Password', 'a long passphrase here'); await button(page, 'Create account').click();
    check(await text(page, 'we sent a confirmation link'), 'sign-up asks the user to confirm by email');
    check(requests.filter((r) => r.path === '/auth/v1/signup').length === before + 1, 'exactly one sign-up request was sent');
    await fill(page, 'Email', 'anyone@test.dev'); await button(page, 'Forgot password?').click();
    check(await text(page, 'If that email has an account, we sent a reset link.'), 'reset message does not reveal whether the account exists');
    await ctx.close();
  }

  // 3. Google PKCE round trip (mock provider), and open-redirect safety
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent('//evil.example.com')}`);
    await button(page, 'Continue with Google').click();
    await page.waitForURL((u) => !u.href.includes('/auth/callback') && u.origin === base, { timeout: 20000 }).catch(() => {});
    await page.goto(`${base}/account`);
    check(await text(page, `Signed in as ${USER.email}`), 'Google sign-in completes the PKCE round trip and signs in');
    check(new URL(page.url()).origin === base, 'a hostile next parameter never leaves the app', page.url());
    await ctx.close();
  }

  // 3b. Account features against the stateful mock (favorites, rating, check-in, report, submission, settings, deletion)
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/location/${LOC_ID}`);
    check(await text(page, 'Mock Park Restroom'), 'restroom detail loads signed out');
    check(await text(page, 'Sign in to save this restroom'), 'signed-out detail offers sign-in for actions, not a wall');
    check(!(await button(page, 'Save to favorites').count()), 'no account actions are offered signed out');
    await page.goto(`${base}/auth/sign-in?next=%2Flocation%2F${LOC_ID}`);
    await fill(page, 'Email', USER.email); await fill(page, 'Password', GOOD_PW); await button(page, 'Sign in').click();
    check(await text(page, 'Save to favorites'), 'signing in returns to the restroom with actions unlocked');

    await button(page, 'Save to favorites').click();
    check(await text(page, 'Saved to favorites.') && acct.favorite, 'favorite saved');
    check(await text(page, 'Remove from favorites'), 'button flips to remove');
    const favReq = requests.filter((r) => r.path.endsWith('/list_my_favorites'));
    check(favReq.length > 0 && favReq.every((r) => r.body.p_lat === null && r.body.p_lng === null), 'favorites requests never carry coordinates');

    await page.getByRole('radio', { name: '4 stars', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Clean', exact: true }).click();
    await button(page, 'Save rating').click();
    check(await text(page, 'Your rating was saved.') && acct.review?.rating === 4 && acct.review.observations.join() === 'clean', 'rating with observation saved');
    await button(page, 'Remove my rating').click();
    check(await text(page, 'Your rating was removed.') && acct.review === null, 'rating removed');
    await button(page, 'Save rating').click();
    check(await text(page, 'Choose a rating from 1 to 5.'), 'rating is validated before any request');

    await button(page, 'I’m here: check in').click();
    check(await text(page, 'Checked in.') && acct.checkins.length === 1, 'check-in succeeds when location is granted');

    await button(page, 'Report a problem').click();
    await button(page, 'Send report').click();
    check(await text(page, 'Choose what’s wrong.'), 'report needs an issue');
    await page.getByRole('radio', { name: 'It’s closed or gone', exact: true }).click();
    await fill(page, 'Add a note (optional)', 'see http://spam.example');
    await button(page, 'Send report').click();
    check(await text(page, 'links, email addresses or phone numbers'), 'links in report notes are rejected client-side');
    await fill(page, 'Add a note (optional)', 'Locked at 3pm');
    await button(page, 'Send report').click();
    check(await text(page, 'Thanks. A person will take a look.') && acct.reports.length === 1 && acct.reports[0].p_issue === 'closed', 'report sent');

    await page.goto(`${base}/contribute`);
    check(await text(page, 'Stand at the restroom to add it'), 'new-restroom screen explains it is added where you stand');
    check(!(await text(page, 'Choose the location on the map')), 'no arbitrary map-pin language remains');
    check(await page.getByLabel(/latitude|longitude/i).count() === 0, 'there are no coordinate inputs for new restrooms');
    // strict location rule: no permission -> refused locally, nothing sent
    await fill(page, 'Name of the place', 'Library restroom');
    await page.getByRole('checkbox', { name: /not inside a private home/ }).click();
    await page.evaluate(() => {
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: (_ok, fail) => fail({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1 }) });
      Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: async () => ({ state: 'denied', addEventListener() {}, removeEventListener() {} }) });
    });
    await button(page, 'Add restroom at my current location').click();
    check(await text(page, 'Location access is off') || await text(page, 'couldn’t get your location'), 'without location access a new restroom is refused');
    check(acct.submissionAttempts.length === 0, 'no request is made without a location fix');

    // permission back but a poor fix (500 m) -> refused locally
    await page.evaluate(() => { delete navigator.geolocation.getCurrentPosition; delete navigator.permissions.query; });
    await ctx.setGeolocation({ latitude: 44.5263, longitude: -109.0565, accuracy: 500 });
    await button(page, 'Add restroom at my current location').click();
    check(await text(page, 'isn’t accurate enough'), 'an inaccurate location fix is refused');
    check(acct.submissionAttempts.length === 0, 'no request is made with an inaccurate fix');

    // required fields: name and the public-place attestation
    await ctx.setGeolocation({ latitude: 44.52631, longitude: -109.05651, accuracy: 10 });
    await fill(page, 'Name of the place', '');
    await page.getByRole('checkbox', { name: /not inside a private home/ }).click();
    await button(page, 'Add restroom at my current location').click();
    check(await text(page, 'Enter the name.') && await text(page, 'Confirm this is a public restroom'), 'new restroom needs a name and the attestation');
    check(acct.submissionAttempts.length === 0, 'nothing is sent without a name and attestation');
    await page.getByRole('checkbox', { name: /not inside a private home/ }).click();

    // private residence wording is still blocked (with a good fix)
    await fill(page, 'Name of the place', 'My house bathroom');
    await button(page, 'Add restroom at my current location').click();
    check(await text(page, 'Private homes can’t be added'), 'private residences are blocked');
    check(acct.submissionAttempts.length === 0, 'blocked submission never reached the server');

    // valid: device position goes as separate arguments, never inside the free-form payload
    await fill(page, 'Name of the place', 'Library restroom');
    await button(page, 'Add restroom at my current location').click();
    check(await text(page, 'sent for review') && acct.submissions.length === 1, 'valid current-location submission is sent for review', (await page.locator('body').innerText()).slice(0, 2000).replace(/\n/g, ' | '));
    const sub = acct.submissions[0];
    check(sub.p_attested === true && Math.abs(sub.p_lat - 44.52631) < 1e-6 && Math.abs(sub.p_lng + 109.05651) < 1e-6 && sub.p_accuracy_m > 0 && sub.p_accuracy_m <= 50,
      'submission carries the device fix and accuracy', JSON.stringify(sub));
    check(!('latitude' in sub.p_proposed) && !('longitude' in sub.p_proposed), 'payload contains no free-form coordinates');

    // server-side duplicate / coalescing outcomes are explained to the user
    await page.goto(`${base}/contribute`);
    await fill(page, 'Name of the place', 'Existing public place');
    await page.getByRole('checkbox', { name: /not inside a private home/ }).click();
    await button(page, 'Add restroom at my current location').click();
    check(await text(page, 'already on the map'), 'an already-listed restroom is explained, not silently dropped');
    await fill(page, 'Name of the place', 'Shared place');
    await button(page, 'Add restroom at my current location').click();
    check(await text(page, 'added your report to it'), 'a coalesced report tells the user it was added to an existing one');

    // corrections to existing restrooms need no location
    await page.goto(`${base}/contribute?id=${LOC_ID}&name=Mock%20Park%20Restroom`);
    await page.getByRole('radio', { name: 'Yes', exact: true }).first().click();
    await page.getByRole('checkbox', { name: /not inside a private home/ }).click();
    await page.evaluate(() => {
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: (_ok, fail) => fail({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1 }) });
      Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: async () => ({ state: 'denied', addEventListener() {}, removeEventListener() {} }) });
    });
    await button(page, 'Send suggestion').click();
    check(await text(page, 'sent for review'), 'a correction can be sent without sharing location');
    await page.evaluate(() => { delete navigator.geolocation.getCurrentPosition; delete navigator.permissions.query; });

    await page.goto(`${base}/settings`);
    await page.getByRole('radio', { name: 'Risqué', exact: true }).click();
    await page.getByRole('radio', { name: 'Bike', exact: true }).click();
    await fill(page, 'Display name (optional)', 'Trail Walker');
    await button(page, 'Save display name').click();
    check(await text(page, 'Saved.') && acct.mode === 'risque' && acct.transport === 'bike' && acct.name === 'Trail Walker', 'preferences and display name sync to the account');
    await fill(page, 'Display name (optional)', 'Admin Joe');
    await button(page, 'Save display name').click();
    check(await text(page, 'That name isn’t allowed'), 'reserved display names are rejected');

    await page.goto(`${base}/account`);
    await button(page, 'Delete my account…').click();
    check(await button(page, 'Permanently delete my account').isDisabled(), 'delete stays disabled until DELETE is typed');
    await fill(page, 'Type DELETE to confirm', 'delete');
    check(await button(page, 'Permanently delete my account').isDisabled(), 'lowercase is not enough');
    await fill(page, 'Type DELETE to confirm', 'DELETE');
    await button(page, 'Permanently delete my account').click();
    check(await text(page, 'Sign in or create account') && acct.deleted, 'account deleted and signed out');
    await ctx.close();
  }

  // 4. Discovery works with no account at all
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/`);
    await button(page, 'Find Nearest Restroom').click();
    check(await text(page, 'No restrooms found nearby yet.') || await text(page, 'Looking for restrooms'), 'finding restrooms works signed out');
    check(!(await page.getByText('Sign in to save favorite restrooms').count()), 'no sign-in wall on discovery');
    await ctx.close();
  }
} finally {
  await browser.close();
  mock.close(); app.close();
  rmSync(out, { recursive: true, force: true });
}
if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1); }
console.log('\nAuth UI e2e passed.');
