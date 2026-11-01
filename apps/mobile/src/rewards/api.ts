import { parseProgressPage, type ProgressPage } from '@open-stall/domain';
import type { RpcClientLike } from '../account/api';

export type ProgressResult = { ok: true; page: ProgressPage } | { ok: false };

/**
 * One page of the caller's OWN progress (`public.get_my_progress`; there is no subject parameter, so no other person's data can be asked for).
 * It must be the signed-in client. Any error or malformed answer is `{ ok: false }`, which the UI shows as unavailable, never as zero.
 */
export async function fetchProgress(c: RpcClientLike, cursor: string | null, limit: number): Promise<ProgressResult> {
  try {
    const { data, error } = await c.rpc('get_my_progress', { p_cursor: cursor, p_limit: limit });
    if (error) return { ok: false };
    const page = parseProgressPage(data);
    return page ? { ok: true, page } : { ok: false };
  } catch {
    return { ok: false };
  }
}
