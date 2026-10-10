// Starts the Expo dev server (Metro) for the QA self-tests and returns native bundles, or says exactly why it could not.
// Built for diagnosis on someone else's machine: it captures a bounded, redacted tail of the child's output, notices an early
// exit instead of polling a dead process, bounds every request, picks a free port, and always stops the whole process group.
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MOBILE = new URL('../apps/mobile', import.meta.url).pathname;
const MAX_LOG = 6000;
const SENSITIVE_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION/i;

export function redactor(env) {
  const values = Object.entries(env).filter(([k, v]) => SENSITIVE_NAME.test(k) && typeof v === 'string' && v.length >= 6).map(([, v]) => v).sort((a, b) => b.length - a.length);
  return (text) => {
    let out = String(text);
    for (const v of values) out = out.split(v).join('[redacted]');
    return out.replace(/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '[redacted-jwt]').replace(/(Bearer\s+)[\w.~+/=-]{12,}/gi, '$1[redacted]');
  };
}

// Expo's `--localhost` makes Metro listen on whatever `localhost` resolves to: 127.0.0.1 on most Linux hosts but ::1 (IPv6 only)
// on some Macs. Every probe therefore tries all loopback spellings; assuming 127.0.0.1 reports a healthy Metro as dead.
export const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

const listenOnce = (port, host) => new Promise((resolve) => {
  const s = createServer(); s.unref();
  s.on('error', (e) => resolve({ ok: false, code: e.code }));
  s.listen(port, host, () => { const used = s.address().port; s.close(() => resolve({ ok: true, port: used })); });
});

// A port that is free on IPv4 loopback AND on IPv6 loopback (where IPv6 exists).
export async function freePort() {
  for (let i = 0; i < 20; i++) {
    const v4 = await listenOnce(0, '127.0.0.1');
    if (!v4.ok) continue;
    const v6 = await listenOnce(v4.port, '::1');
    if (v6.ok || v6.code === 'EAFNOSUPPORT' || v6.code === 'EADDRNOTAVAIL') return v4.port;
  }
  throw new Error('could not find a port that is free on 127.0.0.1 and ::1');
}

const LOOPBACK_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// Metro advertises its own bundle URL using one loopback spelling (e.g. http://127.0.0.1:P/...) that may not be the spelling
// that is reachable (it can be listening on ::1 only). Re-point the advertised URL at the base that answered /status, keeping
// path and query. Anything that is not a loopback address on THIS Metro's port is refused, never fetched.
export function reachableUrl(advertised, base, port) {
  let u; let b;
  try { u = new URL(advertised); b = new URL(base); } catch { throw new Error(`the advertised bundle URL is not a valid URL: ${String(advertised).slice(0, 120)}`); }
  if (!['http:', 'https:'].includes(u.protocol) || !LOOPBACK_NAMES.has(u.hostname) || Number(u.port || (u.protocol === 'https:' ? 443 : 80)) !== Number(port)) {
    throw new Error(`the advertised bundle URL (${u.protocol}//${u.host}) is not a loopback address on this Metro's port ${port}; refusing to fetch it`);
  }
  return `${b.origin}${u.pathname}${u.search}`;
}

// Returns the base URL (e.g. http://[::1]:8081) of the first loopback spelling whose /status answers 200, or null.
export async function probeStatus(port, { fetchImpl = fetch, timeoutMs = 2000, hosts = LOOPBACK_HOSTS } = {}) {
  for (const h of hosts) {
    const base = `http://${h}:${port}`;
    try { const r = await fetchImpl(`${base}/status`, { signal: AbortSignal.timeout(timeoutMs) }); if (r.ok) return base; } catch { /* try the next spelling */ }
  }
  return null;
}

// Known causes of "Metro did not start" on other machines; shown only when the captured output matches.
export function hintsFor(text) {
  const hints = [];
  if (/EMFILE|too many open files/i.test(text)) hints.push('too many open files: raise the limit (macOS: `ulimit -n 10240` in the same shell) or install watchman (`brew install watchman`)');
  if (/ENOSPC.*watch|inotify/i.test(text)) hints.push('file-watcher limit reached (Linux): raise fs.inotify.max_user_watches');
  if (/EADDRINUSE|address already in use/i.test(text)) hints.push('port already in use: another dev server is running');
  if (/EPERM|EACCES|operation not permitted/i.test(text)) hints.push('a permission or sandbox restriction (listening on localhost or writing the cache is not allowed in this environment)');
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|network request failed/i.test(text)) hints.push('Expo tried to reach the network although EXPO_OFFLINE=1 is set; check for a proxy or an Expo CLI version that ignores it');
  return hints;
}

export function environmentSummary() {
  const pkg = (n) => { try { return JSON.parse(readFileSync(new URL(`../node_modules/${n}/package.json`, import.meta.url), 'utf8')).version; } catch { return 'not installed'; } };
  return `node ${process.version} ${process.platform}/${process.arch}; expo ${pkg('expo')}; @expo/cli ${pkg('@expo/cli')}; metro ${pkg('metro')}`;
}

// command: [bin, ...args] or (port) => [bin, ...args] (tests pass a stand-in); defaults to the real `npx expo start`.
export async function startMetro({ env, startupMs = 120_000, command, probeFetch = fetch } = {}) {
  const port = await freePort();
  const redact = redactor(env);
  const privateTmp = mkdtempSync(join(tmpdir(), 'qa-metro-')); // empty transform cache; the shared /tmp/metro-cache can hold values inlined earlier
  const argv = typeof command === 'function' ? command(port) : command ?? ['npx', 'expo', 'start', '--go', '--localhost', '--port', String(port), '--clear'];
  const t0 = Date.now();
  let log = ''; let exit = null; let spawnError = null;
  const child = spawn(argv[0], argv.slice(1), { cwd: MOBILE, env: { ...env, TMPDIR: privateTmp }, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  const add = (d) => { log = (log + d).slice(-MAX_LOG); };
  child.stdout.on('data', add); child.stderr.on('data', add);
  child.on('error', (e) => { spawnError = e; });
  // stdout/stderr can still be flushing when 'exit' fires; wait a moment so the output tail is not lost
  child.on('exit', (code, signal) => { setTimeout(() => { exit = { code, signal }; }, 300); });
  const stop = async () => {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* already gone */ }
    for (let i = 0; i < 10 && exit === null; i++) await new Promise((r) => setTimeout(r, 300));
    if (exit === null) { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* gone */ } }
    rmSync(privateTmp, { recursive: true, force: true });
  };
  const why = (headline) => {
    const state = spawnError ? `could not be launched: ${spawnError.code ?? ''} ${spawnError.message}` : exit ? `exited early (code ${exit.code}, signal ${exit.signal}) after ${Date.now() - t0} ms` : `was still running but never answered /status on ${LOOPBACK_HOSTS.map((h) => `${h}:${port}`).join(', ')} after ${Date.now() - t0} ms`;
    const hints = hintsFor(log).map((h) => `\n  likely cause: ${h}`).join('');
    return redact(`${headline}: the child process ${state}.\n  command: ${argv.join(' ')}\n  ${environmentSummary()}\n  output tail (redacted, last ${MAX_LOG} chars):\n${log.split('\n').map((l) => `    | ${l}`).join('\n')}${hints}`);
  };
  const get = (url, headers, ms = 15_000) => fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  let base = null;
  try {
    let up = false;
    while (!up && Date.now() - t0 < startupMs) {
      if (exit !== null || spawnError) break;
      base = await probeStatus(port, { fetchImpl: probeFetch });
      up = base !== null;
      if (!up) await new Promise((r) => setTimeout(r, 500));
    }
    if (!up) { const message = why('Metro did not start'); await stop(); throw new Error(message); }
  } catch (e) { await stop(); throw e; }

  async function bundle(platform) {
    try {
      let manifest = '';
      for (let i = 0; i < 30; i++) {
        try { manifest = await (await get(`${base}/`, { 'expo-platform': platform, accept: 'multipart/mixed,application/expo+json,application/json' })).text(); } catch { /* retry */ }
        if (manifest.includes('launchAsset') || manifest.includes('.bundle')) break;
        if (exit !== null) throw new Error(why(`Metro stopped while serving the ${platform} manifest`));
        await new Promise((r) => setTimeout(r, 1000));
      }
      const m = manifest.match(/"launchAsset":\{[^}]*"url":"([^"]+)"/) ?? manifest.match(/"url":"(http[^"]+\.bundle[^"]*)"/);
      if (!m) throw new Error(`${platform}: no bundle URL in the manifest. Manifest head: ${redact(manifest).slice(0, 300)}\n${why('Metro state')}`);
      const res = await get(reachableUrl(m[1].replace(/\\u0026/g, '&'), base, port), undefined, 300_000);
      const code = await res.text();
      if (res.status !== 200) throw new Error(`${platform}: bundle request returned HTTP ${res.status}: ${redact(code).slice(0, 600)}\n${why('Metro state')}`);
      return { manifest, code };
    } catch (e) { throw e instanceof Error ? e : new Error(String(e)); }
  }
  return { port, base, bundle, stop, tail: () => redact(log) };
}

export const _test = { MOBILE, existsSync };
