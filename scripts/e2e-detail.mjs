#!/usr/bin/env node
// Real-browser test of the restroom detail + evidence/reporting experience (R2) against LOCAL MOCKS of the
// auth and REST backends. Builds the actual Expo web export and drives it with Playwright (headless Chromium).
// Covers: rich vs sparse (unknown-fact, unverified, unrated) restrooms, narrow and wide layouts, load/missing/error
// recovery, the signed-out boundary and sign-in return, rating/observation/report flows with validation, server
// failures, auth failures and double-tap protection. Contacts no real service: every non-local request is aborted.
// Writes screenshots to docs/evidence/r2/.
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK_PORT = 54499;
const ANON = 'mock-anon-key-not-real';
const SHOTS = join(root, 'docs/evidence/r2');
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
const RICH = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d11';
const SPARSE = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d12';
const BROKEN = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d13';
const GONE = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d14';
const base_row = { address_line: null, city: 'Cody', region: 'WY', postal_code: null, latitude: 44.5273, longitude: -109.0565, last_verified_at: null, opening_hours: null,
  fee_required: null, key_required: null, purchase_required: null, wheelchair_accessible: null, gender_neutral: null, baby_changing: null, has_hot_water: null,
  has_cold_water: null, access_location: null, average_rating: null, rating_count: 0, attribution: null, distance_m: null };
const ROWS = {
  [RICH]: { ...base_row, id: RICH, name: 'Cody Library Restroom', address_line: '1 Library Way', verification: 'verified', last_verified_at: '2026-09-01T00:00:00Z',
    key_required: false, purchase_required: false, wheelchair_accessible: true, baby_changing: false, has_hot_water: true, opening_hours: 'Mo-Su 06:00-22:00',
    access_location: 'Behind the main desk', average_rating: 4.5, rating_count: 12, attribution: 'Data © OpenStreetMap contributors' },
  [SPARSE]: { ...base_row, id: SPARSE, name: 'Park Pavilion Restroom', verification: 'unverified' },
};
const acct = { reviews: 0, reports: [], favoritesAdds: 0, favorite: false, review: null, checkins: 0 };
let fail = 'none'; // none | server | auth  (applies to write functions)
let delay = 0;
let lose = null; // { fn, times }: the mutation IS recorded, but the response is lost (socket destroyed)
const requests = [];
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const cors = { connection: 'close', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  const data = body ? JSON.parse(body) : {};
  const json = (status, obj, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', ...cors, ...extra }); res.end(JSON.stringify(obj)); };
  requests.push({ path: u.pathname, auth: req.headers.authorization ?? null, body: data });
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') return data.email === USER.email && data.password === GOOD_PW ? json(200, session()) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  if (u.pathname === '/auth/v1/token') return json(200, session());
  if (u.pathname === '/auth/v1/user') return json(200, USER);
  if (u.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/rest/v1/rpc/nearby_locations' || u.pathname === '/rest/v1/rpc/nearest_verified_location') return json(200, []);
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = u.pathname.slice('/rest/v1/rpc/'.length);
    if (fn === 'get_public_location') {
      if (data.p_id === BROKEN) return json(500, { message: 'boom' });
      return json(200, ROWS[data.p_id] ? [ROWS[data.p_id]] : []);
    }
    if (req.headers.authorization !== `Bearer ${JWT}`) return json(401, { code: '28000', message: 'not authenticated' });
    if (delay) await new Promise((r) => setTimeout(r, delay));
    const write = ['add_favorite', 'remove_favorite', 'submit_review', 'delete_my_review', 'submit_report', 'check_in'].includes(fn);
    if (write && fail === 'server') return json(500, { message: 'internal error' });
    if (write && fail === 'auth') return json(401, { code: 'PGRST301', message: 'JWT expired' });
    const lost = lose && lose.fn === fn && lose.times > 0 && (lose.times--, true);
    const reply = lost ? () => req.socket.destroy() : json;
    if (fn === 'list_my_favorites') return reply(200, acct.favorite ? [ROWS[RICH]] : []);
    if (fn === 'add_favorite') { acct.favoritesAdds++; acct.favorite = true; return reply(200, { added: true, count: 1, limit: 5 }); }
    if (fn === 'remove_favorite') { acct.favorite = false; return reply(200, null); }
    if (fn === 'get_my_review') return reply(200, acct.review);
    if (fn === 'submit_review') { acct.reviews++; acct.review = { rating: data.p_rating, mode: data.p_mode, observations: data.p_observations }; return reply(200, { rating: data.p_rating }); }
    if (fn === 'delete_my_review') { acct.review = null; return reply(200, null); }
    if (fn === 'submit_report') { acct.reports.push(data); return reply(200, null); }
    if (fn === 'check_in') { acct.checkins++; return reply(200, { checkin_id: 'c1' }); }
    if (fn === 'get_my_profile') return json(200, [{ display_name: null, preferred_mode: 'plain', default_transport: 'walk', points_balance: 0 }]);
  }
  return json(404, { msg: 'not mocked' });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- build + serve the web app
// E2E_DETAIL_REUSE_BUILD=<dir> reuses (and keeps) a previous export for quick local iteration; CI never sets it.
const reuse = process.env.E2E_DETAIL_REUSE_BUILD;
const out = reuse ?? mkdtempSync(join(tmpdir(), 'open-stall-detail-'));
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
const newPage = async ({ width = 390, height = 844 } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['geolocation'], geolocation: HERE });
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
const text = (page, t) => page.getByText(t, { exact: false }).first().waitFor({ state: 'visible' }).then(() => true, () => false);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const headings = (page) => page.locator('[role="heading"]').allInnerTexts();
/** Activates a button twice within one JS task, before React can re-render it as disabled. */
const doubleActivate = (page, name) => page.evaluate((n) => {
  const b = [...document.querySelectorAll('[role="button"]')].find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim() === n);
  if (!b) throw new Error(`no button ${n}`);
  b.click(); b.click();
}, name);
const count = (path) => requests.filter((r) => r.path.endsWith(path)).length;
async function signIn(page, next) {
  await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email', { exact: true }).fill(USER.email);
  await page.getByLabel('Password', { exact: true }).fill(GOOD_PW);
  await button(page, 'Sign in').click();
}

try {
  // 1. Rich restroom, phone width, signed out
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/location/${RICH}`);
    check(await text(page, 'Cody Library Restroom'), 'detail loads signed out');
    check((await page.locator('[role="heading"][aria-level="1"]').count()) === 1, 'detail has exactly one level-1 heading');
    const h = await headings(page);
    const order = ['Get there', 'Access', 'Amenities', 'About these details', 'Save, rate and check in', 'Something wrong?'];
    check(JSON.stringify(h.filter((x) => order.includes(x))) === JSON.stringify(order), 'sections follow the reading order: get there, facts, provenance, actions', JSON.stringify(h));
    check(await text(page, 'Verified Sep 2026'), 'the verified badge shows text and date');
    check(await text(page, 'Community rating 4.5 / 5 (12 ratings)'), 'the rating is labeled as a community rating with its count');
    check(await text(page, 'No key needed') && await text(page, 'No purchase needed'), 'known access facts are summarized up top');
    check((await page.getByText('Fee to use', { exact: true }).count()) === 1, 'the quick summary never lists an unknown fee');
    const fee = page.getByLabel('Fee to use: Not reported', { exact: true });
    check((await fee.count()) === 1 && (await fee.innerText()).includes('? Not reported'), 'an unknown fee reads "? Not reported", not "No"');
    check((await page.getByLabel('Baby changing: No', { exact: true }).innerText()).includes('✕ No'), 'a known "No" reads "✕ No"');
    check((await page.getByLabel('Wheelchair accessible: Yes', { exact: true }).innerText()).includes('✓ Yes'), 'a known "Yes" reads "✓ Yes"');
    check(await text(page, 'Mo-Su 06:00-22:00 (from public sources, may be inaccurate)'), 'hours carry the public-source caveat');
    check(await text(page, 'Where: Behind the main desk'), 'the access location note is shown');
    check((await page.getByRole('list', { name: 'Access facts' }).getByRole('listitem').count()) === 6, 'facts are a real list (5 facts + hours)');
    check(await text(page, 'Data © OpenStreetMap contributors'), 'source attribution is shown');
    check(await text(page, 'Ratings come from signed-in community members'), 'the page explains that ratings are separate from verification');
    check(!(await page.locator('body').innerText()).includes('Offline:'), 'no offline banner when online');
    await page.screenshot({ path: join(SHOTS, 'narrow-1-detail-rich.png'), fullPage: true });
    // a 320 px reflow check
    await page.setViewportSize({ width: 320, height: 700 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, 'no horizontal scroll at 320 px', `overflow ${overflow}px`);
    await ctx.close();
  }

  // 2. Sparse, unverified, unrated restroom: nothing is invented
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/location/${SPARSE}`);
    check(await text(page, 'Park Pavilion Restroom'), 'sparse detail loads');
    check(await text(page, 'Unverified restroom'), 'unverified restrooms carry a visible banner');
    check(await text(page, 'hasn’t confirmed this restroom yet'), 'the banner explains what unverified means');
    check(await text(page, 'No community ratings yet'), 'unrated says "No community ratings yet"');
    check(!/\b0(\.0)? ?\/ ?5\b/.test(await page.locator('body').innerText()), 'a missing rating is never shown as 0');
    check((await page.getByRole('list', { name: 'Quick facts' }).count()) === 0, 'no quick-facts row when nothing is known');
    const unknown = await page.getByText('? Not reported', { exact: true }).count();
    check(unknown >= 8, 'every unknown fact and the hours read "? Not reported"', `${unknown}`);
    check((await page.getByText('✕ No', { exact: true }).count()) === 0, 'no unknown fact is displayed as "No"');
    check(await text(page, 'Unverified: Open Stall has not confirmed this restroom yet.'), 'provenance states the unverified status');
    check(await text(page, 'Facts marked “Not reported” are unknown'), 'provenance explains unknown vs no');
    await page.screenshot({ path: join(SHOTS, 'narrow-2-detail-sparse.png'), fullPage: true });
    await ctx.close();
  }

  // 3. Wide layout: facts and actions side by side
  {
    const { ctx, page } = await newPage({ width: 1280, height: 900 });
    await page.goto(`${base}/location/${RICH}`);
    check(await text(page, 'Cody Library Restroom'), 'wide detail loads');
    const box = async (name) => page.getByRole('heading', { name, exact: true }).boundingBox();
    const access = await box('Access'); const nav = await box('Get there');
    check(access && nav && nav.x > access.x + 300, 'on wide screens the actions column sits beside the facts', JSON.stringify({ access, nav }));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, 'no horizontal scroll on wide screens');
    await page.screenshot({ path: join(SHOTS, 'wide-1-detail.png'), fullPage: true });
    await ctx.close();
  }

  // 4. Load states and recovery
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/location/${BROKEN}`);
    check(await text(page, 'We couldn’t load this restroom.'), 'a server failure explains itself');
    check((await page.getByRole('alert').count()) >= 1, 'the failure is announced as an alert');
    ROWS[BROKEN] = { ...ROWS[SPARSE], id: BROKEN, name: 'Recovered Restroom' };
    // make the mock succeed for BROKEN from now on
    const origPath = '/rest/v1/rpc/get_public_location';
    await page.route(`**${origPath}`, (route) => route.fulfill({ status: 200, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' }, body: JSON.stringify([ROWS[BROKEN]]) }));
    await button(page, 'Try again').click();
    check(await text(page, 'Recovered Restroom'), 'Try again recovers without leaving the page');
    await page.unroute(`**${origPath}`);
    await page.goto(`${base}/location/${GONE}`);
    check(await text(page, 'This restroom isn’t available.'), 'an unknown restroom says it is not available');
    await button(page, 'Find nearby restrooms').click();
    check(await text(page, 'Find the nearest restroom'), 'the missing-restroom state links back to discovery');
    await page.goto(`${base}/location/not-a-uuid`);
    check(await text(page, 'This restroom link isn’t valid.'), 'an invalid link is explained');
    check((await button(page, 'Find nearby restrooms').count()) === 1, 'the invalid-link state offers a way back');
    await ctx.close();
  }

  // 5. Signed-out boundary and sign-in return
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/location/${RICH}`);
    check(await text(page, 'Sign in to continue'), 'signed-out detail explains the sign-in requirement');
    check(await text(page, 'Finding restrooms never needs an account'), 'the explanation says discovery needs no account');
    check((await button(page, 'Save to favorites').count()) === 0 && (await button(page, 'Save rating').count()) === 0, 'rating and favorites are not offered signed out');
    await button(page, 'Report a problem').click();
    check(await text(page, 'Sign in to report a problem'), 'Report a problem explains the sign-in requirement when signed out');
    await button(page, 'Sign in or create account').click();
    check(page.url().includes('next=%2Freport%3Fid%3D' + RICH) || page.url().includes('next=/report?id=' + RICH), 'the report destination is carried through sign-in', page.url());
    await page.getByLabel('Email', { exact: true }).fill(USER.email);
    await page.getByLabel('Password', { exact: true }).fill(GOOD_PW);
    await button(page, 'Sign in').click();
    check(await text(page, 'What’s wrong with'), 'after sign-in the user lands on the report form for that restroom');
    check(page.url().includes('/report'), 'the report URL is preserved', page.url());
    await page.goto(`${base}/location/${RICH}`);
    await button(page, 'Suggest a correction').click();
    check(page.url().includes('/contribute') && page.url().includes(RICH), 'Suggest a correction opens the correction form for this restroom', page.url());
    await ctx.close();
  }

  // 6. Signed-in actions: validation, double tap, server and auth failures
  {
    const { ctx, page } = await newPage();
    await signIn(page, `/location/${RICH}`);
    check(await text(page, 'Save to favorites'), 'signing in returns to the restroom with actions unlocked');
    check((await page.getByText('Sign in to continue').count()) === 0, 'the sign-in banner goes away once signed in');

    await button(page, 'Save rating').click();
    check(await text(page, 'Choose a rating from 1 to 5.') && count('/submit_review') === 0, 'rating is validated before any request');
    check((await page.getByRole('alert').filter({ hasText: 'Choose a rating' }).count()) === 1, 'the validation message is announced');

    fail = 'server';
    await page.getByRole('radio', { name: '4 stars', exact: true }).click();
    await button(page, 'Save rating').click();
    check((await page.getByRole('alert').filter({ hasText: /./ }).first().waitFor({ state: 'visible' }).then(() => true, () => false)), 'a server failure on rating is announced');
    check(acct.reviews === 0 && (await button(page, 'Save rating').isEnabled()), 'a failed save writes nothing and can be retried');
    check((await page.getByText('Thanks. Your rating was saved.').count()) === 0, 'no success message after a failure');
    fail = 'auth';
    await button(page, 'Save rating').click();
    check((await page.getByRole('alert').first().waitFor({ state: 'visible' }).then(() => true, () => false)) && acct.reviews === 0, 'an expired session is reported and nothing is written');
    fail = 'none';

    delay = 500;
    await page.getByRole('checkbox', { name: 'Clean', exact: true }).click();
    await doubleActivate(page, 'Save rating');
    check(await text(page, 'Thanks. Your rating was saved.'), 'the rating saves once the server recovers');
    check(acct.reviews === 1, 'a same-tick double activation sends exactly one rating', `${acct.reviews}`);
    check(acct.review?.rating === 4 && acct.review.observations.join() === 'clean', 'the rating and observation are what the user picked');

    const before = acct.favoritesAdds;
    await doubleActivate(page, 'Save to favorites');
    check(await text(page, 'Saved to favorites.'), 'favorite saved');
    check(acct.favoritesAdds === before + 1, 'a same-tick double activation adds the favorite once', `${acct.favoritesAdds - before}`);
    delay = 0;
    await button(page, 'I’m here: check in').click();
    check(await text(page, 'Checked in. Thanks!') && acct.checkins === 1, 'check-in works with location granted');
    await page.screenshot({ path: join(SHOTS, 'narrow-3-detail-signed-in.png'), fullPage: true });
    await ctx.close();
  }

  // 6b. Lost responses: the server RECORDED the write but the answer never arrived
  {
    acct.favorite = false; acct.review = null;
    const { ctx, page } = await newPage();
    await signIn(page, `/location/${RICH}`);
    await text(page, 'Save to favorites');
    // rating
    await page.getByRole('radio', { name: '2 stars', exact: true }).click();
    const rev0 = acct.reviews; const rq0 = count('/submit_review');
    lose = { fn: 'submit_review', times: 1 };
    await page.getByRole('button', { name: /^(Save rating|Update my rating)$/ }).click();
    check(await page.getByRole('alert').filter({ hasText: /couldn’t confirm whether your rating was saved/ }).first().waitFor({ state: 'visible' }).then(() => true, () => false), 'a lost rating response is reported as unconfirmed');
    check(acct.reviews === rev0 + 1, 'the mock really did record the rating');
    await page.waitForTimeout(1200);
    check(count('/submit_review') === rq0 + 1, 'no automatic retry of the rating', `${count('/submit_review') - rq0}`);
    check((await page.getByText('Thanks. Your rating was saved.').count()) === 0 && !/nothing was saved/i.test(await page.locator('body').innerText()), 'no success claim and no "nothing was saved" claim');
    check((await page.getByRole('radio', { name: '2 stars', exact: true }).getAttribute('aria-checked')) === 'true', 'the chosen rating stays selected');
    // favorite
    const fq0 = count('/add_favorite');
    lose = { fn: 'add_favorite', times: 1 };
    await button(page, 'Save to favorites').click();
    check(await page.getByRole('alert').filter({ hasText: /couldn’t confirm whether your favorite was saved/ }).first().waitFor({ state: 'visible' }).then(() => true, () => false), 'a lost favorite response is reported as unconfirmed');
    await page.waitForTimeout(1200);
    check(count('/add_favorite') === fq0 + 1, 'no automatic retry of the favorite');
    await ctx.close();
  }

  // 7. Report flow
  {
    const { ctx, page } = await newPage();
    await signIn(page, `/report?id=${RICH}&name=Cody%20Library%20Restroom`);
    check(await text(page, 'What’s wrong with Cody Library Restroom?'), 'report names the restroom');
    check(await text(page, 'means permanently closed or removed'), 'report explains permanent closure vs temporary');
    await button(page, 'Send report').click();
    check(await text(page, 'Choose what’s wrong.') && acct.reports.length === 0, 'report needs an issue and sends nothing without one');
    const group = page.getByRole('radiogroup', { name: 'What’s wrong' });
    await group.getByRole('radio').first().focus();
    await page.keyboard.press('ArrowDown');
    check((await group.getByRole('radio', { name: 'It’s in the wrong place' }).getAttribute('aria-checked')) === 'true', 'arrow keys choose the report issue');
    await page.getByLabel('Add a note (optional)', { exact: true }).fill('see http://spam.example');
    await button(page, 'Send report').click();
    check(await text(page, 'links, email addresses or phone numbers') && acct.reports.length === 0, 'links in the note are rejected before sending');
    await page.getByLabel('Add a note (optional)', { exact: true }).fill('The pin is on the wrong side of the building');
    fail = 'server';
    await button(page, 'Send report').click();
    check((await page.getByRole('alert').first().waitFor({ state: 'visible' }).then(() => true, () => false)) && acct.reports.length === 0, 'a server failure keeps the form and sends nothing');
    check((await page.getByLabel('Add a note (optional)', { exact: true }).inputValue()).includes('wrong side'), 'the typed note survives a failed send');
    fail = 'none';
    const rep0 = acct.reports.length; const rpq0 = count('/submit_report');
    lose = { fn: 'submit_report', times: 1 };
    await button(page, 'Send report').click();
    check(await page.getByRole('alert').filter({ hasText: /couldn’t confirm whether your report was sent/ }).first().waitFor({ state: 'visible' }).then(() => true, () => false), 'a lost report response is reported as unconfirmed');
    check(acct.reports.length === rep0 + 1, 'the mock really did record the report');
    await page.waitForTimeout(1200);
    check(count('/submit_report') === rpq0 + 1 && !/nothing was sent|wasn’t sent/i.test(await page.locator('body').innerText()), 'no automatic retry and no false "nothing was sent" claim');
    check((await page.getByLabel('Add a note (optional)', { exact: true }).inputValue()).includes('wrong side'), 'the typed note survives an unconfirmed send');
    acct.reports.length = 0;
    fail = 'none'; delay = 400;
    await doubleActivate(page, 'Send report');
    check(await text(page, 'Thanks. A person will take a look.'), 'report succeeds after the failure');
    check(acct.reports.length === 1, 'a same-tick double activation sends exactly one report', `${acct.reports.length}`);
    check(acct.reports[0].p_issue === 'wrong_location', 'the report carries the chosen issue');
    delay = 0;
    await page.screenshot({ path: join(SHOTS, 'narrow-4-report-sent.png'), fullPage: true });
    await ctx.close();
  }

  // 8. Privacy and boundaries
  {
    const pub = requests.filter((r) => r.path.endsWith('/get_public_location'));
    check(pub.length > 0 && pub.every((r) => r.auth === `Bearer ${ANON}` || r.auth === null), 'public restroom reads never carry the user token');
    check(!requests.some((r) => r.path.endsWith('/get_public_location') && r.auth === `Bearer ${JWT}`), 'no public read used the signed-in session');
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
