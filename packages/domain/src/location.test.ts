import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_MODE, isPubliclyVisible, ratingSchema } from './location';

describe('location rules', () => {
  it('verified and explicit-evidence unverified locations are public; everything else is hidden', () => {
    expect(isPubliclyVisible('verified')).toBe(true);
    expect(isPubliclyVisible('unverified', 'explicit')).toBe(true);
    expect(isPubliclyVisible('unverified', 'inferred')).toBe(false);
    expect(isPubliclyVisible('unverified')).toBe(false);
    expect(isPubliclyVisible('candidate', 'explicit')).toBe(false);
    expect(isPubliclyVisible('pending', 'explicit')).toBe(false);
    expect(isPubliclyVisible('closed', 'explicit')).toBe(false);
  });

  it('ratings are integers 1–5', () => {
    expect(ratingSchema.safeParse(0).success).toBe(false);
    expect(ratingSchema.safeParse(3.5).success).toBe(false);
    expect(ratingSchema.safeParse(5).success).toBe(true);
  });

  it('defaults to plain mode', () => {
    expect(DEFAULT_DISPLAY_MODE).toBe('plain');
  });
});
