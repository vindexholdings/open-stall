#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildCleanupSql, buildInsertScript, buildVerifySql, validateManualInput } from './manualLocations';

const HELP = `Generate SQL for 1-3 MANUALLY confirmed development/test locations. Never connects to a database.

  npm run manual:sql -- --file manual-locations.local.json            # validate + print SQL
  npm run manual:sql -- --file manual-locations.local.json --out add.sql
  npm run manual:sql -- --verify                                      # print the read-only check query
  npm run manual:sql -- --cleanup                                     # print DESTRUCTIVE cleanup SQL (human-run only)
See manual-locations.example.json for the format.`;

const { values } = parseArgs({
  options: { file: { type: 'string' }, out: { type: 'string' }, verify: { type: 'boolean' }, cleanup: { type: 'boolean' }, help: { type: 'boolean' } },
});
if (values.help) {
  console.log(HELP);
} else if (values.verify) {
  console.log(buildVerifySql());
} else if (values.cleanup) {
  console.log(buildCleanupSql());
} else if (values.file) {
  const result = validateManualInput(JSON.parse(readFileSync(values.file, 'utf8')));
  if (!result.ok) {
    console.error('Validation failed. Nothing generated:\n- ' + result.errors.join('\n- '));
    process.exit(1);
  }
  const sql = buildInsertScript(result.records);
  if (values.out) {
    writeFileSync(values.out, sql + '\n');
    console.error(`Wrote ${values.out} (${result.records.length} record(s)). Review it, then paste into the Supabase SQL editor.`);
  } else {
    console.log(sql);
  }
} else {
  console.log(HELP);
  process.exit(1);
}
