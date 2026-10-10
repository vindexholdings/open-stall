#!/usr/bin/env node
// Starts the Open Stall app in Expo Go (or Metro for web) pointed at the LOCAL QA mock only.
//   node scripts/qa-app.mjs [--target lan|android-emulator|ios-simulator|web] [--port 54800] [--metro-port 8081] [--ios|--android]
// Start the mock first in another terminal:  npm run qa:mock
// What the app is told (all EXPO_PUBLIC_*, baked in at bundle time; no live keys, no external tunnel):
//   EXPO_PUBLIC_SUPABASE_URL        http://<host>:<port>      <host> = this machine's LAN IP | 10.0.2.2 (Android emulator) | localhost (iOS simulator, web)
//   EXPO_PUBLIC_SUPABASE_ANON_KEY   qa-mock-anon-key          (a placeholder; the mock accepts it)
//   EXPO_PUBLIC_MAP_TILE_URL        http://<host>:<port>/tiles/{z}/{x}/{y}.png     (flat grey tiles, no third-party tile server)
//   EXPO_PUBLIC_LEAFLET_BASE_URL    http://<host>:<port>/leaflet                   (Leaflet served by the mock, no CDN)
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : dflt; };
const target = arg('target', 'lan');
const port = Number(arg('port', process.env.QA_PORT ?? 54800));
const metroPort = String(arg('metro-port', 8081));

function lanIp() {
  for (const list of Object.values(networkInterfaces())) for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal && !n.address.startsWith('169.254.')) return n.address;
  return null;
}
const host = { lan: lanIp(), 'android-emulator': '10.0.2.2', 'ios-simulator': 'localhost', web: 'localhost' }[target];
if (!host) { console.error(`Could not determine a LAN IP for --target ${target}. Connect to Wi-Fi/Ethernet, or pass --target android-emulator|ios-simulator|web.`); process.exit(2); }
const base = `http://${host}:${port}`;
const env = {
  ...process.env,
  EXPO_PUBLIC_SUPABASE_URL: base,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: 'qa-mock-anon-key',
  EXPO_PUBLIC_MAP_TILE_URL: `${base}/tiles/{z}/{x}/{y}.png`,
  EXPO_PUBLIC_MAP_ATTRIBUTION: 'QA mock tiles',
  EXPO_PUBLIC_LEAFLET_BASE_URL: `${base}/leaflet`,
  EXPO_NO_TELEMETRY: '1',
};
console.log(`QA app -> mock at ${base} (target: ${target})`);
console.log('Make sure `npm run qa:mock` is running. On a phone, the phone and this computer must be on the same Wi-Fi.');
const flags = ['expo', 'start', '--port', metroPort, '--clear'];
if (target === 'web') flags.push('--web'); else flags.push('--go');
if (process.argv.includes('--ios')) flags.push('--ios');
if (process.argv.includes('--android')) flags.push('--android');
if (process.argv.includes('--offline')) env.EXPO_OFFLINE = '1'; // env, because Expo rejects --offline together with --localhost/--lan
if (target === 'ios-simulator' || target === 'web') flags.push('--localhost');
const child = spawn('npx', flags, { cwd: new URL('../apps/mobile', import.meta.url).pathname, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
