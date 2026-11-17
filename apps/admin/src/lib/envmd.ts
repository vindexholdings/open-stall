import 'server-only';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** ENVIRONMENT.md records the one Supabase project this repo may talk to; every client checks against it. */
export function readEnvironmentMd(): string {
  for (const rel of ['../../ENVIRONMENT.md', 'ENVIRONMENT.md']) {
    try {
      return readFileSync(path.resolve(process.cwd(), rel), 'utf8');
    } catch {
      // try next
    }
  }
  throw new Error('ENVIRONMENT.md not found; refusing to connect without the recorded project ref');
}
