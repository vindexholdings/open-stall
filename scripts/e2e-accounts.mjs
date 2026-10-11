#!/usr/bin/env node
// Real-browser test of the account + contribution experience (R3) against LOCAL MOCKS of the auth and REST backends.
// Builds the actual Expo web export and drives it with Playwright (headless Chromium). Covers sign-in/sign-up/reset
// including failures and safe return destinations, favorites (empty, full, error/retry), settings and display name,
// new-restroom submissions (current-device fix, attestation, caps, rate limits), corrections without location,
// account deletion, duplicate-write protection and form-input preservation. Contacts no real service.
// Writes screenshots to docs/evidence/r3/.
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK_PORT = 54599;
const ANON = 'mock-anon-key-not-real';
const SHOTS = join(root, 'docs/evidence/r3');
const HERE = { latitude: 44.5263, longitude: -109.0565, accuracy: 10 };
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'user@test.dev', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const GOOD_PW = 'correct horse battery';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', exp: 4102444800 })}.sig`;
const session = () => ({ access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-token-1', user: USER });

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const app of ['Google Chrome', 'Chromium']) for (const home of ['', process.env.HOME ?? '']) { const p = `${home}/Applications/${app}.app/Contents/MacOS/${app}`; if (existsSync(p)) return p; }
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

// ---------------------------------------------------------------- mock backend
const LOC = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d21';
const mkRow = (id, name) => ({ id, name, address_line: '1 Park Way', city: 'Cody', region: 'WY', postal_code: null, latitude: 44.5273, longitude: -109.0565, verification: 'verified',
  last_verified_at: '2026-09-01T00:00:00Z', opening_hours: null, fee_required: null, key_required: false, purchase_required: false, wheelchair_accessible: true, gender_neutral: null,
  baby_changing: null, has_hot_water: null, has_cold_water: null, access_location: null, average_rating: null, rating_count: 0, attribution: null, distance_m: null });
const LOC_ROW = mkRow(LOC, 'Mock Park Restroom');
const acct = { favorites: [], submissions: [], edits: [], mode: 'plain', transport: 'walk', name: null, profileWrites: 0, deleted: false, deleteCalls: 0, signups: 0, logins: 0, resets: 0 };
let inject = null; // { status, body, times } consumed by write functions and favorites listing
let netFail = false; // destroys the socket on sign-in token requests
let delay = 0;
let lose = null; // { fn, times }: the mutation IS recorded, but the response is lost (socket destroyed)
let logoutFail = false;
const requests = [];
const WRITES = ['add_favorite', 'remove_favorite', 'submit_location', 'submit_location_edit', 'update_my_profile', 'delete_my_account', 'list_my_favorites'];
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const cors = { connection: 'close', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  const data = body ? JSON.parse(body) : {};
  const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
  requests.push({ path: u.pathname, auth: req.headers.authorization ?? null, body: data });
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
    if (netFail) return req.socket.destroy();
    if (delay) await new Promise((r) => setTimeout(r, delay));
    acct.logins++;
    return data.email === USER.email && data.password === GOOD_PW ? json(200, session()) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (u.pathname === '/auth/v1/token') return json(200, session());
  if (u.pathname === '/auth/v1/signup') { acct.signups++; return json(200, { ...USER, id: '99999999-2222-4333-8444-555555555555', email: data.email, confirmation_sent_at: new Date().toISOString() }); }
  if (u.pathname === '/auth/v1/recover') { acct.resets++; return json(200, {}); }
  if (u.pathname === '/auth/v1/user') return json(200, USER);
  if (u.pathname === '/auth/v1/logout') { if (logoutFail) return json(500, { msg: 'logout failed' }); res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/rest/v1/rpc/nearby_locations' || u.pathname === '/rest/v1/rpc/nearest_verified_location') return json(200, []);
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = u.pathname.slice('/rest/v1/rpc/'.length);
    if (fn === 'get_public_location') return json(200, data.p_id === LOC ? [LOC_ROW] : []);
    if (req.headers.authorization !== `Bearer ${JWT}`) return json(401, { code: '28000', message: 'not authenticated' });
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (WRITES.includes(fn) && inject && inject.times > 0) { inject.times--; return json(inject.status, inject.body); }
    const lost = lose && lose.fn === fn && lose.times > 0 && (lose.times--, true);
    const reply = lost ? () => req.socket.destroy() : json;
    if (fn === 'list_my_favorites') return reply(200, acct.favorites);
    if (fn === 'add_favorite') { acct.favorites.push(LOC_ROW); return reply(200, { added: true, count: acct.favorites.length, limit: 5 }); }
    if (fn === 'remove_favorite') { acct.favorites = []; return reply(200, null); }
    if (fn === 'get_my_review') return reply(200, null);
    if (fn === 'submit_location') { acct.submissions.push(data); return reply(200, { submission_id: `sub-${acct.submissions.length}` }); }
    if (fn === 'submit_location_edit') { acct.edits.push(data); return reply(200, 'sub-edit'); }
    if (fn === 'get_my_profile') return reply(200, [{ display_name: acct.name, preferred_mode: acct.mode, default_transport: acct.transport, points_balance: 0 }]);
    if (fn === 'update_my_profile') {
      if (/admin/i.test(data.p_display_name ?? '')) return reply(400, { code: '22023', message: 'reserved name' });
      acct.profileWrites++; Object.assign(acct, { name: data.p_display_name, mode: data.p_mode, transport: data.p_transport }); return reply(200, []);
    }
    if (fn === 'delete_my_account') { acct.deleteCalls++; acct.deleted = true; return reply(200, null); }
  }
  return json(404, { msg: 'not mocked' });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- build + serve the web app
// E2E_ACCOUNTS_REUSE_BUILD=<dir> reuses (and keeps) a previous export for quick local iteration; CI never sets it.
const reuse = process.env.E2E_ACCOUNTS_REUSE_BUILD;
const out = reuse ?? mkdtempSync(join(tmpdir(), 'open-stall-accounts-'));
if (!existsSync(join(out, 'index.html'))) {
  execFileSync('npx', ['expo', 'export', '--clear', '--platform', 'web', '--output-dir', out], {
    cwd: join(root, 'apps/mobile'), stdio: 'inherit',
    env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON },
  });
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };
const app = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let f = join(out, p);
  if (!f.startsWith(out) || !existsSync(f) || statSync(f).isDirectory()) f = join(out, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.address().port}`;
mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- harness
let failures = 0;
let passed = 0;
const external = [];
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (ok) passed++; else failures++; };
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const newPage = async ({ width = 390, height = 844, geolocation = HERE } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(geolocation ? { permissions: ['geolocation'], geolocation } : {}) });
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'data:') return route.continue();
    external.push(url.href);
    return route.abort();
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  return { ctx, page };
};
const text = (page, t) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible' }).then(() => true, () => false);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const fill = (page, label, value) => page.getByLabel(label, { exact: true }).fill(value);
const alerts = (page) => page.getByRole('alert').allInnerTexts();
const alerted = (page, re) => page.getByRole('alert').filter({ hasText: re }).first().waitFor({ state: 'visible' }).then(() => true, () => false);
/** Activates a button twice within one JS task, before React can re-render it as disabled. */
const doubleActivate = (page, name) => page.evaluate((n) => {
  const b = [...document.querySelectorAll('[role="button"]')].find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim() === n);
  if (!b) throw new Error(`no button ${n}`);
  b.click(); b.click();
}, name);
/** Level-1 headings a screen reader can reach: not inside an aria-hidden screen (the tab navigator keeps visited screens mounted). */
const count = (path) => requests.filter((r) => r.path.endsWith(path)).length;
const h1texts = async (page) => {
  await page.locator('h1').first().waitFor({ state: 'attached' }).catch(() => {});
  return page.evaluate(() => [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')].filter((h) => !h.closest('[aria-hidden="true"]')).map((h) => h.textContent));
};
const h1s = async (page) => (await h1texts(page)).length;
const unlabeledInputs = (page) => page.evaluate(() => [...document.querySelectorAll('input, textarea')].filter((e) => !e.closest('[aria-hidden="true"]') && !(e.getAttribute('aria-label') || '').trim()).length);
async function signIn(page, next = '/account') {
  await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await fill(page, 'Email', USER.email); await fill(page, 'Password', GOOD_PW);
  await button(page, 'Sign in').click();
}
const acceptAttestation = (page) => page.getByRole('checkbox', { name: /not inside a private home/ }).click();

try {
  // 1. Sign-in: failures keep the form, double taps send once, network failure recovers
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/auth/sign-in?next=%2Faccount`);
    check((await h1s(page)) === 1 && (await unlabeledInputs(page)) === 0, 'sign-in has one h1 and every input is labeled', `${JSON.stringify(await h1texts(page))} ${await unlabeledInputs(page)}`);
    await fill(page, 'Email', USER.email); await fill(page, 'Password', 'wrong password!!');
    await button(page, 'Sign in').click();
    check(await alerted(page, /Email or password is incorrect/), 'a wrong password is announced as an alert');
    check((await page.getByLabel('Email', { exact: true }).inputValue()) === USER.email, 'the email survives a failed sign-in');
    netFail = true;
    await fill(page, 'Password', GOOD_PW);
    const before = acct.logins;
    await button(page, 'Sign in').click();
    check(await alerted(page, /reach|wrong|connection/i), 'a network failure is explained and announced', JSON.stringify(await alerts(page)));
    check((await page.getByLabel('Email', { exact: true }).inputValue()) === USER.email && (await button(page, 'Sign in').isEnabled()), 'the form is kept and re-enabled after a network failure');
    netFail = false; delay = 400;
    const base2 = acct.logins;
    await doubleActivate(page, 'Sign in');
    check(await text(page, 'Your account'), 'sign-in succeeds once the network recovers and lands on the requested page');
    check(acct.logins === base2 + 1, 'a same-tick double activation sends exactly one sign-in', `${acct.logins - base2}`);
    delay = 0;
    check(before >= 1, 'sanity: earlier attempts were counted');
    await ctx.close();
  }


  // 1b. Show/Hide Password on the real sign-in form: masked by default, text kept, no submit/network, keyboard, not persisted
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/auth/sign-in?next=%2Faccount`);
    const field = page.getByLabel('Password', { exact: true });
    const typeOf = () => field.evaluate((e) => e.type);
    const PW = 'p4ss w0rd & more!';
    await fill(page, 'Email', USER.email); await fill(page, 'Password', PW);
    check((await typeOf()) === 'password' && (await button(page, 'Show password').count()) === 1 && (await button(page, 'Hide password').count()) === 0, 'password: masked by default with a "Show password" button');
    const loginsBefore = acct.logins; const urlBefore = page.url();
    await button(page, 'Show password').click();
    check((await typeOf()) === 'text' && (await field.inputValue()) === PW && (await button(page, 'Hide password').count()) === 1 && (await button(page, 'Show password').count()) === 0, 'password: Show reveals the exact typed text and the action becomes "Hide password"');
    await button(page, 'Hide password').click();
    check((await typeOf()) === 'password' && (await field.inputValue()) === PW && (await button(page, 'Show password').count()) === 1, 'password: Hide re-masks and the text is unchanged after the round trip');
    await field.focus(); await page.keyboard.press('End');
    await page.keyboard.type('X');
    check((await field.inputValue()) === `${PW}X`, 'password: editing after a toggle keeps appending to the same text');
    await fill(page, 'Password', PW);
    check(acct.logins === loginsBefore && page.url() === urlBefore && (await alerts(page)).length === 0, 'password: toggling never submits, never calls the network and shows no error', `${acct.logins - loginsBefore} ${page.url()}`);
    // accessible name/role: the visible text is the name; neither control exposes the password
    const aria = await page.evaluate(() => [...document.querySelectorAll('input[type="password"], input[type="text"], [role="button"]')].map((e) => `${e.getAttribute('aria-label') || ''}|${e.getAttribute('aria-describedby') || ''}|${e.getAttribute('aria-pressed') || ''}`).join('\n'));
    check(!aria.includes('p4ss') && !aria.includes('w0rd'), 'password: the typed password appears in no accessible name, description or state');
    const toggle = button(page, 'Show password');
    const box = await toggle.boundingBox();
    check(box && box.height >= 44, `password: the toggle is a real button with a target at least 44 px tall (${box?.height})`);
    // keyboard: Tab from the field reaches the toggle, with a visible focus ring; Space and Enter both toggle
    await field.focus(); await page.keyboard.press('Tab');
    const focusedName = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent);
    const ring = await page.evaluate(() => { const e = document.activeElement; const c = e ? getComputedStyle(e) : null; return !!c && ((c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0) || c.boxShadow !== 'none'); });
    check(focusedName === 'Show password' && ring, 'password: Tab from the field reaches the toggle and it shows a visible focus ring', `${focusedName} ring ${ring}`);
    await page.keyboard.press('Enter');
    check((await typeOf()) === 'text', 'password: Enter on the focused toggle shows the password');
    await page.keyboard.press('Space');
    check((await typeOf()) === 'password', 'password: Space on the focused toggle hides it again');
    // a rejected login keeps the text, and Enter in the field still signs in
    await fill(page, 'Password', 'wrong password!!');
    await button(page, 'Show password').click();
    await field.press('Enter');
    check(await alerted(page, /Email or password is incorrect/) && (await field.inputValue()) === 'wrong password!!', 'password: Enter in the field still signs in; a rejected login recovers with the entered text unchanged (shown state kept)');
    check((await page.getByLabel('Email', { exact: true }).inputValue()) === USER.email, 'password: the email also survives that rejected login');
    // not persisted: visibility never survives leaving the screen
    await page.goto(`${base}/auth/sign-in`);
    check((await page.getByLabel('Password', { exact: true }).evaluate((e) => e.type)) === 'password', 'password: a fresh visit to the screen is masked again (visibility is never persisted)');
    // sign-up mode has the same control and a hint that still reads
    await button(page, 'New here? Create an account').click();
    check((await button(page, 'Show password').count()) === 1 && (await text(page, 'At least 8 characters')), 'password: the sign-up form has the same control and keeps its hint');
    await page.screenshot({ path: join(SHOTS, 'narrow-password-toggle.png'), fullPage: true });
    // the successful login still works with the field revealed
    await page.goto(`${base}/auth/sign-in?next=%2Faccount`);
    await fill(page, 'Email', USER.email); await fill(page, 'Password', GOOD_PW);
    await button(page, 'Show password').click();
    await button(page, 'Sign in').click();
    check(await text(page, 'Your account'), 'password: a correct login succeeds while the password is shown');
    await ctx.close();
  }

  // 2. Sign-up and reset
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/auth/sign-in`);
    await button(page, 'New here? Create an account').click();
    check(await text(page, 'Create account') && (await h1s(page)) === 1, 'the sign-up mode has one h1');
    await fill(page, 'Email', 'new.person@test.dev'); await fill(page, 'Password', 'short');
    await button(page, 'Create account').click();
    check(await alerted(page, /Use at least 8 characters/) && acct.signups === 0, 'a weak password is rejected before any request');
    await fill(page, 'Password', 'a long passphrase here');
    delay = 300;
    await doubleActivate(page, 'Create account');
    check(await text(page, 'we sent a confirmation link'), 'sign-up asks the user to confirm by email');
    check(acct.signups === 1, 'a same-tick double activation sends exactly one sign-up', `${acct.signups}`);
    delay = 0;
    await fill(page, 'Email', 'anyone@test.dev'); await button(page, 'Forgot password?').click();
    check(await text(page, 'If that email has an account, we sent a reset link.') && acct.resets === 1, 'reset never reveals whether the account exists');
    await page.screenshot({ path: join(SHOTS, 'narrow-1-sign-in-notice.png'), fullPage: true });
    await page.goto(`${base}/auth/reset`);
    check(await text(page, 'Open the reset link from your email'), 'the reset screen explains how to get here without a link');
    await ctx.close();
  }

  // 3. Safe return destinations
  {
    for (const [next, name] of [['//evil.example.com', 'a protocol-relative'], ['https://evil.example.com/x', 'an absolute'], ['/auth/sign-in', 'an auth-loop']]) {
      const { ctx, page } = await newPage();
      await signIn(page, next);
      await page.waitForURL((u) => !u.pathname.startsWith('/auth/'), { timeout: 15000 }).catch(() => {});
      check(new URL(page.url()).origin === base && !page.url().includes('evil'), `${name} next parameter never leaves the app`, page.url());
      await ctx.close();
    }
    const { ctx, page } = await newPage();
    await signIn(page, '/favorites');
    check(await text(page, 'No favorites yet.') && new URL(page.url()).pathname === '/favorites', 'a safe next path is honored');
    await ctx.close();
  }

  // 4. Favorites: empty, error + retry, full
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/favorites');
    check(await text(page, 'No favorites yet.'), 'an empty Favorites list explains what to do');
    check((await button(page, 'Find nearby restrooms').count()) === 1 && (await h1s(page)) === 1, 'the empty state offers a way back and the page has one h1', JSON.stringify(await h1texts(page)));
    inject = { status: 500, body: { message: 'boom' }, times: 1 };
    await page.reload();
    check(await text(page, 'We couldn’t load your favorites.') && (await alerts(page)).length >= 1, 'a load failure is announced and explained');
    await button(page, 'Try again').click({ timeout: 4000 }).catch(() => {}); // the list may already have reloaded itself
    check(await text(page, 'No favorites yet.'), 'Try again recovers');
    acct.favorites = [LOC_ROW, mkRow('3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d22', 'Second Restroom'), mkRow('3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d23', 'Third Restroom'), mkRow('3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d24', 'Fourth Restroom'), mkRow('3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d25', 'Fifth Restroom')];
    await page.reload();
    check(await text(page, '5 of 5 saved') && await text(page, 'Your favorites are full.'), 'a full list says so and how to make room');
    await page.screenshot({ path: join(SHOTS, 'narrow-2-favorites-full.png'), fullPage: true });
    await page.getByRole('link', { name: /Mock Park Restroom/ }).first().click();
    check(await text(page, 'Remove from favorites') && page.url().includes('/location/'), 'a favorite opens its detail with a remove action');
    acct.favorites = [];
    // if saved-state cannot be checked, saving is paused and explained (not silently disabled), with a way to retry
    inject = { status: 500, body: { message: 'boom' }, times: 999 }; // sticky: the screen may fetch more than once while the session settles
    await page.goto(`${base}/location/${LOC}`);
    check(await text(page, 'We couldn’t check your favorites'), 'a failed saved-state check is explained');
    check(await button(page, 'Save to favorites').isDisabled(), 'saving is paused while the saved state is unknown');
    inject = null;
    await button(page, 'Check again').click();
    await button(page, 'Save to favorites').waitFor({ state: 'visible' });
    check(await page.waitForFunction(() => { const b = [...document.querySelectorAll('[role="button"]')].find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim() === 'Save to favorites'); return b && b.getAttribute('aria-disabled') !== 'true'; }).then(() => true, () => false), 'Check again re-enables saving');
    // adding at the cap shows the server-side cap message, not a generic failure
    await page.goto(`${base}/location/${LOC}`);
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('[role="button"]')].find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim() === 'Save to favorites'); return b && b.getAttribute('aria-disabled') !== 'true'; }); // wait for the saved-state check before injecting a write error
    inject = { status: 400, body: { code: '53400', message: 'too many favorites' }, times: 1 };
    await button(page, 'Save to favorites').click();
    check(await alerted(page, /up to 5 favorites/), 'the favorites cap shows its own message');
    check(acct.favorites.length === 0 && (await button(page, 'Save to favorites').isEnabled()), 'a refused save changes nothing and can be retried');
    await ctx.close();
  }

  // 5. Settings and display name
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/settings');
    check(await text(page, 'Display name'), 'settings loads signed in');
    check((await h1s(page)) === 1 && (await unlabeledInputs(page)) === 0, 'settings has one h1 and labeled inputs');
    await page.getByRole('radio', { name: 'Risqué', exact: true }).click();
    check(await text(page, 'Saved.'), 'a preference change is confirmed');
    await fill(page, 'Display name (optional)', 'Admin Joe');
    await button(page, 'Save display name').click();
    check(await text(page, 'That name isn’t allowed'), 'a reserved name is rejected');
    const field = page.getByLabel('Display name (optional)', { exact: true });
    check((await field.getAttribute('aria-invalid')) === 'true' && (await field.inputValue()) === 'Admin Joe', 'the field is marked invalid and keeps the typed value');
    await fill(page, 'Display name (optional)', 'Trail Walker');
    inject = { status: 500, body: { message: 'boom' }, times: 1 };
    await button(page, 'Save display name').click();
    check(await alerted(page, /./) && acct.name !== 'Trail Walker', 'a failed save is announced and nothing is stored');
    check((await field.inputValue()) === 'Trail Walker', 'the typed name survives the failure');
    const w = acct.profileWrites; delay = 400;
    await doubleActivate(page, 'Save display name');
    check(await text(page, 'Saved.') && acct.name === 'Trail Walker', 'the name saves once the server recovers');
    check(acct.profileWrites === w + 1, 'a same-tick double activation writes the profile once', `${acct.profileWrites - w}`);
    delay = 0;
    await ctx.close();
  }

  // 6. Contribution: new restroom
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/contribute');
    check(await text(page, 'Stand at the restroom to add it'), 'the new-restroom form explains it is added where you stand');
    check((await h1s(page)) === 1 && (await unlabeledInputs(page)) === 0, 'the form has one h1 and every input is labeled');
    const sections = await page.locator('[role="heading"][aria-level="2"]').allInnerTexts();
    check(['About the place', 'Access and facilities', 'Location', 'Before you send'].every((t) => sections.includes(t)), 'the form is grouped into labeled sections', JSON.stringify(sections));
    await page.screenshot({ path: join(SHOTS, 'narrow-3-contribute.png'), fullPage: true });
    await button(page, 'Add restroom at my current location').click();
    check(await text(page, 'Enter the name.') && acct.submissions.length === 0, 'the form asks for a name before sending anything');
    await fill(page, 'Name of the place', 'Library restroom');
    await acceptAttestation(page);
    // server refusals keep the form and are explained
    for (const [inj, re] of [
      [{ status: 400, body: { code: '53400', message: 'too many pending' }, times: 1 }, /too many pending submissions/],
      [{ status: 429, body: { code: '54000', message: 'rate limit' }, times: 1 }, /doing that a lot/],
    ]) {
      inject = inj;
      await button(page, 'Add restroom at my current location').click();
      check(await alerted(page, re) && acct.submissions.length === 0, `a ${inj.body.message} refusal is explained and nothing is stored`);
      check((await page.getByLabel('Name of the place', { exact: true }).inputValue()) === 'Library restroom' && (await page.getByRole('checkbox', { name: /not inside a private home/ }).getAttribute('aria-checked')) === 'true', 'the typed name and attestation survive the refusal');
    }
    delay = 400;
    await doubleActivate(page, 'Add restroom at my current location');
    check(await text(page, 'sent for review'), 'a valid current-location submission is sent for review');
    check(acct.submissions.length === 1, 'a same-tick double activation sends exactly one proposal', `${acct.submissions.length}`);
    delay = 0;
    const sub = acct.submissions[0];
    check(sub.p_attested === true && Math.abs(sub.p_lat - HERE.latitude) < 1e-6 && Math.abs(sub.p_lng - HERE.longitude) < 1e-6 && sub.p_accuracy_m > 0 && sub.p_accuracy_m <= 50, 'the proposal carries the device fix and accuracy', JSON.stringify(sub));
    check(!('latitude' in sub.p_proposed) && !('longitude' in sub.p_proposed), 'the free-form payload carries no coordinates');
    check((await button(page, 'Back to nearby restrooms').count()) === 1, 'the success state offers a way back');
    await page.screenshot({ path: join(SHOTS, 'narrow-4-contribute-sent.png'), fullPage: true });
    await ctx.close();
  }

  // 6b. New restroom needs a good current fix: no position can be chosen
  {
    const { ctx, page } = await newPage({ geolocation: null });
    await signIn(page, '/contribute');
    await fill(page, 'Name of the place', 'Trailhead');
    await acceptAttestation(page);
    await page.evaluate(() => {
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: (_ok, fail) => fail({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1 }) });
      Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: async () => ({ state: 'denied', addEventListener() {}, removeEventListener() {} }) });
    });
    const n = acct.submissions.length;
    await button(page, 'Add restroom at my current location').click();
    check((await alerted(page, /./)) && acct.submissions.length === n, 'without location access the new restroom is refused and nothing is sent');
    check((await page.getByLabel(/latitude|longitude/i).count()) === 0 && !(await page.locator('body').innerText()).includes('Choose the location on the map'), 'there is no way to type or pick a position');
    await ctx.close();
  }

  // 6c. Lost responses: the server RECORDED the write but the answer never arrived. The UI must not claim otherwise.
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/contribute');
    await fill(page, 'Name of the place', 'Lost-response restroom');
    await acceptAttestation(page);
    const n0 = acct.submissions.length;
    const req0 = count('/submit_location');
    lose = { fn: 'submit_location', times: 1 };
    await button(page, 'Add restroom at my current location').click();
    check(await alerted(page, /couldn’t confirm whether your restroom was sent for review/), 'a lost response says the outcome is unconfirmed', JSON.stringify(await alerts(page)));
    check(acct.submissions.length === n0 + 1, 'the mock really did record the submission (so "nothing was sent" would have been false)');
    const body = await page.locator('body').innerText();
    check(!/nothing was sent|wasn’t sent|not sent/i.test(body), 'the page never claims that nothing was sent');
    check(/Not confirmed/.test(body) && /never resend automatically/.test(body), 'the notice is labeled "Not confirmed" and says nothing is resent automatically');
    await page.waitForTimeout(1500);
    check(count('/submit_location') === req0 + 1, 'exactly one request was made: no automatic retry', `${count('/submit_location') - req0}`);
    check((await page.getByLabel('Name of the place', { exact: true }).inputValue()) === 'Lost-response restroom' && (await page.getByRole('checkbox', { name: /not inside a private home/ }).getAttribute('aria-checked')) === 'true', 'the typed answers and attestation are kept');
    check(await button(page, 'Add restroom at my current location').isEnabled(), 'the user can decide to try again');
    await page.screenshot({ path: join(SHOTS, 'narrow-5-uncertain-outcome.png'), fullPage: true });
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ geolocation: null });
    await signIn(page, `/contribute?id=${LOC}&name=Mock%20Park%20Restroom`);
    await page.getByRole('radiogroup', { name: 'Need a key or code?' }).getByRole('radio', { name: 'No', exact: true }).click();
    await acceptAttestation(page);
    const e0 = acct.edits.length; const req0 = count('/submit_location_edit');
    lose = { fn: 'submit_location_edit', times: 1 };
    await button(page, 'Send suggestion').click();
    check(await alerted(page, /couldn’t confirm whether your suggestion was sent for review/) && acct.edits.length === e0 + 1, 'a lost correction response is reported as unconfirmed (it was in fact recorded)');
    await page.waitForTimeout(1200);
    check(count('/submit_location_edit') === req0 + 1 && !/nothing was sent/i.test(await page.locator('body').innerText()), 'no automatic retry and no false "nothing was sent" for corrections');
    await ctx.close();
  }

  // 6d. Unknown and transport error codes are never treated as "nothing happened"; contract rejections still are
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/contribute');
    await fill(page, 'Name of the place', 'Code-test restroom');
    await acceptAttestation(page);
    const n0 = acct.submissions.length;
    for (const [code, status] of [['ECONNRESET', 502], ['XX000', 500], ['SOMETHING_NEW', 400]]) {
      inject = { status, body: { code, message: 'x' }, times: 1 };
      await button(page, 'Add restroom at my current location').click();
      check(await alerted(page, /couldn’t confirm whether your restroom was sent for review/) && acct.submissions.length === n0, `error code ${code} is treated as an unconfirmed outcome`);
    }
    inject = { status: 400, body: { code: '53400', message: 'too many pending submissions' }, times: 1 };
    await button(page, 'Add restroom at my current location').click();
    check(await alerted(page, /too many pending submissions/) && !(await page.locator('body').innerText()).includes('couldn’t confirm whether your restroom'), 'a contract cap rejection (53400) is still a specific, confirmed refusal');
    await ctx.close();
  }

  // 7. Contribution: correction needs no location, failure preserved
  {
    const { ctx, page } = await newPage({ geolocation: null });
    await signIn(page, `/contribute?id=${LOC}&name=Mock%20Park%20Restroom`);
    check(await text(page, 'Only fill in what should change for Mock Park Restroom'), 'the correction form names the restroom');
    await page.getByRole('radiogroup', { name: 'Need a key or code?' }).getByRole('radio', { name: 'Yes', exact: true }).click();
    await acceptAttestation(page);
    const base7 = acct.edits.length;
    inject = { status: 400, body: { code: '22023', message: 'you already have a pending correction for this restroom' }, times: 1 };
    await button(page, 'Send suggestion').click();
    check(await alerted(page, /already have a correction waiting/) && acct.edits.length === base7, 'an existing pending correction is explained');
    check((await page.getByRole('radiogroup', { name: 'Need a key or code?' }).getByRole('radio', { name: 'Yes', exact: true }).getAttribute('aria-checked')) === 'true', 'the chosen answers survive the refusal');
    delay = 400;
    await doubleActivate(page, 'Send suggestion');
    check(await text(page, 'sent for review'), 'a correction is sent without any location access');
    check(acct.edits.length === base7 + 1, 'a same-tick double activation sends exactly one correction', `${acct.edits.length - base7}`);
    delay = 0;
    check(acct.edits.every((e) => !('p_lat' in e) && !('p_lng' in e)), 'a correction carries no position by default');
    check((await button(page, 'Back to the restroom').count()) === 1, 'the correction success state links back to the restroom');
    await ctx.close();
  }

  // 8. Account: delete, failure first
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/account');
    check(await text(page, 'Signed in as user@test.dev') && (await h1s(page)) === 1, 'the account page shows the signed-in email and one h1');
    await button(page, 'Delete my account…').click();
    check(await button(page, 'Permanently delete my account').isDisabled(), 'delete stays disabled until DELETE is typed');
    await fill(page, 'Type DELETE to confirm', 'DELETE');
    inject = { status: 500, body: { message: 'boom' }, times: 1 };
    await button(page, 'Permanently delete my account').click();
    check((await alerted(page, /./)) && !acct.deleted, 'a failed deletion is announced and the account stays');
    check(await text(page, 'Signed in as user@test.dev'), 'the user is still signed in after a failed deletion');
    delay = 400;
    await doubleActivate(page, 'Permanently delete my account');
    check(await text(page, 'Your account was deleted.'), 'a successful deletion is confirmed');
    check(acct.deleteCalls === 1, 'a same-tick double activation deletes once', `${acct.deleteCalls}`);
    delay = 0;
    check(await text(page, 'Sign in or create account'), 'the user is signed out afterwards');
    await ctx.close();
  }

  // 8b. Account deletion with an unknown outcome, and a confirmed deletion followed by a local sign-out failure
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/account');
    await button(page, 'Delete my account…').click();
    await fill(page, 'Type DELETE to confirm', 'DELETE');
    const d0 = acct.deleteCalls;
    lose = { fn: 'delete_my_account', times: 1 };
    await button(page, 'Permanently delete my account').click();
    check(await alerted(page, /couldn’t confirm whether your account was deleted/), 'a lost deletion response is reported as unconfirmed');
    check(acct.deleted && acct.deleteCalls === d0 + 1, 'the mock really did delete the account');
    await page.waitForTimeout(1200);
    const bodyText = await page.locator('body').innerText();
    check(acct.deleteCalls === d0 + 1 && !/nothing was deleted|wasn’t deleted/i.test(bodyText), 'no automatic retry and no claim that nothing was deleted');
    check(/Signed in as user@test\.dev/.test(bodyText) && (await button(page, 'Sign out').count()) === 1, 'the user keeps a way to sign out and check');
    check(/can’t tell us on its own/.test(bodyText) && !/if not,? it was deleted|account is gone|has been deleted/i.test(bodyText), 'the message does not conclude deletion from a failed sign-in');
    // the user signs out and tries to sign back in, but the network is down: still no claim that the account was deleted
    await button(page, 'Sign out').click();
    await page.goto(`${base}/auth/sign-in?next=%2Faccount`);
    await fill(page, 'Email', USER.email); await fill(page, 'Password', GOOD_PW);
    netFail = true;
    await button(page, 'Sign in').click();
    check(await alerted(page, /reach|wrong|connection/i), 'a sign-in that fails because of the network says so');
    const after = await page.locator('body').innerText();
    check(!/was deleted|has been deleted|account is gone|no longer exists|doesn’t exist/i.test(after), 'a failed sign-in never asserts that the account was deleted', after.slice(0, 300));
    netFail = false;
    await ctx.close();
  }
  {
    acct.deleted = false; acct.deleteCalls = 0;
    const { ctx, page } = await newPage();
    await signIn(page, '/account');
    await button(page, 'Delete my account…').click();
    await fill(page, 'Type DELETE to confirm', 'DELETE');
    // make clearing the local session fail (storage refuses removals), as a device-level problem would
    await page.evaluate(() => { window.__failRemove = true; const orig = Storage.prototype.removeItem; Storage.prototype.removeItem = function (k) { if (window.__failRemove) throw new Error('storage unavailable'); return orig.call(this, k); }; });
    await button(page, 'Permanently delete my account').click();
    check(await text(page, 'Your account was deleted.') && acct.deleteCalls === 1, 'a confirmed deletion stays confirmed even if clearing the local session fails');
    check(await text(page, 'This device is still signed in'), 'the local clean-up problem is explained separately');
    const t = await page.locator('body').innerText();
    check(!/nothing was deleted|couldn’t confirm whether your account/i.test(t), 'no false "nothing was deleted" or "unconfirmed" message after a confirmed deletion');
    check((await button(page, 'Delete my account…').count()) === 0, 'the delete action is gone once the deletion is confirmed');
    await page.screenshot({ path: join(SHOTS, 'narrow-6-deleted-cleanup.png'), fullPage: true });
    await page.evaluate(() => { window.__failRemove = false; });
    await button(page, 'Sign out of this device').click();
    check(await text(page, 'Sign in or create account') && acct.deleteCalls === 1, 'retrying the local sign-out finishes the job without another deletion request');
    await ctx.close();
  }

  // 9. Wide layout keeps forms readable
  {
    const { ctx, page } = await newPage({ width: 1280, height: 900 });
    await signIn(page, '/contribute');
    await text(page, 'Stand at the restroom to add it');
    const box = await page.getByLabel('Name of the place', { exact: true }).boundingBox();
    check(box && box.width <= 640, 'forms stay in a readable column on wide screens', JSON.stringify(box));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, 'no horizontal scroll on wide screens');
    await page.screenshot({ path: join(SHOTS, 'wide-1-contribute.png') });
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage({ width: 320, height: 700 });
    await signIn(page, '/contribute');
    await text(page, 'Stand at the restroom to add it');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, 'no horizontal scroll at 320 px on the longest form', `${overflow}px`);
    await ctx.close();
  }

  // 10. Privacy and boundaries
  {
    const pub = requests.filter((r) => r.path.endsWith('/get_public_location') || r.path.endsWith('/nearby_locations'));
    check(pub.every((r) => r.auth !== `Bearer ${JWT}`), 'public reads never carry the user token');
    const favs = requests.filter((r) => r.path.endsWith('/list_my_favorites'));
    check(favs.length > 0 && favs.every((r) => r.body.p_lat === null && r.body.p_lng === null), 'favorites requests never carry coordinates');
    check(external.length === 0, 'the app made no request outside the local mock', external.slice(0, 3).join(', '));
  }
} catch (e) {
  console.error('E2E error:', e);
  failures++;
} finally {
  await browser.close();
  mock.close();
  app.close();
}
console.log(`\n${passed} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
