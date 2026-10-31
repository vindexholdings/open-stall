import { classifyAll, sanitizeElement, type ClassifyOptions } from './osmClassify';
import { buildOverpassQuery, fetchTile, type FetchOptions } from './overpass';
import { splitBbox } from './areas';
import type { FinalizeCounts, ImportCounts, ImportStore } from './apply';
import type { Bbox, ImportRecord, OsmElement } from './types';

export const TOOL_VERSION = 'osm-import/0.2';
export const BATCH_SIZE = 200;

/** What a raw capture covers; a replay may only finalize if it covers the run's whole area and scope. */
export type RawMeta = { bbox: Bbox; includeCandidates: boolean; fetchedAt: string };

export type ImportPlan = {
  areaName: string;
  bbox: Bbox;
  tileDegrees: number;
  classify: ClassifyOptions;
  /** When set, elements come from this loader instead of the network (offline/replay). */
  loadElements?: () => Promise<{ elements: OsmElement[]; meta?: RawMeta }>;
  /** Called with the raw fetched elements + capture metadata (for reproducible replays via --from-file). */
  saveRaw?: (elements: OsmElement[], meta: RawMeta) => void;
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
  /** True only if the whole area was fetched (or replayed from a capture covering it). */
  complete: boolean;
  incompleteReason?: string;
  applied?: {
    counts: ImportCounts;
    finalized: boolean;
    finalizeSkippedReason?: string;
    finalize?: FinalizeCounts;
  };
};

const sameBox = (a: Bbox, b: Bbox) =>
  (['south', 'west', 'north', 'east'] as const).every((k) => Math.abs(a[k] - b[k]) < 1e-9);

/** Fetches ALL tiles first (any failure aborts before anything is written). */
export async function gatherElements(
  plan: ImportPlan,
): Promise<{ elements: OsmElement[]; tiles: number; complete: boolean; incompleteReason?: string }> {
  if (plan.loadElements) {
    const loaded = await plan.loadElements();
    const elements = loaded.elements.map(sanitizeElement);
    const meta = loaded.meta;
    const wantsCandidates = plan.classify.includeCandidates !== false;
    if (!meta) return { elements, tiles: 0, complete: false, incompleteReason: 'replayed file has no capture metadata (area/scope unknown)' };
    if (!sameBox(meta.bbox, plan.bbox)) return { elements, tiles: 0, complete: false, incompleteReason: 'replayed capture covers a different area than this run' };
    if (wantsCandidates && !meta.includeCandidates) return { elements, tiles: 0, complete: false, incompleteReason: 'replayed capture did not include candidates' };
    return { elements, tiles: 0, complete: true };
  }
  const tiles = splitBbox(plan.bbox, plan.tileDegrees);
  const sleep = plan.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const out: OsmElement[] = [];
  for (const [i, tile] of tiles.entries()) {
    const query = buildOverpassQuery(tile, { includeCandidates: plan.classify.includeCandidates });
    out.push(...(await fetchTile(query, plan.fetch)).map(sanitizeElement));
    if (i < tiles.length - 1) await sleep(plan.delayMs ?? 1500);
  }
  plan.saveRaw?.(out, {
    bbox: plan.bbox,
    includeCandidates: plan.classify.includeCandidates !== false,
    fetchedAt: new Date().toISOString(),
  });
  return { elements: out, tiles: tiles.length, complete: true };
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
  opts: { finalize?: boolean; forceFinalize?: boolean } = {},
): Promise<{ report: ImportReport; records: ImportRecord[] }> {
  const { elements, tiles, complete, incompleteReason } = await gatherElements(plan);
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
    complete,
    incompleteReason,
  };
  if (!store) return { report, records };

  const runId = await store.createRun({
    source: 'osm',
    area_name: plan.areaName,
    bounds: plan.bbox,
    scope: { include_candidates: plan.classify.includeCandidates !== false },
    complete,
    tool_version: TOOL_VERSION,
  });
  const counts: ImportCounts = { inserted: 0, updated: 0, unchanged: 0, protected: 0, duplicates_flagged: 0, held_recent_edit: 0 };
  for (const batch of chunk(records, BATCH_SIZE)) {
    const c = await store.importBatch(runId, batch);
    counts.inserted += c.inserted;
    counts.updated += c.updated;
    counts.unchanged += c.unchanged;
    counts.protected += c.protected;
    counts.duplicates_flagged += c.duplicates_flagged;
    counts.held_recent_edit += c.held_recent_edit;
  }
  const wantFinalize = opts.finalize !== false;
  const skipReason = !wantFinalize ? 'disabled (--no-finalize)' : !complete ? (incompleteReason ?? 'run not complete') : undefined;
  const finalize = skipReason ? undefined : await store.finalizeRun(runId, opts.forceFinalize === true);
  report.applied = { counts, finalized: finalize !== undefined, finalizeSkippedReason: skipReason, finalize };
  return { report, records };
}
