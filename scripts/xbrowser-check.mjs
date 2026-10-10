#!/usr/bin/env node
// OPTIONAL cross-browser check of the consumer web app in engines other than Chromium: Firefox (stock build, via
// geckodriver) and WebKitGTK (the WebKit engine, via WebKitWebDriver; NOT Safari). Not part of CI: it needs free local
// tooling that is not a repo dependency:
//   selenium-webdriver  (npm, installed in a scratch dir:  XB_DIR/node_modules)
//   Firefox + geckodriver (for example conda-forge's `firefox` and `geckodriver` packages: FIREFOX_BIN, GECKODRIVER_BIN)
//   WebKitWebDriver + MiniBrowser + xvfb (Ubuntu: webkit2gtk-driver, xvfb)
// Usage: XB_DIR=/tmp/xb XB_BUILD=<web export dir built against mock port 54699> node scripts/xbrowser-check.mjs firefox|webkit
// It serves a LOCAL mock backend and the exported app, never a real service. It records the exact runtime in its output.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const which = process.argv[2];
const XB_DIR = process.env.XB_DIR ?? '/tmp/xb';
const BUILD = process.env.XB_BUILD;
if (!['firefox', 'webkit'].includes(which) || !BUILD || !existsSync(join(BUILD, 'index.html'))) {
  console.error('usage: XB_BUILD=<web export dir> [XB_DIR=<dir with node_modules/selenium-webdriver>] node scripts/xbrowser-check.mjs firefox|webkit');
  process.exit(2);
}
const require = createRequire(join(XB_DIR, 'x.js'));
const { Builder, Key } = require('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox');

const MOCK_PORT = 54699;
const id = (n) => `3f2b9c1e-8f55-4a52-9d3a-0c1a2b3c4d${String(n).padStart(2, '0')}`;
const row = (o) => ({ id: o.id, name: o.name, address_line: o.address ?? null, city: 'Cody', region: 'WY', postal_code: null, latitude: o.lat, longitude: -109.0565,
  verification: o.verification, last_verified_at: o.verification === 'verified' ? '2026-09-01T00:00:00Z' : null, opening_hours: null, fee_required: null,
  key_required: o.key ?? null, purchase_required: o.purchase ?? null, wheelchair_accessible: o.wheelchair ?? null, gender_neutral: null, baby_changing: null,
  has_hot_water: null, has_cold_water: null, access_location: null, average_rating: o.rating ?? null, rating_count: o.count ?? 0, attribution: null, distance_m: null });
const ROWS = [
  row({ id: id(11), name: 'Cody Library Restroom', address: '1 Library Way', lat: 44.5273, verification: 'verified', key: false, purchase: false, wheelchair: true, rating: 4.5, count: 12 }),
  row({ id: id(12), name: 'Park Pavilion Restroom', lat: 44.53, verification: 'unverified' }),
  row({ id: id(13), name: 'Corner Gas Station', address: '9 Main St', lat: 44.534, verification: 'verified', key: true, purchase: true, rating: 3, count: 4 }),
  row({ id: id(14), name: 'Far Trailhead Restroom', lat: 44.55, verification: 'unverified', wheelchair: true }),
];
const mock = createServer(async (req, res) => {
  const cors = { connection: 'close', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  let body = ''; for await (const c of req) body += c;
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'content-type': 'application/json', ...cors }); res.end(JSON.stringify(o)); };
  if (u.pathname.endsWith('/nearby_locations')) return json(ROWS);
  if (u.pathname.endsWith('/nearest_verified_location')) return json([]);
  if (u.pathname.endsWith('/get_public_location')) return json(ROWS.filter((r) => body.includes(r.id)));
  res.writeHead(404, cors); res.end('{}');
});
await new Promise((r) => mock.listen(MOCK_PORT, '127.0.0.1', r));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json', '.ttf': 'font/ttf' };
const app = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  let f = join(BUILD, p);
  if (!f.startsWith(BUILD) || !existsSync(f) || statSync(f).isDirectory()) f = join(BUILD, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
});
await new Promise((r) => app.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${app.address().port}`;

let passed = 0; let failures = 0;
const check = (ok, name, detail = '') => { console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${ok ? '' : `  ${detail}`}`); if (ok) passed++; else failures++; };

// ---- start the driver for the requested engine
let driver; let wk;
async function start(zoom = 1, size = { width: 390, height: 844 }, minFont = 0) {
  if (which === 'firefox') {
    const opts = new firefox.Options();
    opts.setBinary(process.env.FIREFOX_BIN ?? '/tmp/ffenv/bin/firefox');
    if (!process.env.XB_ATSPI) opts.addArguments('-headless'); // XB_ATSPI=1: a real (xvfb) window so Firefox exposes its accessibility tree over AT-SPI
    opts.setPreference('layout.css.devPixelsPerPx', String(zoom)); // genuine browser zoom (device pixels per CSS px)
    if (minFont) opts.setPreference('font.minimum-size.x-western', minFont); // the browser's "minimum font size" accessibility setting
    opts.setPreference('network.proxy.type', 0);
    const service = new firefox.ServiceBuilder(process.env.GECKODRIVER_BIN ?? '/tmp/ffenv/bin/geckodriver');
    driver = await new Builder().forBrowser('firefox').setFirefoxOptions(opts).setFirefoxService(service).build();
  } else {
    wk = spawn('xvfb-run', ['-a', '-s', '-screen 0 1600x1000x24', 'WebKitWebDriver', '--port=4455'], { stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { const r = await fetch('http://127.0.0.1:4455/status'); if (r.ok) break; } catch { /* not up yet */ } await new Promise((r) => setTimeout(r, 500)); }
    driver = await new Builder().usingServer('http://127.0.0.1:4455').withCapabilities({
      browserName: 'MiniBrowser', 'webkitgtk:browserOptions': { binary: '/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1/MiniBrowser', args: ['--automation'] },
    }).build();
  }
  await driver.manage().window().setRect({ x: 0, y: 0, ...size });
}
const stop = async () => { try { await driver?.quit(); } catch {} wk?.kill(); };
const js = (fn, ...a) => driver.executeScript(fn, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const geo = () => js(`navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: 44.5263, longitude: -109.0565, accuracy: 10 }, timestamp: Date.now() });
  try { Object.defineProperty(navigator.permissions, 'query', { configurable: true, value: async () => ({ state: 'granted', addEventListener() {}, removeEventListener() {} }) }); } catch (e) {}`);
const waitText = async (t, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { if ((await js('return document.body.innerText')).includes(t)) return true; await sleep(150); } return false; };
const clickByText = (tag, t) => js(`const t = arguments[1]; const el = [...document.querySelectorAll(arguments[0])].find((e) => (e.getAttribute('aria-label') || e.textContent).trim() === t); if (!el) return false; el.click(); return true;`, tag, t);
const overflowX = () => js('return document.documentElement.scrollWidth - window.innerWidth');
const ua = async () => (await js('return navigator.userAgent'));

try {
  await start(1, { width: 430, height: 940 });
  console.log(`INFO engine: ${which}  UA: ${await ua()}`);
  // ---------------------------------------------------------- discovery, phone width
  await driver.get(`${base}/`);
  check(await waitText('Find the nearest restroom'), 'home renders');
  await geo();
  check(await clickByText('[role="button"], button', 'Find Nearest Restroom'), 'the locate button is clickable');
  check(await waitText('Cody Library Restroom'), 'results appear after locating (4 restrooms)');
  check(((await js('return document.body.innerText')).match(/Verified Sep 2026/g) ?? []).length === 2, 'verified badges show text and date');
  const h1s = await js(`return [...document.querySelectorAll('h1')].filter((h) => !h.closest('[aria-hidden="true"]')).length`);
  check(h1s === 1, 'one reachable h1', String(h1s));
  check((await overflowX()) <= 1, 'no horizontal scroll at phone width');
  // ---------------------------------------------------------- navigation semantics + keyboard
  const nav = await js(`const n = document.querySelector('nav[aria-label="Main"]'); return n ? { links: n.querySelectorAll('a').length, current: [...n.querySelectorAll('[aria-current="page"]')].map((e) => e.textContent.trim()), tabs: document.querySelectorAll('[role="tab"],[role="tablist"]').length } : null`);
  check(nav && nav.links === 4 && nav.tabs === 0 && nav.current.join() === 'Nearby', 'main navigation is a labeled landmark of four links with aria-current', JSON.stringify(nav));
  // Enter on a result card opens it and focus moves to the heading
  await js(`[...document.querySelectorAll('[role="link"]')].find((e) => e.getAttribute('aria-label')?.includes('Cody Library Restroom')).focus()`);
  await driver.actions().sendKeys(Key.ENTER).perform();
  const opened = await waitText('Community rating 4.5 / 5 (12 ratings)');
  await sleep(500);
  const where = await js(`return { path: location.pathname, tag: document.activeElement?.tagName, text: document.activeElement?.textContent?.trim().slice(0, 30) }`);
  check(opened && where.path.startsWith('/location/'), 'Enter on a result card opens the restroom detail', JSON.stringify(where));
  check(where.tag === 'H1', 'focus moves to the page heading after opening', JSON.stringify(where));
  // after client-side navigation the previous screen stays mounted: nothing inside it may stay focusable or hit-testable
  const hiddenFocusable = await js(`return [...document.querySelectorAll('a[href], button, input, textarea, select, [tabindex], [role="button"], [role="link"], [role="radio"], [role="checkbox"]')].filter((el) => el.closest('[aria-hidden="true"]') && el.tabIndex >= 0 && el.getClientRects().length > 0 && !el.hasAttribute('inert')).map((el) => { const chain = []; let e = el; while (e && e !== document.body && chain.length < 6) { const st = getComputedStyle(e); chain.push(e.tagName + ':' + st.display + '/' + st.visibility + '/' + st.pointerEvents + (e.getAttribute('aria-hidden') ? '/ah' : '')); e = e.parentElement; } return (el.getAttribute('aria-label') || el.textContent).trim().slice(0, 24) + ' <' + chain.join(' < '); })`);
  check(hiddenFocusable.length === 0, 'no focusable control is left inside an aria-hidden (inactive) screen', JSON.stringify(hiddenFocusable.slice(0, 2)));
  // unknown facts never read as "No"
  const body = await js('return document.body.innerText');
  check(body.includes('? Not reported') && body.includes('✓ Yes') && body.includes('✕ No'), 'facts show symbol + word (✓ Yes, ✕ No, ? Not reported)');
  // keyboard focus indicators on Tab stops of the detail page
  await js('document.activeElement.blur()');
  const noRing = [];
  const seen = new Set();
  for (let i = 0; i < 24; i++) {
    await driver.actions().sendKeys(Key.TAB).perform();
    await sleep(60);
    const f = await js(`const el = document.activeElement; if (!el || el === document.body || el.tagName === 'H1') return null; const s = getComputedStyle(el); const key = el.tagName + '|' + (el.getAttribute('aria-label') || el.textContent.trim().slice(0, 28)) + '|' + Math.round(el.getBoundingClientRect().top); return { key, ring: (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || s.boxShadow !== 'none', why: el.tagName + ' outline=' + s.outlineStyle + '/' + s.outlineWidth + ' fv=' + el.matches(':focus-visible') + ' ti=' + el.getAttribute('tabindex') + ' role=' + el.getAttribute('role') + ' ovf=' + s.overflowY };`);
    if (f && !seen.has(f.key)) { seen.add(f.key); if (!f.ring) { if (/^DIV outline=none\/\S+ fv=\w+ ti=null role=null ovf=(auto|scroll)\b/.test(f.why)) console.log('INFO browser-provided scroll-container tab stop (not an app control): ' + f.key.slice(0, 40)); else noRing.push(f.key + ' [' + f.why + ']'); } }
  }
  check(seen.size >= 8, `Tab reaches the detail controls (${seen.size} stops)`);
  check(noRing.length === 0, 'every focus stop shows a visible focus indicator', noRing.slice(0, 4).join(', '));
  // radio group arrow keys (travel mode)
  await js(`[...document.querySelectorAll('[role="radio"]')].find((e) => e.getAttribute('aria-label') === 'Walk').focus()`);
  await driver.actions().sendKeys(Key.ARROW_RIGHT).perform();
  await sleep(200);
  const radio = await js(`return { checked: [...document.querySelectorAll('[role="radiogroup"][aria-label="Travel mode"] [role="radio"][aria-checked="true"]')].map((e) => e.getAttribute('aria-label')), focus: document.activeElement?.getAttribute('aria-label'), stops: [...document.querySelectorAll('[role="radiogroup"][aria-label="Travel mode"] [role="radio"]')].filter((e) => e.tabIndex === 0).length }`);
  check(radio.checked.join() === 'Bike' && radio.focus === 'Bike' && radio.stops === 1, 'ArrowRight moves radio selection and focus; one tab stop per group', JSON.stringify(radio));
  // ---------------------------------------------------------- platform accessibility tree (AT-SPI), Firefox only
  if (process.env.XB_ATSPI) {
    const { execFileSync } = await import('node:child_process');
    const dump = () => JSON.parse(execFileSync('/usr/bin/python3.12', [new URL('./atspi-dump.py', import.meta.url).pathname, 'Firefox'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
    // 1) the restroom detail page (we are on it)
    let tree = dump();
    const find = (role, name) => tree.filter((n) => n.role === role && (typeof name === 'string' ? n.name === name : name.test(n.name)));
    console.log(`INFO AT-SPI nodes exposed by Firefox: ${tree.length}`);
    check(find('heading', 'Cody Library Restroom').some((n) => n.attrs.level === '1'), 'AT-SPI: the page title is exposed as a level-1 heading');
    check(['Access', 'Amenities', 'Get there', 'About these details'].every((h) => find('heading', h).some((n) => n.attrs.level === '2')), 'AT-SPI: section titles are level-2 headings');
    // (the arrow-key check above moved the selection from Walk to Bike)
    const modes = ['Walk', 'Bike', 'Drive'].map((m) => find('radio button', m)[0]);
    check(modes.every(Boolean) && modes[1].states.includes('checked') && !modes[0].states.includes('checked') && !modes[2].states.includes('checked'), 'AT-SPI: exactly the selected travel mode (Bike) is exposed as a checked radio button', JSON.stringify(modes));
    check(tree.some((n) => n.role === 'landmark' && (n.attrs['xml-roles'] === 'navigation' || n.name === 'Main')) || tree.some((n) => n.attrs['xml-roles'] === 'navigation'), 'AT-SPI: a navigation landmark is exposed');
    const links = ['Nearby restrooms', 'Favorites', 'Account', 'Settings'].map((nm) => find('link', nm).length);
    check(links.every((c) => c === 1), 'AT-SPI: the four main navigation items are exposed as links', JSON.stringify(links));
    const docStart = tree.findIndex((n) => n.role === 'document web');
    const tabRoles = tree.slice(Math.max(docStart, 0)).filter((n) => n.role === 'page tab' || n.role === 'page tab list'); // inside the web document only (not Firefox's own tab strip)
    check(tabRoles.length === 0, 'AT-SPI: no tab roles are exposed for the navigation', JSON.stringify(tabRoles.slice(0, 3)));
    const facts = tree.filter((n) => n.role === 'list item' && /^Fee to use: /.test(n.name));
    check(facts.length === 1 && facts[0].name === 'Fee to use: Not reported', 'AT-SPI: an unknown fact is spoken as "Not reported", never as No', JSON.stringify(facts.map((f) => f.name)));
    // 2) discovery filters and sign-in
    await driver.get(`${base}/`);
    await waitText('Find the nearest restroom');
    await geo();
    await clickByText('[role="button"], button', 'Find Nearest Restroom');
    await waitText('Cody Library Restroom');
    await clickByText('[role="button"]', 'Show filters');
    await sleep(500);
    tree = dump();
    const filt = find('toggle button', 'Hide filters').concat(find('push button', 'Hide filters'), find('button', 'Hide filters'));
    check(filt.length >= 1 && filt.some((n) => n.states.includes('expanded')), 'AT-SPI: the filter disclosure button is exposed as expanded', JSON.stringify(filt));
    const grp = find('radio button', /^(1|2|5|10|25) mi$/);
    check(grp.length === 5 && grp.filter((n) => n.states.includes('checked')).length === 1, 'AT-SPI: the distance choices are radio buttons with exactly one checked', JSON.stringify(grp.map((n) => `${n.name}:${n.states.includes('checked')}`)));
    await driver.get(`${base}/auth/sign-in`);
    await waitText('Forgot password?');
    await sleep(500);
    tree = dump();
    const ent = tree.filter((n) => n.role === 'entry' || n.role === 'password text').map((n) => n.name);
    check(ent.includes('Email') && ent.includes('Password'), 'AT-SPI: the sign-in fields are exposed with their labels', JSON.stringify(ent));
    await stop();
    mock.close(); app.close();
    console.log(`\n${which} (AT-SPI): ${passed} passed, ${failures} failed.`);
    process.exit(failures ? 1 : 0);
  }
  // ---------------------------------------------------------- sign-in screen: input focus ring, labels
  await driver.get(`${base}/auth/sign-in`);
  check(await waitText('Forgot password?'), 'sign-in renders');
  const inputs = await js(`return [...document.querySelectorAll('input')].map((e) => e.getAttribute('aria-label'))`);
  check(inputs.join() === 'Email,Password', 'sign-in inputs are labeled', inputs.join());
  await js(`document.querySelector('input').focus()`);
  await sleep(150);
  const inRing = await js(`const s = getComputedStyle(document.activeElement); return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || s.boxShadow !== 'none'`);
  check(inRing, 'a focused text input shows a visible focus indicator');
  await stop();

  // ---------------------------------------------------------- zoom reflow
  const zooms = which === 'firefox' ? [[2, { width: 1280, height: 720 }, '200% (layout.css.devPixelsPerPx=2)'], [4, { width: 1280, height: 720 }, '400% (layout.css.devPixelsPerPx=4)'], [1, { width: 1280, height: 720 }, 'minimum font size 24px (font.minimum-size.x-western=24), 1280x720', 24]] : [[1, { width: 640, height: 360 }, '640x360 window (no zoom control in WebKitGTK driver: emulated)'], [1, { width: 320, height: 240 }, '320x240 window (emulated)']];
  for (const [z, size, label, minFont] of zooms) {
    await start(z, size, minFont ?? 0);
    await driver.get(`${base}/`);
    await waitText('Find the nearest restroom');
    await geo();
    await clickByText('[role="button"], button', 'Find Nearest Restroom');
    await waitText('Cody Library Restroom');
    const vw = await js('return [window.innerWidth, window.innerHeight, window.devicePixelRatio]');
    const probe = await js(`const nav = [...document.querySelectorAll('nav[aria-label="Main"] a')]; const cut = nav.filter((a) => { const r = document.createRange(); r.selectNodeContents(a); return r.getBoundingClientRect().width > a.clientWidth + 1; }).map((a) => a.textContent.trim()); return { overflow: document.documentElement.scrollWidth - window.innerWidth, cut, navVisible: nav.every((a) => a.getBoundingClientRect().bottom <= window.innerHeight + 1) }`);
    console.log(`INFO ${label}: viewport ${JSON.stringify(vw)}`);
    check(probe.overflow <= 1, `${label}: no horizontal scroll`, JSON.stringify(probe));
    check(probe.cut.length === 0 && probe.navVisible, `${label}: navigation labels whole and the bar stays on screen`, JSON.stringify(probe));
    // every control reachable: scroll each into view and check it is the topmost element at its center
    const covered = await js(`const out = []; for (const el of document.querySelectorAll('[role="link"], [role="button"], button, a[href], input')) { if (el.closest('[aria-hidden="true"]') || el.closest('nav[aria-label="Main"]') || el.closest('.leaflet-container')) continue; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue; const top = document.elementFromPoint(r.left + r.width / 2, Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1)); if (top && top !== el && !el.contains(top) && !top.contains(el)) out.push((el.getAttribute('aria-label') || el.textContent).trim().slice(0, 30)); } return out;`);
    check(covered.length === 0, `${label}: no control is covered (sticky navigation hides nothing)`, covered.slice(0, 3).join(', '));
    await stop();
  }
} catch (e) {
  console.error('XBROWSER error:', e);
  failures++;
} finally {
  await stop();
  mock.close();
  app.close();
}
console.log(`\n${which}: ${passed} passed, ${failures} failed.`);
process.exit(failures ? 1 : 0);
