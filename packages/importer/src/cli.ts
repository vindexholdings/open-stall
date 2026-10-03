#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { assertApplyTarget, createSupabaseStore } from './apply';
import { AREA_PRESETS, parseBbox, validateBbox } from './areas';
import { DEFAULT_OVERPASS_URL } from './overpass';
import { executeImport, type ImportPlan } from './run';
import type { OsmElement } from './types';

const HELP = `OpenStreetMap -> Open Stall importer (dry run by default; writes nothing).

  npm run import:osm -- --area cody-area
  npm run import:osm -- --bbox 44.45,-109.25,44.62,-108.85 --save-raw raw.json
  npm run import:osm -- --from-file raw.json --area cody-area --report report.json
  npm run import:osm -- --area cody-area --apply --confirm-project <ref>      # writes to Supabase

Options: --area <preset> | --bbox s,w,n,e   --area-name <label>   --no-candidates
         --tile-size <deg>  --delay-ms <ms>  --overpass-url <url>  --country <ISO2>
         --from-file <json> --save-raw <json> --report <json>
         --apply --confirm-project <ref> [--no-finalize]
Apply needs env: SUPABASE_URL (or EXPO_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (never printed).
Presets: ${Object.keys(AREA_PRESETS).join(', ')}`;

async function main() {
  const { values } = parseArgs({
    options: {
      area: { type: 'string' },
      bbox: { type: 'string' },
      'area-name': { type: 'string' },
      'no-candidates': { type: 'boolean' },
      'tile-size': { type: 'string' },
      'delay-ms': { type: 'string' },
      'overpass-url': { type: 'string' },
      country: { type: 'string' },
      'from-file': { type: 'string' },
      'save-raw': { type: 'string' },
      report: { type: 'string' },
      apply: { type: 'boolean' },
      'confirm-project': { type: 'string' },
      'no-finalize': { type: 'boolean' },
      help: { type: 'boolean' },
    },
  });
  if (values.help) return void console.log(HELP);

  const preset = values.area ? AREA_PRESETS[values.area] : undefined;
  if (values.area && !preset) throw new Error(`Unknown area "${values.area}". Presets: ${Object.keys(AREA_PRESETS).join(', ')}`);
  const bbox = values.bbox ? parseBbox(values.bbox) : preset ? validateBbox(preset.bbox) : null;
  if (!bbox) throw new Error('Give --area <preset> or --bbox south,west,north,east (see --help).');

  const plan: ImportPlan = {
    areaName: values['area-name'] ?? values.area ?? 'custom-bbox',
    bbox,
    tileDegrees: Number(values['tile-size'] ?? 0.25),
    classify: { includeCandidates: !values['no-candidates'], defaultCountry: values.country ?? 'US' },
    fetch: { url: values['overpass-url'] ?? process.env.OVERPASS_URL ?? DEFAULT_OVERPASS_URL },
    delayMs: Number(values['delay-ms'] ?? 1500),
    saveRaw: values['save-raw']
      ? (elements) => writeFileSync(values['save-raw']!, JSON.stringify({ elements }))
      : undefined,
    loadElements: values['from-file']
      ? async () => {
          const json = JSON.parse(readFileSync(values['from-file']!, 'utf8')) as { elements?: OsmElement[] } | OsmElement[];
          return Array.isArray(json) ? json : (json.elements ?? []);
        }
      : undefined,
  };

  let store = null;
  if (values.apply) {
    const url = process.env.SUPABASE_URL ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.');
    assertApplyTarget({
      url,
      confirmedRef: values['confirm-project'],
      environmentMd: readFileSync(new URL('../../../ENVIRONMENT.md', import.meta.url), 'utf8'),
    });
    store = createSupabaseStore(url, key);
  }

  const { report, records } = await executeImport(plan, store, { finalize: !values['no-finalize'] });
  console.log(JSON.stringify(report, null, 2));
  if (values.report) writeFileSync(values.report, JSON.stringify({ report, records }, null, 2));
  console.log(store ? 'APPLIED to Supabase (see counts above).' : 'DRY RUN: nothing was written to any database.');
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
