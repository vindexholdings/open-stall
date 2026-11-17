// Runs the Expo CLI that npm installed for THIS workspace, by explicit path, using the same Node that runs the script.
// `npx expo` depends on PATH and on npx finding a root-hoisted bin from apps/mobile; on a real Mac checkout that failed with
// "sh: expo: command not found". Nothing here downloads, installs or reads PATH.
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

export const MOBILE_DIR = new URL('../apps/mobile', import.meta.url).pathname;

// from: a directory whose node_modules resolution should be used (tests pass a bare directory to prove the diagnostic)
export function expoCli(from = MOBILE_DIR) {
  let pkgPath;
  try { pkgPath = createRequire(join(from, 'package.json')).resolve('expo/package.json'); }
  catch {
    throw new Error(`The Expo package is not installed for ${from}.\n  Run \`npm ci\` once at the repository root (the folder that contains package-lock.json), then retry.\n  (Searched node_modules folders from ${from} upward. Nothing was downloaded or installed.)`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.expo;
  const cli = rel ? join(dirname(pkgPath), rel) : null;
  if (!cli || !existsSync(cli)) throw new Error(`The Expo package at ${dirname(pkgPath)} has no runnable CLI file (${cli ?? 'no bin entry'}). Reinstall with \`npm ci\` at the repository root.`);
  return { cli, version: pkg.version, node: process.execPath };
}

// argv for spawn: [node, cli, ...args]
export function expoArgv(args, from = MOBILE_DIR) {
  const { cli, node } = expoCli(from);
  return [node, cli, ...args];
}
