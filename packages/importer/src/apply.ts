import { createClient } from '@supabase/supabase-js';
import type { Bbox, ImportRecord } from './types';

export type ImportCounts = { inserted: number; updated: number; unchanged: number; protected: number };
export type FinalizeCounts = { hidden_missing: number; flagged_missing: number };

/** Narrow persistence interface so the orchestration can be tested without a database. */
export interface ImportStore {
  createRun(run: { source: 'osm'; area_name: string; bounds: Bbox; tool_version: string }): Promise<string>;
  importBatch(runId: string, records: ImportRecord[]): Promise<ImportCounts>;
  finalizeRun(runId: string): Promise<FinalizeCounts>;
}

export function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname;
  const m = /^([a-z0-9]+)\.supabase\.co$/.exec(host);
  if (!m?.[1]) throw new Error(`Not a hosted Supabase URL: ${host}`);
  return m[1];
}

export function parseEnvironmentRef(environmentMd: string): string | null {
  return /^Project ref:\s*([a-z0-9]+)/im.exec(environmentMd)?.[1] ?? null;
}

/**
 * Refuses to write unless the target is exactly the project recorded in ENVIRONMENT.md AND
 * the operator re-typed that ref with --confirm-project. Never guesses or picks a project.
 */
export function assertApplyTarget(args: { url: string; confirmedRef: string | undefined; environmentMd: string }): string {
  const urlRef = projectRefFromUrl(args.url);
  const recorded = parseEnvironmentRef(args.environmentMd);
  if (!recorded) throw new Error('ENVIRONMENT.md has no "Project ref:"; refusing to apply.');
  if (urlRef !== recorded) {
    throw new Error(`Supabase URL project (${urlRef}) does not match ENVIRONMENT.md (${recorded}); refusing to apply.`);
  }
  if (args.confirmedRef !== recorded) {
    throw new Error(`Pass --confirm-project ${recorded} to apply to this project.`);
  }
  return recorded;
}

export function createSupabaseStore(url: string, serviceRoleKey: string): ImportStore {
  // The service-role key stays in memory only and is never logged.
  const client = createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return {
    async createRun(run) {
      const { data, error } = await client.from('import_runs').insert(run).select('id').single();
      if (error) throw new Error(`createRun: ${error.message}`);
      return (data as { id: string }).id;
    },
    async importBatch(runId, records) {
      const { data, error } = await client.rpc('import_locations', { p_run: runId, p_records: records });
      if (error) throw new Error(`import_locations: ${error.message}`);
      return data as ImportCounts;
    },
    async finalizeRun(runId) {
      const { data, error } = await client.rpc('finalize_import_run', { p_run: runId });
      if (error) throw new Error(`finalize_import_run: ${error.message}`);
      return data as FinalizeCounts;
    },
  };
}
