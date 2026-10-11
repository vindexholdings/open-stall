#!/usr/bin/env node
// Generates the dashboard visual-review screenshots (docs/evidence/d1/) from the CURRENT source: exports the Expo web app
// against the local QA mock (realistic fixture names, no real backend, no tiles host), drives headless Chromium and saves
// labeled screenshots. Browser screenshots in EMULATED viewports only: this is not native, device or screen-reader evidence.
//   node scripts/visual-packet.mjs            (set VISUAL_REUSE_BUILD=<dir> to reuse an export)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';
import { refuseIfEnvFiles } from './qa-env-guard.mjs';
import { expoArgv } from './qa-expo.mjs';
import { startQaMock } from './qa-mock-server.mjs';

const root = new URL('..', import.meta.url).pathname;
if (refuseIfEnvFiles(join(root, 'apps/mobile'))) process.exit(3);
const OUT = join(root, 'docs/evidence/d1');
mkdirSync(OUT, { recursive: true });
const NAMES = ['Cody Library Restroom', 'Riverside Park Pavilion', 'Corner Gas Station', 'Trailhead Parking Restroom'];
const mock = await startQaMock({ port: 54803, host: '127.0.0.1', names: NAMES });
const U = mock.url;

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const app of ['Google Chrome', 'Chromium']) for (const home of ['', process.env.HOME ?? '']) { const p = `${home}/Applications/${app}.app/Contents/MacOS/${app}`; if (existsSync(p)) return p; }
  for (const n of ['google-chrome', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

const out = process.env.VISUAL_REUSE_BUILD ?? mkdtempSync(join(tmpdir(), 'open-stall-visual-'));
if (!existsSync(join(out, 'index.html'))) {
  const [bin, ...rest] = expoArgv(['export', '--clear', '--platform', 'web', '--output-dir', out]);
  execFileSync(bin, rest, { cwd: join(root, 'apps/mobile'), stdio: 'inherit', env: { ...process.env, EXPO_NO_DOTENV: '1', EXPO_PUBLIC_SUPABASE_URL: U, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'qa-mock-anon-key', EXPO_PUBLIC_MAP_TILE_URL: `${U}/tiles/{z}/{x}/{y}.png`, EXPO_PUBLIC_LEAFLET_BASE_URL: `${U}/leaflet` } });
}
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json', '.ttf': 'font/ttf' };
const app = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let f = join(out, p);
  if (!f.startsWith(out) || !existsSync(f) || statSync(f).isDirectory()) f = join(out, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.address().port}`;
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const HERE = { latitude: 44.5263, longitude: -109.0565, accuracy: 10 };
const index = [];
const open = async (w, h, { geo = true } = {}) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, ...(geo ? { permissions: ['geolocation'], geolocation: HERE } : {}) });
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); return u.hostname === '127.0.0.1' || u.protocol === 'data:' ? r.continue() : r.abort(); });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  return { ctx, page };
};
const shot = async (page, file, label, { full = true } = {}) => { await page.waitForTimeout(500); await page.screenshot({ path: join(OUT, file), fullPage: full }); index.push([file, label]); console.log('saved', file); };
const find = (page) => page.getByRole('button', { name: /find nearest restroom/i }).first().click();
const seen = (page, t) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible' });

try {
  // phone, 390 wide
  let { ctx, page } = await open(390, 844, { geo: false });
  await page.goto(base); await seen(page, 'Find the nearest restroom');
  await shot(page, '01-phone-home-before-location.png', 'Home before location is granted (phone 390 px, browser, emulated viewport)');
  await ctx.close();

  ({ ctx, page } = await open(390, 844));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await shot(page, '02-phone-home-top.png', 'Dashboard home, first screen (phone 390 x 844, no scrolling)', { full: false });
  await ctx.close();
  ({ ctx, page } = await open(390, 2000));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await shot(page, '03-phone-home-full.png', 'Dashboard home, whole page: nearest card, quick actions, search, filters, list (phone 390 px wide, tall window so nothing is cut off)');
  await page.getByLabel('Search these restrooms', { exact: true }).fill('park');
  await seen(page, 'match “park”');
  await shot(page, '04-phone-search.png', 'Search narrowed to "park" (local search over loaded restrooms)');
  await page.getByLabel('Search these restrooms', { exact: true }).fill('zzzz');
  await seen(page, 'No restrooms match');
  await shot(page, '05-phone-search-empty.png', 'Search with no match: plain message and a Clear search action');
  await page.getByRole('button', { name: 'Clear search' }).first().click();
  await page.getByRole('button', { name: /^Filters\./ }).first().click();
  await seen(page, 'Distance');
  await shot(page, '06-phone-filters-open.png', 'Filters quick action opens the existing filter panel');
  await page.getByRole('button', { name: /^Hide filters/ }).first().click().catch(() => {});
  await page.getByRole('button', { name: /^Show map\./ }).first().click();
  await page.waitForTimeout(1200);
  await shot(page, '07-phone-map.png', 'Show map quick action: map view (tiles come from the local mock, flat grey)');
  await page.getByRole('button', { name: /^Show list\./ }).first().click();
  await page.getByRole('link', { name: /^Details for/ }).first().click();
  await seen(page, 'Get there');
  await shot(page, '08-phone-detail.png', 'Card to detail transition: Details opens the existing restroom detail (phone)');
  await page.goto(`${base}/favorites`); await seen(page, 'Favorites');
  await shot(page, '09-phone-favorites.png', 'Favorites (signed out): shared navigation bar with icons', { full: false });
  await page.goto(`${base}/auth/sign-in`); await page.getByLabel('Password', { exact: true }).fill('example password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await shot(page, '10-phone-sign-in-password.png', 'Sign-in with Show password on (the typed text is a placeholder example)');
  await ctx.close();

  // very narrow phone / reflow, 320 wide
  ({ ctx, page } = await open(320, 640));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await shot(page, '11-narrow-320-home.png', 'Dashboard at 320 px wide (reflow check; emulated viewport, NOT OS large text)');
  await ctx.close();

  // wide, 1280
  ({ ctx, page } = await open(1280, 800));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await page.waitForTimeout(1000);
  await shot(page, '12-wide-home.png', 'Dashboard on a wide screen (1280 px): list and map side by side');
  await ctx.close();
} finally {
  await browser.close(); app.close(); await mock.close();
}
const md = `# Dashboard visual packet (D1)\n\nGenerated by \`node scripts/visual-packet.mjs\` from the current source. **Evidence level: automated browser screenshots (headless Chromium, emulated viewports) against the local QA mock with illustrative fixture names. Not native, not a device, not a screen reader.** The distances and names are fixtures, not real restrooms.\n\n${index.map(([f, l]) => `- \`${f}\`: ${l}`).join('\n')}\n`;
writeFileSync(join(OUT, 'README.md'), md);
console.log(`${index.length} screenshots in docs/evidence/d1/`);
