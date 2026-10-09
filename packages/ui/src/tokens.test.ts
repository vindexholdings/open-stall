import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';
import { breakpoints, colors, focusRing, layout, layoutFor, tones, touchTarget } from './tokens';

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
    ['muted text on muted surface', colors.textMuted, colors.surfaceMuted],
    ['text on muted surface', colors.text, colors.surfaceMuted],
    ['status text on plain surface (verified)', colors.status.verified.fg, colors.surface],
    ['status text on plain surface (unverified)', colors.status.unverified.fg, colors.surface],
    ['status text on plain surface (danger)', colors.status.danger.fg, colors.surface],
    ...Object.entries(tones).map(([name, { fg, bg }]) => [`${name} tone`, fg, bg] as [string, string, string]),
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

describe('R1 layout and focus tokens', () => {
  it('keeps form columns narrower than the page column and at least phone width', () => {
    expect(layout.formMaxWidth).toBeLessThan(layout.maxContentWidth);
    expect(layout.formMaxWidth).toBeGreaterThanOrEqual(360);
  });
  it('chooses wide layout from the breakpoint up', () => {
    expect(layoutFor(breakpoints.wide - 1)).toBe('narrow');
    expect(layoutFor(breakpoints.wide)).toBe('wide');
    expect(layoutFor(360)).toBe('narrow');
  });
  it('focus ring has non-text contrast of at least 3:1 against surfaces and the background', () => {
    for (const bg of [colors.surface, colors.background, colors.surfaceMuted]) {
      expect(contrastRatio(focusRing.outlineColor, bg)).toBeGreaterThanOrEqual(3);
    }
    expect(focusRing.outlineWidth).toBeGreaterThanOrEqual(2);
  });
  it('every tone has a symbol so status never relies on color alone', () => {
    for (const t of Object.values(tones)) expect(t.symbol.length).toBeGreaterThan(0);
  });
});

