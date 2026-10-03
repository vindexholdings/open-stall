import { describe, expect, it, vi } from 'vitest';
import { assertApplyTarget, parseEnvironmentRef, projectRefFromUrl, type ImportStore } from './apply';
import { BATCH_SIZE, chunk, executeImport, type ImportPlan } from './run';
import type { OsmElement } from './types';

const els = (n: number): OsmElement[] =>
  Array.from({ length: n }, (_, i) => ({ type: 'node', id: i + 1, lat: 10, lon: 10, tags: { amenity: 'toilets' } }));
const BOX = { south: 0, west: 0, north: 1, east: 1 };
const META = { bbox: BOX, includeCandidates: true, fetchedAt: '2026-01-01T00:00:00Z' };
const plan = (elements: OsmElement[], extra: Partial<ImportPlan> = {}, meta: typeof META | null = META): ImportPlan => ({
  areaName: 'test', bbox: BOX, tileDegrees: 0.25,
  classify: {}, loadElements: async () => ({ elements, meta: meta ?? undefined }), ...extra,
});
const fakeStore = () => {
  const store = {
    createRun: vi.fn(async () => 'run-1'),
    importBatch: vi.fn(async (_r: string, recs: unknown[]) => ({ inserted: recs.length, updated: 0, unchanged: 0, protected: 0, duplicates_flagged: 0, held_recent_edit: 0 })),
    finalizeRun: vi.fn(async (_r: string, _force: boolean) => ({ flagged_sources: 0, hidden_locations: 0, public_in_area: 0 })),
  };
  return store satisfies ImportStore;
};

describe('executeImport', () => {
  it('dry run (no store) classifies and writes nothing', async () => {
    const { report } = await executeImport(plan(els(3)), null);
    expect(report).toMatchObject({ records: 3, explicitUnverified: 3, hiddenCandidates: 0 });
    expect(report.applied).toBeUndefined();
  });

  it('applies in batches, then finalizes', async () => {
    const store = fakeStore();
    const { report } = await executeImport(plan(els(BATCH_SIZE + 5)), store);
    expect(store.createRun).toHaveBeenCalledTimes(1);
    expect(store.importBatch).toHaveBeenCalledTimes(2);
    expect(store.finalizeRun).toHaveBeenCalledWith('run-1', false);
    expect(store.createRun).toHaveBeenCalledWith(expect.objectContaining({ complete: true, bounds: BOX, scope: { include_candidates: true } }));
    expect(report.applied?.counts.inserted).toBe(BATCH_SIZE + 5);
  });

  it('passes force only when explicitly requested', async () => {
    const store = fakeStore();
    await executeImport(plan(els(1)), store, { forceFinalize: true });
    expect(store.finalizeRun).toHaveBeenCalledWith('run-1', true);
  });

  it('records the run scope when candidates are not queried', async () => {
    const store = fakeStore();
    await executeImport(plan(els(1), { classify: { includeCandidates: false } }, { ...META, includeCandidates: false }), store);
    expect(store.createRun).toHaveBeenCalledWith(expect.objectContaining({ scope: { include_candidates: false } }));
  });

  it('never finalizes from a replay that does not cover the run (wrong area, no metadata, narrower scope)', async () => {
    for (const [meta, why] of [
      [null, 'no capture metadata'],
      [{ ...META, bbox: { south: 0, west: 0, north: 0.5, east: 0.5 } }, 'different area'],
      [{ ...META, includeCandidates: false }, 'did not include candidates'],
    ] as const) {
      const store = fakeStore();
      const { report } = await executeImport(plan(els(2), {}, meta as typeof META | null), store);
      expect(report.complete).toBe(false);
      expect(report.incompleteReason).toContain(why);
      expect(store.createRun).toHaveBeenCalledWith(expect.objectContaining({ complete: false }));
      expect(store.finalizeRun).not.toHaveBeenCalled();
      expect(report.applied?.finalizeSkippedReason).toContain(why);
    }
  });

  it('skips finalize when asked', async () => {
    const store = fakeStore();
    await executeImport(plan(els(1)), store, { finalize: false });
    expect(store.finalizeRun).not.toHaveBeenCalled();
  });

  it('aborts before writing anything if any tile fails to fetch', async () => {
    const store = fakeStore();
    const failing = plan([], {
      loadElements: undefined,
      fetch: { fetchImpl: (async () => ({ ok: false, status: 400, json: async () => ({}) })) as unknown as typeof fetch, sleepMs: async () => {} },
      sleep: async () => {},
    });
    await expect(executeImport(failing, store)).rejects.toThrow();
    expect(store.createRun).not.toHaveBeenCalled();
  });

  it('chunks evenly', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe('assertApplyTarget', () => {
  const env = 'Supabase organization: x\nProject: Open Stall\nProject ref: abcdefghij1234 (approved)\n';
  const url = 'https://abcdefghij1234.supabase.co';

  it('parses refs', () => {
    expect(parseEnvironmentRef(env)).toBe('abcdefghij1234');
    expect(projectRefFromUrl(url)).toBe('abcdefghij1234');
    expect(() => projectRefFromUrl('https://example.com')).toThrow();
  });
  it('allows only the recorded project with explicit confirmation', () => {
    expect(assertApplyTarget({ url, confirmedRef: 'abcdefghij1234', environmentMd: env })).toBe('abcdefghij1234');
    expect(() => assertApplyTarget({ url, confirmedRef: undefined, environmentMd: env })).toThrow('--confirm-project');
    expect(() => assertApplyTarget({ url, confirmedRef: 'other', environmentMd: env })).toThrow('--confirm-project');
    expect(() => assertApplyTarget({ url: 'https://zzzzzzzzzz.supabase.co', confirmedRef: 'zzzzzzzzzz', environmentMd: env })).toThrow('does not match');
    expect(() => assertApplyTarget({ url, confirmedRef: 'abcdefghij1234', environmentMd: 'no ref here' })).toThrow('ENVIRONMENT.md');
  });
});
