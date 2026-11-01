import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { rewardsProgressLive } from './config';
import { ProgressController } from './controller';
import { progressView, type Fetched, type ProgressView } from './view';

const LIVE = rewardsProgressLive();
const IDLE: Fetched = { phase: 'idle' };

/**
 * The signed-in user's own progress, partitioned by the account's private identity. With the feature off (or not the mock configuration)
 * there is NO request. The state is read through `owner`: whatever belongs to a different account than the one signed in now is
 * ignored in the same render, so old-account data is never shown while an effect catches up.
 */
export function useRewardsProgress(pageSize: number): { view: ProgressView; refresh: () => void; more: () => void; retry: () => void } {
  const { status, userId, rpc } = useAuth();
  const [ctl] = useState(() => new ProgressController(undefined, LIVE));
  const snap = useSyncExternalStore(ctl.subscribe, ctl.getSnapshot, ctl.getSnapshot);
  const owner = status === 'signed-in' && rpc !== null ? userId : null;

  useEffect(() => { ctl.bind(owner, owner ? rpc : null, pageSize); }, [ctl, owner, rpc, pageSize]);
  useEffect(() => () => ctl.dispose(), [ctl]);

  const fetched = snap.owner === owner ? snap.fetched : IDLE;
  return { view: progressView(LIVE, status, fetched), refresh: ctl.refresh, more: ctl.more, retry: ctl.retry };
}
