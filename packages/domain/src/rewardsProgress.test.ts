import { describe, expect, it } from 'vitest';
import {
  COMING_SOON_TEXT, UNAVAILABLE_TEXT, howToEarn, itemName, mergePages, newlyEarned, numericTarget, parseProgressPage, progressSentence, stateText, windowPhrase,
  type ProgressItem,
} from './rewardsProgress';

const item = (o: Partial<ProgressItem> = {}): ProgressItem => ({
  achievement: 'explorer', period: '2026-10', state: 'in_progress', copy: 'Explorer', metric: 'distinct_locations', value: 3, threshold: 5, earnedAt: null, earnedLate: false, ...o,
});

describe('parseProgressPage (untrusted response)', () => {
  it('accepts disabled and ready', () => {
    expect(parseProgressPage({ state: 'disabled', items: [], next_cursor: null })).toEqual({ state: 'disabled' });
    const p = parseProgressPage({ state: 'ready', items: [{ achievement: 'explorer', period: '2026-10', state: 'in_progress', copy: 'Explorer', metric: 'distinct_locations', value: 0, threshold: 5 }], next_cursor: 'explorer|2026-10' });
    expect(p).toMatchObject({ state: 'ready', nextCursor: 'explorer|2026-10' });
    expect(p && p.state === 'ready' && p.items[0]).toMatchObject({ value: 0, threshold: 5, earnedLate: false });
  });
  it.each([
    null, 'x', [], { state: 'ready' }, { state: 'ready', items: 'x' }, { state: 'other', items: [] },
    { state: 'ready', items: [{ achievement: 'BAD KEY', period: '2026-10', state: 'earned' }] },
    { state: 'ready', items: [{ achievement: 'explorer', period: '2026-10', state: 'weird' }] },
    { state: 'ready', items: [{ achievement: 'explorer', period: '<x>', state: 'earned' }] },
    { state: 'ready', items: [], next_cursor: 'not a cursor' },
    { state: 'ready', items: new Array(51).fill({ achievement: 'explorer', period: '2026-10', state: 'earned' }) },
  ])('rejects malformed %#', (bad) => expect(parseProgressPage(bad)).toBeNull());
  it('treats a bad number as absent, never as zero', () => {
    const p = parseProgressPage({ state: 'ready', items: [{ achievement: 'explorer', period: '2026-10', state: 'in_progress', value: -1, threshold: 'x', metric: 'distinct_locations' }] });
    expect(p && p.state === 'ready' && p.items[0]).toMatchObject({ value: null, threshold: null });
  });
});

describe('wording', () => {
  it('writes the sentence from the real metric and window, once', () => {
    expect(progressSentence(item())).toBe('3 of 5 different places in October 2026, 2 to go');
    expect(progressSentence(item({ value: 0 }))).toBe('0 of 5 different places in October 2026, 5 to go');
    expect(progressSentence(item({ metric: 'lifetime_points_total', period: 'lifetime', value: 1200, threshold: 5000 }))).toBe('1,200 of 5,000 points in total, 3,800 to go');
    expect(progressSentence(item({ value: 5 }))).toBe('5 of 5 different places in October 2026, goal reached');
    expect(progressSentence(item({ metric: 'distinct_active_days', threshold: 1, value: 0, period: 'lifetime' }))).toBe('0 of 1 active day in total, 1 to go');
  });
  it('shows no sentence without a real number or a known metric', () => {
    expect(progressSentence(item({ value: null }))).toBeNull();
    expect(progressSentence(item({ metric: 'mystery' }))).toBeNull();
    expect(numericTarget(item({ threshold: 0 }))).toBeNull();
  });
  it('never converts points to visits', () => {
    for (const m of ['lifetime_points_total', 'qualifying_awards', 'distinct_active_days', 'distinct_locations'])
      expect(`${progressSentence(item({ metric: m }))} ${howToEarn(item({ metric: m }))}`).not.toMatch(/visit|worth|equals|≈/i);
  });
  it('how to earn', () => {
    expect(howToEarn(item({ metric: 'lifetime_points_total', period: 'lifetime', threshold: 50 }))).toBe('Reach 50 points in total');
    expect(howToEarn(item())).toBe('Reach 5 different places in October 2026');
    expect(howToEarn(item({ threshold: null }))).toBeNull();
  });
  it('windows', () => {
    expect(windowPhrase('lifetime')).toBe('in total');
    expect(windowPhrase('2026-12')).toBe('in December 2026');
    expect(windowPhrase('2026-10-12')).toBe('in the season starting 12 Oct 2026');
    expect(windowPhrase('weird')).toBe('in this period');
  });
  it('state lines keep the backend truth', () => {
    expect(stateText(item({ state: 'earned', earnedAt: '2026-10-12T18:00:00Z' }))).toBe('Earned 12 Oct 2026');
    expect(stateText(item({ state: 'earned', earnedLate: true, earnedAt: '2026-11-02T18:00:00Z' }))).toBe('Earned late for October 2026');
    expect(stateText(item({ state: 'removed' }))).toBe('Removed after a review');
    expect(stateText(item({ state: 'being_updated' }))).toMatch(/^Being updated\. This badge is under review and may change\.$/);
    expect(stateText(item({ state: 'updating' }))).toMatch(/^Updating/);
    expect(stateText(item({ state: 'unavailable' }))).toBe(UNAVAILABLE_TEXT);
    expect(stateText(item())).toBeNull();
    expect(COMING_SOON_TEXT).toBe('VIP progress — rewards coming soon');
  });
  it('names fall back to the key', () => {
    expect(itemName(item({ copy: null, achievement: 'first_stop' }))).toBe('First stop');
    expect(itemName(item())).toBe('Explorer');
  });
});

describe('paging and announcements', () => {
  it('announces only a real transition to earned', () => {
    const before = [item(), item({ achievement: 'first_stop', period: 'lifetime', state: 'earned' })];
    const after = [item({ state: 'earned' }), item({ achievement: 'first_stop', period: 'lifetime', state: 'earned' }), item({ achievement: 'new_one', period: 'lifetime', state: 'earned' })];
    expect(newlyEarned(before, after).map((i) => i.achievement)).toEqual(['explorer']);
    expect(newlyEarned([], after)).toEqual([]); // first load announces nothing
  });
  it('merges pages without duplicates', () => {
    const a = [item(), item({ achievement: 'first_stop', period: 'lifetime' })];
    const b = [item({ achievement: 'first_stop', period: 'lifetime' }), item({ achievement: 'zzz_last', period: 'lifetime' })];
    expect(mergePages(a, b).map((i) => i.achievement)).toEqual(['explorer', 'first_stop', 'zzz_last']);
  });
});
