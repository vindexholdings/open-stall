import type { RpcClientLike } from '../account/api';
import { fetchProgress, type ProgressResult } from './api';
import { applyFirstPage, applyMorePage, type Fetched } from './view';

/** State is always stored WITH the account it belongs to, so it can never be read as another account's. */
export type Snapshot = { owner: string | null; fetched: Fetched };
export type Fetcher = (rpc: RpcClientLike, cursor: string | null, limit: number) => Promise<ProgressResult>;

const IDLE: Fetched = { phase: 'idle' };

/**
 * The private progress of ONE signed-in account at a time (no React here, so every race is testable). Rules:
 *  - `bind` partitions by the account's private identity: a different account (including a direct A -> B replacement with no signed-out
 *    step in between) discards everything of the previous account at once and invalidates every request it had in flight, so a late
 *    response of A can never win. The SAME account (a token refresh) changes nothing and starts no request.
 *  - A failed or malformed refresh/first load always ends as `failed` (unavailable + retry): earned or numeric state is never kept
 *    authoritative after a failure. Only a failed FURTHER PAGE keeps the shown items and offers a page retry.
 *  - A `disabled` answer to any request clears the entire view, loading state included.
 */
export class ProgressController {
  private snap: Snapshot = { owner: null, fetched: IDLE };
  private rpc: RpcClientLike | null = null;
  private limit = 20;
  private ticket = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly fetcher: Fetcher = fetchProgress, private readonly live = true) {}

  subscribe = (l: () => void): (() => void) => { this.listeners.add(l); return () => { this.listeners.delete(l); }; };
  getSnapshot = (): Snapshot => this.snap;

  private put(owner: string | null, fetched: Fetched): void {
    this.snap = { owner, fetched };
    for (const l of this.listeners) l();
  }

  bind(owner: string | null, rpc: RpcClientLike | null, limit: number): void {
    this.rpc = rpc;
    this.limit = limit;
    if (owner === this.snap.owner) return; // same account (for example a token refresh): no reset, no request
    this.ticket++; // every request of the previous account is stale from this moment
    this.put(owner, IDLE);
    if (this.live && owner && rpc) void this.load(false);
  }

  dispose(): void {
    this.ticket++;
    this.snap = { owner: null, fetched: IDLE };
  }

  private async load(announce: boolean): Promise<void> {
    const { owner } = this.snap;
    const rpc = this.rpc;
    if (!this.live || !owner || !rpc) return;
    const mine = ++this.ticket;
    const r = await this.fetcher(rpc, null, this.limit);
    if (mine !== this.ticket || this.snap.owner !== owner) return; // another account or a newer request: this answer is not ours any more
    this.put(owner, r.ok ? applyFirstPage(announce ? this.snap.fetched : IDLE, r.page) : { phase: 'failed' });
  }

  /** Re-read page one of what is shown (the first load is `bind`'s). A failure makes the view unavailable, never stale-but-authoritative. */
  refresh = (): void => { if (this.snap.fetched.phase === 'ready') void this.load(true); };

  retry = (): void => {
    if (!this.snap.owner) return;
    this.put(this.snap.owner, { phase: 'loading' });
    void this.load(false);
  };

  more = (): void => {
    const { owner, fetched } = this.snap;
    const rpc = this.rpc;
    if (!this.live || !owner || !rpc || fetched.phase !== 'ready' || !fetched.nextCursor || fetched.loadingMore) return;
    const mine = ++this.ticket;
    this.put(owner, { ...fetched, loadingMore: true, moreError: false });
    void this.fetcher(rpc, fetched.nextCursor, this.limit).then((r) => {
      if (mine !== this.ticket || this.snap.owner !== owner) return;
      const cur = this.snap.fetched;
      if (cur.phase !== 'ready') return;
      this.put(owner, r.ok ? applyMorePage(cur, r.page) : { ...cur, loadingMore: false, moreError: true });
    });
  };
}
