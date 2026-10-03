import { classifyAll, type ClassifyOptions } from './osmClassify';
import { buildOverpassQuery, fetchTile, type FetchOptions } from './overpass';
import { splitBbox } from './areas';
import type { ImportCounts, ImportStore } from './apply';
import type { Bbox, ImportRecord, OsmElement } from './types';

export const TOOL_VERSION = 'osm-import/0.1';
export const BATCH_SIZE = 200;

export type ImportPlan = {
  areaName: string;
  bbox: Bbox;
  tileDegrees: number;
  classify: ClassifyOptions;
  /** When set, elements come from this loader instead of the network (offline/replay). */
  loadElements?: () => Promise<OsmElement[]>;
  /** Called with the raw fetched elements (for reproducible replays via --from-file). */
  saveRaw?: (elements: OsmElement[]) => void;
  fetch?: FetchOptions;
  delayMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type ImportReport = {
  areaName: string;
  tiles: number;
  elements: number;
  records: number;
  explicitUnverified: number;
  hiddenCandidates: number;
  reasons: Record<string, number>;
  skipped: Record<string, number>;
  applied?: { counts: ImportCounts; finalized: boolean; finalize?: { hidden_missing: number; flagged_missing: number } };
};

/** Fetches ALL tiles first (any failure aborts before anything is written). */
export async function gatherElements(plan: ImportPlan): Promise<{ elements: OsmElement[]; tiles: number }> {
  if (plan.loadElements) return { elements: await plan.loadElements(), tiles: 0 };
  const tiles = splitBbox(plan.bbox, plan.tileDegrees);
  const sleep = plan.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out: OsmElement[] = [];
  for (const [i, tile] of tiles.entries()) {
    const query = buildOverpassQuery(tile, { includeCandidates: plan.classify.includeCandidates });
    out.push(...(await fetchTile(query, plan.fetch)));
    if (i < tiles.length - 1) await sleep(plan.delayMs ?? 1500);
  }
  plan.saveRaw?.(out);
  return { elements: out, tiles: tiles.length };
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Dry run by default (store === null): classify and report, write nothing.
 * With a store: create a run, import in batches, then finalize (stale handling) only if allowed.
 */
export async function executeImport(
  plan: ImportPlan,
  store: ImportStore | null,
  opts: { finalize?: boolean } = {},
): Promise<{ report: ImportReport; records: ImportRecord[] }> {
  const { elements, tiles } = await gatherElements(plan);
  const { records, reasons, skipped } = classifyAll(elements, plan.classify);
  const report: ImportReport = {
    areaName: plan.areaName,
    tiles,
    elements: elements.length,
    records: records.length,
    explicitUnverified: records.filter((r) => r.evidence === 'explicit').length,
    hiddenCandidates: records.filter((r) => r.evidence === 'inferred').length,
    reasons,
    skipped,
  };
  if (!store) return { report, records };

  const runId = await store.createRun({ source: 'osm', area_name: plan.areaName, bounds: plan.bbox, tool_version: TOOL_VERSION });
  const counts: ImportCounts = { inserted: 0, updated: 0, unchanged: 0, protected: 0 };
  for (const batch of chunk(records, BATCH_SIZE)) {
    const c = await store.importBatch(runId, batch);
    counts.inserted += c.inserted;
    counts.updated += c.updated;
    counts.unchanged += c.unchanged;
    counts.protected += c.protected;
  }
  const finalize = opts.finalize !== false;
  const finalized = finalize ? await store.finalizeRun(runId) : undefined;
  report.applied = { counts, finalized: finalize, finalize: finalized };
  return { report, records };
}
