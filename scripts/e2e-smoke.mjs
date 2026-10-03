#!/usr/bin/env node
// Web smoke test: builds the Expo web export, serves it, loads routes in headless Chromium,
// and asserts key accessible text renders. No network data, no real database.
import { execFile, execFileSync, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';

const execFileAsync = promisify(execFile);
const root = new URL('..', import.meta.url).pathname;

function findChrome() {
  if (process.env.CHROME_BIN && existsSync(process.env.CHROME_BIN)) return process.env.CHROME_BIN;
  const base = '/opt/pw-browsers';
  if (existsSync(base)) {
    for (const dir of readdirSync(base).sort().reverse()) {
      for (const rel of ['chrome-linux/headless_shell', 'chrome-linux/chrome']) {
        const p = join(base, dir, rel);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    const r = spawnSync('which', [name], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
  }
  throw new Error('No Chrome/Chromium found (set CHROME_BIN).');
}

const out = mkdtempSync(join(tmpdir(), 'open-stall-web-'));
let server;
try {
  execFileSync('npx', ['expo', 'export', '--platform', 'web', '--output-dir', out], {
    cwd: join(root, 'apps/mobile'),
    stdio: 'inherit',
    env: process.env,
  });

  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
  server = createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(out, path);
    if (!file.startsWith(out) || !existsSync(file) || statSync(file).isDirectory()) file = join(out, 'index.html');
    res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const chrome = findChrome();

  // Async on purpose: the in-process server must keep serving while Chrome loads the page.
  const dump = async (path) => {
    try {
      const { stdout } = await execFileAsync(
        chrome,
        ['--no-sandbox', '--disable-gpu', '--no-proxy-server', '--virtual-time-budget=10000', '--dump-dom', `http://127.0.0.1:${port}${path}`],
        { timeout: 60000, maxBuffer: 20 * 1024 * 1024 },
      );
      return stdout;
    } catch {
      return '';
    }
  };

  const checks = [
    ['/', ['Find Nearest Restroom', 'Nearby', 'Favorites', 'Settings']],
    ['/favorites', ['Saved restrooms will appear here.']],
    ['/settings', ['Display mode']],
    ['/location/not-a-uuid', ['This restroom link isn’t valid.']],
  ];
  let failed = false;
  for (const [path, texts] of checks) {
    const dom = await dump(path);
    if (process.env.E2E_DEBUG) console.log(path, 'dom bytes', dom.length, dom.slice(0, 200));
    for (const t of texts) {
      const ok = dom.includes(t);
      console.log(`${ok ? 'PASS' : 'FAIL'} ${path} contains "${t}"`);
      failed ||= !ok;
    }
  }
  if (failed) process.exit(1);
  console.log('E2E smoke passed.');
} finally {
  server?.close();
  rmSync(out, { recursive: true, force: true });
}
