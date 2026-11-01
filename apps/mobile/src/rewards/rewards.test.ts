import { describe, expect, it, vi } from 'vitest';
import type { ProgressItem } from '@open-stall/domain';
import { fetchProgress } from './api';
import { rewardsProgressLive } from './config';
import { ProgressController, type Fetcher } from './controller';
import { applyFirstPage, applyMorePage, progressView, type Fetched } from './view';

const it1 = (o: Partial<ProgressItem> = {}): ProgressItem => ({ achievement: 'explorer', period: '2026-10', state: 'in_progress', copy: 'Explorer', metric: 'distinct_locations', value: 0, threshold: 5, earnedAt: null, earnedLate: false, ...o });
const ready = (items: ProgressItem[], nextCursor: string | null = null): Fetched => ({ phase: 'ready', items, nextCursor, loadingMore: false, moreError: false, announcement: null });

const MOCK = { flag: 'live', url: 'http://127.0.0.1:54611', key: 'mock-anon-key-not-real' };
describe('the build gate (production stays coming soon, no number, no request; fail-closed mock boundary)', () => {
  it('is on only for the flag AND a loopback http URL AND a placeholder key', () => {
    expect(rewardsProgressLive(MOCK)).toBe(true);
    expect(rewardsProgressLive({ ...MOCK, url: 'http://localhost:54800', key: 'qa-mock-anon-key' })).toBe(true);
    expect(rewardsProgressLive({ ...MOCK, url: 'http://[::1]:54800' })).toBe(true);
  });
  it.each([
    ['no flag', { ...MOCK, flag: undefined }],
    ['flag not exactly live', { ...MOCK, flag: 'on' }],
    ['flag with other case', { ...MOCK, flag: 'LIVE' }],
    ['a hosted https project URL', { ...MOCK, url: 'https://abcdefgh.supabase.co' }],
    ['hosted URL on http', { ...MOCK, url: 'http://abcdefgh.supabase.co' }],
    ['loopback over https', { ...MOCK, url: 'https://127.0.0.1:54611' }],
    ['a look-alike host', { ...MOCK, url: 'http://127.0.0.1.evil.example' }],
    ['credentials in the URL', { ...MOCK, url: 'http://user:pw@127.0.0.1:54611' }],
    ['a non-URL', { ...MOCK, url: 'not a url' }],
    ['no URL', { ...MOCK, url: undefined }],
    ['a real-looking anon key', { ...MOCK, key: 'eyJhbGciOiJIUzI1NiJ9.real.key' }],
    ['no anon key', { ...MOCK, key: undefined }],
    ['empty everything', { flag: '', url: '', key: '' }],
  ])('stays OFF (fails closed): %s', (_n, env) => expect(rewardsProgressLive(env as never)).toBe(false));
  it('the default reads the build environment, which is unset in a normal build and in the tests', () => expect(rewardsProgressLive()).toBe(false));
  it('every auth state is coming soon when the feature is off, even with data present', () => {
    for (const a of ['loading', 'signed-out', 'signed-in', 'unavailable'] as const)
      expect(progressView(false, a, ready([it1({ value: 4 })]))).toEqual({ kind: 'coming_soon' });
  });
});

describe('states are distinguished truthfully', () => {
  it('signed out / auth loading / accounts unavailable', () => {
    expect(progressView(true, 'signed-out', { phase: 'idle' })).toEqual({ kind: 'signed_out' });
    expect(progressView(true, 'loading', { phase: 'idle' })).toEqual({ kind: 'loading' });
    expect(progressView(true, 'unavailable', { phase: 'idle' })).toEqual({ kind: 'error' });
  });
  it('loading and failure are never a zero', () => {
    expect(progressView(true, 'signed-in', { phase: 'loading' })).toEqual({ kind: 'loading' });
    expect(progressView(true, 'signed-in', { phase: 'idle' })).toEqual({ kind: 'loading' });
    expect(progressView(true, 'signed-in', { phase: 'failed' })).toEqual({ kind: 'error' });
  });
  it('a server-disabled answer is coming soon', () => expect(progressView(true, 'signed-in', { phase: 'disabled' })).toEqual({ kind: 'coming_soon' }));
  it('a real evaluated zero is carried through as ready with the number 0', () => {
    const v = progressView(true, 'signed-in', ready([it1({ value: 0 })]));
    expect(v.kind === 'ready' && v.items[0]!.value).toBe(0);
  });
});

describe('pages', () => {
  it('first page replaces; a refresh announces only a newly earned badge', () => {
    const a = applyFirstPage({ phase: 'idle' }, { state: 'ready', items: [it1()], nextCursor: null });
    expect(a.phase === 'ready' && a.announcement).toBeNull(); // first load announces nothing
    const b = applyFirstPage(a, { state: 'ready', items: [it1({ state: 'earned', earnedAt: '2026-10-12T00:00:00Z' })], nextCursor: null });
    expect(b.phase === 'ready' && b.announcement).toBe('New badge earned: Explorer');
    const c = applyFirstPage(b, { state: 'ready', items: [it1({ state: 'earned' })], nextCursor: null });
    expect(c.phase === 'ready' && c.announcement).toBeNull(); // already earned: no repeat
  });
  it('server disabled replaces the list with coming soon', () => expect(applyFirstPage(ready([it1()]), { state: 'disabled' })).toEqual({ phase: 'disabled' }));
  it('further pages append without duplicates and update the cursor', () => {
    const a = ready([it1()], 'explorer|2026-10');
    const b = applyMorePage({ ...a, loadingMore: true } as Fetched, { state: 'ready', items: [it1(), it1({ achievement: 'first_stop', period: 'lifetime' })], nextCursor: null });
    expect(b.phase === 'ready' && b.items.map((i) => i.achievement)).toEqual(['explorer', 'first_stop']);
    expect(b.phase === 'ready' && b.nextCursor).toBeNull();
    expect(b.phase === 'ready' && b.loadingMore).toBe(false);
  });
});

describe('applyMorePage disabled', () => {
  it('a disabled page clears everything even while loading more', () => {
    const loading = { ...(ready([it1()], 'explorer|2026-10') as Extract<Fetched, { phase: 'ready' }>), loadingMore: true, announcement: 'New badge earned: X' } as Fetched;
    expect(applyMorePage(loading, { state: 'disabled' })).toEqual({ phase: 'disabled' });
  });
});

describe('fetchProgress (caller-only RPC)', () => {
  const rpc = (result: { data: unknown; error: unknown }) => ({ rpc: vi.fn(async () => result) });
  it('asks only for the caller: cursor and limit, no subject', async () => {
    const c = rpc({ data: { state: 'ready', items: [], next_cursor: null }, error: null });
    expect(await fetchProgress(c as never, 'explorer|2026-10', 3)).toEqual({ ok: true, page: { state: 'ready', items: [], nextCursor: null } });
    expect(c.rpc).toHaveBeenCalledWith('get_my_progress', { p_cursor: 'explorer|2026-10', p_limit: 3 });
  });
  it('an RPC error, a thrown error and a malformed answer are all not-ok (unavailable, never zero)', async () => {
    expect(await fetchProgress(rpc({ data: null, error: { message: 'x' } }) as never, null, 20)).toEqual({ ok: false });
    expect(await fetchProgress(rpc({ data: { state: 'ready', items: 'x' }, error: null }) as never, null, 20)).toEqual({ ok: false });
    expect(await fetchProgress({ rpc: async () => { throw new Error('net'); } } as never, null, 20)).toEqual({ ok: false });
  });
  it('a disabled answer is passed through', async () => {
    expect(await fetchProgress(rpc({ data: { state: 'disabled', items: [], next_cursor: null }, error: null }) as never, null, 20)).toEqual({ ok: true, page: { state: 'disabled' } });
  });
});

// ------------------------------------------------------------------ the controller: account partition and races, with deliberately delayed answers
type Page = Parameters<typeof applyMorePage>[1];
const ready1 = (items: ProgressItem[], next: string | null = null): Page => ({ state: 'ready', items, nextCursor: next });
function harness(live = true) {
  const calls: { rpc: unknown; cursor: string | null; resolve: (r: { ok: true; page: Page } | { ok: false }) => void }[] = [];
  const fetcher: Fetcher = (rpc, cursor) => new Promise((resolve) => { calls.push({ rpc, cursor, resolve: resolve as never }); });
  const ctl = new ProgressController(fetcher, live);
  const snap = () => ctl.getSnapshot();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return { ctl, calls, snap, tick };
}
const RA = { rpc: 'A' } as never;
const RB = { rpc: 'B' } as never;
const A_ITEM = it1({ achievement: 'only_a', copy: 'Only A', state: 'earned', value: 5 });
const B_ITEM = it1({ achievement: 'only_b', copy: 'Only B', value: 1 });
const items = (s: ReturnType<ProgressController['getSnapshot']>) => (s.fetched.phase === 'ready' ? s.fetched.items.map((i) => i.achievement) : null);

describe('controller: account identity partition', () => {
  it('a direct A -> B replacement (no signed-out step) discards A at once and a LATE A answer cannot win', async () => {
    const { ctl, calls, snap, tick } = harness();
    ctl.bind('A', RA, 20);
    expect(calls).toHaveLength(1);
    ctl.bind('B', RB, 20); // direct replacement, while A's first load is still in flight
    expect(snap()).toEqual({ owner: 'B', fetched: { phase: 'idle' } }); // nothing of A is in the state any more, synchronously
    expect(calls).toHaveLength(2);
    expect(calls[1]!.rpc).toBe(RB);
    calls[0]!.resolve({ ok: true, page: ready1([A_ITEM]) }); // A answers late
    await tick();
    expect(snap().fetched.phase).toBe('idle'); // A did not win
    calls[1]!.resolve({ ok: true, page: ready1([B_ITEM]) });
    await tick();
    expect(items(snap())).toEqual(['only_b']);
  });
  it('B never sees A numbers, cursors or announcements after a replacement of a READY A', async () => {
    const { ctl, calls, snap, tick } = harness();
    ctl.bind('A', RA, 20);
    calls[0]!.resolve({ ok: true, page: ready1([A_ITEM], 'only_a|2026-10') });
    await tick();
    expect(items(snap())).toEqual(['only_a']);
    ctl.bind('B', RB, 20);
    expect(items(snap())).toBeNull(); // old items gone in the same step
    expect(snap().owner).toBe('B');
    ctl.more(); // B has nothing yet: A's cursor must not be usable
    expect(calls).toHaveLength(2); // only B's first load exists
    calls[1]!.resolve({ ok: true, page: ready1([B_ITEM], 'only_b|2026-10') });
    await tick();
    ctl.more();
    expect(calls[2]!.cursor).toBe('only_b|2026-10'); // B's own cursor, never A's
    expect(calls[2]!.rpc).toBe(RB);
    const f = snap().fetched;
    expect(f.phase === 'ready' && f.announcement).toBeNull();
  });
  it('a delayed FURTHER PAGE of A is ignored after B signs in', async () => {
    const { ctl, calls, snap, tick } = harness();
    ctl.bind('A', RA, 20);
    calls[0]!.resolve({ ok: true, page: ready1([A_ITEM], 'only_a|2026-10') });
    await tick();
    ctl.more();
    expect(calls[1]!.cursor).toBe('only_a|2026-10');
    ctl.bind('B', RB, 20);
    calls[1]!.resolve({ ok: true, page: ready1([it1({ achievement: 'a_page_two' })]) });
    await tick();
    expect(items(snap())).toBeNull();
    calls[2]!.resolve({ ok: true, page: ready1([B_ITEM]) });
    await tick();
    expect(items(snap())).toEqual(['only_b']);
  });
  it('a delayed RETRY of A is ignored after logout and a login of B', async () => {
    const { ctl, calls, snap, tick } = harness();
    ctl.bind('A', RA, 20);
    calls[0]!.resolve({ ok: false });
    await tick();
    expect(snap().fetched.phase).toBe('failed');
    ctl.retry();
    expect(snap().fetched.phase).toBe('loading');
    ctl.bind(null, null, 20); // logout
    expect(snap()).toEqual({ owner: null, fetched: { phase: 'idle' } });
    ctl.bind('B', RB, 20); // login
    calls[1]!.resolve({ ok: true, page: ready1([A_ITEM]) }); // A's retry answers late
    await tick();
    expect(snap().owner).toBe('B');
    expect(items(snap())).toBeNull();
    calls[2]!.resolve({ ok: true, page: ready1([B_ITEM]) });
    await tick();
    expect(items(snap())).toEqual(['only_b']);
  });
  it('a plain logout while A is loading: the late answer of A leaves no data behind', async () => {
    const { ctl, calls, snap, tick } = harness();
    ctl.bind('A', RA, 20);
    ctl.bind(null, null, 20);
    calls[0]!.resolve({ ok: true, page: ready1([A_ITEM]) });
    await tick();
    expect(snap()).toEqual({ owner: null, fetched: { phase: 'idle' } });
  });
  it('logout then login of the SAME account loads again and a stale pre-logout answer is dropped', async () => {
    const { ctl, calls, snap, tick } = harness();
    ctl.bind('A', RA, 20);
    ctl.bind(null, null, 20);
    ctl.bind('A', RA, 20);
    expect(calls).toHaveLength(2);
    calls[0]!.resolve({ ok: true, page: ready1([it1({ achievement: 'old_session' })]) });
    await tick();
    expect(snap().fetched.phase).toBe('idle');
    calls[1]!.resolve({ ok: true, page: ready1([A_ITEM]) });
    await tick();
    expect(items(snap())).toEqual(['only_a']);
  });
  it('a token refresh of the SAME account (new rpc object, same identity) starts no request and keeps the state', async () => {
    const { ctl, calls, snap, tick } = harness();
    ctl.bind('A', RA, 20);
    calls[0]!.resolve({ ok: true, page: ready1([A_ITEM]) });
    await tick();
    ctl.bind('A', { rpc: 'A2' } as never, 20);
    ctl.bind('A', RA, 20);
    expect(calls).toHaveLength(1);
    expect(items(snap())).toEqual(['only_a']);
  });
  it('an unmounted controller ignores everything that is still in flight', async () => {
    const { ctl, calls, snap, tick } = harness();
    ctl.bind('A', RA, 20);
    ctl.dispose();
    calls[0]!.resolve({ ok: true, page: ready1([A_ITEM]) });
    await tick();
    expect(snap()).toEqual({ owner: null, fetched: { phase: 'idle' } });
  });
  it('with the feature off the controller never calls the network', () => {
    const { ctl, calls, snap } = harness(false);
    ctl.bind('A', RA, 20);
    ctl.more();
    ctl.retry();
    ctl.refresh();
    expect(calls).toHaveLength(0);
    expect(snap().owner).toBe('A');
  });
});

describe('controller: a failed refresh is never authoritative', () => {
  const earnedPage = ready1([it1({ state: 'earned', earnedAt: '2026-10-12T00:00:00Z', value: 5 })]);
  async function readyEarned() {
    const h = harness();
    h.ctl.bind('A', RA, 20);
    h.calls[0]!.resolve({ ok: true, page: earnedPage });
    await h.tick();
    expect(items(h.snap())).toEqual(['explorer']);
    return h;
  }
  it.each([['an RPC error (including an authorization failure)', { ok: false } as const], ['a malformed answer (which the adapter reports as not ok)', { ok: false } as const]])(
    'earned -> refresh with %s -> unavailable with retry, then recovery shows the revocation', async (_n, bad) => {
      const { ctl, calls, snap, tick } = await readyEarned();
      ctl.refresh();
      calls[1]!.resolve(bad);
      await tick();
      expect(snap().fetched).toEqual({ phase: 'failed' }); // no earned badge and no number any more
      expect(progressView(true, 'signed-in', snap().fetched)).toEqual({ kind: 'error' });
      ctl.retry();
      expect(snap().fetched.phase).toBe('loading');
      calls[2]!.resolve({ ok: true, page: ready1([it1({ state: 'removed' })]) });
      await tick();
      const f = snap().fetched;
      expect(f.phase === 'ready' && f.items[0]!.state).toBe('removed'); // the changed eligibility, not the old Earned
    });
  it('a refresh that works replaces the page and announces a transition to earned only', async () => {
    const h = harness();
    h.ctl.bind('A', RA, 20);
    h.calls[0]!.resolve({ ok: true, page: ready1([it1()]) });
    await h.tick();
    h.ctl.refresh();
    h.calls[1]!.resolve({ ok: true, page: earnedPage });
    await h.tick();
    const f = h.snap().fetched;
    expect(f.phase === 'ready' && f.announcement).toBe('New badge earned: Explorer');
  });
});

describe('controller: paging', () => {
  async function paging() {
    const h = harness();
    h.ctl.bind('A', RA, 20);
    h.calls[0]!.resolve({ ok: true, page: ready1([A_ITEM], 'only_a|2026-10') });
    await h.tick();
    return h;
  }
  it('a DISABLED answer to the next page clears items, cursor, announcement and the loading state', async () => {
    const { ctl, calls, snap, tick } = await paging();
    ctl.more();
    expect((snap().fetched as { loadingMore: boolean }).loadingMore).toBe(true);
    calls[1]!.resolve({ ok: true, page: { state: 'disabled' } });
    await tick();
    expect(snap().fetched).toEqual({ phase: 'disabled' });
    expect(progressView(true, 'signed-in', snap().fetched)).toEqual({ kind: 'coming_soon' });
  });
  it('a DISABLED refresh that races a pending page wins and the late page cannot bring numbers back', async () => {
    const { ctl, calls, snap, tick } = await paging();
    ctl.more(); // calls[1]
    ctl.refresh(); // calls[2], supersedes the page
    calls[2]!.resolve({ ok: true, page: { state: 'disabled' } });
    await tick();
    expect(snap().fetched).toEqual({ phase: 'disabled' });
    calls[1]!.resolve({ ok: true, page: ready1([it1({ achievement: 'late_page' })]) });
    await tick();
    expect(snap().fetched).toEqual({ phase: 'disabled' });
  });
  it('a failed next page keeps what is shown and offers a page retry (distinct from a disabled server)', async () => {
    const { ctl, calls, snap, tick } = await paging();
    ctl.more();
    calls[1]!.resolve({ ok: false });
    await tick();
    const f = snap().fetched;
    expect(f.phase === 'ready' && f.items.map((i) => i.achievement)).toEqual(['only_a']);
    expect(f.phase === 'ready' && f.moreError && !f.loadingMore).toBe(true);
    ctl.more(); // the retry
    calls[2]!.resolve({ ok: true, page: ready1([it1({ achievement: 'page_two' })]) });
    await tick();
    expect(items(snap())).toEqual(['only_a', 'page_two']);
  });
  it('a double tap on Show more sends one request', async () => {
    const { ctl, calls } = await paging();
    ctl.more();
    ctl.more();
    expect(calls).toHaveLength(2);
  });
});
