#!/usr/bin/env node
// OS-A11Y-NAV-TEXT200 (F3): real-browser measurement of the shared navigation bars (MainNav on the tab roots, PushedNav on opened
// screens) at normal text and at ACTUAL 2x text, at 320 / 390 / 1024 px. Text is enlarged with the project's existing technique
// (every element that owns text gets font-size and line-height x2): this is a rendering measurement, NOT native font scaling,
// VoiceOver, TalkBack or a physical device. Local mock only (every non-local request is aborted). Writes docs/evidence/f3/.
import { Buffer } from 'node:buffer';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK_PORT = 54511;
const ANON = 'mock-anon-key-not-real';
const SHOTS = join(root, 'docs/evidence/f3');
const USER = { id: '11111111-2222-4333-8444-555555555555', email: 'user@test.dev', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' };
const GOOD_PW = 'correct horse battery';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const JWT = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: USER.id, role: 'authenticated', exp: 4102444800 })}.sig`;
const session = () => ({ access_token: JWT, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'refresh-token-1', user: USER });
const LOC = '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d21';
const FB = '3f2b9c1e-8f55-4a52-9d3a-000000000001';
const FB_ITEM = { id: FB, kind: 'bug', screen: 'map', title: 'The map pin jumps when I zoom in on a narrow screen', status: 'received', outcome: 'We have your feedback.', created_at: '2026-10-30T10:00:00Z', updated_at: '2026-10-30T10:00:00Z' };
const ROW = { id: LOC, name: 'Mock Park Restroom', address_line: '1 Park Way', city: 'Cody', region: 'WY', postal_code: null, latitude: 44.5273, longitude: -109.0565, verification: 'verified',
  last_verified_at: '2026-09-01T00:00:00Z', opening_hours: null, fee_required: null, key_required: false, purchase_required: false, wheelchair_accessible: true, gender_neutral: null,
  baby_changing: null, has_hot_water: null, has_cold_water: null, access_location: null, average_rating: null, rating_count: 0, attribution: null, distance_m: null };

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const app of ['Google Chrome', 'Chromium']) for (const home of ['', process.env.HOME ?? '']) { const p = `${home}/Applications/${app}.app/Contents/MacOS/${app}`; if (existsSync(p)) return p; }
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const cors = { connection: 'close', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  const data = body ? JSON.parse(body) : {};
  const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
  if (u.pathname === '/auth/v1/token' && u.searchParams.get('grant_type') === 'password') return data.password === GOOD_PW ? json(200, session()) : json(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
  if (u.pathname === '/auth/v1/token') return json(200, session());
  if (u.pathname === '/auth/v1/user') return json(200, USER);
  if (u.pathname === '/auth/v1/logout') { res.writeHead(204, cors); return res.end(); }
  if (u.pathname === '/rest/v1/rpc/nearby_locations' || u.pathname === '/rest/v1/rpc/nearest_verified_location') return json(200, []);
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    const fn = u.pathname.slice('/rest/v1/rpc/'.length);
    if (fn === 'get_public_location') return json(200, data.p_id === LOC ? [ROW] : []);
    if (fn === 'get_my_profile') return json(200, [{ display_name: null, preferred_mode: 'plain', default_transport: 'walk', points_balance: 0 }]);
    if (fn === 'list_my_feedback') return json(200, { items: [FB_ITEM], next_cursor: null });
    if (fn === 'get_my_feedback') return json(200, { ...FB_ITEM, description: 'When I zoom the map with two fingers the pin moves away from the place I chose, and I have to start again every time this happens.', expected: null, actual: null, steps: null, frequency: null, impact: null, app_version: null, platform: 'web', timeline: [{ status: 'received', at: FB_ITEM.created_at }] });
    if (fn.startsWith('list_') || fn.endsWith('_list')) return json(200, []);
    return json(200, null);
  }
  return json(404, { msg: 'not mocked' });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

const reuse = process.env.E2E_NAV_REUSE_BUILD;
const out = reuse ?? mkdtempSync(join(tmpdir(), 'open-stall-nav-'));
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

let failures = 0; let passed = 0;
const external = [];
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (ok) passed++; else failures++; };
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const newPage = async (width, height) => {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.route('**/*', (route) => { const url = new URL(route.request().url()); if (url.hostname === '127.0.0.1' || url.hostname === 'localhost' || url.protocol === 'data:') return route.continue(); external.push(url.href); return route.abort(); });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  return { ctx, page };
};
const scaleText = (page, k) => page.evaluate((f) => {
  for (const el of document.querySelectorAll('body *')) {
    const c = getComputedStyle(el);
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { el.style.fontSize = `${parseFloat(c.fontSize) * f}px`; if (c.lineHeight !== 'normal') el.style.lineHeight = `${parseFloat(c.lineHeight) * f}px`; }
  }
}, k);
const signIn = async (page) => {
  await page.goto(`${base}/auth/sign-in`);
  await page.getByLabel('Email').fill(USER.email); await page.getByLabel('Password', { exact: true }).fill(GOOD_PW);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await page.waitForTimeout(1200);
};

/** Everything measured about the navigation landmark and the page around it, in CSS px. */
const measure = (page) => page.evaluate(() => {
  const nav = document.querySelector('[role="navigation"][aria-label="Main"]');
  if (!nav) return { nav: false };
  const r = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
  const items = [...nav.querySelectorAll('a[role="link"], [role="tab"], [role="button"], a')].filter((e) => e.checkVisibility());
  const labels = items.map((a) => {
    const t = [...a.querySelectorAll('div,span')].find((e) => e.children.length === 0 && e.textContent.trim());
    const tb = t.getBoundingClientRect(); const ab = a.getBoundingClientRect();
    const range = document.createRange(); range.selectNodeContents(t);
    const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top))).size;
    return { text: t.textContent.trim(), box: { l: tb.left, t: tb.top, r: tb.right, b: tb.bottom }, item: { l: ab.left, t: ab.top, r: ab.right, b: ab.bottom, w: ab.width, h: ab.height }, lines,
      clipped: t.scrollWidth > t.clientWidth + 1 || t.scrollHeight > t.clientHeight + 1, textW: Math.max(0, ...[...range.getClientRects()].map((q) => q.width)) };
  });
  const overlaps = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i].item; const b = labels[j].item;
    if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) overlaps.push(`${labels[i].text}/${labels[j].text}`);
  }
  const textOverlaps = [];
  for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) {
    const a = labels[i].box; const b = labels[j].box;
    if (a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5) textOverlaps.push(`${labels[i].text}/${labels[j].text}`);
  }
  const sc = document.scrollingElement;
  return { nav: true, navBox: r(nav), count: items.length, labels, overlaps, textOverlaps, pageX: sc.scrollWidth - window.innerWidth, vw: window.innerWidth, vh: window.innerHeight,
    textOutside: labels.filter((l) => l.box.l < l.item.l - 0.5 || l.box.r > l.item.r + 0.5 || l.box.t < l.item.t - 0.5 || l.box.b > l.item.b + 0.5).map((l) => l.text) };
});
/** The last actionable control inside the page's scroll area, scrolled to the end: is it uncovered and above the bar? */
const clearance = (page) => page.evaluate(async () => {
  const nav = document.querySelector('[role="navigation"][aria-label="Main"]');
  const main = document.querySelector('[role="main"]');
  if (!nav || !main) return null;
  let sc = main.parentElement; while (sc && sc !== document.body && !(sc.scrollHeight > sc.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(sc).overflowY))) sc = sc.parentElement;
  if (sc && sc !== document.body) sc.scrollTop = sc.scrollHeight; else window.scrollTo(0, document.body.scrollHeight);
  await new Promise((r) => setTimeout(r, 150));
  const acts = [...main.querySelectorAll('a,button,input,textarea,[role="button"],[role="link"],[tabindex="0"]')].filter((e) => e.checkVisibility() && e.getBoundingClientRect().height > 0);
  const nb = nav.getBoundingClientRect();
  const lastBottom = Math.max(...[...main.querySelectorAll('*')].filter((e) => e.checkVisibility() && e.getBoundingClientRect().height > 0).map((e) => e.getBoundingClientRect().bottom));
  // Only controls that are on screen after scrolling to the end (a Back link at the top of a long page has scrolled away and is not "the last action").
  const last = acts.filter((e) => { const q = e.getBoundingClientRect(); return q.bottom > 0 && q.top < nb.top; }).at(-1);
  let covered = false;
  if (last) { const b = last.getBoundingClientRect(); const top = document.elementFromPoint(b.left + b.width / 2, Math.min(b.top + b.height / 2, nb.top - 1)); covered = !(top && (last === top || last.contains(top) || top.contains(last))); }
  return { navTop: nb.top, lastContentBottom: lastBottom, gap: nb.top - lastBottom, lastActionable: last ? (last.getAttribute('aria-label') || last.textContent || '').trim().slice(0, 30) : null, covered };
});

const SCREENS = [
  ['tab root: Nearby', '/', 'main', true],
  ['tab root: Favorites', '/favorites', 'main', true],
  ['tab root: Account', '/account', 'main', true],
  ['tab root: Settings', '/settings', 'main', true],
  ['pushed: restroom detail', `/location/${LOC}`, 'pushed', false],
  ['pushed: feedback form', '/feedback', 'pushed', true],
  ['pushed: my feedback', '/feedback/mine', 'pushed', true],
  ['pushed: feedback detail', `/feedback/${FB}`, 'pushed', true],
  ['pushed: add a restroom', '/contribute', 'pushed', true],
  ['pushed: report', `/report?id=${LOC}`, 'pushed', true],
  ['pushed: sign in', '/auth/sign-in', 'pushed', false],
];
const WIDTHS = [[320, 700], [390, 844], [1024, 768]];
const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
try {
  const summary = [];
  for (const [name, path, kind, authed] of SCREENS) {
    for (const [w, h] of WIDTHS) for (const k of [1, 2]) {
      const { ctx, page } = await newPage(w, h);
      if (authed) await signIn(page);
      await page.goto(`${base}${path}`); await page.waitForTimeout(1300);
      if (k === 2) { await scaleText(page, 2); await page.waitForTimeout(400); }
      const m = await measure(page);
      const tag = `${name} @${w}px ${k === 1 ? 'normal' : '2x'} text`;
      if (!m.nav) { check(false, `${tag}: the navigation bar is present`); await ctx.close(); continue; }
      const c = await clearance(page);
      const wrapped = m.labels.map((l) => l.lines).join('/');
      summary.push({ tag, pageX: Math.round(m.pageX), barH: Math.round(m.navBox.h), minItemH: Math.round(Math.min(...m.labels.map((l) => l.item.h))), lines: wrapped, gap: c ? Math.round(c.gap) : null });
      check(m.count === 4 && m.labels.map((l) => l.text).join(',') === (kind === 'main' || kind === 'pushed' ? 'Nearby,Favorites,Account,Settings' : ''), `${tag}: all four labels present once`, JSON.stringify(m.labels.map((l) => l.text)));
      check(m.overlaps.length === 0 && m.textOverlaps.length === 0, `${tag}: no label or item overlaps another`, JSON.stringify({ items: m.overlaps, text: m.textOverlaps }));
      check(m.textOutside.length === 0 && m.labels.every((l) => !l.clipped), `${tag}: no label is clipped or leaves its item`, JSON.stringify({ outside: m.textOutside, clipped: m.labels.filter((l) => l.clipped).map((l) => l.text) }));
      check(m.pageX <= 0, `${tag}: no sideways page scroll (scrollWidth - viewport = ${Math.round(m.pageX)})`, `${m.pageX}`);
      check(m.labels.every((l) => l.item.h >= 48 - 0.5 && l.item.w >= 44), `${tag}: every item is at least 48 px tall and 44 px wide`, JSON.stringify(m.labels.map((l) => [Math.round(l.item.w), Math.round(l.item.h)])));
      if (c) check(!c.covered && c.gap >= -0.5, `${tag}: the last content/action stays above the bar (gap ${Math.round(c.gap)} px, last "${c.lastActionable}")`, JSON.stringify(c));
      if (w === 320 && k === 2) {
        await page.addScriptTag({ path: join(root, 'node_modules/axe-core/axe.min.js') });
        const run = (ctxSel) => page.evaluate(async (sel) => (await window.axe.run(sel ? { include: [[sel]] } : document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] })).violations.map((x) => `${x.impact}:${x.id}:${x.nodes.length}`), ctxSel);
        const navV = await run('[role="navigation"][aria-label="Main"]');
        const pageV = await run(null);
        console.log(`INFO axe ${name} @320 2x: navigation ${JSON.stringify(navV)}; whole page ${JSON.stringify(pageV)}`);
        check(navV.length === 0, `${tag}: axe finds no WCAG 2 A/AA violation in the navigation landmark`, navV.join(', '));
        check(!pageV.some((x) => /^(serious|critical):/.test(x)), `${tag}: axe finds no serious or critical violation on the whole page (all findings are logged as INFO)`, pageV.join(', '));
      }
      if (w === 320 && k === 2) await page.screenshot({ path: join(SHOTS, `nav-${slug(name)}-320-text200.png`) });
      await ctx.close();
    }
  }
  console.log('SUMMARY ' + JSON.stringify(summary));
  check(external.length === 0, 'no non-local request was attempted', JSON.stringify(external.slice(0, 5)));
} finally { await browser.close(); mock.close(); app.close(); }
console.log(`\n${passed} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
