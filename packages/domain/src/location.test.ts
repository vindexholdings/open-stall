import { describe, expect, it } from 'vitest';
import { DEFAULT_DISPLAY_MODE, isPubliclyVisible, ratingSchema } from './location';

describe('location rules', () => {
  it('only verified locations are public', () => {
    expect(isPubliclyVisible('verified')).toBe(true);
    expect(isPubliclyVisible('candidate')).toBe(false);
    expect(isPubliclyVisible('pending')).toBe(false);
    expect(isPubliclyVisible('closed')).toBe(false);
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
