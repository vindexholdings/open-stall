#!/usr/bin/env node
// Boundary check for the rewards P1 package. Pure file inspection: it opens no network connection, reads no environment file
// and never contacts a database. It fails when:
//  1. any file in supabase/migrations/ references a rewards table or function,
//  2. supabase/rewards-wip/ creates an object name that supabase/migrations/ already creates,
//  3. a rewards file contains a connection string, a project reference or a key,
//  4. a rewards-wip statement enables rewards, sets a budget, or grants write access to the settings,
//  5. rewards-wip uses a network feature (foreign servers, dblink, extensions, copy from program),
//  6. (with --against <rev>) any changed or untracked path falls outside the allowed list, or package.json changes
//     anything but the one test:db:rewards script.
// Usage: node scripts/check-rewards-boundary.mjs [--against <git revision>] [--root <directory>]
//        node scripts/check-rewards-boundary.mjs --selftest     (negative controls: seeded violations must each be caught)
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const here = resolve(new URL('..', import.meta.url).pathname);
const root = resolve(opt('--root') ?? here);
const against = opt('--against');

if (args.includes('--selftest')) {
  const base = {
    'supabase/migrations/001_a.sql': 'create table public.thing (id int);\n',
    'supabase/rewards-wip/R001.sql': 'create table rewards.t (id int);\ninsert into rewards.reward_settings (id, rewards_enabled, global_budget_utc_day) values (true, false, null);\n',
    'supabase/tests/rewards/a.test.sql': 'select 1;\n',
  };
  const cases = [
    ['a migration references a rewards table', { 'supabase/migrations/002_b.sql': 'select * from reward_ledger;\n' }],
    ['rewards-wip re-creates a name from migrations', { 'supabase/rewards-wip/R002.sql': 'create table public.thing (id int);\n' }],
    ['a connection string', { 'supabase/rewards-wip/R002.sql': 'select 1; -- ' + 'postgres' + '://u:p@db.example.com/postgres\n' }],
    ['rewards enabled by an update', { 'supabase/rewards-wip/R002.sql': 'update rewards.reward_settings set rewards_enabled = true;\n' }],
    ['a budget is set', { 'supabase/rewards-wip/R002.sql': 'select 1 where global_budget_utc_day = 500;\n' }],
    ['write access granted on the settings', { 'supabase/rewards-wip/R002.sql': 'grant update on rewards.reward_settings to someone;\n' }],
    ['a second settings insert', { 'supabase/rewards-wip/R002.sql': 'insert into rewards.reward_settings values (true, true, 5);\n' }],
    ['delete_my_account replaced outside R006', { 'supabase/migrations/002_b.sql': 'create function public.delete_my_account(p text) returns void language sql as $$ select 1 $$;\n', 'supabase/rewards-wip/R007.sql': 'create or replace function public.delete_my_account(p text) returns void language sql as $$ select 1 $$;\n' }],
    ['R006 replaces another existing function', { 'supabase/migrations/002_b.sql': 'create function public.log_moderation() returns void language sql as $$ select 1 $$;\n', 'supabase/rewards-wip/R006_p2_lifecycle_functions.sql': 'create or replace function public.log_moderation() returns void language sql as $$ select 1 $$;\n' }],
    ['R006 CREATES (not replaces) delete_my_account', { 'supabase/migrations/002_b.sql': 'create function public.delete_my_account(p text) returns void language sql as $$ select 1 $$;\n', 'supabase/rewards-wip/R006_p2_lifecycle_functions.sql': 'create function public.delete_my_account(p text) returns void language sql as $$ select 1 $$;\n' }],
    ['an achievement catalog row is seeded', { 'supabase/rewards-wip/R002.sql': "insert into rewards.achievement_definitions (achievement_key, version) values ('x', 1);\n" }],
    ['a network feature', { 'supabase/rewards-wip/R002.sql': 'create extension dblink;\n' }],
    ['a JWT-shaped key', { 'supabase/tests/rewards/b.test.sql': 'select \'' + 'eyJ' + 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.abc\';\n' }],
    ['an environment-file reference', { 'supabase/tests/rewards/b.test.sql': 'select 1; -- reads ' + '.' + 'env' + '.local\n' }],
    ['a hosted host name', { 'supabase/tests/rewards/b.test.sql': 'select \'abc' + '.supabase.' + 'co\';\n' }],
  ];
  let bad = 0;
  const run = (files) => {
    const dir = mkdtempSync(join(tmpdir(), 'rwb-'));
    try {
      for (const [f, c] of Object.entries(files)) { mkdirSync(dirname(join(dir, f)), { recursive: true }); writeFileSync(join(dir, f), c); }
      return spawnSync('node', [new URL(import.meta.url).pathname, '--root', dir], { encoding: 'utf8' });
    } finally { rmSync(dir, { recursive: true, force: true }); }
  };
  const clean = run(base);
  if (clean.status === 0) console.log('ok - selftest: the clean tree passes'); else { bad += 1; console.log('not ok - selftest: the clean tree should pass\n' + clean.stdout); }
  const okReplace = run({ ...base, 'supabase/migrations/002_b.sql': 'create function public.delete_my_account(p text) returns void language sql as $$ select 1 $$;\n', 'supabase/rewards-wip/R006_p2_lifecycle_functions.sql': 'create or replace function public.delete_my_account(p text) returns void language sql as $$ select 1 $$;\n' });
  if (okReplace.status === 0) console.log('ok - selftest: the single permitted replacement in R006 passes'); else { bad += 1; console.log('not ok - selftest: the permitted R006 replacement should pass\n' + okReplace.stdout); }
  for (const [name, extra] of cases) {
    const r = run({ ...base, ...extra });
    if (r.status === 1 && /not ok/.test(r.stdout)) console.log(`ok - selftest: caught "${name}"`); else { bad += 1; console.log(`not ok - selftest: did NOT catch "${name}"`); }
  }
  console.log(`selftest: ${cases.length + 2 - bad} passed, ${bad} failed`);
  process.exit(bad === 0 ? 0 : 1);
}
let failures = 0;
let checks = 0;
const ok = (cond, name, detail = '') => {
  checks += 1;
  if (cond) console.log(`ok - ${name}`);
  else { failures += 1; console.log(`not ok - ${name}${detail ? `: ${detail}` : ''}`); }
};
const walk = (dir) => {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
};
const read = (p) => readFileSync(p, 'utf8');
const stripSqlComments = (t) => t.replace(/--[^\n]*/g, '');
const rel = (p) => relative(root, p);

const migrations = walk(join(root, 'supabase/migrations')).filter((p) => p.endsWith('.sql'));
const wipFiles = walk(join(root, 'supabase/rewards-wip')).filter((p) => p.endsWith('.sql'));
const rewardsFiles = [
  ...wipFiles,
  ...walk(join(root, 'supabase/tests/rewards')),
  ...walk(join(root, 'docs/evidence/rewards')),
  ...['scripts/test-db-rewards.sh', 'scripts/check-rewards-boundary.mjs'].map((f) => join(root, f)).filter(existsSync),
];
// Tests may contain deliberately hostile fixtures only as pieces; the checks scan every file as plain text.

// 1. migrations never reference rewards objects
const names = /\b(reward_ledger|reward_settings(_history)?|reward_policy_versions|reward_counters_user_day|reward_counters_global_day|reward_location_zones|reward_writer_owner|reward_purge_owner|record_visit(_at)?|evaluate_visit)\b|\brewards\.[a-z_]+/i;
const referencing = migrations.filter((p) => names.test(stripSqlComments(read(p))));
ok(referencing.length === 0, 'no file in supabase/migrations/ references a rewards table, function or role', referencing.map(rel).join(', '));
ok(wipFiles.every((p) => rel(p).startsWith('supabase/rewards-wip/')), 'all rewards SQL lives under supabase/rewards-wip/');
ok(wipFiles.length > 0, `rewards-wip holds ${wipFiles.length} source files`);

// 2. no object name collision with migrations
const createRe = /create\s+(?:or\s+replace\s+)?(?:unique\s+)?(table|function|view|type|schema|role|index|trigger|policy)\s+(?:if\s+not\s+exists\s+)?([a-z0-9_."]+)/gi;
const created = (files) => {
  const out = new Set();
  for (const f of files) for (const m of stripSqlComments(read(f)).matchAll(createRe)) out.add(`${m[1].toLowerCase()} ${m[2].replace(/"/g, '').split('.').pop().toLowerCase()}`);
  return out;
};
const wipCreated = created(wipFiles);
const migCreated = created(migrations);
// P2 exception, exactly one: the account-deletion function is REPLACED (create or replace, baseline copied from the migration)
// so the purge can be called from the existing deletion path. It may be defined only in R006_p2_lifecycle_functions.sql.
const replaced = 'function delete_my_account';
const replacementFiles = wipFiles.filter((p) => created([p]).has(replaced)).map(rel);
const replacementOk = replacementFiles.length === 0
  || (replacementFiles.length === 1 && replacementFiles[0] === 'supabase/rewards-wip/R006_p2_lifecycle_functions.sql'
      && /create\s+or\s+replace\s+function\s+public\.delete_my_account\s*\(/i.test(stripSqlComments(read(wipFiles.find((p) => rel(p) === replacementFiles[0])))));
const collisions = [...wipCreated].filter((n) => migCreated.has(n) && !(n === replaced && replacementOk));
ok(collisions.length === 0, 'rewards-wip creates no object name that supabase/migrations/ already creates (sole exception: the P2 replacement of delete_my_account in R006)', collisions.join(', '));
const migBase = new Set(migrations.map((p) => p.split('/').pop()));
ok(wipFiles.every((p) => !migBase.has(p.split('/').pop())), 'no rewards-wip file name exists in supabase/migrations/');

// 3. connection strings, project refs, keys, environment files
const dbUrl = new RegExp('postgres(?:ql)?' + ':' + '//(?!invalid)', 'i');
const hosted = new RegExp('\\.supabase\\.' + '(co|com|in)\\b', 'i');
const jwt = new RegExp('eyJ' + '[A-Za-z0-9_-]{15,}\\.');
const sbKey = new RegExp('sb_' + '(publishable|secret)_[A-Za-z0-9_-]{10,}');
const envFile = new RegExp('\\.' + 'env\\b');
const refLike = /\b[a-z]{20}\b/;
for (const [label, re] of [['a connection string', dbUrl], ['a hosted Supabase host', hosted], ['a JWT-looking key', jwt], ['a Supabase API key', sbKey], ['an environment-file reference', envFile], ['a 20-letter lowercase token (project-reference shape)', refLike]]) {
  const hits = rewardsFiles.filter((p) => { try { return re.test(read(p)); } catch { return false; } });
  ok(hits.length === 0, `no rewards file contains ${label}`, hits.map(rel).join(', '));
}

// 4. the settings can only be changed by test fixtures, never by rewards-wip
const wipSql = wipFiles.map((p) => stripSqlComments(read(p))).join('\n');
const seed = /insert\s+into\s+rewards\.reward_settings\s*\(\s*id\s*,\s*rewards_enabled\s*,\s*global_budget_utc_day\s*\)\s*values\s*\(\s*true\s*,\s*false\s*,\s*null\s*\)\s*;/gi;
const withoutSeed = wipSql.replace(seed, '');
ok((wipSql.match(seed) || []).length === 1, 'rewards-wip seeds the settings exactly once, as disabled and unset (false, NULL)');
ok(!/insert\s+into\s+rewards\.reward_settings\b(?!_history)/i.test(withoutSeed), 'no other insert into the settings table');
ok(!/update\s+(only\s+)?rewards\.reward_settings\b/i.test(wipSql), 'no statement updates the settings');
ok(!/rewards_enabled\s*(=|:=)\s*true/i.test(wipSql) && !/set\s+rewards_enabled/i.test(wipSql), 'nothing in rewards-wip enables rewards');
ok(!/global_budget_utc_day\s*(=|:=)\s*[0-9]/i.test(wipSql) && !/set\s+global_budget_utc_day/i.test(wipSql), 'nothing in rewards-wip sets a budget');
ok(!/grant\s+[^;]*\b(insert|update|delete|truncate|all)\b[^;]*reward_settings/i.test(wipSql), 'nothing grants write access to the settings');
ok(!/delete\s+from\s+rewards\.reward_settings/i.test(wipSql), 'nothing deletes settings');
// P3: no achievement catalog row is ever seeded by rewards-wip (tests insert synthetic definitions inside their own throwaway clone only)
ok(!/insert\s+into\s+rewards\.achievement_definitions\b/i.test(wipSql), 'no achievement catalog row is seeded by rewards-wip');

// 5. no network feature inside the SQL
const net = /\b(create\s+server|create\s+foreign|dblink|postgres_fdw|create\s+extension|copy\s+[^;]*\bprogram\b|alter\s+system|\\connect|\\c\s)/i;
ok(!net.test(wipSql), 'rewards-wip uses no foreign server, dblink, extension, COPY PROGRAM or ALTER SYSTEM');

// 6. optional: the change set against a revision stays inside the allowed list
if (against) {
  const git = (a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
  const changed = git(['diff', '--name-status', against]).split('\n').filter(Boolean).map((l) => l.split('\t'));
  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter(Boolean).map((p) => ['??', p]);
  const allowedPrefix = ['supabase/rewards-wip/', 'supabase/tests/rewards/', 'docs/evidence/rewards/'];
  const allowedFile = new Set(['scripts/test-db-rewards.sh', 'scripts/check-rewards-boundary.mjs', 'package.json', 'PROJECT_STATE.md', 'BACKLOG.md', 'TESTING.md', 'HANDOFF.md', 'SECURITY.md', 'DATABASE.md', 'GOVERNANCE.md', 'REWARDS_IMPLEMENTATION_PROPOSAL.md']);
  const outside = [...changed, ...untracked].filter(([status, p]) => {
    if (status.startsWith('D') || status.startsWith('R')) return true;
    return !(allowedFile.has(p) || allowedPrefix.some((a) => p.startsWith(a)));
  });
  ok(outside.length === 0, `every changed or untracked path since ${against} is on the allowed list`, outside.map((o) => o.join(' ')).join('; '));
  const newerPkg = JSON.parse(read(join(root, 'package.json')));
  const olderPkg = JSON.parse(git(['show', `${against}:package.json`]));
  const keys = new Set([...Object.keys(newerPkg.scripts), ...Object.keys(olderPkg.scripts)]);
  const diffKeys = [...keys].filter((k) => newerPkg.scripts[k] !== olderPkg.scripts[k]);
  const rest = (o) => JSON.stringify({ ...o, scripts: undefined });
  ok(diffKeys.every((k) => k === 'test:db:rewards') && rest(newerPkg) === rest(olderPkg), 'package.json differs only by the test:db:rewards script', diffKeys.join(', '));
  const touchedMigrations = [...changed, ...untracked].filter(([, p]) => p.startsWith('supabase/migrations/'));
  ok(touchedMigrations.length === 0, 'no existing migration was changed and none was added');
  const touchedApps = [...changed, ...untracked].filter(([, p]) => /^(apps|packages)\//.test(p) || /^\.github\//.test(p));
  ok(touchedApps.length === 0, 'apps/, packages/ and CI workflows are untouched');
}

console.log(`boundary: ${checks - failures} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
