#!/usr/bin/env node
// R4 integrated validation: ONE real-browser session matrix over the whole consumer app (discovery, detail,
// reporting, auth, favorites, settings, submissions, account) against LOCAL MOCKS of the auth and REST backends.
// Builds the actual Expo web export and drives headless Chromium. Verifies: an end-to-end journey with state kept
// across screens, an axe-core accessibility audit of every screen at phone and desktop widths, zoom reflow
// (200% / 400% equivalents), sticky-navigation overlap (every control must stay clickable), keyboard reachability and
// visible focus, focus after navigation, offline/recovery, map controls (touch target size, keyboard, attribution) and
// privacy/auth boundaries. Contacts no real service. Writes screenshots and axe-report.json to docs/evidence/r4/.
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK_PORT = 54699;
const ANON = 'mock-anon-key-not-real';
const SHOTS = join(root, 'docs/evidence/r4');
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
const id = (n) => `3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d${String(n).padStart(2, '0')}`;
const row = (o) => ({ id: o.id, name: o.name, address_line: o.address ?? null, city: 'Cody', region: 'WY', postal_code: null, latitude: o.lat, longitude: -109.0565,
  verification: o.verification, last_verified_at: o.verification === 'verified' ? '2026-09-01T00:00:00Z' : null, opening_hours: o.hours ?? null, fee_required: o.fee ?? null,
  key_required: o.key ?? null, purchase_required: o.purchase ?? null, wheelchair_accessible: o.wheelchair ?? null, gender_neutral: null, baby_changing: o.baby ?? null,
  has_hot_water: null, has_cold_water: null, access_location: o.where ?? null, average_rating: o.rating ?? null, rating_count: o.count ?? 0, attribution: o.attribution ?? null, distance_m: null });
const ROWS = [
  row({ id: id(11), name: 'Cody Library Restroom', address: '1 Library Way', lat: 44.5273, verification: 'verified', key: false, purchase: false, wheelchair: true, baby: false, hours: 'Mo-Su 06:00-22:00', where: 'Behind the main desk', rating: 4.5, count: 12, attribution: 'Data © OpenStreetMap contributors' }),
  row({ id: id(12), name: 'Park Pavilion Restroom', lat: 44.53, verification: 'unverified' }),
  row({ id: id(13), name: 'Corner Gas Station', address: '9 Main St', lat: 44.534, verification: 'verified', key: true, purchase: true, rating: 3, count: 4 }),
  row({ id: id(14), name: 'Far Trailhead Restroom', lat: 44.55, verification: 'unverified', wheelchair: true }),
];
const RICH = ROWS[0].id; const SPARSE = ROWS[1].id;
const acct = { favorites: [], review: null, reports: [], submissions: [], edits: [], mode: 'plain', transport: 'walk', name: null, reviews: 0, checkins: 0 };
const requests = [];
let apiDown = false;
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const cors = { connection: 'close', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  const data = body ? JSON.parse(body) : {};
  const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
  requests.push({ path: u.pathname, auth: req.headers.authorization ?? null, body: data });
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') return data.email === USER.email && data.password === GOOD_PW ? json(200, session()) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  if (u.pathname === '/auth/v1/token') return json(200, session());
  if (u.pathname === '/auth/v1/user') return json(200, USER);
  if (u.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = u.pathname.slice('/rest/v1/rpc/'.length);
    if (apiDown) return req.socket.destroy();
    if (fn === 'nearby_locations') return json(200, ROWS);
    if (fn === 'nearest_verified_location') return json(200, []);
    if (fn === 'get_public_location') return json(200, ROWS.filter((r) => r.id === data.p_id));
    if (req.headers.authorization !== `Bearer ${JWT}`) return json(401, { code: '28000', message: 'not authenticated' });
    if (fn === 'list_my_favorites') return json(200, acct.favorites);
    if (fn === 'add_favorite') { acct.favorites.push(ROWS.find((r) => r.id === data.p_location) ?? ROWS[0]); return json(200, { added: true, count: acct.favorites.length, limit: 5 }); }
    if (fn === 'remove_favorite') { acct.favorites = acct.favorites.filter((r) => r.id !== data.p_location); return json(200, null); }
    if (fn === 'get_my_review') return json(200, acct.review);
    if (fn === 'submit_review') { acct.reviews++; acct.review = { rating: data.p_rating, mode: data.p_mode, observations: data.p_observations }; return json(200, { rating: data.p_rating }); }
    if (fn === 'delete_my_review') { acct.review = null; return json(200, null); }
    if (fn === 'submit_report') { acct.reports.push(data); return json(200, null); }
    if (fn === 'check_in') { acct.checkins++; return json(200, { checkin_id: 'c1' }); }
    if (fn === 'submit_location') { acct.submissions.push(data); return json(200, { submission_id: 'sub-1' }); }
    if (fn === 'submit_location_edit') { acct.edits.push(data); return json(200, 'sub-edit'); }
    if (fn === 'get_my_profile') return json(200, [{ display_name: acct.name, preferred_mode: acct.mode, default_transport: acct.transport, points_balance: 0 }]);
    if (fn === 'update_my_profile') { Object.assign(acct, { name: data.p_display_name, mode: data.p_mode, transport: data.p_transport }); return json(200, []); }
  }
  return json(404, { msg: 'not mocked' });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- build + serve the web app
// E2E_INTEGRATED_REUSE_BUILD=<dir> reuses (and keeps) a previous export for quick local iteration; CI never sets it.
const reuse = process.env.E2E_INTEGRATED_REUSE_BUILD;
const out = reuse ?? mkdtempSync(join(tmpdir(), 'open-stall-integrated-'));
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
const info = (msg) => console.log(`INFO ${msg}`);
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const VIEWS = {
  phone: { width: 390, height: 844 },
  wide: { width: 1280, height: 800 },
  zoom200: { width: 640, height: 360 }, // a 1280x720 window at 200% browser zoom
  zoom400: { width: 320, height: 180 }, // a 1280x720 window at 400% browser zoom (WCAG 1.4.10 reflow size)
};
const newPage = async (view = 'phone', { geolocation = HERE } = {}) => {
  const ctx = await browser.newContext({ viewport: VIEWS[view], ...(geolocation ? { permissions: ['geolocation'], geolocation } : {}) });
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
async function signIn(page, next = '/account') {
  await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await fill(page, 'Email', USER.email); await fill(page, 'Password', GOOD_PW);
  await button(page, 'Sign in').click();
}
const findNearest = async (page) => { await page.goto(`${base}/`); await button(page, 'Find Nearest Restroom').click(); return text(page, 'Cody Library Restroom'); };
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

// ---- accessibility audit (axe-core, already present in node_modules as a transitive dev dependency; not added to package.json)
const AXE = join(root, 'node_modules/axe-core/axe.min.js');
const hasAxe = existsSync(AXE);
const axeReport = [];
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];
async function audit(page, screen, view) {
  if (!hasAxe) return [];
  await page.addScriptTag({ path: AXE });
  const result = await page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, targets: v.nodes.slice(0, 3).map((n) => n.target.join(' ')) }));
  }, AXE_TAGS);
  axeReport.push({ screen, view, violations: result });
  return result;
}
/** Every visible control must be clickable where it sits (nothing, such as the sticky tab bar, may cover it). */
async function coverage(page) {
  const sel = 'button, [role="button"], a[href], input, textarea, [role="radio"], [role="checkbox"], [role="link"], [tabindex="0"]';
  const handles = await page.locator(`${sel}`).elementHandles();
  const problems = [];
  let n = 0;
  for (const h of handles) {
    const info = await h.evaluate((el) => {
      const hidden = !!el.closest('[aria-hidden="true"]') || getComputedStyle(el).visibility === 'hidden' || el.offsetParent === null && getComputedStyle(el).position !== 'fixed';
      const inTabBar = !!el.closest('nav[aria-label="Main"]');
      return { hidden, inTabBar, label: (el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40), leaflet: !!el.closest('.leaflet-container') };
    });
    if (info.hidden || info.inTabBar || info.leaflet) continue;
    n++;
    try { await h.scrollIntoViewIfNeeded({ timeout: 2000 }); await h.click({ trial: true, timeout: 2500 }); } catch (e) { problems.push(`${info.label}: ${String(e.message).split('\n')[0].slice(0, 90)}`); }
  }
  return { n, problems };
}

const SCREENS = [
  ['home-start', async (p) => { await p.goto(`${base}/`); await text(p, 'Find the nearest restroom'); }],
  ['home-results', async (p) => { await findNearest(p); }],
  ['detail-rich', async (p) => { await p.goto(`${base}/location/${RICH}`); await text(p, 'Community rating'); }],
  ['detail-sparse', async (p) => { await p.goto(`${base}/location/${SPARSE}`); await text(p, 'Unverified restroom'); }],
  ['sign-in', async (p) => { await p.goto(`${base}/auth/sign-in`); await text(p, 'Forgot password?'); }],
  ['favorites-signed-out', async (p) => { await p.goto(`${base}/favorites`); await text(p, 'Sign in to save favorite restrooms'); }],
  ['report-signed-out', async (p) => { await p.goto(`${base}/report?id=${RICH}`); await text(p, 'Sign in to report a problem'); }],
  ['settings-signed-out', async (p) => { await p.goto(`${base}/settings`); await text(p, 'Saved on this device'); }],
  ['account-signed-out', async (p) => { await p.goto(`${base}/account`); await text(p, 'You’re not signed in'); }],
];
const SIGNED_SCREENS = [
  ['favorites-empty', async (p) => { await p.goto(`${base}/favorites`); await text(p, 'No favorites yet.'); }],
  ['settings', async (p) => { await p.goto(`${base}/settings`); await text(p, 'Display name'); }],
  ['account', async (p) => { await p.goto(`${base}/account`); await text(p, 'Signed in as'); }],
  ['contribute-new', async (p) => { await p.goto(`${base}/contribute`); await text(p, 'Stand at the restroom to add it'); }],
  ['contribute-correction', async (p) => { await p.goto(`${base}/contribute?id=${RICH}&name=Cody%20Library%20Restroom`); await text(p, 'Only fill in what should change'); }],
  ['report', async (p) => { await p.goto(`${base}/report?id=${RICH}&name=Cody%20Library%20Restroom`); await text(p, 'What’s wrong with'); }],
  ['detail-signed-in', async (p) => { await p.goto(`${base}/location/${RICH}`); await text(p, 'Save to favorites'); }],
];

try {
  // ============================================================ 1. integrated journey (phone), state kept across screens
  {
    const { ctx, page } = await newPage('phone');
    check(await findNearest(page), 'journey: finding restrooms works signed out');
    await button(page, 'Show filters').click();
    await page.getByRole('checkbox', { name: 'Verified only', exact: true }).click();
    check(await text(page, '2 restrooms nearby, filtered'), 'journey: the Verified-only filter narrows the list');
    await page.getByRole('link', { name: /Cody Library Restroom/ }).click();
    check(await text(page, 'Community rating 4.5 / 5 (12 ratings)') && page.url().includes('/location/'), 'journey: a result opens its detail page', `${page.url()} ${(await page.locator('body').innerText()).slice(0, 300).replace(/\n/g, ' | ')}`);
    await page.goBack();
    check(await text(page, '2 restrooms nearby, filtered') && (await page.getByRole('button', { name: 'Remove filter: Verified only' }).count()) === 1, 'journey: going back keeps the results and the active filter');
    await page.getByRole('link', { name: 'Favorites' }).click();
    check(await text(page, 'Sign in to save favorite restrooms'), 'journey: Favorites explains the sign-in requirement');
    await button(page, 'Sign in or create account').click();
    await fill(page, 'Email', USER.email); await fill(page, 'Password', GOOD_PW);
    await button(page, 'Sign in').click();
    check(await text(page, 'No favorites yet.') && new URL(page.url()).pathname === '/favorites', 'journey: signing in returns to Favorites, unlocked');
    await page.getByRole('link', { name: 'Nearby restrooms' }).click();
    check(await text(page, '2 restrooms nearby, filtered'), 'journey: the Nearby tab still has its results and filter after the detour');
    await page.getByRole('link', { name: /Cody Library Restroom/ }).click();
    await button(page, 'Save to favorites').click();
    check(await text(page, 'Saved to favorites.') && acct.favorites.length === 1, 'journey: a restroom is saved to favorites');
    await page.getByRole('radio', { name: '4 stars', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Clean', exact: true }).click();
    await button(page, 'Save rating').click();
    check(await text(page, 'Thanks. Your rating was saved.') && acct.review?.rating === 4, 'journey: a rating with an observation is saved');
    await page.getByRole('link', { name: 'Favorites' }).click();
    check(await text(page, '1 of 5 saved') && await text(page, 'Cody Library Restroom'), 'journey: the favorite appears in Favorites');
    await page.getByRole('link', { name: 'Settings' }).click();
    await page.getByRole('radio', { name: 'Risqué', exact: true }).click();
    check(await text(page, 'Saved.') && acct.mode === 'risque', 'journey: a preference change is saved');
    await page.goto(`${base}/location/${RICH}`);
    check(await text(page, 'Update my rating'), 'journey: after reload the saved rating is recognized (button says Update)');
    await page.getByRole('link', { name: 'Account' }).click();
    await button(page, 'Sign out').click();
    check(await text(page, 'You’re not signed in'), 'journey: sign out returns to the signed-out account page');
    await page.getByRole('link', { name: 'Favorites' }).click();
    check(await text(page, 'Sign in to save favorite restrooms'), 'journey: Favorites is gated again');
    await ctx.close();
  }

  // ============================================================ 2. accessibility audit (axe-core) on every screen, phone + wide
  if (!hasAxe) info('axe-core not found in node_modules: accessibility audit SKIPPED');
  const seriousByScreen = [];
  for (const view of ['phone', 'wide']) {
    const { ctx, page } = await newPage(view);
    for (const [name, go] of SCREENS) {
      await go(page);
      const v = await audit(page, name, view);
      const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical');
      if (bad.length) seriousByScreen.push(`${name}@${view}: ${bad.map((b) => `${b.id}(${b.nodes}) ${b.targets[0] ?? ''}`).join('; ')}`);
      if (name === 'home-results' && view === 'phone') await page.screenshot({ path: join(SHOTS, 'phone-home-results.png') });
    }
    // home states
    await findNearest(page);
    if (view === 'phone') { await page.getByRole('radio', { name: 'Map' }).click(); await text(page, 'Map of nearby restrooms'); const v = await audit(page, 'home-map', view); const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical'); if (bad.length) seriousByScreen.push(`home-map@${view}: ${bad.map((b) => `${b.id}(${b.nodes}) ${b.targets[0] ?? ''}`).join('; ')}`); }
    await button(page, 'Show filters').click().catch(() => {});
    { const v = await audit(page, 'home-filters-open', view); const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical'); if (bad.length) seriousByScreen.push(`home-filters-open@${view}: ${bad.map((b) => `${b.id}(${b.nodes}) ${b.targets[0] ?? ''}`).join('; ')}`); }
    await signIn(page, '/account');
    await text(page, 'Signed in as');
    for (const [name, go] of SIGNED_SCREENS) {
      await go(page);
      const v = await audit(page, name, view);
      const bad = v.filter((x) => x.impact === 'serious' || x.impact === 'critical');
      if (bad.length) seriousByScreen.push(`${name}@${view}: ${bad.map((b) => `${b.id}(${b.nodes}) ${b.targets[0] ?? ''}`).join('; ')}`);
    }
    await ctx.close();
  }
  if (hasAxe) {
    const total = axeReport.reduce((n, r) => n + r.violations.length, 0);
    const byImpact = {};
    for (const r of axeReport) for (const v of r.violations) byImpact[v.impact] = (byImpact[v.impact] ?? 0) + 1;
    info(`axe-core ${axeReport.length} screen/width audits, ${total} violations by impact: ${JSON.stringify(byImpact)}`);
    writeFileSync(join(SHOTS, 'axe-report.json'), JSON.stringify({ engine: 'axe-core', tags: AXE_TAGS, audits: axeReport }, null, 1));
    check(seriousByScreen.length === 0, 'axe-core: no serious or critical violations on any screen at phone or desktop width', seriousByScreen.join(' | '));
    const minor = axeReport.flatMap((r) => r.violations.map((v) => `${r.screen}@${r.view}:${v.id}`));
    if (minor.length) info(`remaining axe findings (moderate/minor): ${[...new Set(minor)].slice(0, 40).join(', ')}`);
  }

  // ============================================================ 3. zoom reflow + sticky navigation never hides a control
  for (const view of ['phone', 'wide', 'zoom200', 'zoom400']) {
    const { ctx, page } = await newPage(view);
    const trouble = [];
    for (const [name, go] of SCREENS) {
      await go(page);
      const ox = await overflowX(page);
      if (ox > 1) trouble.push(`${name}: horizontal overflow ${ox}px`);
      const c = await coverage(page);
      if (c.problems.length) trouble.push(`${name}: ${c.problems.slice(0, 3).join(' / ')}`);
    }
    await signIn(page, '/account'); await text(page, 'Signed in as');
    for (const [name, go] of SIGNED_SCREENS) {
      await go(page);
      const ox = await overflowX(page);
      if (ox > 1) trouble.push(`${name}: horizontal overflow ${ox}px`);
      const c = await coverage(page);
      if (c.problems.length) trouble.push(`${name}: ${c.problems.slice(0, 3).join(' / ')}`);
    }
    check(trouble.length === 0, `${view} (${VIEWS[view].width}x${VIEWS[view].height}): no horizontal scroll and every control is reachable and clickable on all ${SCREENS.length + SIGNED_SCREENS.length} screens`, trouble.slice(0, 6).join(' | '));
    {
      const cut = await page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main"] a')].flatMap((tab) => [...tab.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent.trim() && e.textContent.trim() !== '⏷').filter((e) => { const st = getComputedStyle(e); const clipped = st.overflow === 'hidden' && e.scrollWidth > e.clientWidth + 1; const r = document.createRange(); r.selectNodeContents(e); const w = r.getBoundingClientRect().width; return clipped || w > tab.clientWidth; }).map((e) => e.textContent.trim())));
      check(cut.length === 0, `${view}: tab bar labels are shown whole (no truncation)`, cut.join(', '));
    }
    if (view === 'zoom400') { await page.goto(`${base}/location/${RICH}`); await text(page, 'Community rating'); await page.screenshot({ path: join(SHOTS, 'zoom400-detail.png') }); }
    await ctx.close();
  }

  // ============================================================ 4. keyboard: reachability, visible focus, no trap, focus after navigation
  {
    const { ctx, page } = await newPage('phone');
    for (const [name, go] of [['home-results', (p) => findNearest(p)], ['detail-rich', SCREENS[2][1]], ['sign-in', SCREENS[4][1]]]) {
      await go(page);
      const expected = await page.evaluate(() => [...document.querySelectorAll('button, [role="button"], a[href], input, textarea, [role="radio"], [role="checkbox"], [tabindex="0"]')]
        .filter((el) => !el.closest('[aria-hidden="true"]') && el.offsetParent !== null && !el.closest('.leaflet-container') && el.tabIndex >= 0 && !el.disabled && el.getAttribute('aria-disabled') !== 'true').length);
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      const seen = new Set(); const noRing = [];
      for (let i = 0; i < expected + 25; i++) {
        await page.keyboard.press('Tab');
        await page.waitForTimeout(40); // let the focus-ring state render
        // (the page heading takes programmatic focus only and is not operable, so it is skipped)
        const f = await page.evaluate(() => { const el = document.activeElement; if (!el || el === document.body || el.tagName === 'H1') return null; const s = getComputedStyle(el); const key = `${el.tagName}|${el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 30)}|${Math.round(el.getBoundingClientRect().top)}`; const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || s.boxShadow !== 'none'; return { key, ring }; });
        if (!f) continue;
        if (!seen.has(f.key)) { seen.add(f.key); if (!f.ring) noRing.push(f.key); }
      }
      check(seen.size >= Math.floor(expected * 0.9), `keyboard: ${name}: Tab reaches the controls (${seen.size} focus stops for ${expected} controls)`);
      check(noRing.length === 0, `keyboard: ${name}: every focus stop shows a visible focus indicator`, noRing.slice(0, 5).join(', '));
    }
    // focus after navigation by keyboard: a result opened with Enter must not leave focus lost on <body>
    await findNearest(page);
    await page.getByRole('link', { name: /Cody Library Restroom/ }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/location\//, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(400);
    const where = await page.evaluate(() => { const el = document.activeElement; return { body: !el || el === document.body, inMain: !!el && !el.closest('[aria-hidden="true"]'), tag: el?.tagName, label: el?.getAttribute('aria-label') || el?.textContent?.trim().slice(0, 30) }; });
    info(`focus after opening a result with Enter: ${JSON.stringify(where)}`);
    const hiddenFocusable = await page.evaluate(() => [...document.querySelectorAll('a[href], button, input, textarea, select, [tabindex], [role="button"], [role="link"], [role="radio"], [role="checkbox"]')].filter((el) => el.closest('[aria-hidden="true"]') && el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.hasAttribute('inert')).map((el) => (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30)));
    check(hiddenFocusable.length === 0, 'keyboard: after client-side navigation nothing stays focusable inside an inactive (aria-hidden) screen', JSON.stringify(hiddenFocusable.slice(0, 3)));
    const urlNow = new URL(page.url()).pathname;
    check(urlNow.startsWith('/location/'), 'keyboard: Enter on a result card opens its detail page', urlNow);
    check(where.inMain && where.tag === 'H1', 'keyboard: after opening a result, focus moves to the new page heading (not left in the hidden list)', JSON.stringify(where));
    await ctx.close();
  }

  // ============================================================ 4b. main navigation semantics (a route nav, not an ARIA tablist)
  {
    const { ctx, page } = await newPage('phone');
    await page.goto(`${base}/favorites`);
    await text(page, 'Sign in to save favorite restrooms');
    const nav = page.getByRole('navigation', { name: 'Main' });
    check((await nav.count()) === 1, 'navigation: the main navigation is one labeled navigation landmark');
    check((await nav.getByRole('link').count()) === 4, 'navigation: it contains four ordinary links (Nearby, Favorites, Account, Settings)');
    check((await page.locator('[role="tablist"], [role="tab"]').count()) === 0, 'navigation: no tablist/tab roles on web (they would promise arrow-key behavior this bar does not have)');
    const current = await nav.locator('[aria-current="page"]').allInnerTexts();
    check(current.length === 1 && current[0] === 'Favorites', 'navigation: the current page is exposed with aria-current="page"', JSON.stringify(current));
    // keyboard: Tab to a link, Enter activates it, the current state moves and focus stays on the link
    for (let i = 0; i < 60; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Settings' && !!document.activeElement.closest('nav'))) break; }
    check(await page.evaluate(() => document.activeElement?.textContent?.trim() === 'Settings'), 'navigation: the Settings link can be reached with the Tab key');
    await page.keyboard.press('Enter');
    await page.waitForURL(/\/settings/, { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ path: location.pathname, active: document.activeElement?.textContent?.trim(), tag: document.activeElement?.tagName, current: [...document.querySelectorAll('nav[aria-label="Main"] [aria-current="page"]')].map((e) => e.textContent.trim()) }));
    check(after.path === '/settings', 'navigation: Enter on a navigation link opens the page', JSON.stringify(after));
    check(JSON.stringify(after.current) === '["Settings"]', 'navigation: aria-current moves to the opened page', JSON.stringify(after));
    check(after.active === 'Settings' && after.tag === 'A', 'navigation: focus stays on the navigation link after activating it', JSON.stringify(after));
    // arrow keys must not be needed (and must not be silently swallowed): Tab order continues through the links
    await page.keyboard.press('Shift+Tab');
    check(await page.evaluate(() => document.activeElement?.closest('nav[aria-label="Main"]') !== null), 'navigation: Shift+Tab moves between the links');
    // hidden (pushed) routes have no current item and the bar is still there
    await page.goto(`${base}/location/${RICH}`);
    await text(page, 'Community rating');
    check((await page.getByRole('navigation', { name: 'Main' }).locator('[aria-current="page"]').count()) === 0, 'navigation: on a pushed screen (restroom detail) no navigation item claims to be current');
    await ctx.close();
  }

  // ============================================================ 5. offline / recovery
  {
    const { ctx, page } = await newPage('phone');
    await page.goto(`${base}/location/${RICH}`);
    check(await text(page, 'Community rating'), 'offline: detail loads online first (and is cached)');
    apiDown = true;
    await page.reload();
    check(await text(page, 'Offline: showing saved details'), 'offline: with the service unreachable, saved details are shown with an offline notice');
    apiDown = false;
    await page.goto(`${base}/location/${SPARSE}`);
    apiDown = true;
    await page.reload();
    check(await text(page, 'We couldn’t load this restroom.') || await text(page, 'Offline: showing saved details'), 'offline: an uncached restroom shows a recoverable error');
    apiDown = false;
    await page.goto(`${base}/`);
    apiDown = true;
    await button(page, 'Find Nearest Restroom').click();
    check(await text(page, 'couldn’t') || await text(page, 'Offline') || await text(page, 'try again'), 'offline: a failed nearby search explains itself');
    apiDown = false;
    await ctx.close();
  }

  // ============================================================ 6. map controls (local fixtures; tiles blocked)
  {
    const { ctx, page } = await newPage('wide');
    await findNearest(page);
    const region = page.getByRole('region', { name: /Map of nearby restrooms/ });
    check(await region.isVisible(), 'map: a labeled map region is present');
    check((await page.locator('.leaflet-control-attribution').innerText()).includes('OpenStreetMap'), 'map: the tile attribution is shown');
    const zoom = await page.locator('.leaflet-control-zoom a').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), label: e.getAttribute('aria-label') || e.getAttribute('title') }; }));
    check(zoom.length === 2 && zoom.every((z) => z.w >= 44 && z.h >= 44), 'map: zoom controls are at least 44 px touch targets', JSON.stringify(zoom));
    check(zoom.every((z) => !!z.label), 'map: zoom controls have accessible names', JSON.stringify(zoom));
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => document.activeElement?.classList.contains('leaflet-control-zoom-in'))) break; }
    check(await page.evaluate(() => document.activeElement?.classList.contains('leaflet-control-zoom-in')), 'map: the zoom control can be reached with the Tab key');
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, w: parseFloat(s.outlineWidth), shadow: s.boxShadow }; });
    check((ring.style !== 'none' && ring.w >= 2) || ring.shadow !== 'none', 'map: a focused zoom control shows a visible focus indicator', JSON.stringify(ring));
    await page.keyboard.press('Enter');
    await page.screenshot({ path: join(SHOTS, 'wide-home-map.png') });
    check((await page.getByRole('link', { name: /Cody Library Restroom/ }).count()) === 1, 'map: the results list carries every restroom, so markers are not the only way in');
    await ctx.close();
  }

  // ============================================================ 7. boundaries across the whole session matrix
  {
    const pub = requests.filter((r) => /\/rpc\/(nearby_locations|get_public_location|nearest_verified_location)$/.test(r.path));
    check(pub.length > 0 && pub.every((r) => r.auth === `Bearer ${ANON}` || r.auth === null), 'boundary: every public read used only the anonymous key');
    const acctReq = requests.filter((r) => /\/rpc\/(list_my_favorites|add_favorite|submit_review|submit_report|submit_location|get_my_profile)$/.test(r.path));
    check(acctReq.every((r) => r.auth === `Bearer ${JWT}`), 'boundary: account functions always carried the signed-in token');
    check(requests.filter((r) => r.path.endsWith('/list_my_favorites')).every((r) => r.body.p_lat === null && r.body.p_lng === null), 'boundary: favorites requests never carry coordinates');
    const hosts = [...new Set(external.map((u) => new URL(u).hostname))];
    check(hosts.every((h) => h === 'tile.openstreetmap.org'), 'boundary: the only third-party request is the configured map tile provider (blocked here); no fonts, analytics or other calls', hosts.join(', '));
    check(external.every((u) => /\/\d+\/\d+\/\d+\.png$/.test(new URL(u).pathname)), 'boundary: tile requests carry only z/x/y tile paths (no user identifiers)', external.slice(0, 2).join(', '));
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
