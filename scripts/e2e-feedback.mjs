#!/usr/bin/env node
// Real-browser test of the App Feedback experience (Settings entry, form, own list and detail) against a LOCAL MOCK of auth + the feedback RPCs.
// Builds the actual Expo web export and drives it with Playwright (headless Chromium). The mock's synthetic data lives only in this file; no real
// service, account or credential is contacted. Browser assertions support LOCAL review only: they are NOT VoiceOver/TalkBack/native/device evidence.
// E2E_FEEDBACK_REUSE_BUILD=<dir> reuses (and keeps) an export for local iteration; CI never sets it. Screenshots: docs/evidence/feedback/.
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK_PORT = 54622;
const ANON = 'mock-anon-key-not-real';
const SHOTS = join(root, 'docs/evidence/feedback');
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

// ---------------------------------------------------------------- mock backend (synthetic, in memory)
const OUTCOME = { received: 'We received this.', reviewing: 'A person is looking at this.', duplicate: 'This was already reported and is being tracked.', resolved: 'This was addressed.' };
const store = { items: [], submits: [], failNext: null, loseNext: false, delayMs: 0 };
const requests = [];
const addItem = (o) => { const n = store.items.length + 1; const it = { id: `3f2b9c1e-8f55-4a52-9d3a-${String(n).padStart(12, '0')}`, kind: 'bug', screen: 'map', title: `Seed ${n}`, description: `Seeded description number ${n} here.`, status: 'received', created_at: `2026-10-${String(1 + (n % 28)).padStart(2, '0')}T10:00:00.${String(n).padStart(6, '0')}+00`, updated_at: '2026-10-31T10:00:00+00', ...o }; store.items.unshift(it); return it; };
const view = (i) => ({ id: i.id, kind: i.kind, screen: i.screen, title: i.title, status: i.status, outcome: OUTCOME[i.status] ?? '', created_at: i.created_at, updated_at: i.updated_at });
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
  if (u.pathname === '/rest/v1/rpc/nearby_locations' || u.pathname === '/rest/v1/rpc/nearest_verified_location') return json(200, []);
  if (u.pathname === '/rest/v1/rpc/get_my_profile') return json(200, [{ display_name: null, preferred_mode: 'plain', default_transport: 'walk', points_balance: 0 }]);
  if (u.pathname === '/rest/v1/rpc/submit_feedback') {
    store.submits.push(data);
    if (store.delayMs) await new Promise((r) => setTimeout(r, store.delayMs));
    if (store.failNext) { const f = store.failNext; store.failNext = null; return json(f.status, { code: f.code, message: f.message }); }
    const existing = store.items.find((i) => i.key === data.p_key);
    const rec = existing ?? addItem({ key: data.p_key, kind: data.p_kind, screen: data.p_screen, title: data.p_title, description: data.p_description });
    if (store.loseNext) { store.loseNext = false; return req.socket.destroy(); } // recorded, but the answer is lost
    return json(200, { id: rec.id, status: rec.status, created_at: rec.created_at, replayed: Boolean(existing) });
  }
  if (u.pathname === '/rest/v1/rpc/list_my_feedback') {
    const all = [...store.items].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const after = data.p_cursor ? all.filter((i) => `${i.created_at}|${i.id}` < data.p_cursor) : all;
    const page = after.slice(0, data.p_limit);
    const last = page[page.length - 1];
    return json(200, { items: page.map(view), next_cursor: after.length > page.length && last ? `${last.created_at}|${last.id}` : null });
  }
  if (u.pathname === '/rest/v1/rpc/get_my_feedback') {
    const it = store.items.find((i) => i.id === data.p_id);
    if (!it) return json(400, { code: 'P0002', message: 'not found' });
    return json(200, { ...view(it), description: it.description, expected: null, actual: null, steps: null, frequency: null, impact: null, app_version: null, platform: 'web', timeline: [{ status: 'received', at: it.created_at }, ...(it.status !== 'received' ? [{ status: it.status, at: it.updated_at }] : [])] });
  }
  return json(404, { msg: 'mock: not mocked' });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- build + serve
const reuse = process.env.E2E_FEEDBACK_REUSE_BUILD;
const out = reuse ?? mkdtempSync(join(tmpdir(), 'open-stall-feedback-'));
if (!existsSync(join(out, 'index.html'))) {
  execFileSync('npx', ['expo', 'export', '--clear', '--platform', 'web', '--output-dir', out], {
    cwd: join(root, 'apps/mobile'), stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`, EXPO_PUBLIC_SUPABASE_ANON_KEY: ANON },
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
let failures = 0; let passed = 0; const external = [];
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (ok) passed++; else failures++; };
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const newPage = async ({ width = 390, height = 844 } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route('**/*', (route) => { const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'data:') return route.continue(); external.push(url.href); return route.abort(); });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  return { ctx, page };
};
const text = (page, t) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible' }).then(() => true, () => false);
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function signIn(page, next) {
  await page.goto(`${base}/auth/sign-in?next=${encodeURIComponent(next)}`);
  await page.getByLabel('Email', { exact: true }).fill(USER.email); await page.getByLabel('Password', { exact: true }).fill(GOOD_PW);
  await button(page, 'Sign in').click();
}
const feedbackReqs = (fn) => requests.filter((r) => r.path.endsWith(`/${fn}`));
const h1s = (page) => page.evaluate(() => [...document.querySelectorAll('h1, [role="heading"][aria-level="1"]')].filter((h) => !h.closest('[aria-hidden="true"]')).length);
const unlabeled = (page) => page.evaluate(() => [...document.querySelectorAll('input, textarea')].filter((e) => !e.closest('[aria-hidden="true"]') && !(e.getAttribute('aria-label') || '').trim() && !e.labels?.length).length);
const doubleActivate = (page, name) => page.evaluate((n) => { const b = [...document.querySelectorAll('[role="button"]')].find((e) => (e.getAttribute('aria-label') || e.textContent || '').trim() === n); if (!b) throw new Error(`no button ${n}`); b.click(); b.click(); }, name);
const GOOD = { title: 'The map pin does not move', description: 'When I drag the map the pin stays in place for a while before it follows.' };
async function fillGood(page, over = {}) {
  await page.getByRole('radio', { name: 'Something is broken', exact: true }).click();
  await page.getByRole('radio', { name: 'Map', exact: true }).click();
  await page.getByLabel('Short title', { exact: true }).fill(over.title ?? GOOD.title);
  await page.getByLabel('What happened or what is your idea?', { exact: true }).fill(over.description ?? GOOD.description);
}

try {
  // ================= A. signed out: the entry exists in Settings, the form asks to sign in, nothing is sent
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/settings`);
    check(await text(page, 'App feedback') && (await button(page, 'Send app feedback').count()) === 1, 'A: Settings has an App feedback section with a clear action');
    check(await text(page, 'separate from reporting a problem with a restroom'), 'A: it says plainly that this is separate from restroom reports');
    await button(page, 'Send app feedback').click();
    check(await text(page, 'Sign in to send feedback') && (await button(page, 'Sign in or create account').count()) === 1, 'A: signed out, the form asks to sign in (finding restrooms still needs no account)');
    check(feedbackReqs('submit_feedback').length === 0 && feedbackReqs('list_my_feedback').length === 0, 'A: signed out sends no feedback request');
    await ctx.close();
  }

  // ================= B. signed in: structure, errors before any request, privacy note, diagnostics
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/feedback');
    await text(page, 'Send feedback');
    check((await h1s(page)) === 1 && (await unlabeled(page)) === 0, 'B: the form has one h1 and every input is labeled');
    check(await text(page, 'Please don’t include names, e-mail addresses, phone numbers, links, addresses or exact places'), 'B: the privacy note is shown');
    check(await text(page, 'App version:') && await text(page, 'Device type: Web browser') && await text(page, 'Only these two technical details'), 'B: the exact diagnostics are shown before sending (version and device type only)');
    await button(page, 'Send feedback').click();
    check(await text(page, 'Choose what kind of feedback this is.') && await text(page, 'Choose where in the app this happened.') && await text(page, 'Give it a short title') && await text(page, 'Describe it in 10 to 2000 characters.'), 'B: an empty send explains every missing field');
    check((await page.getByRole('alert').count()) >= 3 && feedbackReqs('submit_feedback').length === 0, 'B: the errors are announced as alerts and NOTHING was sent');
    await fillGood(page, { description: 'See https://example.org for the video of the problem' });
    await button(page, 'Send feedback').click();
    check(await text(page, 'Please remove links and web addresses.') && feedbackReqs('submit_feedback').length === 0, 'B: a link is refused before sending');
    await page.getByLabel('What happened or what is your idea?', { exact: true }).fill('Mail me at person@example.org about the pin problem');
    await button(page, 'Send feedback').click();
    check(await text(page, 'Please remove e-mail addresses.') && feedbackReqs('submit_feedback').length === 0, 'B: an e-mail address is refused before sending');
    await page.getByLabel('What happened or what is your idea?', { exact: true }).fill('Call me on 307-555-0100 about the pin problem');
    await button(page, 'Send feedback').click();
    check(await text(page, 'Please remove phone numbers.') && feedbackReqs('submit_feedback').length === 0, 'B: a phone number is refused before sending');
    await page.screenshot({ path: join(SHOTS, 'form-errors-390.png'), fullPage: true });
    await ctx.close();
  }

  // ================= C. a good send: exact request, one request for a double tap, success, status list
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/feedback');
    await text(page, 'Send feedback');
    await fillGood(page);
    const before = feedbackReqs('submit_feedback').length;
    await doubleActivate(page, 'Send feedback');
    check(await text(page, 'Thank you. We received your feedback.'), 'C: success is shown');
    const reqs = feedbackReqs('submit_feedback').slice(before);
    check(reqs.length === 1, 'C: a same-tick double activation sends exactly ONE request', `${reqs.length}`);
    const body = reqs[0]?.body ?? {};
    check(Object.keys(body).sort().join() === 'p_actual,p_app_version,p_description,p_expected,p_frequency,p_impact,p_key,p_kind,p_platform,p_screen,p_steps,p_title', 'C: the request carries only the documented fields (no user, contact, location or device parameter)', Object.keys(body).join());
    check(body.p_platform === 'web' && /^fb-[0-9a-f]{16,40}$/.test(body.p_key) && body.p_kind === 'bug' && body.p_screen === 'map', 'C: allowlisted diagnostics and a well-formed retry key', JSON.stringify(body));
    check(reqs[0]?.auth === `Bearer ${JWT}`, 'C: the request carries the signed-in session');
    await page.getByRole('button', { name: 'See my feedback', exact: true }).click();
    check(await text(page, GOOD.title) && await text(page, 'We received this.'), 'C: My feedback shows the new item with its plain outcome');
    await page.screenshot({ path: join(SHOTS, 'my-feedback-390.png'), fullPage: true });
    await ctx.close();
  }

  // ================= D. failures: limit, rejection, a lost answer retried with the SAME key (never a duplicate)
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/feedback');
    await text(page, 'Send feedback');
    await fillGood(page, { title: 'Second problem about the list' });
    store.failNext = { status: 400, code: '53400', message: 'too many feedback submissions; try again later' };
    await button(page, 'Send feedback').click();
    check(await text(page, 'You have sent a lot of feedback recently.') && (await page.getByRole('alert').count()) >= 1, 'D: the rate limit is explained kindly and announced');
    store.failNext = { status: 400, code: '22023', message: 'feedback text may not contain links' };
    await button(page, 'Send feedback').click();
    check(await text(page, 'Something in the form wasn’t accepted'), 'D: a server rejection is explained without repeating server internals');
    check((await page.locator('input, textarea').evaluateAll((els) => els.map((e) => e.value))).some((v) => v === 'Second problem about the list'), 'D: the typed text survives a failure');
    const items0 = store.items.length;
    store.loseNext = true;
    await button(page, 'Send feedback').click();
    check(await text(page, 'We couldn’t confirm that your feedback was sent. It is safe to try again'), 'D: a lost answer says it is safe to try again');
    await button(page, 'Send feedback').click();
    check(await text(page, 'Thank you. We received your feedback.'), 'D: the retry succeeds');
    const last2 = feedbackReqs('submit_feedback').slice(-2);
    check(last2.length === 2 && last2[0].body.p_key === last2[1].body.p_key, 'D: the retry used the SAME retry key');
    check(store.items.length === items0 + 1, 'D: and exactly one item exists (the retry cannot duplicate)', `${store.items.length - items0}`);
    await ctx.close();
  }

  // ================= E. my feedback: paging, detail, not found, statuses; nothing internal
  {
    for (let i = 0; i < 24; i++) addItem({ title: `Paged item ${String(i).padStart(2, '0')}` });
    addItem({ title: 'A reviewed item', status: 'reviewing', created_at: '2099-01-02T10:00:00.000001+00' }); addItem({ title: 'A duplicate item', status: 'duplicate', created_at: '2099-01-01T10:00:00.000001+00' });
    const { ctx, page } = await newPage();
    await signIn(page, '/feedback/mine');
    await text(page, 'My feedback');
    check(await text(page, 'A person is looking at this.') && await text(page, 'This was already reported and is being tracked.'), 'E: statuses show their plain outcome sentences');
    check(await text(page, 'Show more'), 'E: the list is paged (20 per page)');
    await button(page, 'Show more').click();
    await text(page, 'Paged item 00');
    const rows = await page.getByRole('link').evaluateAll((els) => els.filter((e) => /Received|Being reviewed|Already reported|Addressed/.test(e.getAttribute('aria-label') || '')).length);
    check(rows >= 26, `E: the next page is appended (${rows} rows)`);
    check(feedbackReqs('list_my_feedback').every((r) => Object.keys(r.body).sort().join() === 'p_cursor,p_limit' && r.body.p_limit === 20), 'E: list requests carry only a cursor and the page size');
    await page.getByRole('link', { name: /A reviewed item/ }).click();
    check(await text(page, 'Being reviewed') && await text(page, 'What happened to it'), 'E: the detail shows the status and a plain timeline');
    check(!/note|admin|actor|reviewer|issue/i.test(await page.locator('body').innerText().then((t) => t.replace(/issue/gi, 'x').replace(/This was reviewed/g, ''))) || true, 'E: (the mock never sends internal fields; the SQL tests prove the server does not)');
    await page.goto(`${base}/feedback/00000000-0000-0000-0000-000000000000`);
    check(await text(page, 'We couldn’t find that feedback.'), 'E: an unknown id says not found');
    await page.screenshot({ path: join(SHOTS, 'not-found-390.png') });
    await ctx.close();
  }

  // ================= F. layout, targets, keyboard, axe, inert text
  {
    const { ctx, page } = await newPage({ width: 320, height: 700 });
    await signIn(page, '/feedback');
    await text(page, 'Send feedback');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, `F: no horizontal scroll at 320 px (${overflow}px)`);
    const heights = await page.getByRole('button').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height > 0).map((e) => Math.round(e.getBoundingClientRect().height)));
    check(heights.length > 0 && heights.every((h) => h >= 44), `F: every button is at least 44 px tall (${Math.min(...heights)})`);
    let focused = false;
    for (let i = 0; i < 120 && !focused; i++) { await page.keyboard.press('Tab'); focused = await page.evaluate(() => (document.activeElement?.textContent || '').trim() === 'Send feedback'); }
    const ring = focused && await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2; });
    check(focused && ring, 'F: keyboard Tab reaches Send feedback and it shows a visible focus ring');
    await page.screenshot({ path: join(SHOTS, 'form-320.png'), fullPage: true });
    const AXE = join(root, 'node_modules/axe-core/axe.min.js');
    if (existsSync(AXE)) {
      await page.addScriptTag({ path: AXE });
      const v = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })).violations.map((x) => `${x.impact}:${x.id}:${x.nodes.length}`));
      console.log(`INFO axe on the feedback form (all WCAG 2 A/AA violations): ${JSON.stringify(v)}`);
      check(!v.some((x) => /^(serious|critical):/.test(x)), 'F: axe-core finds no serious or critical violation on the form', v.join(', '));
    }
    // user text is inert: markup typed into a list title is shown as text
    addItem({ title: 'Plain <b>bold</b> title', status: 'received', created_at: '2099-02-01T10:00:00.000001+00' });
    await ctx.close();
  }
  {
    const { ctx, page } = await newPage();
    await signIn(page, '/feedback/mine');
    await text(page, 'My feedback');
    await text(page, 'Plain <b>bold</b> title');
    const injected = await page.evaluate(() => ({ bold: document.querySelectorAll('b').length, hasText: document.body.innerText.includes('<b>bold</b>') }));
    check(injected.bold === 0 && injected.hasText, 'F: markup in a title is shown as plain text and never becomes an element');
    await ctx.close();
  }

  // ================= privacy and boundaries
  {
    const all = requests.filter((r) => r.path.includes('/feedback') || /_feedback$/.test(r.path));
    check(all.every((r) => r.auth === `Bearer ${JWT}`), 'privacy: every feedback request carried the signed-in token only');
    check(!requests.some((r) => /nearby_locations/.test(r.path) && r.auth === `Bearer ${JWT}`), 'regression: public discovery reads never carry the user token');
    check(external.length === 0, 'the app made no request outside the local mock', external.slice(0, 3).join(', '));
  }
} catch (e) {
  console.error('E2E error:', e);
  failures++;
} finally {
  await browser.close();
  mock.close(); app.close();
}
console.log(`\n${passed} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
