#!/usr/bin/env node
// Measures the home screen layout (phone 390x844 and 320x640, default text and a text-only 1.5x enlargement) so before/after
// claims are numbers, not impressions. Browser (Chromium) in emulated viewports against the local QA mock only.
//   node scripts/d2-metrics.mjs <label>      -> docs/evidence/d2/metrics-<label>.json
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';
import { expoArgv } from './qa-expo.mjs';
import { refuseIfEnvFiles } from './qa-env-guard.mjs';
import { startQaMock } from './qa-mock-server.mjs';

const root = new URL('..', import.meta.url).pathname;
if (refuseIfEnvFiles(join(root, 'apps/mobile'))) process.exit(3);
const label = process.argv[2] ?? 'current';
const mock = await startQaMock({ port: 54804, host: '127.0.0.1', names: ['Cody Library Restroom', 'Riverside Park Pavilion', 'Corner Gas Station', 'Trailhead Parking Restroom'] });
const U = mock.url;
function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const app of ['Google Chrome', 'Chromium']) for (const home of ['', process.env.HOME ?? '']) { const p = `${home}/Applications/${app}.app/Contents/MacOS/${app}`; if (existsSync(p)) return p; }
  for (const n of ['google-chrome', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}
const out = process.env.VISUAL_REUSE_BUILD ?? mkdtempSync(join(tmpdir(), 'open-stall-metrics-'));
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

async function measure(w, h, scale) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, permissions: ['geolocation'], geolocation: HERE });
  await ctx.route('**/*', (r) => { const u = new URL(r.request().url()); return u.hostname === '127.0.0.1' || u.protocol === 'data:' ? r.continue() : r.abort(); });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  await page.goto(base);
  await page.getByRole('button', { name: /find nearest restroom/i }).first().click();
  await page.getByText('Verified', { exact: false }).first().waitFor();
  await page.waitForTimeout(600);
  if (scale !== 1) await page.evaluate((k) => { // text-only enlargement: every element's font and line height times k (browser emulation of OS text scaling)
    for (const el of document.querySelectorAll('body *')) { const c = getComputedStyle(el); if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) { el.style.fontSize = `${parseFloat(c.fontSize) * k}px`; if (c.lineHeight !== 'normal') el.style.lineHeight = `${parseFloat(c.lineHeight) * k}px`; } }
  }, scale);
  await page.waitForTimeout(400);
  const m = await page.evaluate(() => {
    const main = document.querySelector('[role="main"]');
    const top = main.getBoundingClientRect().top;
    const rel = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { y: Math.round(r.top - top), h: Math.round(r.height), w: Math.round(r.width) }; };
    const hero = document.querySelector('[role="region"][aria-label^="Nearest"]');
    const search = document.querySelector('input[aria-label="Search these restrooms"]');
    const firstCard = document.querySelector('[role="list"] [role="listitem"]');
    const pillGroup = document.querySelector('[role="group"][aria-label="Quick actions"]');
    const doc = document.documentElement;
    return { hero: rel(hero), search: rel(search), quickActions: rel(pillGroup), firstCard: rel(firstCard), pageHeight: Math.round(main.getBoundingClientRect().height), horizontalOverflow: doc.scrollWidth > doc.clientWidth + 1 };
  });
  await ctx.close();
  return m;
}
const result = { label, measured: new Date().toISOString().slice(0, 10), note: 'Chromium, emulated viewports, local QA mock. y values are pixels from the top of the page content; "scale" 1.5 is a text-only enlargement emulation, not OS text scaling.', runs: {} };
for (const [name, w, h, scale] of [['phone-390x844', 390, 844, 1], ['phone-390x844-text-1.5x', 390, 844, 1.5], ['narrow-320x640', 320, 640, 1]]) result.runs[name] = await measure(w, h, scale);
await browser.close(); app.close(); await mock.close();
const file = join(root, `docs/evidence/d2/metrics-${label}.json`);
writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
