#!/usr/bin/env node
// Fails if tracked files contain likely secrets or real env files are tracked.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const patterns = [
  ['private key', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{10,}/],
  ['AWS access key', /\bAKIA[0-9A-Z]{16}\b/],
  ['GitHub token', /\bgh[pousr]_[A-Za-z0-9]{30,}/],
  ['public service-role var', /(EXPO|NEXT)_PUBLIC_[A-Z_]*SERVICE_ROLE/],
];

const problems = [];
for (const file of files) {
  if (/(^|\/)\.env(\.|$)/.test(file) && !file.endsWith('.env.example')) {
    problems.push(`${file}: env file must not be committed`);
    continue;
  }
  if (/package-lock\.json$|\.(png|jpe?g|gif|ico|ttf|otf|woff2?)$/.test(file)) continue;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  if (file === 'scripts/check-secrets.mjs') continue;
  for (const [name, re] of patterns) {
    if (re.test(text)) problems.push(`${file}: possible ${name}`);
  }
}

if (problems.length) {
  console.error('Secret check failed:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Secret check passed (${files.length} files).`);
