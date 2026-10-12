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
  row({ id: '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d04', name: 'Far Trailhead Restroom', lat: 44.538, verification: 'unverified', wheelchair: true }),
  // beyond the 1 mile default radius from HERE (about 2.3 mi), so it appears only after choosing a farther distance
  row({ id: '3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d05', name: 'Distant Overlook Restroom', lat: 44.56, verification: 'unverified' }),
];
const ORDER = ROWS.slice(0, 4).map((r) => r.name);
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
const newPage = async ({ width = 390, height = 844, geolocation = true, at = HERE } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, ...(geolocation ? { permissions: ['geolocation'], geolocation: at } : {}) });
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
/** The filter sheet slides in and out, so wait for the dialog to be (in)active instead of reading it at once. */
const dialogOpen = (page) => page.getByRole('dialog', { name: 'Filters' }).waitFor({ state: 'visible' }).then(() => true, () => false);
const dialogClosed = (page) => page.getByRole('dialog').waitFor({ state: 'detached', timeout: 5000 }).then(() => true, () => false);
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
async function findNearestAny(page) {
  await page.goto(`${base}/`);
  await button(page, 'Find Nearest Restroom').click();
  return true;
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
    check((await page.getByText('Unverified', { exact: true }).count()) === 2, 'unverified restrooms carry the Unverified badge (the word; the icon is decorative)');
    check(await text(page, 'Community rating 4.5 / 5 (12 ratings)'), 'community ratings are labeled as community ratings');
    check((await page.getByText('Community rating', { exact: false }).count()) === 2, 'unrated restrooms show no rating');
    check(await text(page, 'No key needed'), 'known facts appear on the card');
    const listArea = page.getByRole('list').first();
    check((await listArea.getByText('Key required', { exact: true }).count()) === 1 && (await listArea.getByText('Wheelchair accessible', { exact: true }).count()) === 2, 'unknown facts are not shown as negatives');
    const link = page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ });
    const label = await link.getAttribute('aria-label');
    check(/Nearest\. Cody Library Restroom\. Verified Sep 2026\. .*(ft|mi) straight-line/.test(label ?? '') && !/min walk/.test(label ?? ''), 'a card has one meaningful spoken name (straight-line distance, no invented walking time)', label ?? '');
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

  // 3. Filters (narrow): a modal sheet with a draft, Apply, Clear and Cancel (D3)
  {
    const { ctx, page } = await newPage();
    await findNearest(page);
    const opener = page.getByRole('button', { name: 'Show filters' });
    check((await opener.getAttribute('aria-haspopup')) === 'dialog' && (await page.getByRole('dialog').count()) === 0, 'the Filters button opens a dialog (none is open yet)');
    await opener.click();
    const dlg = page.getByRole('dialog', { name: 'Filters' });
    check(await dialogOpen(page) && (await dlg.getAttribute('aria-modal')) === 'true', 'the filter sheet is a modal dialog named Filters');
    check(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')), 'focus moves into the dialog when it opens');
    check(await dlg.getByRole('heading', { name: 'Filters', level: 2 }).isVisible(), 'the dialog has a visible Filters title');
    await page.screenshot({ path: join(SHOTS, 'narrow-4-filters.png') });
    // Tab stays inside the dialog
    let escaped = false;
    for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); if (!(await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')))) { escaped = true; break; } }
    check(!escaped, 'keyboard focus stays inside the open dialog (40 Tab presses)');
    // draft: Cancel discards
    await dlg.getByRole('checkbox', { name: 'Verified only', exact: true }).click();
    check((await dlg.getByRole('checkbox', { name: 'Verified only', exact: true }).getAttribute('aria-checked')) === 'true' && (await cardNames(page)).length === 4, 'choosing a filter in the sheet is a draft: the list behind it has not changed');
    await dlg.getByRole('button', { name: 'Cancel and close filters' }).click();
    check(await dialogClosed(page) && (await cardNames(page)).length === 4 && (await button(page, 'Remove filter: Verified only').count()) === 0, 'Cancel closes the sheet and discards the draft');
    check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Show filters'), 'focus returns to the Filters button after Cancel');
    // draft: Escape discards, and a reopened sheet starts from the applied filters
    await opener.click();
    await dialogOpen(page);
    await dlg.getByRole('checkbox', { name: 'Verified only', exact: true }).click();
    await page.keyboard.press('Escape');
    check(await dialogClosed(page) && (await cardNames(page)).length === 4, 'Escape closes the sheet and discards the draft');
    check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Show filters'), 'focus returns to the Filters button after Escape');
    await opener.click();
    await dialogOpen(page);
    check((await dlg.getByRole('checkbox', { name: 'Verified only', exact: true }).getAttribute('aria-checked')) === 'false', 'a reopened sheet shows the applied filters, not the discarded draft');
    // Apply commits the whole draft at once
    await dlg.getByRole('checkbox', { name: 'Verified only', exact: true }).click();
    await dlg.getByRole('checkbox', { name: 'Wheelchair accessible', exact: true }).click();
    check((await cardNames(page)).length === 4, 'nothing is applied until Apply');
    await dlg.getByRole('button', { name: 'Apply filters' }).click();
    check(await dialogClosed(page) && JSON.stringify(await cardNames(page)) === JSON.stringify(['Cody Library Restroom']), 'Apply commits every draft choice together and closes the sheet', JSON.stringify(await cardNames(page)));
    check(await text(page, '1 restroom nearby, filtered') && await button(page, 'Remove filter: Verified only').first().isVisible() && await button(page, 'Remove filter: Wheelchair accessible').first().isVisible(), 'applied filters stay visible as chips and the header says results are filtered');
    check((await page.getByRole('button', { name: 'Show filters, 2 active' }).count()) === 1, 'the Filters button states how many filters are active');
    // selections survive reopening; Clear resets the draft visibly and Apply commits it
    await page.getByRole('button', { name: 'Show filters, 2 active' }).click();
    await dialogOpen(page);
    check((await dlg.getByRole('checkbox', { name: 'Verified only', exact: true }).getAttribute('aria-checked')) === 'true' && (await dlg.getByRole('checkbox', { name: 'Wheelchair accessible', exact: true }).getAttribute('aria-checked')) === 'true', 'applied selections are preserved when the sheet is reopened');
    await dlg.getByRole('button', { name: 'Clear', exact: true }).click();
    check((await dlg.getByRole('checkbox', { name: 'Verified only', exact: true }).getAttribute('aria-checked')) === 'false' && (await cardNames(page)).length === 1, 'Clear visibly resets the draft but changes nothing until Apply');
    await dlg.getByRole('button', { name: 'Apply filters' }).click();
    await dialogClosed(page);
    check((await cardNames(page)).length === 4 && (await button(page, 'Remove filter: Verified only').count()) === 0, 'Apply after Clear commits the reset');
    // a filter with no matches -> recoverable empty state; the outside Clear all stays obvious
    await opener.click();
    await dialogOpen(page);
    await dlg.getByRole('checkbox', { name: 'Baby changing', exact: true }).click();
    await dlg.getByRole('button', { name: 'Apply filters' }).click();
    await dialogClosed(page);
    check(await text(page, 'No restrooms match your filters'), 'a filter with no matches explains why the list is empty');
    await button(page, 'Clear all filters').first().click();
    check(await text(page, 'Cody Library Restroom') && (await cardNames(page)).length === 4, 'Clear all filters (outside the sheet) recovers the full list');
    // the chips remove one filter at a time
    await opener.click();
    await dialogOpen(page);
    await dlg.getByRole('checkbox', { name: 'Verified only', exact: true }).click();
    await dlg.getByRole('button', { name: 'Apply filters' }).click();
    await dialogClosed(page);
    await button(page, 'Remove filter: Verified only').click();
    check(await text(page, 'Park Pavilion Restroom'), 'removing the active-filter chip restores results');

    // radio groups keep their keyboard behavior inside the sheet
    await opener.click();
    await dialogOpen(page);
    const distance = dlg.getByRole('radiogroup', { name: 'Distance' });
    const radios = distance.getByRole('radio');
    const tabStops = async () => radios.evaluateAll((els) => els.filter((e) => e.tabIndex === 0).map((e) => e.getAttribute('aria-label')));
    const checked = async () => radios.evaluateAll((els) => els.filter((e) => e.getAttribute('aria-checked') === 'true').map((e) => e.getAttribute('aria-label')));
    check(JSON.stringify(await checked()) === JSON.stringify(['1 mi']), 'the default distance is 1 mile', JSON.stringify(await checked()));
    check(JSON.stringify(await tabStops()) === JSON.stringify(await checked()) && (await tabStops()).length === 1, 'a radio group has a single tab stop on the selected radio', JSON.stringify(await tabStops()));
    check(JSON.stringify(await radios.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))) === JSON.stringify(['1 mi', '2 mi', '5 mi', '10 mi', '25 mi']), 'every explicit distance choice is still offered');
    await radios.first().focus();
    await page.keyboard.press('ArrowRight');
    check(JSON.stringify(await checked()) === JSON.stringify(['2 mi']) && (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === '2 mi', 'ArrowRight moves selection and focus to the next radio');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    check(JSON.stringify(await checked()) === JSON.stringify(['25 mi']), 'arrow keys wrap from the first radio to the last');
    await dlg.getByRole('button', { name: 'Cancel and close filters' }).click();
    await dialogClosed(page);

    // Key and Purchase: Any / Required / Not required, with context in the group name
    await opener.click();
    await dialogOpen(page);
    const keyGroup = dlg.getByRole('radiogroup', { name: 'Key needed' });
    const purchase = dlg.getByRole('radiogroup', { name: 'Purchase needed' });
    check(JSON.stringify(await keyGroup.getByRole('radio').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))) === JSON.stringify(['Any', 'Required', 'Not required']), 'Key offers Any / Required / Not required');
    check(JSON.stringify(await purchase.getByRole('radio').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))) === JSON.stringify(['Any', 'Required', 'Not required']) && (await purchase.getByText(/^Free$/).count()) === 0, 'Purchase offers Any / Required / Not required and never says "Free"');
    await purchase.getByRole('radio', { name: 'Not required' }).click();
    await dlg.getByRole('button', { name: 'Apply filters' }).click();
    await dialogClosed(page);
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
      const map = document.querySelector('[role="region"][aria-label^="Map of"]').getBoundingClientRect();
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
    check(await text(e.page, 'No restrooms within 1 mi yet') && await button(e.page, 'Search within 2 mi').isVisible(), 'an empty area is explained and offers a farther search');
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


  // 9. Dashboard-first home (D1): nearest card, quick actions, local search, icons without emoji
  {
    const { ctx, page } = await newPage();
    check(await findNearest(page), 'dashboard: results appear after granting location');
    const hero = page.getByRole('region', { name: 'Nearest restroom' });
    const heroText = (await hero.innerText()).replace(/\s+/g, ' ');
    check(heroText.includes('Cody Library Restroom') && /\d+(\.\d+)? (ft|mi)/.test(heroText) && /straight-line/.test(heroText) && !/min walk/.test(heroText), 'dashboard: the nearest card leads with the name and a straight-line distance (no invented walking time)', heroText);
    check((await cardNames(page))[0] === 'Cody Library Restroom' && heroText.includes('Verified'), 'dashboard: the nearest card is the first (distance-first) result and shows its real verification status');
    check(heroText.includes('No key needed') && !/\bNo\b(?! key| purchase)/.test(heroText), 'dashboard: the card lists known facts only and never an unknown as a negative', heroText);
    const hb = await hero.getByRole('button', { name: /^Directions to / }).boundingBox();
    const db = await hero.getByRole('link', { name: /^Details for / }).boundingBox();
    check(hb && db && hb.height >= 48 && db.height >= 48, `dashboard: Directions and Details are at least 48 px tall (${hb?.height}, ${db?.height})`);
    // directions open a maps app with ONLY the destination (never the user's position)
    const popupP = page.context().waitForEvent('page');
    await hero.getByRole('button', { name: /^Directions to / }).click();
    const popup = await popupP;
    await popup.waitForLoadState('domcontentloaded').catch(() => {});
    const dir = external.filter((u) => u.includes('google.com/maps/dir')).pop() ?? popup.url(); // the test network blocks the real maps host; the blocked request is what the app asked for
    check(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=-?\d+\.\d+,-?\d+\.\d+&travelmode=/.test(dir) && !/origin=/.test(dir) && !dir.includes('44.5263'), 'dashboard: Directions opens a maps link with only the destination (no origin, not the user position)', dir);
    await popup.close().catch(() => {});
    // quick actions
    const group = page.getByRole('group', { name: 'Quick actions' });
    const actionNames = (await group.getByRole('button').allInnerTexts()).concat(await group.getByRole('link').allInnerTexts()).map((t) => t.split('\n')[0]).sort();
    check(JSON.stringify(actionNames) === JSON.stringify(['Add restroom', 'Favorites', 'Map']), 'dashboard: three compact actions with short visible labels that map to existing features', JSON.stringify(actionNames));
    check((await page.getByText('Sign in to', { exact: false }).count()) === 0 && (await page.getByText('points', { exact: false }).count()) === 0 && (await page.getByText('badge', { exact: false }).count()) === 0, 'dashboard: public discovery stays signed out and shows no fake balance, badge or reward');
    // The Filters button sits in the search row and opens the filter dialog
    const filtersTile = page.getByRole('button', { name: 'Show filters', exact: true });
    await filtersTile.click();
    check(await dialogOpen(page) && await text(page, 'Distance'), 'dashboard: the Filters button opens the filter dialog');
    await page.keyboard.press('Escape');
    await dialogClosed(page);
    // Show map / Show list
    await group.getByRole('button', { name: 'Show map', exact: true }).click();
    check(await page.getByRole('region', { name: /Map of nearby restrooms/ }).isVisible() && (await page.getByRole('radio', { name: 'Map' }).getAttribute('aria-checked')) === 'true', 'dashboard: Show map switches to the map and keeps the List | Map control in step');
    await group.getByRole('button', { name: 'Show list', exact: true }).click();
    check((await page.getByRole('radio', { name: 'List' }).getAttribute('aria-checked')) === 'true', 'dashboard: Show list switches back');
    // search: local, narrowing, truthful
    const searchBox = page.getByLabel('Search these restrooms', { exact: true });
    const callsBefore = requests.filter((r) => r.path === '/rest/v1/rpc/nearby_locations').length;
    await searchBox.fill('gas');
    check(await text(page, '1 restroom matches “gas”') && (await cardNames(page)).join('|') === 'Corner Gas Station', 'dashboard: search narrows the list by name, street or town');
    check((await page.getByRole('region', { name: 'Nearest match' }).innerText()).includes('Corner Gas Station'), 'dashboard: while searching the card says "Nearest match" and shows the nearest match, not the nearest restroom overall');
    check(requests.filter((r) => r.path === '/rest/v1/rpc/nearby_locations').length === callsBefore, 'dashboard: search makes no network request (it only narrows what is loaded)');
    await searchBox.fill('zzzz');
    check(await text(page, 'No restrooms match “zzzz”') && !(await text(page, 'No restrooms match your filters')), 'dashboard: a search with no match says so and is not confused with the filter message');
    check((await page.getByRole('region', { name: /Nearest/ }).count()) === 0, 'dashboard: no nearest card is shown when nothing matches (no stale card)');
    await page.getByRole('button', { name: 'Clear search' }).first().click();
    check(await text(page, '4 restrooms nearby, nearest first') && (await searchBox.inputValue()) === '', 'dashboard: Clear search restores every restroom');
    // search survives opening a restroom and going back
    await searchBox.fill('library');
    await page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).click();
    check(await text(page, 'Get there'), 'dashboard: a result still opens its detail');
    await page.goBack();
    check((await page.getByLabel('Search these restrooms', { exact: true }).inputValue()) === 'library', 'dashboard: going back keeps the search text');
    // label in name (WCAG 2.5.3): each quick action's visible text is contained in its spoken name
    const lin = await page.getByRole('group', { name: 'Quick actions' }).locator('a, button, [role="link"], [role="button"]').evaluateAll((els) => els.map((e) => ({ name: (e.getAttribute('aria-label') || '').toLowerCase(), vis: (e.innerText || '').trim().toLowerCase() })));
    check(lin.length >= 2 && lin.every((x) => x.vis && x.name.includes(x.vis)), `dashboard: every quick action's visible text is contained in its spoken name (label-in-name) ${JSON.stringify(lin)}`);
    // quick-action routes
    await page.getByLabel('Search these restrooms', { exact: true }).fill('');
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('link', { name: /^Favorites/ }).click();
    check(/\/favorites$/.test(page.url()), 'dashboard: the Favorites action opens Favorites');
    await page.goto(`${base}/`);
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('link', { name: 'Add restroom', exact: true }).click();
    check(/\/contribute$/.test(page.url()), 'dashboard: Add restroom opens the existing contribution screen (which keeps its own sign-in rule)');
    // keyboard + focus ring on the new controls
    await page.goto(`${base}/`); await button(page, 'Find Nearest Restroom').click(); await text(page, 'Nearest restroom');
    check(await tabTo(page, 'Directions to Cody Library Restroom', 40), 'dashboard: Directions is reachable with Tab');
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return s.outlineStyle === 'solid' && parseFloat(s.outlineWidth) >= 2; });
    check(ring, 'dashboard: Directions shows a visible focus outline');
    check(await tabTo(page, 'Show map', 12), 'dashboard: the quick actions are reachable with Tab');
    // no emoji or dingbat symbols anywhere in the product text
    const body = await page.evaluate(() => document.body.innerText);
    check(!/\p{Extended_Pictographic}|[✓✕✔✖✗✘]/u.test(body), 'dashboard: no emoji or symbol glyphs in the visible text (icons are drawn shapes)');
    check((await page.locator('[aria-hidden="true"]').count()) > 0 && (await page.locator('img').count()) === 0, 'dashboard: icons are decorative (hidden from assistive technology) and no bitmap images are used');
    await page.screenshot({ path: join(SHOTS, 'narrow-d1-dashboard.png') });
    await ctx.close();
    // wide: the card and actions sit in the left column beside the map
    const w = await newPage({ width: 1280, height: 800 });
    await findNearest(w.page);
    const wideBoxes = await w.page.evaluate(() => ({ hero: document.querySelector('[role="region"][aria-label^="Nearest"]').getBoundingClientRect().right, map: document.querySelector('[role="region"][aria-label^="Map of"]').getBoundingClientRect().left }));
    check(wideBoxes.hero <= wideBoxes.map + 1, 'dashboard: on a wide screen the nearest card sits beside the map, not over it', JSON.stringify(wideBoxes));
    await w.page.screenshot({ path: join(SHOTS, 'wide-d1-dashboard.png') });
    await w.ctx.close();
  }


  // 10. D2 owner-directed corrections: compact featured card, search/filters first, scannable cards, compact actions, VIP preview, one Settings destination
  {
    const baseline = JSON.parse(readFileSync(join(root, 'docs/evidence/d2/metrics-before.json'), 'utf8')).runs['phone-390x844'];
    const { ctx, page } = await newPage();
    await findNearest(page);
    await page.waitForTimeout(500);
    const rel = (sel) => page.evaluate((q) => {
      const top = document.querySelector('[role="main"]').getBoundingClientRect().top;
      const el = document.querySelector(q); if (!el) return null;
      const r = el.getBoundingClientRect(); return { y: Math.round(r.top - top), h: Math.round(r.height) };
    }, sel);
    const hero = await rel('[role="region"][aria-label^="Nearest"]');
    check(hero && hero.h <= baseline.hero.h * 0.6, `D2: the featured card is at least 40% shorter than D1 (${hero?.h} px now, ${baseline.hero.h} px before, matched 390x844)`);
    const searchPos = await rel('input[aria-label="Search these restrooms"]');
    check(searchPos && searchPos.y < 120, `D2: search sits at the top of the screen (${searchPos?.y} px from the top; D1 ${baseline.search.y})`);
    const firstCard = await rel('[role="list"] [role="listitem"]');
    check(firstCard && firstCard.y < 700, `D2: the first nearby result starts above the fold of the page content (${firstCard?.y} px; D1 ${baseline.firstCard.y})`);
    check((await page.getByRole('button', { name: 'Show filters', exact: true }).count()) === 1, 'D2: Filters is one button next to search (no second Filters control)');
    // honest VIP preview
    const vip = page.getByRole('region', { name: 'VIP progress' });
    const vipText = (await vip.innerText()).replace(/\s+/g, ' ');
    check(vipText === 'VIP progress — rewards coming soon Challenges — not available yet', 'D2: the VIP preview says rewards are coming soon and challenges are not available, nothing more', vipText);
    check(!/\b\d+\s*(pts|points|xp)\b/i.test(vipText) && (await vip.getByRole('button').count()) === 0 && (await vip.getByRole('link').count()) === 0, 'D2: the VIP preview shows no balance, no number and no dead control');
    // exactly one Settings destination on every main screen
    for (const [path, name] of [['/', 'home'], ['/favorites', 'favorites'], ['/account', 'account']]) {
      await page.goto(`${base}${path}`); if (path === '/') await button(page, 'Find Nearest Restroom').click().catch(() => {});
      await page.waitForTimeout(300);
      const n = await page.evaluate(() => [...document.querySelectorAll('a, button, [role="link"], [role="button"], [role="tab"]')].filter((e) => !e.closest('[aria-hidden="true"]') && e.offsetParent !== null && /settings/i.test(e.getAttribute('aria-label') || e.textContent || '')).length);
      check(n === 1, `D2: exactly one Settings destination on ${name}`, `${n}`);
    }
    await page.goto(`${base}/`); await findNearest(page);
    // cards: rating or honest unrated state, directions per card, destination only, distinct destinations
    const cards = page.getByRole('list').first().getByRole('listitem');
    check((await cards.count()) === 4 && (await page.getByRole('list').first().getByRole('button', { name: /^Directions to / }).count()) === 4, 'D2: every nearby card has its own Directions button');
    check((await page.getByRole('list').first().getByText('Not rated yet', { exact: true }).count()) === 2 && (await page.getByRole('list').first().getByText('Community rating', { exact: false }).count()) === 2, 'D2: cards show the community rating, or "Not rated yet" for the two unrated restrooms');
    const heroDest = async () => {
      const popupP = page.context().waitForEvent('page');
      await page.getByRole('region', { name: 'Nearest restroom' }).getByRole('button', { name: /^Directions to / }).click();
      const pp = await popupP; await pp.waitForLoadState('domcontentloaded').catch(() => {});
      const u = external.filter((x) => x.includes('google.com/maps/dir')).pop(); await pp.close().catch(() => {}); return u;
    };
    const cardDest = async (name) => {
      const popupP = page.context().waitForEvent('page');
      await page.getByRole('list').first().getByRole('button', { name: `Directions to ${name}`, exact: true }).click();
      const pp = await popupP; await pp.waitForLoadState('domcontentloaded').catch(() => {});
      const u = external.filter((x) => x.includes('google.com/maps/dir')).pop(); await pp.close().catch(() => {}); return u;
    };
    const d1 = await heroDest();
    const d2 = await cardDest('Corner Gas Station');
    check(/destination=-?\d+\.\d+,-?\d+\.\d+/.test(d2 ?? '') && !/origin=/.test(d2 ?? '') && d1 !== d2, 'D2: a card\'s Directions opens that restroom\'s destination only (no origin) and differs from the featured one', `${d1} | ${d2}`);
    // touch targets
    const sizes = await page.evaluate(() => {
      const h = (el) => (el ? Math.round(el.getBoundingClientRect().height) : 0);
      const filters = [...document.querySelectorAll('[role="button"]')].find((e) => /filters/i.test(e.getAttribute('aria-label') || ''));
      const pill = document.querySelector('[role="group"][aria-label="Quick actions"] [role="button"], [role="group"][aria-label="Quick actions"] [role="link"]');
      const dir = [...document.querySelectorAll('[role="list"] [role="button"]')].find((e) => /^Directions to/.test(e.getAttribute('aria-label') || ''));
      return { filters: h(filters), pill: h(pill), dir: h(dir) };
    });
    check(sizes.filters >= 44 && sizes.pill >= 44 && sizes.dir >= 44, 'D2: Filters, the quick actions and card Directions are all at least 44 px tall', JSON.stringify(sizes));
    await page.screenshot({ path: join(SHOTS, 'narrow-d2-home.png') });
    await ctx.close();
    // enlarged text (text-only emulation): the featured card grows instead of clipping, and nothing overflows sideways
    const big = await newPage();
    await findNearest(big.page);
    const before = await big.page.evaluate(() => document.querySelector('[role="region"][aria-label^="Nearest"]').getBoundingClientRect().height);
    await big.page.evaluate((k) => {
      for (const el of document.querySelectorAll('body *')) { const c = getComputedStyle(el); if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { el.style.fontSize = `${parseFloat(c.fontSize) * k}px`; if (c.lineHeight !== 'normal') el.style.lineHeight = `${parseFloat(c.lineHeight) * k}px`; } }
    }, 1.6);
    await big.page.waitForTimeout(400);
    const grown = await big.page.evaluate(() => {
      const h = document.querySelector('[role="region"][aria-label^="Nearest"]'); const r = h.getBoundingClientRect();
      const kids = [...h.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().height > 0);
      return { h: r.height, spill: kids.some((e) => e.getBoundingClientRect().bottom > r.bottom + 1 || e.getBoundingClientRect().right > r.right + 1), overflowX: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 };
    });
    check(grown.h > before * 1.2 && !grown.spill && !grown.overflowX, `D2: at 1.6x text (emulated) the featured card grows (${Math.round(before)} -> ${Math.round(grown.h)} px), clips nothing and nothing scrolls sideways`, JSON.stringify(grown));
    await big.page.screenshot({ path: join(SHOTS, 'narrow-d2-text-1.6x.png') });
    await big.ctx.close();
    const nar = await newPage({ width: 320, height: 640 });
    await findNearest(nar.page);
    check(!(await nar.page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)), 'D2: no horizontal scrolling at 320 px wide');
    await nar.ctx.close();
  }

  // 11. D3: distance default and recovery, straight-line wording, history-aware Back
  {
    const FAR = { latitude: 44.5805, longitude: -109.0565 }; // about 1.4 mi from the only nearby restroom, so nothing is within 1 mi
    const far = await newPage({ at: FAR });
    await findNearestAny(far.page);
    check(await text(far.page, 'No restrooms within 1 mi yet') && await text(far.page, 'straight-line distance'), 'D3: with nothing within the 1 mile default, the empty state says how far was searched (straight-line)');
    await button(far.page, 'Search within 2 mi').click();
    check(await text(far.page, 'Distant Overlook Restroom') && await button(far.page, 'Remove filter: Within 2 mi').isVisible(), 'D3: "Search within 2 mi" shows the farther restroom and keeps the choice visible and removable');
    check(await text(far.page, 'Distances are straight-line from you, not walking routes.'), 'D3: the list says distances are straight-line, not walking routes');
    await far.ctx.close();
    const chain = await newPage();
    mode = 'empty';
    await chain.page.goto(`${base}/`);
    await button(chain.page, 'Find Nearest Restroom').click();
    for (const mi of [2, 5, 10, 25]) {
      await button(chain.page, `Search within ${mi} mi`).click();
    }
    check(await text(chain.page, 'No restrooms within 25 mi yet') && (await chain.page.getByRole('button', { name: /^Search within/ }).count()) === 0, 'D3: after the farthest choice there is no further "Search within" (no dead end loop)');
    mode = 'ok';
    await chain.ctx.close();

    const { ctx, page } = await newPage();
    await findNearest(page);
    const body = await page.evaluate(() => document.body.innerText);
    check(!/min (walk|bike|drive)/i.test(body) && !/~\d+ min/.test(body), 'D3: no invented walking, biking or driving minutes anywhere on the home screen');
    check(await text(page, 'straight-line'), 'D3: the featured card labels its distance as straight-line');
    // finer sub-mile display
    check(/\b(\d+ ft|0\.\d+ mi)\b/.test(body), 'D3: sub-mile distances use feet or hundredths of a mile', body.slice(0, 200));
    // choose a farther distance, then come back from a detail page: the choice and the search survive
    await page.getByRole('button', { name: 'Show filters', exact: true }).click();
    await dialogOpen(page);
    await page.getByRole('dialog').getByRole('radio', { name: '5 mi', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Apply filters' }).click();
    await dialogClosed(page);
    check(await text(page, '5 restrooms nearby, filtered') && await button(page, 'Remove filter: Within 5 mi').isVisible(), 'D3: an explicit 5 mi choice is honored and shown as a removable filter');
    await page.getByLabel('Search these restrooms', { exact: true }).fill('library');
    await page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).click();
    check(await text(page, 'Features & Access') && (await page.getByRole('button', { name: 'Back', exact: true }).count()) === 1, 'D3: a restroom opened from the list has one visible Back control');
    check(await text(page, 'straight-line') && !/min (walk|bike|drive)/i.test(await page.locator('body').innerText()), 'D3: the details page labels its distance straight-line and shows no invented minutes');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    check(new URL(page.url()).pathname === '/' && (await page.getByLabel('Search these restrooms', { exact: true }).inputValue()) === 'library' && await button(page, 'Remove filter: Within 5 mi').isVisible(), 'D3: Back returns to the actual previous screen with the search and the distance choice intact');
    // browser back does the same
    await page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).click();
    await text(page, 'Features & Access');
    await page.goBack();
    check(new URL(page.url()).pathname === '/' && (await page.getByLabel('Search these restrooms', { exact: true }).inputValue()) === 'library', 'D3: the browser Back button returns to the same screen with the search intact');
    // multi-step push/pop: home -> details -> report -> Back -> details -> Back -> home
    await page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).click();
    await text(page, 'Features & Access');
    await page.getByRole('button', { name: 'Report a problem' }).click();
    check(/\/report/.test(page.url()) && (await page.getByRole('button', { name: 'Back', exact: true }).count()) === 1, 'D3: a pushed flow (report) has a visible Back');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    check(/\/location\//.test(page.url()) && await text(page, 'Features & Access'), 'D3: Back from the report flow returns to the restroom');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    check(new URL(page.url()).pathname === '/' && (await page.getByLabel('Search these restrooms', { exact: true }).inputValue()) === 'library', 'D3: a second Back returns to the nearby list, search intact');
    // Favorites and Add restroom, reached from the quick actions
    await page.getByLabel('Search these restrooms', { exact: true }).fill('');
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('link', { name: /^Favorites/ }).click();
    check(/\/favorites/.test(page.url()) && (await page.getByRole('button', { name: 'Back', exact: true }).count()) === 1, 'D3: Favorites, opened from Home, has Back');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    check(new URL(page.url()).pathname === '/' && await button(page, 'Remove filter: Within 5 mi').isVisible(), 'D3: Back from Favorites returns Home with the filters intact');
    await page.getByRole('group', { name: 'Quick actions' }).getByRole('link', { name: 'Add restroom', exact: true }).click();
    check(/\/contribute/.test(page.url()) && (await page.getByRole('button', { name: 'Back', exact: true }).count()) === 1, 'D3: Add restroom has Back');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    check(new URL(page.url()).pathname === '/', 'D3: Back from Add restroom returns Home');
    await page.screenshot({ path: join(SHOTS, 'narrow-d3-back-home.png') });
    await ctx.close();
    // a direct link has no history: the control is named for where it goes and is never labeled Back
    const direct = await newPage();
    await direct.page.goto(`${base}/location/${ROWS[0].id}`);
    check(await text(direct.page, 'Features & Access'), 'D3: a direct link opens the restroom');
    check((await direct.page.getByRole('button', { name: 'Back', exact: true }).count()) === 0 && (await direct.page.getByRole('button', { name: 'Go to nearby restrooms' }).count()) === 1, 'D3: with no history the control is "Nearby restrooms", not "Back"');
    await direct.page.getByRole('button', { name: 'Go to nearby restrooms' }).click();
    check(new URL(direct.page.url()).pathname === '/', 'D3: the named safe destination opens the nearby screen');
    await direct.page.screenshot({ path: join(SHOTS, 'narrow-d3-direct-link.png') }).catch(() => {});
    await direct.ctx.close();
  }

  // 12. D3 navigation history: repeated entries with different params, pushed main links, reload, dialog safety
  {
    const { ctx, page } = await newPage();
    await findNearest(page);
    const h1 = () => page.locator('[role="heading"][aria-level="1"]:visible').first().innerText();
    const idOf = (url) => new URL(url).pathname.split('/').pop();
    const A = ROWS[0].id; const B = ROWS[2].id;
    // Home -> Details A -> Nearby (pushed) -> Details B -> Back -> Back  must return to Details A with its own id
    await page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).click();
    await text(page, 'Features & Access');
    check(idOf(page.url()) === A && (await h1()) === 'Cody Library Restroom', 'D3 history: Details A opens');
    await page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('link', { name: 'Nearby restrooms' }).click();
    await text(page, 'Nearest restroom');
    await page.getByRole('list').filter({ visible: true }).getByRole('link', { name: /Corner Gas Station/ }).click();
    await text(page, 'Features & Access');
    check(idOf(page.url()) === B && (await h1()) === 'Corner Gas Station', 'D3 history: Details B opens after a pushed Nearby');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await text(page, 'Nearest restroom');
    check(new URL(page.url()).pathname === '/', 'D3 history: the first Back returns to the Nearby screen that opened B');
    // that second Nearby screen has no Back (a main destination); use the system/browser Back for the next step
    await page.goBack();
    await text(page, 'Features & Access');
    check(idOf(page.url()) === A && (await h1()) === 'Cody Library Restroom', 'D3 history: the second Back returns to Details A (its own screen and id, not Home)', `${page.url()} ${await h1()}`);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await text(page, 'Nearest restroom');
    check(new URL(page.url()).pathname === '/', 'D3 history: the third Back returns to the first Nearby screen');
    // Details A -> Favorites (pushed) -> Back returns to Details A
    await page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).click();
    await text(page, 'Features & Access');
    await page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('link', { name: 'Favorites' }).click();
    await text(page, 'Sign in to save favorite restrooms');
    check((await page.getByRole('button', { name: 'Back', exact: true }).count()) === 1, 'D3 history: Favorites pushed from Details shows Back');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await text(page, 'Features & Access');
    check(idOf(page.url()) === A, 'D3 history: Back from a pushed Favorites returns to Details A');
    // reload = no history: the control is named for where it goes
    await page.reload();
    await text(page, 'Features & Access');
    check((await page.getByRole('button', { name: 'Back', exact: true }).count()) === 0 && (await page.getByRole('button', { name: 'Go to nearby restrooms' }).count()) === 1, 'D3 history: after a reload there is no history, so the control is "Nearby restrooms", never Back');
    await ctx.close();
    // the filter dialog never stays open over another screen
    const d = await newPage();
    await findNearest(d.page);
    await d.page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).click();
    await text(d.page, 'Features & Access');
    await d.page.goBack();
    await text(d.page, 'Nearest restroom');
    await d.page.getByRole('button', { name: 'Show filters', exact: true }).click();
    await dialogOpen(d.page);
    await d.page.goForward();
    await text(d.page, 'Features & Access');
    check(await dialogClosed(d.page), 'D3 history: navigating away with the filter dialog open closes it (it is never left over another screen)');
    // after a browser Forward the router rebuilds the state from the URL (no history): the named control is shown instead of Back
    const leave = (await d.page.getByRole('button', { name: 'Back', exact: true }).count()) === 1 ? d.page.getByRole('button', { name: 'Back', exact: true }) : d.page.getByRole('button', { name: 'Go to nearby restrooms' });
    await leave.click();
    await text(d.page, 'Nearest restroom');
    const usable = { dialogs: await d.page.getByRole('dialog').count(), search: await d.page.getByLabel('Search these restrooms', { exact: true }).isVisible().catch(() => 'err'), url: d.page.url() };
    check(usable.dialogs === 0 && usable.search === true, 'D3 history: coming back shows Nearby with the dialog closed and the screen usable', JSON.stringify(usable));
    await d.ctx.close();
  }

  // 8. Privacy and public access
  {
    const nearby = requests.filter((r) => r.path === '/rest/v1/rpc/nearby_locations');
    check(nearby.length > 0, 'searches were made');
    check(nearby.every((r) => r.auth === `Bearer ${ANON}`), 'discovery uses only the public anon key (no account, no user token)');
    check(external.every((u) => /tile|openstreetmap|fonts|gstatic|google\.com\/maps\/dir/i.test(u)) , 'the only external requests attempted were map tiles/fonts and the user-triggered directions link, all blocked in this test', JSON.stringify(external.slice(0, 5)));
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
