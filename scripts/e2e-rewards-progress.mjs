#!/usr/bin/env node
// Real-browser test of the P4 rewards progress UI (dashboard card + account list) against a LOCAL MOCK backend. Builds the actual Expo web
// export THREE times: a normal build (feature off), a clearly identified local mock build (EXPO_PUBLIC_REWARDS_PROGRESS=live on the loopback mock),
// and a flag-on build pointed at a HOSTED-looking URL (which must stay disabled: the fail-closed mock boundary), then
// drives them with Playwright (headless Chromium). The mock's synthetic fixtures exist only here; no real reward settings, catalog, account or
// service is contacted. Browser assertions and screenshots support LOCAL review only: they are NOT VoiceOver/TalkBack/native evidence.
// E2E_P4_REUSE_OFF / E2E_P4_REUSE_LIVE / E2E_P4_REUSE_HOSTED=<dir> reuse (and keep) earlier exports for quick local iteration; CI never sets them.
// Writes screenshots to docs/evidence/rewards-p4/.
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK_PORT = 54611;
const ANON = 'mock-anon-key-not-real';
const SHOTS = join(root, 'docs/evidence/rewards-p4');
const HERE = { latitude: 44.5263, longitude: -109.0565, accuracy: 10 };
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'user@test.dev', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const USER_B = { ...USER, id: '66666666-7777-4888-9999-000000000000', email: 'second@test.dev' };
const GOOD_PW = 'correct horse battery';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwtFor = (u) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: u.id, role: 'authenticated', exp: 4102444800 })}.sig`;
const JWT = jwtFor(USER);
const JWT_B = jwtFor(USER_B);
const session = (u = USER) => ({ access_token: jwtFor(u), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: `refresh-token-${u === USER ? 1 : 2}`, user: u });
const subOf = (auth) => { try { return JSON.parse(Buffer.from((auth ?? '').split('.')[1] ?? '', 'base64url').toString()).sub; } catch { return null; } };

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

// ---------------------------------------------------------------- mock backend: auth + the one RPC under test (synthetic fixtures)
const mk = (achievement, period, state, extra = {}) => ({ achievement, period, state, copy: null, metric: 'distinct_locations', value: null, threshold: null, ...extra });
const FIXTURE = [
  mk('explorer', '2026-10', 'in_progress', { copy: 'Explorer', value: 3, threshold: 5 }),
  mk('first_stop', 'lifetime', 'earned', { copy: 'First Stop', metric: 'qualifying_awards', value: 1, threshold: 1, earned_at: '2026-10-12T18:00:00Z', earned_late: false }),
  mk('late_bird', '2026-09', 'earned', { copy: 'Late Bird', metric: 'distinct_active_days', value: 4, threshold: 4, earned_at: '2026-10-02T18:00:00Z', earned_late: true }),
  mk('removed_one', 'lifetime', 'removed', { copy: 'Removed Badge' }),
  mk('review_me', 'lifetime', 'being_updated', { copy: 'Under Review' }),
  mk('zero_goal', 'lifetime', 'in_progress', { copy: 'Point Collector', metric: 'lifetime_points_total', value: 0, threshold: 50 }),
  mk('unavail', 'lifetime', 'unavailable', { copy: 'Not Ready' }),
  mk('updating_one', '2026-10', 'updating', { copy: 'Almost There', value: 6, threshold: 5 }),
  ...Array.from({ length: 24 }, (_, i) => mk(`zz_filler_${String(i + 1).padStart(2, '0')}`, 'lifetime', 'in_progress', { copy: `Filler ${i + 1}`, metric: 'lifetime_points_total', value: i, threshold: 1000 })),
].sort((a, b) => (a.achievement + '|' + a.period < b.achievement + '|' + b.period ? -1 : 1));
const B_FIXTURE = [mk('only_b', 'lifetime', 'in_progress', { copy: 'Second Account Badge', metric: 'lifetime_points_total', value: 7, threshold: 100 })];
const progress = { mode: 'normal', calls: 0, failNext: 0, failCursorOnce: false, bodies: [], auths: [], earnedAfter: Infinity, reads: 0, delayA: 0, revoked: false, disableOnCursor: false, failStatus: 500 };
const requests = [];
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const cors = { connection: 'close', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  const data = body ? JSON.parse(body) : {};
  const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
  requests.push({ path: u.pathname, auth: req.headers.authorization ?? null, body: data });
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') {
    const acct = [USER, USER_B].find((x) => x.email === data.email);
    return acct && data.password === GOOD_PW ? json(200, session(acct)) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  }
  if (u.pathname === '/auth/v1/token') return json(200, session(data.refresh_token === 'refresh-token-2' ? USER_B : USER));
  if (u.pathname === '/auth/v1/user') return json(200, subOf((req.headers.authorization ?? '').replace('Bearer ', '')) === USER_B.id ? USER_B : USER);
  if (u.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/rest/v1/rpc/nearby_locations' || u.pathname === '/rest/v1/rpc/nearest_verified_location') return json(200, []);
  if (u.pathname === '/rest/v1/rpc/get_my_profile') return json(200, [{ display_name: null, preferred_mode: 'plain', default_transport: 'walk', points_balance: 0 }]);
  if (u.pathname === '/rest/v1/rpc/get_my_progress') {
    progress.calls++; progress.bodies.push(data); progress.auths.push(req.headers.authorization ?? null);
    const who = subOf((req.headers.authorization ?? '').replace('Bearer ', ''));
    if (who === USER.id && progress.delayA) await new Promise((r) => setTimeout(r, progress.delayA));
    if (progress.disableOnCursor && data.p_cursor) return json(200, { state: 'disabled', items: [], next_cursor: null });
    if (progress.failNext > 0) { progress.failNext--; return progress.failStatus === 401 ? json(401, { code: 'PGRST301', message: 'JWT expired' }) : json(progress.failStatus, { message: 'mock progress failure' }); }
    if (progress.failCursorOnce && data.p_cursor) { progress.failCursorOnce = false; return json(500, { message: 'mock page failure' }); }
    if (progress.mode === 'disabled') return json(200, { state: 'disabled', items: [], next_cursor: null });
    if (progress.mode === 'malformed') return json(200, { state: 'ready', items: 'nope' });
    if (progress.mode === 'empty') return json(200, { state: 'ready', items: [], next_cursor: null });
    let list = who === USER_B.id ? B_FIXTURE : progress.revoked ? FIXTURE.map((x) => (x.achievement === 'first_stop' ? { ...x, state: 'removed', value: null, threshold: null } : x)) : FIXTURE;
    if (progress.mode === 'newly_earned') {
      progress.reads++;
      list = [progress.reads > progress.earnedAfter ? { ...FIXTURE.find((x) => x.achievement === 'explorer'), state: 'earned', value: 5, earned_at: '2026-10-20T10:00:00Z', earned_late: false } : FIXTURE.find((x) => x.achievement === 'explorer')];
    }
    const key = (x) => `${x.achievement}|${x.period}`;
    const after = data.p_cursor ? list.filter((x) => key(x) > data.p_cursor) : list;
    const page = after.slice(0, data.p_limit);
    return json(200, { state: 'ready', items: page, next_cursor: after.length > page.length ? key(page[page.length - 1]) : null });
  }
  return json(404, { msg: 'mock: not mocked' });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- build + serve (two exports)
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };
function buildAndServe(extraEnv, reuse) {
  const out = reuse ?? mkdtempSync(join(tmpdir(), 'open-stall-p4-'));
  if (!existsSync(join(out, 'index.html'))) {
    execFileSync('npx', ['expo', 'export', '--clear', '--platform', 'web', '--output-dir', out], {
      cwd: join(root, 'apps/mobile'), stdio: 'inherit',
      env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON, ...extraEnv },
    });
  }
  const server = createServer((req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
    let f = join(out, p);
    if (!f.startsWith(out) || !existsSync(f) || statSync(f).isDirectory()) f = join(out, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}
const off = await buildAndServe({ EXPO_PUBLIC_REWARDS_PROGRESS: '' }, process.env.E2E_P4_REUSE_OFF);
const live = await buildAndServe({ EXPO_PUBLIC_REWARDS_PROGRESS: 'live' }, process.env.E2E_P4_REUSE_LIVE);
const hosted = await buildAndServe({ EXPO_PUBLIC_REWARDS_PROGRESS: 'live', EXPO_PUBLIC_SUPABASE_URL: 'https://hosted-project.invalid' }, process.env.E2E_P4_REUSE_HOSTED);
mkdirSync(SHOTS, { recursive: true });

// ---------------------------------------------------------------- harness
let failures = 0; let passed = 0; const external = [];
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (ok) passed++; else failures++; };
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const newPage = async ({ width = 390, height = 844 } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, permissions: ['geolocation'], geolocation: HERE });
  await ctx.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'data:') return route.continue();
    external.push(url.href); return route.abort();
  });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  return { ctx, page };
};
const text = (page, t) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible' }).then(() => true, () => false);
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function signIn(page, base, next = '/account') {
  await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email', { exact: true }).fill(USER.email); await page.getByLabel('Password', { exact: true }).fill(GOOD_PW);
  await button(page, 'Sign in').click();
}
const reset = (mode = 'normal') => { progress.mode = mode; progress.delayA = 0; progress.revoked = false; progress.disableOnCursor = false; progress.failStatus = 500; progress.calls = 0; progress.failNext = 0; progress.failCursorOnce = false; progress.bodies = []; progress.auths = []; progress.reads = 0; progress.earnedAfter = Infinity; };
const nav = (page, label) => page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: new RegExp(label) }).first().click();
/** Text-only enlargement at a phone viewport (the project's existing technique): every text node's font and line height are multiplied. */
const scaleText = (page, k) => page.evaluate((f) => {
  for (const el of document.querySelectorAll('body *')) { const c = getComputedStyle(el); if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { el.style.fontSize = `${parseFloat(c.fontSize) * f}px`; if (c.lineHeight !== 'normal') el.style.lineHeight = `${parseFloat(c.lineHeight) * f}px`; } }
}, k);
const offenders = (page) => page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => e.checkVisibility() && e.getBoundingClientRect().right > window.innerWidth + 1)
  .map((e) => `${e.tagName.toLowerCase()}[${(e.getAttribute('aria-label') || e.getAttribute('role') || e.textContent || '').trim().slice(0, 28)}]:${Math.round(e.getBoundingClientRect().right)}`).slice(0, 10));
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const regionText = (page, name) => page.getByRole('region', { name }).first().innerText();
/** Every visible element that carries `s` as its own text is hidden from assistive technology (so it is spoken only by the progress element). */
const spokenOnce = (page, s) => page.evaluate((sentence) => {
  const hits = [...document.querySelectorAll('*')].filter((e) => e.children.length === 0 && e.textContent === sentence && e.checkVisibility() && e.getBoundingClientRect().width > 0);
  return { n: hits.length, hidden: hits.every((e) => e.closest('[aria-hidden="true"]')) };
}, s);

try {
  // ================= A. normal (production-like) build: feature OFF
  {
    reset();
    const { ctx, page } = await newPage();
    await page.goto(`${off.base}/`);
    check(await text(page, 'VIP progress — rewards coming soon'), 'A: signed out, normal build: honest coming-soon card');
    check(!/\d/.test(await regionText(page, 'VIP progress')), 'A: the coming-soon card shows no number at all');
    await signIn(page, off.base);
    check(await text(page, 'Your account'), 'A: signed in on the normal build');
    await page.goto(`${off.base}/`);
    check(await text(page, 'VIP progress — rewards coming soon') && (await page.getByText('Sign in to track your progress').count()) === 0, 'A: signed in, normal build: still coming soon (no sign-in CTA, no numbers)');
    await page.goto(`${off.base}/account`);
    await text(page, 'Your progress');
    check(await text(page, 'Nothing to show yet'), 'A: the account list is the same honest coming-soon text');
    check(progress.calls === 0, 'A: the normal build made NO progress request at all', `${progress.calls}`);
    await ctx.close();
  }

  // ================= B. local mock build (feature live): signed out
  {
    reset();
    const { ctx, page } = await newPage();
    await page.goto(`${live.base}/`);
    check(await text(page, 'Sign in to track your progress') && (await button(page, 'Sign in').count() + await page.getByRole('link', { name: 'Sign in', exact: true }).count()) >= 1, 'B: signed out: "Sign in to track your progress" with a sign-in action', await regionText(page, 'VIP progress'));
    check(!/\d/.test(await regionText(page, 'VIP progress')) && progress.calls === 0, 'B: signed out: no number and no progress request');
    await page.getByRole('link', { name: 'Sign in', exact: true }).first().click();
    check((await page.waitForURL(/sign-in/).then(() => true, () => false)), 'B: the sign-in action opens sign in');
    await ctx.close();
  }

  // ================= C. live: signed in, every state, accessibility, paging
  {
    reset();
    const { ctx, page } = await newPage();
    await signIn(page, live.base, '/');
    await text(page, 'See all progress');
    check(progress.bodies.length >= 1 && progress.bodies.every((b) => Object.keys(b).sort().join() === 'p_cursor,p_limit' && b.p_limit === 3 && b.p_cursor === null), 'C: the dashboard asks only for the caller: cursor and limit 3, no subject, no coordinates', JSON.stringify(progress.bodies));
    check(progress.auths.every((a) => a === `Bearer ${JWT}`), 'C: progress requests carry the signed-in token');
    const card = await regionText(page, 'VIP progress');
    check(/Explorer/.test(card) && /3 of 5 different places in October 2026, 2 to go/.test(card), 'C: the dashboard card shows the first items with their exact server numbers', card.replace(/\n/g, ' | '));
    await page.screenshot({ path: join(SHOTS, 'dashboard-card-390.png') });
    await page.getByRole('link', { name: 'See all progress', exact: true }).click();
    await page.waitForURL(/\/account/);
    await text(page, 'Your progress');
    check(await text(page, 'Show more'), 'C: the account list is paged: Show more is offered after the first 20');
    const body = () => page.getByRole('heading', { name: 'Your progress', exact: true }).locator('xpath=..').innerText();
    let t = await body();
    check(/Earned 12 Oct 2026/.test(t), 'C: earned badge shows its date', t.slice(0, 200));
    check(/Earned late for September 2026/.test(t), 'C: a late award is worded as late for its window');
    check(/Removed after a review/.test(t), 'C: a removed badge says only that it was removed after a review');
    check(/Being updated\. This badge is under review and may change\./.test(t), 'C: a being-updated badge says so');
    check(/Updating\. You have reached this goal/.test(t) && /6 of 5 different places in October 2026, goal reached/.test(t), 'C: an updating badge keeps backend truth (goal reached, badge pending)');
    check(/0 of 50 points in total, 50 to go/.test(t), 'C: a real evaluated zero is shown as a zero');
    check(/Progress is unavailable right now\. Try again soon/.test(t) && !/Not Ready\s*\n?\s*0 of/.test(t), 'C: an unavailable item says unavailable, never zero');
    check(/Reach 50 points in total/.test(t) && !/visit/i.test(t), 'C: how-to-earn comes from the metric and window, with no point/visit conversion');
    // one accessible progress element per numeric target, name + value text
    const pb = page.getByRole('progressbar', { name: 'Explorer', exact: true });
    check((await pb.count()) === 1, 'C: exactly one progress element named Explorer');
    const attrs = await pb.evaluate((e) => ({ min: e.getAttribute('aria-valuemin'), max: e.getAttribute('aria-valuemax'), now: e.getAttribute('aria-valuenow'), text: e.getAttribute('aria-valuetext'), h: e.getBoundingClientRect().height }));
    check(attrs.min === '0' && attrs.max === '5' && attrs.now === '3' && attrs.text === '3 of 5 different places in October 2026, 2 to go', 'C: the progress element carries min/max/now and the full sentence as its value text', JSON.stringify(attrs));
    check(attrs.h >= 48, `C: the progress element is at least 48 px tall (${Math.round(attrs.h)})`);
    const once = await spokenOnce(page, '3 of 5 different places in October 2026, 2 to go');
    check(once.n === 1 && once.hidden, 'C: the visible sentence exists once and is hidden from assistive technology (spoken once, by the element)', JSON.stringify(once));
    const bars = await page.getByRole('progressbar').count();
    check(bars >= 4, `C: every numeric target is a progress element (${bars})`);
    // paging
    await button(page, 'Show more').click();
    await text(page, 'Filler 24');
    const ids = await page.getByRole('progressbar').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
    check(new Set(ids).size === ids.length && (await page.getByText('Show more').count()) === 0, 'C: the next page is appended with no duplicates and the button goes away');
    check(progress.bodies.some((b) => b.p_cursor && b.p_limit === 20), 'C: paging uses the server cursor with limit 20');
    // layout
    check((await overflow(page)) <= 1, 'C: no horizontal scroll at 390 px');
    await page.screenshot({ path: join(SHOTS, 'account-list-390.png'), fullPage: true });
    await ctx.close();
  }

  // ================= D. live: narrow, large text, keyboard, reduced motion, targets
  {
    reset();
    const { ctx, page } = await newPage({ width: 320, height: 700 });
    await signIn(page, live.base, '/account');
    await text(page, 'Show more');
    check((await overflow(page)) <= 1, 'D: no horizontal scroll at 320 px');
    await page.screenshot({ path: join(SHOTS, 'account-list-320.png') });
    const sm = await button(page, 'Show more').boundingBox();
    check(sm && sm.height >= 48, `D: Show more is a real button at least 48 px tall (${Math.round(sm?.height ?? 0)})`);
    let focused = false;
    for (let i = 0; i < 80 && !focused; i++) {
      await page.keyboard.press('Tab');
      focused = await page.evaluate(() => (document.activeElement?.textContent || '').trim() === 'Show more');
    }
    const ring = focused && await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
    check(focused && ring, 'D: keyboard Tab reaches Show more and it shows a visible focus ring', `focused ${focused} ring ${ring}`);
    await page.keyboard.press('Enter');
    check(await text(page, 'Filler 24'), 'D: Enter on the focused Show more loads the next page');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const anim = await page.evaluate(() => [...document.querySelectorAll('[role="progressbar"], [role="progressbar"] *')].every((e) => { const s = getComputedStyle(e); return (s.animationName === 'none' || s.animationName === '') && parseFloat(s.transitionDuration || '0') === 0; }));
    check(anim, 'D: the progress UI uses no animation or transition (reduced motion is respected by construction)');
    await ctx.close();
  }

  // ================= E. live: failures and retry, pending semantics
  {
    reset(); progress.failNext = 1;
    let { ctx, page } = await newPage();
    await signIn(page, live.base, '/account');
    check(await text(page, 'Progress is unavailable right now. Try again soon'), 'E: a failed load says unavailable');
    check((await page.getByRole('alert').filter({ hasText: /unavailable right now/ }).count()) >= 1 && !/\b0 of\b/.test(await page.locator('body').innerText()), 'E: it is announced as an alert and shows no zero');
    await page.getByRole('button', { name: 'Try again', exact: true }).first().click();
    check(await text(page, 'Show more') && await text(page, 'Earned 12 Oct 2026'), 'E: Try again recovers and shows the list');
    await ctx.close();

    reset('malformed');
    ({ ctx, page } = await newPage());
    await signIn(page, live.base, '/account');
    check(await text(page, 'Progress is unavailable right now. Try again soon'), 'E: a malformed answer is unavailable, never a zero');
    await ctx.close();

    reset('disabled');
    ({ ctx, page } = await newPage());
    await signIn(page, live.base, '/');
    check(await text(page, 'VIP progress — rewards coming soon') && !/\d/.test(await regionText(page, 'VIP progress')), 'E: a server that says disabled shows coming soon with no number');
    await ctx.close();

    reset('empty');
    ({ ctx, page } = await newPage());
    await signIn(page, live.base, '/account');
    check(await text(page, 'No badges to show yet.') && !/\b0 of\b/.test(await page.locator('body').innerText()), 'E: an empty evaluated list says there is nothing yet (not a made-up zero)');
    await ctx.close();

    reset(); progress.failCursorOnce = true;
    ({ ctx, page } = await newPage());
    await signIn(page, live.base, '/account');
    await text(page, 'Show more');
    await button(page, 'Show more').click();
    check(await text(page, 'Could not load more') && (await page.getByRole('alert').filter({ hasText: /Could not load more/ }).count()) >= 1, 'E: a failed further page is announced and the first page stays');
    check(await text(page, 'Earned 12 Oct 2026'), 'E: the already shown items stay after a failed page');
    await button(page, 'Try again').click();
    check(await text(page, 'Filler 24'), 'E: retrying the page appends it');
    await ctx.close();
  }

  // ================= F. live: a newly earned badge is announced politely
  {
    reset('newly_earned'); progress.earnedAfter = 1;
    const { ctx, page } = await newPage();
    await signIn(page, live.base, '/account');
    check(await text(page, '3 of 5 different places in October 2026, 2 to go'), 'F: first load shows progress and announces nothing');
    check((await page.getByRole('status').filter({ hasText: /New badge earned/ }).count()) === 0, 'F: no announcement on the first load');
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Nearby/ }).first().click();
    await page.waitForTimeout(600);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Account/ }).first().click();
    check(await text(page, 'New badge earned: Explorer'), 'F: a newly earned badge is announced once in a polite status region');
    const live2 = await page.getByRole('status').filter({ hasText: /New badge earned/ }).first().evaluate((e) => ({ live: e.getAttribute('aria-live'), role: e.getAttribute('role') }));
    check(live2.live === 'polite' && live2.role === 'status', 'F: the announcement is a polite live region', JSON.stringify(live2));
    await ctx.close();
  }


  // ================= G. live: account identity (direct A -> B replacement, delayed answers, logout/login)
  {
    reset(); progress.delayA = 4500; // A's first progress answer is deliberately slow
    const { ctx, page } = await newPage();
    await signIn(page, live.base, '/account');
    await text(page, 'Your progress');
    // DIRECT replacement: another tab signs in as B. supabase-js stores the new session and broadcasts SIGNED_IN to this tab; there is NO signed-out step.
    await page.evaluate(() => { window.__seenA = false; new MutationObserver(() => { if (/Explorer|First Stop|Filler/.test(document.body.innerText)) window.__seenA = true; }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
    const swapped = await page.evaluate(({ sess }) => {
      const key = Object.keys(localStorage).find((k) => /^sb-.*-auth-token$/.test(k));
      if (!key) return false;
      localStorage.setItem(key, JSON.stringify(sess));
      new BroadcastChannel(key).postMessage({ event: 'SIGNED_IN', session: sess });
      return true;
    }, { sess: session(USER_B) });
    check(swapped, 'G: the stored session of A could be replaced by B\'s without a signed-out step (a second tab signing in)');
    check(await text(page, 'Second Account Badge'), 'G: after a DIRECT A -> B replacement the account list shows B\'s progress', (await page.locator('body').innerText()).slice(0, 200));
    await page.waitForTimeout(5000); // A's late answer arrives now
    {
      const body = await page.locator('body').innerText();
      check(!/Explorer|First Stop|Filler/.test(body) && /Second Account Badge/.test(body), 'G: A\'s late answer never replaces or joins B\'s list');
      check(!(await page.evaluate(() => window.__seenA)), 'G: no A-only badge was ever rendered after B took over (observed continuously)');
      check(progress.bodies.every((b) => Object.keys(b).sort().join() === 'p_cursor,p_limit' && b.p_cursor === null), 'G: identity is never sent: requests carry only cursor and limit');
      check(new Set(progress.auths).has(`Bearer ${JWT_B}`) && new Set(progress.auths).has(`Bearer ${JWT}`), 'G: each request carried its own account\'s token');
      // logout, then A signs in again with no delay: A's data, none of B's
      progress.delayA = 0;
      await button(page, 'Sign out').click();
      await text(page, 'You’re not signed in');
      check(!/Second Account Badge/.test(await page.locator('body').innerText()), 'G: after logout none of B\'s progress remains on the page');
      await signIn(page, live.base, '/account');
      check(await text(page, 'Explorer') && (await page.getByText('Second Account Badge').count()) === 0, 'G: logout then login shows only the new account\'s progress');
    }
    // a token refresh of the same account must not start a fetch storm
    const before = progress.calls;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(800);
    check(progress.calls - before <= 1, 'G: a plain focus/visibility event of the same account starts at most one refresh', `${progress.calls - before}`);
    await ctx.close();
  }

  // ================= H. live: failed refresh is never authoritative; disabled while paging clears everything
  {
    for (const [label, setup] of [['a server error', () => { progress.failNext = 1000; progress.failStatus = 500; }], ['an authorization error', () => { progress.failNext = 1000; progress.failStatus = 401; }], ['a malformed answer', () => { progress.mode = 'malformed'; }]]) {
      reset();
      const { ctx, page } = await newPage();
      await signIn(page, live.base, '/account');
      await text(page, 'Earned 12 Oct 2026');
      setup();
      await nav(page, 'Nearby'); await page.waitForTimeout(500); await nav(page, 'Account');
      check(await text(page, 'Progress is unavailable right now. Try again soon'), `H: a refresh that gets ${label} makes the list unavailable`);
      const t = await page.locator('body').innerText();
      check(!/Earned 12 Oct 2026|3 of 5 different places/.test(t), `H: after ${label} no earned badge and no old number is kept`, t.replace(/\n/g, ' | ').slice(0, 900));
      progress.mode = 'normal'; progress.failNext = 0; progress.revoked = true; // every request failed until now (deterministic: both screens fetch independently)
      await page.getByRole('button', { name: 'Try again', exact: true }).first().click();
      check(await text(page, 'Removed after a review'), `H: after ${label}, Try again reflects the revocation`);
      check(!/Earned 12 Oct 2026/.test(await page.locator('body').innerText()), `H: the revoked badge is no longer shown as earned (after ${label})`);
      await ctx.close();
    }
    reset(); progress.disableOnCursor = true;
    const { ctx, page } = await newPage();
    await signIn(page, live.base, '/account');
    await text(page, 'Show more');
    await button(page, 'Show more').click();
    check(await text(page, 'rewards coming soon'), 'H: a server that turns disabled between pages shows coming soon');
    const t = await page.locator('body').innerText();
    check(!/Earned 12 Oct 2026|\d+ of \d+/.test(t) && (await page.getByText('Loading…').count()) === 0 && (await button(page, 'Show more').count()) === 0, 'H: no old numbers and no stuck "Loading…" or Show more remain');
    await ctx.close();
  }

  // ================= I. flag on, but a HOSTED-looking configuration: still disabled, no request
  {
    reset();
    const reqBefore = external.length;
    const { ctx, page } = await newPage();
    await page.goto(`${hosted.base}/`);
    check(await text(page, 'VIP progress — rewards coming soon'), 'I: flag on with a hosted-looking project URL: still the coming-soon card');
    check((await page.getByText('Sign in to track your progress').count()) === 0 && !/\d/.test(await regionText(page, 'VIP progress')), 'I: no sign-in CTA for progress and no number');
    await page.goto(`${hosted.base}/account`);
    await page.waitForTimeout(800);
    check(progress.calls === 0 && external.slice(reqBefore).filter((u) => /get_my_progress/.test(u)).length === 0, 'I: no progress request went anywhere (the mock got none and none was attempted elsewhere)');
    await ctx.close();
  }

  // ================= J. live: real enlarged text (2x) at 320 px, axe, and the 160 px investigation
  {
    reset();
    const d200 = {};
    const progress2x = async (b, path, who) => { const { ctx: c, page: pg } = await newPage({ width: 320, height: 700 }); if (who) await signIn(pg, b, path); else await pg.goto(`${b}${path}`); await pg.waitForTimeout(1200); await scaleText(pg, 2); await pg.waitForTimeout(500); const r = { pageX: await overflow(pg), o: await offenders(pg) }; await c.close(); return r; };
    const { ctx, page } = await newPage({ width: 320, height: 700 });
    await signIn(page, live.base, '/');
    await text(page, 'See all progress');
    await scaleText(page, 2); await page.waitForTimeout(500);
    const dash = await page.evaluate(() => {
      const r = document.querySelector('[role="region"][aria-label="VIP progress"]'); const b = r.getBoundingClientRect();
      const kids = [...r.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0);
      return { spill: kids.some((e) => e.getBoundingClientRect().right > b.right + 1 || e.getBoundingClientRect().left < b.left - 1), pageX: document.documentElement.scrollWidth - document.documentElement.clientWidth, h: Math.round(b.height) };
    });
    check(!dash.spill, `D200: at 2x text on 320 px the dashboard progress card (${dash.h} px tall) clips nothing (every child stays inside it)`, JSON.stringify(dash));
    d200.dashX = dash.pageX; d200.dashOff = await progress2x(off.base, '/', true);
    console.log(`INFO 2x text, 320 px, dashboard: page overflows sideways by ${dash.pageX}px with the mock build vs ${d200.dashOff.pageX}px with the NORMAL build; offenders live ${JSON.stringify(await offenders(page))} vs normal ${JSON.stringify(d200.dashOff.o)}`);
    const link = page.getByRole('link', { name: 'See all progress', exact: true });
    await link.scrollIntoViewIfNeeded();
    const reach = await link.evaluate((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e.contains(top) || top === e || (top && top.contains(e)); });
    check(reach, 'D200: at 2x text "See all progress" is reachable and not covered by the navigation bar');
    await page.screenshot({ path: join(SHOTS, 'dashboard-card-320-text200.png') });
    await ctx.close();
    const { ctx: ctxA, page: pageA } = await newPage({ width: 320, height: 700 }); // a fresh page: the text is enlarged ONCE, not on top of the dashboard's enlargement
    await signIn(pageA, live.base, '/account'); await text(pageA, 'Your progress');
    await scaleText(pageA, 2); await pageA.waitForTimeout(500);
    const acc = await pageA.evaluate(() => {
      const h = [...document.querySelectorAll('[role="heading"]')].find((e) => e.textContent === 'Your progress'); const sec = h.parentElement; const b = sec.getBoundingClientRect();
      const kids = [...sec.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0);
      return { spill: kids.some((e) => e.getBoundingClientRect().right > b.right + 1 || e.getBoundingClientRect().left < b.left - 1), pageX: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    check(!acc.spill, 'D200: at 2x text on 320 px the account progress list clips nothing (every child stays inside its section)', JSON.stringify(acc));
    const accOff = await progress2x(off.base, '/account', true);
    console.log(`INFO 2x text, 320 px, account: page overflows sideways by ${acc.pageX}px with the mock build vs ${accOff.pageX}px with the NORMAL build; offenders live ${JSON.stringify(await offenders(pageA))} vs normal ${JSON.stringify(accOff.o)}`);
    check(d200.dashX <= d200.dashOff.pageX && acc.pageX <= accOff.pageX, 'D200: the whole-page sideways overflow at 2x text is NOT introduced or increased by the progress UI (compared with the normal build at the same enlarged text; any overflow listed above is pre-existing, outside the progress UI)', JSON.stringify({ dash: [d200.dashX, d200.dashOff.pageX], account: [acc.pageX, accOff.pageX] }));
    const more = button(pageA, 'Show more');
    await more.scrollIntoViewIfNeeded();
    const reach2 = await more.evaluate((e) => { const r = e.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return e === top || e.contains(top) || (top && top.contains(e)); });
    check(reach2, 'D200: at 2x text Show more is reachable and not covered');
    await pageA.screenshot({ path: join(SHOTS, 'account-list-320-text200.png') });
    await ctxA.close();

    // axe-core (already present in node_modules as a transitive dev dependency; not added to package.json)
    const AXE = join(root, 'node_modules/axe-core/axe.min.js');
    if (!existsSync(AXE)) check(false, 'axe-core is present in node_modules');
    else {
      const { ctx: c3, page: p3 } = await newPage({ width: 390, height: 844 });
      await signIn(p3, live.base, '/');
      await text(p3, 'See all progress');
      await p3.addScriptTag({ path: AXE });
      const audit = async (name, selectorJs) => p3.evaluate(async (sel) => {
        const el = eval(sel); el.setAttribute('data-axe-p4', '1');
        const r = await window.axe.run({ include: [['[data-axe-p4="1"]']] }, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
        el.removeAttribute('data-axe-p4');
        return r.violations.map((v) => `${v.impact}:${v.id}:${v.nodes.length}`);
      }, selectorJs);
      const v1 = await audit('card', `document.querySelector('[role="region"][aria-label="VIP progress"]')`);
      check(v1.length === 0, 'axe: the dashboard progress card has no WCAG 2 A/AA violations', v1.join(', '));
      await nav(p3, 'Account'); await text(p3, 'Your progress');
      const v2 = await audit('list', `[...document.querySelectorAll('[role="heading"]')].find((e) => e.textContent === 'Your progress').parentElement`);
      check(v2.length === 0, 'axe: the account progress list (all states) has no WCAG 2 A/AA violations', v2.join(', '));
      await c3.close();
    }

    // the 160 css px investigation: compare the normal build (no progress UI at all) with the mock build
    const probe = async (b, path, who) => { const { ctx: c, page: pg } = await newPage({ width: 160, height: 700 }); if (who) await signIn(pg, b, path); else await pg.goto(`${b}${path}`); await pg.waitForTimeout(1200); const o = await offenders(pg); await c.close(); return o; };
    reset();
    const offHome = await probe(off.base, '/', false);
    const liveHome = await probe(live.base, '/', true);
    const offAcct = await probe(off.base, '/account', true);
    const liveAcct = await probe(live.base, '/account', true);
    console.log(`INFO 160px offenders: normal build / -> ${JSON.stringify(offHome)}`);
    console.log(`INFO 160px offenders: mock build   / -> ${JSON.stringify(liveHome)}`);
    console.log(`INFO 160px offenders: normal build /account -> ${JSON.stringify(offAcct)}`);
    console.log(`INFO 160px offenders: mock build   /account -> ${JSON.stringify(liveAcct)}`);
    const inProgress = (o) => o.filter((x) => /progress|Explorer|Show more|Earned|Removed|Updating|Filler|Point|Almost|First Stop|Late Bird|Under Review|Not Ready|different places|points in total/i.test(x));
    check(inProgress(liveHome).length === 0 && inProgress(liveAcct).length === 0, 'D160: the progress UI adds no overflowing element at 160 css px (offenders listed above are outside it)', JSON.stringify([inProgress(liveHome), inProgress(liveAcct)]));
    check(liveHome.length <= offHome.length + 0 && liveAcct.length <= offAcct.length + 0, 'D160: the mock build has no MORE overflowing elements than the normal build (any listed are pre-existing, not introduced by P4)', JSON.stringify({ offHome: offHome.length, liveHome: liveHome.length, offAcct: offAcct.length, liveAcct: liveAcct.length }));
  }

  // ================= privacy and boundaries
  {
    const progressReqs = requests.filter((r) => r.path.endsWith('/get_my_progress'));
    check(progressReqs.length > 0 && progressReqs.every((r) => r.auth === `Bearer ${JWT}` || r.auth === `Bearer ${JWT_B}`), 'privacy: every progress request carried a signed-in account\'s own token and no other credential');
    const pub = requests.filter((r) => r.path.endsWith('/nearby_locations'));
    check(pub.every((r) => r.auth !== `Bearer ${JWT}`), 'regression: public discovery reads never carry the user token');
    check(external.length === 0, 'the app made no request outside the local mock', external.slice(0, 3).join(', '));
  }
} catch (e) {
  console.error('E2E error:', e);
  failures++;
} finally {
  await browser.close();
  mock.close(); off.server.close(); live.server.close(); hosted.server.close();
}
console.log(`\n${passed} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
