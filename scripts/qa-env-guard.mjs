// The QA launcher must never feed real project values into the app. EXPO_NO_DOTENV=1 stops the Expo CLI from loading
// .env files, but Expo's DEV bundles also read apps/mobile/.env* themselves (a Metro require.context in the virtual env module)
// and those values win over process.env, so a real .env.local could silently replace the QA mock URL. Proven by
// `node scripts/qa-kit-selftest.mjs --dotenv`. The launcher therefore refuses to start while any such file exists; it never
// reads, moves or prints them.
import { existsSync, readdirSync } from 'node:fs';

export function envFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f === '.env' || f.startsWith('.env.')).sort();
}

export function refuseIfEnvFiles(dir) {
  const files = envFilesIn(dir);
  if (files.length === 0) return false;
  console.error(`QA launcher stopped: found ${files.join(', ')} in ${dir}.`);
  console.error('Expo dev bundles read these files and they would override the QA mock settings, which could point the app at a real project.');
  console.error('Nothing was read or changed. Rename or move the file(s) aside (for example `mv apps/mobile/.env.local apps/mobile/.env.local.off`), run the QA session, then rename them back.');
  return true;
}
