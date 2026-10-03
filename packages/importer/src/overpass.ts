import { DEFAULT_CANDIDATE_CATEGORIES, type CandidateCategory } from './osmClassify';
import type { Bbox, OsmElement } from './types';

export const DEFAULT_OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
export const USER_AGENT = 'open-stall-importer/0.1 (+https://github.com/vindexholdings/open-stall)';

const fmt = (b: Bbox) => `${b.south},${b.west},${b.north},${b.east}`;

/** Overpass QL for one tile. Explicit-evidence selectors always; candidate selectors optional. */
export function buildOverpassQuery(
  tile: Bbox,
  opts: { includeCandidates?: boolean; categories?: CandidateCategory[]; timeoutSeconds?: number } = {},
): string {
  const box = fmt(tile);
  const lines = [
    `nwr["amenity"="toilets"](${box});`,
    `nwr["toilets"="yes"](${box});`,
    `nwr["toilets:access"](${box});`,
  ];
  if (opts.includeCandidates !== false) {
    for (const c of opts.categories ?? DEFAULT_CANDIDATE_CATEGORIES) {
      const extra = Object.entries(c.require ?? {}).map(([k, v]) => `["${k}"="${v}"]`).join('');
      lines.push(`nwr["${c.key}"~"^(${c.values.join('|')})$"]${extra}(${box});`);
    }
  }
  return `[out:json][timeout:${opts.timeoutSeconds ?? 90}];\n(\n  ${lines.join('\n  ')}\n);\nout center tags;`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export type FetchOptions = {
  url?: string;
  retries?: number;
  fetchImpl?: typeof fetch;
  sleepMs?: (ms: number) => Promise<void>;
};

/** Fetches one tile, retrying politely on 429/5xx. Throws if the tile cannot be fetched. */
export async function fetchTile(query: string, opts: FetchOptions = {}): Promise<OsmElement[]> {
  const doFetch = opts.fetchImpl ?? fetch;
  const wait = opts.sleepMs ?? sleep;
  const retries = opts.retries ?? 3;
  let lastError = 'unknown error';
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await doFetch(opts.url ?? DEFAULT_OVERPASS_URL, {
        method: 'POST',
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.ok) {
        const json = (await res.json()) as { elements?: OsmElement[]; remark?: string };
        if (json.remark?.includes('runtime error')) throw new Error(`Overpass: ${json.remark}`);
        return json.elements ?? [];
      }
      lastError = `HTTP ${res.status}`;
      if (res.status !== 429 && res.status < 500) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < retries) await wait(2000 * 2 ** attempt);
  }
  throw new Error(`Overpass tile failed after retries: ${lastError}`);
}
