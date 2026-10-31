import { describe, expect, it, vi } from 'vitest';
import type { ProgressItem } from '@open-stall/domain';
import { fetchProgress } from './api';
import { rewardsProgressLive } from './config';
import { applyFirstPage, applyMorePage, progressView, type Fetched } from './view';

const it1 = (o: Partial<ProgressItem> = {}): ProgressItem => ({ achievement: 'explorer', period: '2026-10', state: 'in_progress', copy: 'Explorer', metric: 'distinct_locations', value: 0, threshold: 5, earnedAt: null, earnedLate: false, ...o });
const ready = (items: ProgressItem[], nextCursor: string | null = null): Fetched => ({ phase: 'ready', items, nextCursor, loadingMore: false, moreError: false, announcement: null });

describe('the build gate (production stays coming soon, no number, no request)', () => {
  it('is off unless explicitly set to live', () => {
    expect(rewardsProgressLive({})).toBe(false);
    expect(rewardsProgressLive({ EXPO_PUBLIC_REWARDS_PROGRESS: 'on' })).toBe(false);
    expect(rewardsProgressLive({ EXPO_PUBLIC_REWARDS_PROGRESS: 'live' })).toBe(true);
  });
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
