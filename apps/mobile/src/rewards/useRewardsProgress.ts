import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { fetchProgress } from './api';
import { rewardsProgressLive } from './config';
import { applyFirstPage, applyMorePage, progressView, type Fetched, type ProgressView } from './view';

const LIVE = rewardsProgressLive();

/**
 * The signed-in user's own progress. With the feature off there is NO request. Every request is for the caller only (the RPC has no subject
 * parameter). A stale response (the user signed out, or a newer request started) is ignored. `refresh` re-reads page one (a polite
 * announcement is produced only when it shows a newly earned badge); `more` appends the next cursor page; `retry` re-reads after a failure.
 */
export function useRewardsProgress(pageSize: number): { view: ProgressView; refresh: () => void; more: () => void; retry: () => void } {
  const { status, rpc } = useAuth();
  const [fetched, setFetched] = useState<Fetched>({ phase: 'idle' });
  const ticket = useRef(0);
  const phase = useRef<Fetched['phase']>('idle');
  const signedIn = status === 'signed-in' && rpc !== null;
  // Never show one account's progress to the next: a change of signed-in state resets everything (state derived during render).
  const [seenSignedIn, setSeenSignedIn] = useState(signedIn);
  if (seenSignedIn !== signedIn) { setSeenSignedIn(signedIn); setFetched({ phase: 'idle' }); }
  useEffect(() => { phase.current = fetched.phase; });
  const invalidate = useCallback(() => { ticket.current++; }, []);

  const first = useCallback(async (initial: boolean) => {
    if (!LIVE || !rpc) return;
    const mine = ++ticket.current;
    const r = await fetchProgress(rpc, null, pageSize);
    if (mine !== ticket.current) return;
    if (!r.ok) setFetched((p) => (p.phase === 'ready' && !initial ? p : { phase: 'failed' })); // a failed REFRESH keeps what is already shown
    else setFetched((p) => applyFirstPage(initial ? { phase: 'idle' } : p, r.page));
  }, [rpc, pageSize]);

  useEffect(() => {
    if (!LIVE || !signedIn || !rpc) return;
    const mine = ++ticket.current;
    void fetchProgress(rpc, null, pageSize).then((r) => {
      if (mine !== ticket.current) return; // signed out, or a newer request started
      setFetched((p) => (r.ok ? applyFirstPage({ phase: 'idle' }, r.page) : p.phase === 'ready' ? p : { phase: 'failed' }));
    });
    return invalidate;
  }, [signedIn, rpc, pageSize, invalidate]);

  const more = useCallback(() => {
    if (!LIVE || !rpc || fetched.phase !== 'ready' || !fetched.nextCursor || fetched.loadingMore) return;
    const cursor = fetched.nextCursor;
    const mine = ++ticket.current;
    setFetched({ ...fetched, loadingMore: true, moreError: false });
    void fetchProgress(rpc, cursor, pageSize).then((r) => {
      if (mine !== ticket.current) return;
      setFetched((p) => (p.phase !== 'ready' ? p : r.ok ? applyMorePage(p, r.page) : { ...p, loadingMore: false, moreError: true }));
    });
  }, [rpc, fetched, pageSize]);

  return {
    view: progressView(LIVE, status, fetched),
    refresh: useCallback(() => { if (signedIn && phase.current === 'ready') void first(false); }, [signedIn, first]), // only a refresh of what is shown; the first load is the effect's
    more,
    retry: useCallback(() => { if (signedIn) { setFetched({ phase: 'loading' }); void first(true); } }, [signedIn, first]),
  };
}
