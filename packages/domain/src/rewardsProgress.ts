/**
 * Rewards progress, CLIENT side (P4). The server (`public.get_my_progress`) is the only authority: it computes every number, award and
 * eligibility. This module only (a) validates the untrusted response and (b) turns it into accessible text. It never recomputes
 * eligibility, never converts points to visits, and never invents a number: a value is shown only when the server sent one.
 */
export type ProgressItemState = 'earned' | 'in_progress' | 'updating' | 'being_updated' | 'removed' | 'unavailable';

export type ProgressItem = {
  achievement: string;
  period: string;
  state: ProgressItemState;
  /** Catalog display copy (a proposal, not production content). */
  copy: string | null;
  metric: string | null;
  value: number | null;
  threshold: number | null;
  earnedAt: string | null;
  earnedLate: boolean;
};

export type ProgressPage =
  | { state: 'disabled' }
  | { state: 'ready'; items: ProgressItem[]; nextCursor: string | null };

const STATES: readonly ProgressItemState[] = ['earned', 'in_progress', 'updating', 'being_updated', 'removed', 'unavailable'];
const KEY = /^[a-z][a-z0-9_]{2,47}$/;
const PERIOD = /^[0-9A-Za-z:-]{1,40}$/;
const CURSOR = /^[a-z][a-z0-9_]{2,47}[|][0-9A-Za-z:-]{1,40}$/;
const MAX_ITEMS = 50;

const rec = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const count = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length > 0 && v.length <= max ? v : null);

/** Validates the untrusted RPC payload. Anything malformed is `null` (shown as unavailable, never as zero). */
export function parseProgressPage(data: unknown): ProgressPage | null {
  const d = rec(data);
  if (!d) return null;
  if (d.state === 'disabled') return { state: 'disabled' };
  if (d.state !== 'ready' || !Array.isArray(d.items) || d.items.length > MAX_ITEMS) return null;
  const items: ProgressItem[] = [];
  for (const raw of d.items) {
    const r = rec(raw);
    if (!r || typeof r.achievement !== 'string' || !KEY.test(r.achievement) || typeof r.period !== 'string' || !PERIOD.test(r.period)) return null;
    if (typeof r.state !== 'string' || !STATES.includes(r.state as ProgressItemState)) return null;
    items.push({
      achievement: r.achievement,
      period: r.period,
      state: r.state as ProgressItemState,
      copy: text(r.copy, 200),
      metric: text(r.metric, 48),
      value: count(r.value),
      threshold: count(r.threshold),
      earnedAt: text(r.earned_at, 40),
      earnedLate: r.earned_late === true,
    });
  }
  const next = d.next_cursor;
  if (next !== null && next !== undefined && (typeof next !== 'string' || !CURSOR.test(next))) return null;
  return { state: 'ready', items, nextCursor: typeof next === 'string' ? next : null };
}

// ------------------------------------------------------------------ wording (from the real metric and window; no point/visit conversion)
const METRIC: Record<string, { one: string; many: string }> = {
  lifetime_points_total: { one: 'point', many: 'points' },
  distinct_locations: { one: 'different place', many: 'different places' },
  qualifying_awards: { one: 'qualifying check-in', many: 'qualifying check-ins' },
  distinct_active_days: { one: 'active day', many: 'active days' },
};
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export function metricNoun(metric: string | null, n: number): string | null {
  const m = metric ? METRIC[metric] : undefined;
  return m ? (n === 1 ? m.one : m.many) : null;
}

/** "in total", "in October 2026", or "in the season starting 12 Oct 2026": the window of this chain, from its period key. */
export function windowPhrase(period: string): string {
  if (period === 'lifetime') return 'in total';
  const month = /^(\d{4})-(\d{2})$/.exec(period);
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12) return `in ${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (day && Number(day[2]) >= 1 && Number(day[2]) <= 12) return `in the season starting ${Number(day[3])} ${MONTHS[Number(day[2]) - 1]!.slice(0, 3)} ${day[1]}`;
  return 'in this period';
}

export function shortDate(iso: string | null): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]!.slice(0, 3)} ${m[1]}` : null;
}

/** Badge name: the catalog copy, else a readable form of the key (never an invented title). */
export function itemName(i: Pick<ProgressItem, 'achievement' | 'copy'>): string {
  if (i.copy) return i.copy;
  const words = i.achievement.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The numeric target, only when the server sent both numbers and the metric is a known one. */
export function numericTarget(i: ProgressItem): { now: number; max: number } | null {
  if (i.value === null || i.threshold === null || i.threshold < 1 || metricNoun(i.metric, i.threshold) === null) return null;
  return { now: i.value, max: i.threshold };
}

/** "3 of 5 different places in October 2026, 2 to go" / "Goal reached: 6 of 5 ...". Exactly one sentence, drawn and spoken once. */
export function progressSentence(i: ProgressItem): string | null {
  const t = numericTarget(i);
  if (!t) return null;
  const noun = metricNoun(i.metric, t.max)!;
  const base = `${t.now.toLocaleString('en-US')} of ${t.max.toLocaleString('en-US')} ${noun} ${windowPhrase(i.period)}`;
  return t.now >= t.max ? `${base}, goal reached` : `${base}, ${(t.max - t.now).toLocaleString('en-US')} to go`;
}

/** How to earn it, from the metric and window ("Reach 50 points in total"). */
export function howToEarn(i: ProgressItem): string | null {
  if (i.threshold === null || i.threshold < 1) return null;
  const noun = metricNoun(i.metric, i.threshold);
  return noun ? `Reach ${i.threshold.toLocaleString('en-US')} ${noun} ${windowPhrase(i.period)}` : null;
}

export const UNAVAILABLE_TEXT = 'Progress is unavailable right now. Try again soon';
export const COMING_SOON_TEXT = 'VIP progress — rewards coming soon';
export const SIGNED_OUT_TEXT = 'Sign in to track your progress';

/** The state line of a badge: backend truth, worded plainly. `null` for a plain in-progress item (its sentence is the line). */
export function stateText(i: ProgressItem): string | null {
  switch (i.state) {
    case 'earned': {
      if (i.earnedLate) return `Earned late for ${windowPhrase(i.period).replace(/^in (the season starting )?/, '')}`;
      const d = shortDate(i.earnedAt);
      return d ? `Earned ${d}` : 'Earned';
    }
    case 'removed': return 'Removed after a review';
    case 'being_updated': return 'Being updated. This badge is under review and may change.';
    case 'updating': return 'Updating. You have reached this goal; the badge will appear shortly.';
    case 'unavailable': return UNAVAILABLE_TEXT;
    default: return null;
  }
}

/** True when a refresh turned an item into a newly earned one (so a polite announcement is due). */
export function newlyEarned(before: readonly ProgressItem[], after: readonly ProgressItem[]): ProgressItem[] {
  const was = new Map(before.map((i) => [`${i.achievement}|${i.period}`, i.state]));
  return after.filter((i) => i.state === 'earned' && was.has(`${i.achievement}|${i.period}`) && was.get(`${i.achievement}|${i.period}`) !== 'earned');
}

/** Merge a further page (cursor paging) without duplicating or reordering what is already shown. */
export function mergePages(shown: readonly ProgressItem[], next: readonly ProgressItem[]): ProgressItem[] {
  const seen = new Set(shown.map((i) => `${i.achievement}|${i.period}`));
  return [...shown, ...next.filter((i) => !seen.has(`${i.achievement}|${i.period}`))];
}
