import { mergePages, newlyEarned, type ProgressItem, type ProgressPage } from '@open-stall/domain';
import type { AuthStatus } from '../auth/AuthProvider';

/** What the user sees. `error` is "unavailable" (never a zero); `coming_soon` carries no number at all. */
export type ProgressView =
  | { kind: 'coming_soon' }
  | { kind: 'signed_out' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; items: ProgressItem[]; nextCursor: string | null; loadingMore: boolean; moreError: boolean; announcement: string | null };

export type Fetched =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'failed' }
  | { phase: 'disabled' }
  | { phase: 'ready'; items: ProgressItem[]; nextCursor: string | null; loadingMore: boolean; moreError: boolean; announcement: string | null };

/** The one place that decides which state to show. A build with the feature off never reaches the network and never shows a number. */
export function progressView(live: boolean, auth: AuthStatus, f: Fetched): ProgressView {
  if (!live) return { kind: 'coming_soon' };
  if (auth === 'loading') return { kind: 'loading' };
  if (auth === 'signed-out') return { kind: 'signed_out' };
  if (auth !== 'signed-in') return { kind: 'error' };
  switch (f.phase) {
    case 'disabled': return { kind: 'coming_soon' };
    case 'failed': return { kind: 'error' };
    case 'ready': return { kind: 'ready', items: f.items, nextCursor: f.nextCursor, loadingMore: f.loadingMore, moreError: f.moreError, announcement: f.announcement };
    default: return { kind: 'loading' };
  }
}

/** A first page (or a refresh of it) replaces the list; it announces only a transition to earned, never the first load. */
export function applyFirstPage(prev: Fetched, page: ProgressPage): Fetched {
  if (page.state === 'disabled') return { phase: 'disabled' };
  const before = prev.phase === 'ready' ? prev.items : [];
  const won = prev.phase === 'ready' ? newlyEarned(before, page.items) : [];
  return {
    phase: 'ready', items: page.items, nextCursor: page.nextCursor, loadingMore: false, moreError: false,
    announcement: won.length > 0 ? `New badge earned: ${won.map((i) => i.copy ?? i.achievement).join(', ')}` : null,
  };
}

/** A further page is appended below what is shown (no duplicates, no reordering). */
export function applyMorePage(prev: Fetched, page: ProgressPage): Fetched {
  if (prev.phase !== 'ready' || page.state !== 'ready') return prev;
  return { ...prev, items: mergePages(prev.items, page.items), nextCursor: page.nextCursor, loadingMore: false, moreError: false };
}
