#!/usr/bin/env node
// Generates the D3 visual-review screenshots (Details, filter sheet, Back journeys, distance) (docs/evidence/d3/) from the CURRENT source: exports the Expo web app
// against the local QA mock (realistic fixture names, no real backend, no tiles host), drives headless Chromium and saves
// labeled screenshots. Browser screenshots in EMULATED viewports only: this is not native, device or screen-reader evidence.
//   node scripts/visual-packet-d3.mjs         (set VISUAL_REUSE_BUILD=<dir> to reuse an export)
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
const OUT = join(root, 'docs/evidence/d3');
mkdirSync(OUT, { recursive: true });
const NAMES = ['Cody Library Restroom', 'Riverside Park Pavilion', 'Corner Gas Station', 'Trailhead Parking Restroom'];
const mock = await startQaMock({ port: 54804, host: '127.0.0.1', names: NAMES });
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


const mockMode = (m) => fetch(`${U}/__qa/mode`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }).then((r) => r.text());
const dlgOpen = (page) => page.getByRole('dialog', { name: 'Filters' }).waitFor({ state: 'visible' });
const dlgClosed = (page) => page.getByRole('dialog').waitFor({ state: 'detached' });
try {
  // Details: known present/absent mix (library), mostly unknown (park pavilion), known key + purchase (gas station)
  let { ctx, page } = await open(390, 1800);
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).first().click();
  await seen(page, 'Features & Access');
  await shot(page, '01-details-known-mix.png', 'Details: known present, confirmed absent (No baby changing) and not-reported facts in their own words; hours and where-note kept; one Features & Access section; Back at the top');
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await seen(page, 'Nearest restroom');
  await page.getByRole('list').getByRole('link', { name: /Riverside Park Pavilion/ }).first().click();
  await seen(page, 'Features & Access');
  await shot(page, '02-details-unknown.png', 'Details: everything unknown reads "not reported" (never "No"); nothing invented');
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await seen(page, 'Nearest restroom');
  await page.getByRole('list').getByRole('link', { name: /Corner Gas Station/ }).first().click();
  await seen(page, 'Features & Access');
  await shot(page, '03-details-key-purchase.png', 'Details: key and purchase known required; fee confirmed absent only because the value is false');
  await ctx.close();

  // Filters sheet: closed, open (top and scrolled), applied
  ({ ctx, page } = await open(390, 844));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await shot(page, '04-sheet-closed.png', 'Home with the filter sheet closed (1 mi default distance, nothing applied)', { full: false });
  await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await dlgOpen(page);
  await shot(page, '05-sheet-open.png', 'Filter sheet open: dialog named Filters, Cancel and title, Distance / Rating / Verification / Features checkboxes / Access, Clear and Apply filters', { full: false });
  await page.getByRole('dialog').getByRole('checkbox', { name: 'Wheelchair accessible', exact: true }).click();
  await page.getByRole('dialog').getByRole('radio', { name: 'Not required' }).last().click();
  await shot(page, '06-sheet-draft.png', 'Draft choices made (Wheelchair accessible, Purchase: Not required); nothing is applied until Apply', { full: false });
  await page.getByRole('dialog').getByRole('button', { name: 'Apply filters' }).click(); await dlgClosed(page);
  await seen(page, 'filtered');
  await shot(page, '07-sheet-applied.png', 'After Apply: removable chips, Clear all and the filtered results header', { full: false });
  await ctx.close();
  // wide: the same sheet as a centered panel
  ({ ctx, page } = await open(1280, 800));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await dlgOpen(page); await page.waitForTimeout(400);
  await shot(page, '08-sheet-wide.png', 'Wide screen: the same filter dialog as a centered panel', { full: false });
  await ctx.close();

  // Back journeys
  ({ ctx, page } = await open(390, 844));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await page.getByLabel('Search these restrooms', { exact: true }).fill('library');
  await page.getByRole('list').getByRole('link', { name: /Cody Library Restroom/ }).first().click(); await seen(page, 'Features & Access');
  await shot(page, '09-back-on-details.png', 'Details opened from a search: the visible Back control at the top', { full: false });
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await seen(page, 'Nearest match');
  await shot(page, '10-back-returned.png', 'After Back: the same Home with the search text intact', { full: false });
  await page.getByRole('group', { name: 'Quick actions' }).getByRole('link', { name: /Favorites/ }).click(); await seen(page, 'Favorites');
  await shot(page, '11-back-on-favorites.png', 'Favorites opened from Home shows Back', { full: false });
  await page.getByRole('button', { name: 'Back', exact: true }).click(); await seen(page, 'Nearest match');
  await ctx.close();
  ({ ctx, page } = await open(390, 844));
  await page.goto(`${base}/location/3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d31`); await seen(page, 'Features & Access');
  await shot(page, '12-direct-link.png', 'A direct link has no history: the control says "Nearby restrooms" and is never labeled Back', { full: false });
  await ctx.close();

  // Distance: near (default) and the empty-state recovery
  ({ ctx, page } = await open(390, 1800));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await shot(page, '13-distance-near.png', 'Default 1 mi: finer sub-mile straight-line distances (feet under 0.2 mi, then hundredths), no minutes, one disclosure line');
  await ctx.close();
  await mockMode({ empty: true });
  ({ ctx, page } = await open(390, 844));
  await page.goto(base); await find(page); await seen(page, 'No restrooms within 1 mi');
  await shot(page, '14-distance-far-empty.png', 'Nothing within 1 mi: the message says how far was searched and offers "Search within 2 mi"', { full: false });
  await ctx.close();
  await mockMode({ empty: false });

  // 320 px and enlarged text on the new surfaces; wide regression
  ({ ctx, page } = await open(320, 640));
  await page.goto(base); await find(page); await seen(page, 'Nearest restroom');
  await page.getByRole('button', { name: 'Show filters', exact: true }).click(); await dlgOpen(page);
  await shot(page, '15-sheet-320.png', 'Filter sheet at 320 px wide (emulated viewport)', { full: false });
  await ctx.close();
  ({ ctx, page } = await open(390, 1800));
  await page.goto(`${base}/location/3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d31`); await seen(page, 'Features & Access');
  await page.evaluate((k) => { for (const el of document.querySelectorAll('body *')) { const c = getComputedStyle(el); if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { el.style.fontSize = `${parseFloat(c.fontSize) * k}px`; if (c.lineHeight !== 'normal') el.style.lineHeight = `${parseFloat(c.lineHeight) * k}px`; } } }, 1.6);
  await shot(page, '16-details-text-1.6x.png', 'Details with every text size x1.6 (EMULATED in the browser, not OS text scaling): labels wrap, nothing clipped');
  await ctx.close();
  ({ ctx, page } = await open(1280, 800));
  await page.goto(`${base}/location/3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d31`); await seen(page, 'Features & Access'); await page.waitForTimeout(600);
  await shot(page, '17-details-wide.png', 'Details on a wide screen (regression)', { full: false });
  await ctx.close();
} finally {
  await browser.close(); app.close(); await mock.close();
}
const md = `# D3 visual packet\n\nGenerated by \`node scripts/visual-packet-d3.mjs\` from the CURRENT source against the local QA mock (realistic fixture names, no real backend, no tiles host). Browser screenshots in EMULATED viewports only: this is NOT native, iPhone, VoiceOver or TalkBack evidence. Text enlargement shown here is a CSS emulation, not OS text scaling.\n\n` + index.map(([f, l]) => `- \`${f}\`: ${l}`).join('\n') + '\n\nAlso from the detail suite (`npm run test:e2e:detail`, `docs/evidence/r2/`): `narrow-d3-detail-present.png` (every fact known present), `narrow-d3-detail-absent.png` (every fact confirmed absent), `narrow-2-detail-sparse.png` (everything unknown) and `narrow-d3-detail-large-text.png` (320 px, text x1.6 emulated). From the discovery suite (`docs/evidence/r1/`): `narrow-d3-back-home.png` and `narrow-d3-direct-link.png`.\n';
writeFileSync(join(OUT, 'README.md'), md);
console.log(`${index.length} screenshots in docs/evidence/d3/`);
