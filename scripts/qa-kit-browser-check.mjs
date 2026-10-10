#!/usr/bin/env node
// Drives the REAL app (Expo web export, headless Chromium) against the QA mock to prove the kit's documented journeys are
// reproducible: a real loading state (delayMs on a public read), the UNFILTERED empty state (empty mode), the FILTERED empty
// state (Baby changing; no fixture has it), and the expired-session control (/__qa/expire). Browser evidence only; native
// runtime is not exercised. Contacts nothing but the local mock.   npm run qa:browsercheck
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright-core';
import { refuseIfEnvFiles } from './qa-env-guard.mjs';
import { startQaMock } from './qa-mock-server.mjs';

const root = new URL('..', import.meta.url).pathname;
if (refuseIfEnvFiles(join(root, 'apps/mobile'))) process.exit(3);
const PORT = 54801;
const mock = await startQaMock({ port: PORT, host: '127.0.0.1' });
const U = mock.url;
const post = (path, body) => fetch(`${U}${path}`, { method: 'POST', body: JSON.stringify(body ?? {}) });

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) for (const d of readdirSync(base).sort().reverse()) for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) if (existsSync(join(base, d, rel))) return join(base, d, rel);
  for (const app of ['Google Chrome', 'Chromium']) for (const home of ['', process.env.HOME ?? '']) { const p = `${home}/Applications/${app}.app/Contents/MacOS/${app}`; if (existsSync(p)) return p; }
  for (const n of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) { const r = spawnSync('which', [n], { encoding: 'utf8' }); if (r.status === 0) return r.stdout.trim(); }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

const out = process.env.QA_BROWSERCHECK_REUSE_BUILD ?? mkdtempSync(join(tmpdir(), 'open-stall-qa-browser-'));
if (!existsSync(join(out, 'index.html'))) {
  execFileSync('npx', ['expo', 'export', '--clear', '--platform', 'web', '--output-dir', out], {
    cwd: join(root, 'apps/mobile'), stdio: 'inherit',
    env: { ...process.env, EXPO_NO_DOTENV: '1', EXPO_PUBLIC_SUPABASE_URL: U, EXPO_PUBLIC_SUPABASE_ANON_KEY: 'qa-mock-anon-key', EXPO_PUBLIC_MAP_TILE_URL: `${U}/tiles/{z}/{x}/{y}.png`, EXPO_PUBLIC_LEAFLET_BASE_URL: `${U}/leaflet` },
  });
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

let passed = 0, failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (ok) passed++; else failures++; };
const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox', '--disable-gpu', '--no-proxy-server'] });
const external = [];
const open = async (path = '/') => {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['geolocation'], geolocation: { latitude: 44.5263, longitude: -109.0565, accuracy: 10 } });
  await ctx.route('**/*', (route) => { const u = new URL(route.request().url()); if (u.hostname === '127.0.0.1' || u.protocol === 'data:') return route.continue(); external.push(u.href); return route.abort(); });
  const page = await ctx.newPage(); page.setDefaultTimeout(15000);
  await page.goto(base + path);
  return { ctx, page };
};
const seen = (page, t, timeout = 15000) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'visible', timeout }).then(() => true, () => false);
const gone = (page, t, timeout = 15000) => page.getByText(t, { exact: false }).filter({ visible: true }).first().waitFor({ state: 'hidden', timeout }).then(() => true, () => false);
const LOCATE = /find nearest restroom/i;
const locate = async (page) => { await page.getByRole('button', { name: LOCATE }).first().click().catch(() => {}); };

try {
  // 1. a REAL loading state: the public nearby read is delayed 3 s, the app shows its loading banner, then the results
  await post('/__qa/mode', { delayMs: 3000, delayFn: 'nearby_locations', delayTimes: 1 });
  let { ctx, page } = await open();
  await locate(page);
  const t0 = Date.now();
  await seen(page, 'Looking for restrooms', 2500);
  await page.waitForTimeout(Math.max(0, 1800 - (Date.now() - t0)));
  check(await seen(page, 'Looking for restrooms', 300) && !(await seen(page, 'QA Library Restroom', 300)), 'loading: after ~1.8 s of a 3 s delayed public read the app still shows "Looking for restrooms…" and no results yet');
  check(await seen(page, 'QA Library Restroom', 12000) && await gone(page, 'Looking for restrooms', 5000), 'loading: results replace the loading banner when the read completes');
  await ctx.close();

  // 2. filtered-empty (data exists, a filter excludes all of it): Baby changing, no fixture has it
  await post('/__qa/mode', {});
  ({ ctx, page } = await open());
  await locate(page);
  check(await seen(page, 'QA Library Restroom'), 'results are listed before any filter is applied');
  await page.getByRole('button', { name: /show filters/i }).click().catch(() => {});
  await page.getByRole('checkbox', { name: 'Baby changing', exact: true }).click();
  check(await seen(page, 'No restrooms match your filters') && !(await seen(page, 'No restrooms found nearby yet', 1500)), 'filtered-empty: "No restrooms match your filters" (not the nothing-nearby message)');
  await ctx.close();

  // 3. unfiltered-empty (the server has nothing): a different message
  await post('/__qa/mode', { empty: true });
  ({ ctx, page } = await open());
  await locate(page);
  check(await seen(page, 'No restrooms found nearby yet') && !(await seen(page, 'No restrooms match your filters', 1500)), 'unfiltered-empty: "No restrooms found nearby yet" (not the filter message)');
  await ctx.close();

  // 4. expired session: sign in as the QA user, expire every token, the next account call must NOT look like success
  await post('/__qa/reset');
  ({ ctx, page } = await open('/auth/sign-in'));
  await page.getByLabel('Email', { exact: false }).first().fill('qa.user@open-stall.test');
  await page.getByLabel('Password', { exact: false }).first().fill('correct horse battery');
  await page.getByRole('button', { name: /^sign in$/i }).first().click();
  await page.waitForTimeout(1500);
  const before = (await (await fetch(`${U}/__qa/state`)).json()).logins;
  check(before >= 1, 'the QA account signs in through the app against the mock', `logins ${before}`);
  await post('/__qa/expire');
  await page.goto(`${base}/favorites`);
  await page.waitForTimeout(2500);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  const st = await (await fetch(`${U}/__qa/state`)).json();
  console.log(`INFO after expire, /favorites shows: ${body.slice(0, 220)}`);
  check(/sign in again/i.test(body) && !/No favorites yet/i.test(body) && st.calls.list_my_favorites >= 1, 'expired session: the app asks to sign in again and does not show an empty-but-fine favorites list', body.slice(0, 200));
  await ctx.close();
  check(external.length === 0, 'no request left localhost (tiles, Leaflet and the backend all came from the mock)', external.join(', '));
} catch (e) {
  console.error('QA browser check error:', e); failures++;
} finally {
  await browser.close(); app.close(); await mock.close();
}
console.log(`\n${passed} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
