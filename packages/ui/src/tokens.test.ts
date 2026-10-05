import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { colors, touchTarget } from './tokens';

const AA = 4.5;

describe('contrastRatio', () => {
  it('matches known values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
  });
});

describe('tokens meet WCAG AA', () => {
  const pairs: [string, string, string][] = [
    ['text on background', colors.text, colors.background],
    ['text on surface', colors.text, colors.surface],
    ['muted text on surface', colors.textMuted, colors.surface],
    ['muted text on background', colors.textMuted, colors.background],
    ['on-primary on primaryStrong', colors.onPrimaryStrong, colors.primaryStrong],
    ['primaryStrong on surface', colors.primaryStrong, colors.surface],
    ['accentStrong on surface', colors.accentStrong, colors.surface],
    ['text on primary fill', colors.text, colors.primary],
    ...Object.entries(colors.status).map(
      ([name, { fg, bg }]) => [`${name} status`, fg, bg] as [string, string, string],
    ),
  ];

  it.each(pairs)('%s', (_name, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA);
  });

  it('touch targets are at least 48dp', () => {
    expect(touchTarget.min).toBeGreaterThanOrEqual(48);
  });
});
