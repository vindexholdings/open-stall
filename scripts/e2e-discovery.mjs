#!/usr/bin/env node
// Real-browser test of the public discovery experience (R1: home, list/map, filters, navigation, states)
// against a LOCAL MOCK of the REST API. Builds the actual Expo web export and drives it with Playwright
// (headless Chromium). Signed-out throughout: discovery never needs an account. Contacts no real service:
// every non-local request (map tiles, fonts) is aborted. Also writes screenshots to docs/evidence/r1/.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';

const root = new URL('..', import.meta.url).pathname;
const MOCK_PORT = 54399;
const ANON = 'mock-anon-key-not-real';
const SHOTS = join(root, 'docs/evidence/r1');
const HERE = { latitude: 44.5263, longitude: -109.0565, accuracy: 10 };

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const app of ['Google Chrome', 'Chromium']) for (const home of ['', process.env.HOME ?? '']) { const p = `${home}/Applications/${app}.app/Contents/MacOS/${app}`; if (existsSync(p)) return p; }
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

// ---------------------------------------------------------------- mock backend
const row = (o) => ({ id: o.id, name: o.name, address_line: o.address ?? null, city: 'Cody', region: 'WY', postal_code: null, latitude: o.lat, longitude: -109.0565,
  verification: o.verification, last_verified_at: o.verification === 'verified' ? '2026-09-01T00:00:00Z' : null, opening_hours: null, fee_required: o.fee ?? null,
  key_required: o.key ?? null, purchase_required: o.purchase ?? null, wheelchair_accessible: o.wheelchair ?? null, gender_neutral: null, baby_changing: null,
  has_hot_water: null, has_cold_water: null, access_location: null, average_rating: o.rating ?? null, rating_count: o.count ?? 0, attribution: null, distance_m: null });
const ROWS = [
  row({ id: '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d01', name: 'Cody Library Restroom', address: '1 Library Way', lat: 44.5273, verification: 'verified', key: false, purchase: false, wheelchair: true, rating: 4.5, count: 12 }),
  row({ id: '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d02', name: 'Park Pavilion Restroom', lat: 44.53, verification: 'unverified' }),
  row({ id: '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d03', name: 'Corner Gas Station', address: '9 Main St', lat: 44.534, verification: 'verified', key: true, purchase: true, rating: 3, count: 4 }),
  row({ id: '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d04', name: 'Far Trailhead Restroom', lat: 44.55, verification: 'unverified', wheelchair: true }),
];
const ORDER = ROWS.map((r) => r.name);
let mode = 'ok'; // ok | error | empty | network
const requests = [];
const mock = createServer(async (req, res) => {
  const u = new URL(req.url, `http://127.0.0.1:${MOCK_PORT}`);
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  const json = (status, obj) => { res.writeHead(status, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(obj)); };
  requests.push({ path: u.pathname, auth: req.headers.authorization ?? null });
  if (u.pathname === '/rest/v1/rpc/nearby_locations') {
    if (mode === 'network') return req.socket.destroy();
    if (mode === 'error') return json(500, { message: 'boom' });
    return json(200, mode === 'empty' ? [] : ROWS);
  }
  if (u.pathname === '/rest/v1/rpc/nearest_verified_location') return json(200, []);
  if (u.pathname === '/rest/v1/rpc/get_public_location') {
    const id = JSON.parse(body || '{}').p_id;
    return json(200, ROWS.filter((r) => r.id === id));
  }
  return json(404, { msg: 'not mocked' });
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- build + serve the web app
// E2E_DISCOVERY_REUSE_BUILD=<dir> reuses (and keeps) a previous export for quick local iteration; CI never sets it.
const reuse = process.env.E2E_DISCOVERY_REUSE_BUILD;
const out = reuse && existsSync(join(reuse, 'index.html')) ? reuse : reuse ?? mkdtempSync(join(tmpdir(), 'open-stall-discovery-'));
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
const newPage = async ({ width = 390, height = 844, geolocation = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(geolocation ? { permissions: ['geolocation'], geolocation: HERE } : {}) });
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
const gone = (page, t) => page.getByText(t, { exact: false }).first().waitFor({ state: 'hidden', timeout: 4000 }).then(() => true, () => false);
const button = (page, name) => page.getByRole('button', { name, exact: true });
const cardNames = (page) => page.locator('[role="listitem"] [role="heading"]').allInnerTexts();
/** Tab until the focused element's accessible name includes `needle`. Returns whether it got there. */
async function tabTo(page, needle, max = 60) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const n = await page.evaluate(() => { const el = document.activeElement; return el ? (el.getAttribute('aria-label') || (el.textContent || '').trim()) : ''; });
    if (n.includes(needle)) return true;
  }
  return false;
}
async function findNearest(page) {
  await page.goto(`${base}/`);
  await button(page, 'Find Nearest Restroom').click();
  return text(page, 'Cody Library Restroom');
}

try {
  // 1. First screen and the single location prompt (narrow phone), fully by keyboard
  {
    const { ctx, page } = await newPage();
    await page.goto(`${base}/`);
    check(await text(page, 'Find the nearest restroom'), 'home explains what it does before asking for location');
    check(await text(page, 'It is not stored.'), 'home says location is used once and not stored');
    check((await page.getByRole('button', { name: 'Find Nearest Restroom' }).count()) === 1, 'exactly one "Find Nearest Restroom" button (no duplicate prompt)');
    check((await page.getByText('Sign in to', { exact: false }).count()) === 0, 'no account prompt on the discovery home');
    check((await page.locator('h1, [role="heading"][aria-level="1"]').first().innerText()) === 'Open Stall', 'page has one level-1 heading');
    check(await tabTo(page, 'Find Nearest Restroom', 25), 'the main button is reachable with the keyboard');
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
    check(ring.style === 'solid' && ring.width >= 2, 'the focused button shows a visible focus outline', JSON.stringify(ring));
    await page.screenshot({ path: join(SHOTS, 'narrow-1-start.png') });
    await page.keyboard.press('Enter');
    check(await text(page, 'Cody Library Restroom'), 'Enter on the focused button finds restrooms');
    await ctx.close();
  }

  // 2. Results: order, labels, summary, list/map switch, navigation (narrow)
  {
    const { ctx, page } = await newPage();
    check(await findNearest(page), 'results appear after granting location');
    check(await text(page, '4 restrooms nearby, nearest first'), 'results header summarizes the count');
    const names = await cardNames(page);
    check(JSON.stringify(names) === JSON.stringify(ORDER), 'results are ranked nearest first (distance-first ranking preserved)', JSON.stringify(names));
    check(await text(page, 'Nearest'), 'the nearest result is labeled in text');
    check((await page.getByText('? Unverified', { exact: true }).count()) === 2, 'unverified restrooms carry the Unverified badge (text and symbol)');
    check(await text(page, 'Community rating 4.5 / 5 (12 ratings)'), 'community ratings are labeled as community ratings');
    check((await page.getByText('Community rating', { exact: false }).count()) === 2, 'unrated restrooms show no rating');
    check(await text(page, 'No key needed'), 'known facts appear on the card');
    check((await page.getByText('Key required', { exact: true }).count()) === 1 && (await page.getByText('Wheelchair accessible', { exact: true }).count()) === 2, 'unknown facts are not shown as negatives');
    const link = page.getByRole('link', { name: /Cody Library Restroom/ });
    const label = await link.getAttribute('aria-label');
    check(/Nearest\. Cody Library Restroom\. Verified Sep 2026\. .*(ft|mi), ~\d+ min walk/.test(label ?? ''), 'a card has one meaningful spoken name', label ?? '');
    check((await page.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')) === 'true', 'List is the default view on a phone');
    await page.screenshot({ path: join(SHOTS, 'narrow-2-list.png') });

    // switch to map by keyboard
    await page.getByRole('radio', { name: 'Map' }).focus();
    await page.keyboard.press('Space');
    check(await page.getByRole('region', { name: /Map of nearby restrooms/ }).isVisible(), 'Map view shows a labeled map region');
    check((await page.locator('[role="listitem"]').count()) === 0, 'Map view hides the list (no duplicate content)');
    await page.screenshot({ path: join(SHOTS, 'narrow-3-map.png') });
    // the List | Map switch is one radio group: arrow keys move selection, one tab stop
    await page.keyboard.press('ArrowLeft');
    check((await page.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')) === 'true' && (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === 'List', 'ArrowLeft on the view switch selects List and moves focus');
    check((await page.getByRole('radiogroup', { name: 'Results view' }).getByRole('radio').evaluateAll((els) => els.filter((e) => e.tabIndex === 0).length)) === 1, 'the view switch has a single tab stop');
    check((await page.locator('[role="radio"][aria-selected]').count()) === 0, 'the view switch exposes checked, not selected');
    await page.getByRole('radio', { name: 'List' }).click();
    check(await text(page, 'Corner Gas Station'), 'switching back to List restores the results');

    // navigate to details, then back
    await page.getByRole('link', { name: /Corner Gas Station/ }).click();
    check(await text(page, 'Corner Gas Station') && page.url().includes('/location/'), 'a result opens its detail page', page.url());
    check(!/latitude|longitude|44\.52/.test(page.url()), 'the detail URL carries no coordinates');
    await ctx.close();
  }

  // 3. Filters (narrow)
  {
    const { ctx, page } = await newPage();
    await findNearest(page);
    const toggle = page.getByRole('button', { name: 'Show filters' });
    check((await toggle.getAttribute('aria-expanded')) === 'false', 'the filter toggle reports collapsed');
    await toggle.click();
    check((await page.getByRole('button', { name: 'Hide filters' }).getAttribute('aria-expanded')) === 'true', 'the filter toggle reports expanded');
    await page.screenshot({ path: join(SHOTS, 'narrow-4-filters.png') });
    await page.getByRole('checkbox', { name: 'Verified only', exact: true }).click();
    check(await gone(page, 'Park Pavilion Restroom'), 'Verified only hides unverified restrooms');
    check(JSON.stringify(await cardNames(page)) === JSON.stringify(['Cody Library Restroom', 'Corner Gas Station']), 'the remaining results keep distance order');
    await page.getByRole('button', { name: 'Hide filters' }).click();
    check(await text(page, 'Verified only  ✕'), 'a collapsed filter panel still shows the active filter');
    check(await text(page, '2 restrooms nearby, filtered'), 'the header says results are filtered');
    await button(page, 'Remove filter: Verified only').click();
    check(await text(page, 'Park Pavilion Restroom'), 'removing the active-filter chip restores results');
    // filter that matches nothing -> recoverable empty state
    await page.getByRole('button', { name: 'Show filters' }).click();
    await page.getByRole('checkbox', { name: 'Baby changing', exact: true }).click();
    check(await text(page, 'No restrooms match your filters'), 'a filter with no matches explains why the list is empty');
    await button(page, 'Clear all filters').first().click();
    check(await text(page, 'Cody Library Restroom') && (await cardNames(page)).length === 4, 'Clear all filters recovers the full list');
    await page.getByRole('checkbox', { name: 'Wheelchair accessible', exact: true }).click();
    check(JSON.stringify(await cardNames(page)) === JSON.stringify(['Cody Library Restroom', 'Far Trailhead Restroom']), 'an accessibility filter matches only restrooms known to be accessible');

    // R1 corrections: action semantics, radio-group keyboard behavior, purchase wording
    const clear = page.getByRole('button', { name: 'Clear all filters' });
    check((await clear.count()) === 1 && (await clear.getAttribute('aria-checked')) === null, 'Clear all is a button with no checked state');
    const hide = page.getByRole('button', { name: 'Hide filters' });
    check((await hide.getAttribute('aria-checked')) === null && (await page.getByRole('checkbox', { name: /filters/i }).count()) === 0, 'the filters disclosure is a button, not a checkbox');
    await hide.focus();
    await page.keyboard.press('Enter');
    check((await page.getByRole('button', { name: /Show filters/ }).getAttribute('aria-expanded')) === 'false', 'Enter collapses the disclosure and updates aria-expanded');
    await page.keyboard.press('Space');
    check((await page.getByRole('button', { name: 'Hide filters' }).getAttribute('aria-expanded')) === 'true', 'Space expands the disclosure and updates aria-expanded');
    check((await page.locator('[role="radio"][aria-selected]').count()) === 0, 'no radio exposes the extraneous aria-selected');

    const distance = page.getByRole('radiogroup', { name: 'Distance' });
    const radios = distance.getByRole('radio');
    const tabStops = async () => radios.evaluateAll((els) => els.filter((e) => e.tabIndex === 0).map((e) => e.getAttribute('aria-label')));
    const checked = async () => radios.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-checked') === 'true').map((e) => e.getAttribute('aria-label')));
    check(JSON.stringify(await tabStops()) === JSON.stringify(await checked()) && (await tabStops()).length === 1, 'a radio group has a single tab stop on the selected radio', JSON.stringify(await tabStops()));
    const before = (await checked())[0];
    await radios.filter({ has: page.getByText(before, { exact: true }) }).first().focus();
    await page.keyboard.press('ArrowRight');
    const afterRight = await checked();
    check(afterRight.length === 1 && afterRight[0] !== before, 'ArrowRight moves selection to the next radio', `${before} -> ${afterRight[0]}`);
    check((await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === afterRight[0], 'focus follows the arrow-key selection');
    await page.keyboard.press('ArrowLeft');
    check(JSON.stringify(await checked()) === JSON.stringify([before]), 'ArrowLeft moves back');
    await radios.first().focus();
    await page.keyboard.press('ArrowLeft');
    check((await checked())[0] === (await radios.last().getAttribute('aria-label')), 'arrow keys wrap from the first radio to the last');
    await page.keyboard.press('Tab');
    check(!(await page.evaluate(() => !!document.activeElement?.closest('[role="radiogroup"][aria-label="Distance"]'))), 'Tab leaves the radio group after one stop');

    // the purchase filter never claims a restroom is free
    const purchase = page.getByRole('radiogroup', { name: 'Purchase' });
    check((await purchase.getByRole('radio', { name: 'No purchase needed' }).count()) === 1 && (await purchase.getByText(/^Free$/).count()) === 0, 'the purchase filter says "No purchase needed", not "Free"');
    await purchase.getByRole('radio', { name: 'No purchase needed' }).click();
    check(await text(page, 'No purchase required') && (await page.getByText('Free to use').count()) === 0, 'the active purchase chip reads "No purchase required"');
    await ctx.close();
  }

  // 4. Wide layout: list and map side by side, no view switch
  {
    const { ctx, page } = await newPage({ width: 1280, height: 800 });
    await findNearest(page);
    check(await page.getByRole('region', { name: /Map of nearby restrooms/ }).isVisible(), 'wide screens show the map');
    check((await cardNames(page)).length === 4, 'wide screens show the list at the same time');
    check((await page.getByRole('radio', { name: 'Map' }).count()) === 0, 'wide screens have no List/Map switch to operate');
    const boxes = await page.evaluate(() => {
      const list = document.querySelector('[role="list"]').getBoundingClientRect();
      const map = document.querySelector('[role="region"]').getBoundingClientRect();
      return { listRight: list.right, mapLeft: map.left, contentWidth: document.querySelector('[role="list"]').closest('div').parentElement.getBoundingClientRect().width };
    });
    check(boxes.mapLeft >= boxes.listRight - 1, 'the map sits beside the list, not over it', JSON.stringify(boxes));
    await page.screenshot({ path: join(SHOTS, 'wide-1-discovery.png') });
    await ctx.close();
  }

  // 5. Layout robustness, names and targets
  {
    const { ctx, page } = await newPage({ width: 320, height: 640 });
    await findNearest(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(overflow <= 1, 'no horizontal scrolling at 320 CSS px (reflow)', String(overflow));
    await page.getByRole('button', { name: 'Show filters' }).click();
    const audit = await page.evaluate(() => {
      const sel = '[role="button"],[role="link"],[role="radio"],[role="checkbox"],button,a';
      const els = [...document.querySelectorAll(sel)].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      const unnamed = els.filter((e) => !(e.getAttribute('aria-label') || (e.textContent || '').trim())).length;
      const small = els.filter((e) => e.getBoundingClientRect().height < 47.5).map((e) => (e.getAttribute('aria-label') || e.textContent || '').slice(0, 30));
      const heads = [...document.querySelectorAll('[role="heading"]')].map((h) => h.getAttribute('aria-level'));
      return { count: els.length, unnamed, small, heads };
    });
    check(audit.count > 10, 'the audit found the interactive controls', JSON.stringify(audit));
    check(audit.unnamed === 0, 'every interactive control has an accessible name');
    check(audit.small.length === 0, 'every interactive control is at least 48 px tall', JSON.stringify(audit.small));
    check(audit.heads[0] === '1' && audit.heads.filter((h) => h === '1').length === 1, 'exactly one level-1 heading', JSON.stringify(audit.heads));
    await ctx.close();
  }

  // 6. Location denied and recovery
  {
    const { ctx, page } = await newPage();
    await page.addInitScript(() => {
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: (_ok, fail) => fail({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1 }) });
      Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: async () => ({ state: 'denied', addEventListener() {}, removeEventListener() {} }) });
    });
    await page.goto(`${base}/`);
    await button(page, 'Find Nearest Restroom').click();
    check(await text(page, 'Location is turned off'), 'denied location is explained plainly');
    check(await text(page, 'lock icon'), 'the browser instructions are specific');
    check((await page.getByRole('alert').count()) >= 1, 'the denied state is announced as an alert');
    check((await page.getByText('Sign in to', { exact: false }).count()) === 0, 'denied location does not ask for an account');
    await page.screenshot({ path: join(SHOTS, 'narrow-5-denied.png') });
    await page.evaluate(() => { delete navigator.geolocation.getCurrentPosition; delete navigator.permissions.query; });
    await ctx.close();
    const second = await newPage();
    await second.page.addInitScript(() => {
      let deny = true; window.__allow = () => { deny = false; };
      const real = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
      Object.defineProperty(navigator.geolocation, 'getCurrentPosition', { configurable: true, value: (ok, fail, opts) => (deny ? fail({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1 }) : real(ok, fail, opts)) });
    });
    await second.page.goto(`${base}/`);
    await button(second.page, 'Find Nearest Restroom').click();
    check(await text(second.page, 'We couldn’t find your location') || await text(second.page, 'Location is turned off'), 'a failed location lookup shows a recoverable notice');
    await second.page.evaluate(() => window.__allow());
    await button(second.page, 'Try again').click();
    check(await text(second.page, 'Cody Library Restroom'), 'Try again recovers once location works');
    await second.ctx.close();
  }

  // 7. Service error, empty area, offline
  {
    const { ctx, page } = await newPage();
    mode = 'error';
    await page.goto(`${base}/`);
    await button(page, 'Find Nearest Restroom').click();
    check(await text(page, 'We couldn’t load restrooms'), 'a server error is explained');
    check((await page.getByRole('alert').count()) >= 1, 'the error is announced as an alert');
    mode = 'ok';
    await button(page, 'Try again').click();
    check(await text(page, 'Cody Library Restroom'), 'Try again recovers after the service returns');
    await ctx.close();

    const e = await newPage();
    mode = 'empty';
    await e.page.goto(`${base}/`);
    await button(e.page, 'Find Nearest Restroom').click();
    check(await text(e.page, 'No restrooms found nearby yet'), 'an empty area is explained');
    check((await button(e.page, 'Check again').count()) === 1, 'the empty state offers a next step');
    await e.page.screenshot({ path: join(SHOTS, 'narrow-6-empty.png') });
    await e.ctx.close();

    // offline: first visit saves verified restrooms; then the network fails
    const o = await newPage();
    mode = 'ok';
    await findNearest(o.page);
    mode = 'network';
    await o.page.reload();
    await button(o.page, 'Find Nearest Restroom').click();
    check(await text(o.page, 'You’re offline'), 'when the network fails, saved results are labeled offline');
    check(await text(o.page, 'Cody Library Restroom'), 'saved restrooms are still shown offline');
    mode = 'ok';
    await o.ctx.close();
  }

  // 8. Privacy and public access
  {
    const nearby = requests.filter((r) => r.path === '/rest/v1/rpc/nearby_locations');
    check(nearby.length > 0, 'searches were made');
    check(nearby.every((r) => r.auth === `Bearer ${ANON}`), 'discovery uses only the public anon key (no account, no user token)');
    check(external.every((u) => /tile|openstreetmap|fonts|gstatic/i.test(u)) , 'the only external requests attempted were map tiles/fonts, all blocked in this test', JSON.stringify(external.slice(0, 5)));
  }
} finally {
  await browser.close();
  mock.close(); app.close();
  if (!reuse) rmSync(out, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failures} failed.`);
if (failures) process.exit(1);
console.log('Discovery e2e passed.');
process.exit(0);
