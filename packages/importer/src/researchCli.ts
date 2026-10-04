#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { geocodeCensus, type Geocode } from './census';
import { buildResearchCleanupSql, buildResearchScript, buildResearchVerifySql, validateResearchInput } from './researchedLocations';

const HELP = `Generate SQL for up to 3 externally RESEARCHED, UNVERIFIED development records (OS-111).
Coordinates come from the US Census Bureau Geocoder (public domain). Never writes to a database.

  npm run research:sql -- --file os111-research.local.json --out os111-research.sql
  npm run research:sql -- --verify      # read-only check query
  npm run research:sql -- --cleanup     # DESTRUCTIVE cleanup SQL (human-run only)
Options: --save-geocodes <json> (audit copy of geocoder answers)  --use-geocodes <json> (reuse a saved copy)`;

const { values } = parseArgs({
  options: {
    file: { type: 'string' }, out: { type: 'string' }, verify: { type: 'boolean' }, cleanup: { type: 'boolean' },
    'save-geocodes': { type: 'string' }, 'use-geocodes': { type: 'string' }, help: { type: 'boolean' },
  },
});

async function main() {
  if (values.help) return void console.log(HELP);
  if (values.verify) return void console.log(buildResearchVerifySql());
  if (values.cleanup) return void console.log(buildResearchCleanupSql());
  if (!values.file) {
    console.log(HELP);
    process.exit(1);
  }
  const result = validateResearchInput(JSON.parse(readFileSync(values.file, 'utf8')));
  if (!result.ok) {
    console.error('Validation failed. Nothing generated:\n- ' + result.errors.join('\n- '));
    process.exit(1);
  }
  const saved: Record<string, Geocode> = values['use-geocodes'] ? JSON.parse(readFileSync(values['use-geocodes'], 'utf8')) : {};
  const items: { record: (typeof result.records)[number]; geocode: Geocode }[] = [];
  const audit: Record<string, Geocode> = {};
  for (const [i, record] of result.records.entries()) {
    const geocode = saved[record.ref] ?? (await geocodeCensus(record));
    audit[record.ref] = geocode;
    items.push({ record, geocode });
    console.error(`${record.ref}: ${geocode.latitude}, ${geocode.longitude}  (Census matched "${geocode.matchedAddress}")`);
    if (!saved[record.ref] && i < result.records.length - 1) await new Promise((r) => setTimeout(r, 1000));
  }
  if (values['save-geocodes']) writeFileSync(values['save-geocodes'], JSON.stringify(audit, null, 2));
  const sql = buildResearchScript(items);
  if (values.out) {
    writeFileSync(values.out, sql + '\n');
    console.error(`Wrote ${values.out}. Review it, then paste into the Supabase SQL editor.`);
  } else {
    console.log(sql);
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
