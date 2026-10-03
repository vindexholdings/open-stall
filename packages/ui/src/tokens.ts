/**
 * Open Stall design tokens (DESIGN_SYSTEM.md).
 * Brand blue #1E90FF and teal #00B3A6 are for fills/accents with dark text or
 * large graphics; the *Strong variants meet WCAG AA (4.5:1) for text and
 * white-on-color buttons. Contrast is enforced by tokens.test.ts.
 */
export const palette = {
  brandBlue: '#1E90FF',
  brandBlueStrong: '#0B63C4',
  brandTeal: '#00B3A6',
  brandTealStrong: '#00776E',
  white: '#FFFFFF',
  neutral50: '#F7F9FC',
  neutral100: '#EEF2F7',
  neutral300: '#C9D2DE',
  neutral600: '#5B6675',
  neutral900: '#111827',
  green700: '#15803D',
  green50: '#ECFDF3',
  amber800: '#92400E',
  amber50: '#FFF7E6',
  red700: '#B91C1C',
  red50: '#FEF2F2',
} as const;

export const colors = {
  background: palette.neutral50,
  surface: palette.white,
  surfaceMuted: palette.neutral100,
  border: palette.neutral300,
  text: palette.neutral900,
  textMuted: palette.neutral600,
  primary: palette.brandBlue,
  primaryStrong: palette.brandBlueStrong,
  onPrimaryStrong: palette.white,
  accent: palette.brandTeal,
  accentStrong: palette.brandTealStrong,
  focus: palette.brandBlueStrong,
  /** Semantic status tokens: text color on matching background. */
  status: {
    verified: { fg: palette.green700, bg: palette.green50 },
    unverified: { fg: palette.amber800, bg: palette.amber50 },
    pending: { fg: palette.amber800, bg: palette.amber50 },
    closed: { fg: palette.neutral600, bg: palette.neutral100 },
    danger: { fg: palette.red700, bg: palette.red50 },
  },
} as const;

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32 } as const;

export const radii = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const typography = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 14, lineHeight: 18, fontWeight: '600' },
} as const;

/** Minimum touch target (dp); larger than platform minimums for urgent use. */
export const touchTarget = { min: 48, primary: 56 } as const;
