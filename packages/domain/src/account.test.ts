import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT, accountErrorMessage, buildProposal, AUTHORITATIVE_REJECTION_CODES, isUncertainOutcome, uncertainWriteMessage, UNCERTAIN_DELETE_MESSAGE, fixProblem, sanitizePreferences, toggleObservation, validateDisplayName,
  validateFreeText, validateRating, validateReport, looksResidential, ratingChoiceLabel, type LocationDraft, type LocationFix,
} from './account';


describe('display name', () => {
  it('accepts normal names', () => expect(validateDisplayName('Trail Walker')).toBeNull());
  it.each(['a', 'x'.repeat(31), 'a@b.co', '<b>x</b>', 'Admin Joe', 'Open Stall Team', 'see www.x', 'bad;name'])('rejects %s', (n) =>
    expect(validateDisplayName(n)).not.toBeNull());
});

describe('free text', () => {
  it('rejects links, emails, phone numbers, markup', () => {
    for (const t of ['http://x', 'a@b.co', 'call 307-555-0100', '<script>', 'foo.com']) expect(validateFreeText(t, 'note', 300)).not.toBeNull();
    expect(validateFreeText('Behind the bakery, door on the left', 'note', 300)).toBeNull();
  });
  it('enforces length and non-empty', () => {
    expect(validateFreeText('  ', 'note', 10)).toMatch(/Enter/);
    expect(validateFreeText('x'.repeat(11), 'note', 10)).toMatch(/10 characters/);
  });
});

describe('residential heuristic', () => {
  it('flags private homes but not normal places', () => {
    for (const t of ["my house", 'Their garage', 'private residence', 'my neighbor’s yard']) expect(looksResidential(t)).toBe(true);
    for (const t of ['Public library', 'Home Depot', 'Main Street Cafe']) {
      // Home Depot is fine; "Residence Inn" is a known conservative false positive handled by review
      expect(looksResidential(t)).toBe(false);
    }
  });
});

describe('ratings and observations', () => {
  it('validates 1-5', () => {
    expect(validateRating(3)).toBeNull();
    for (const n of [0, 6, 2.5, null]) expect(validateRating(n as number | null)).not.toBeNull();
  });
  it('toggle clears the opposite and toggles off', () => {
    expect(toggleObservation(['dirty'], 'clean')).toEqual(['clean']);
    expect(toggleObservation(['clean'], 'clean')).toEqual([]);
    expect(toggleObservation(['clean'], 'easy_to_find')).toEqual(['clean', 'easy_to_find']);
  });
  it('labels differ by mode', () => {
    expect(ratingChoiceLabel(1, 'plain')).toBe('1 star');
    expect(ratingChoiceLabel(5, 'risque')).not.toBe('5 stars');
  });
});

describe('reports', () => {
  it('needs an issue and a clean comment', () => {
    expect(validateReport(null, '')).not.toBeNull();
    expect(validateReport('closed', '')).toBeNull();
    expect(validateReport('closed', 'see http://spam')).not.toBeNull();
  });
});

describe('buildProposal: new restroom needs a fresh, accurate device fix', () => {
  const NOW = 1_000_000;
  const fix = (o: Partial<LocationFix> = {}): LocationFix => ({ latitude: 44.5, longitude: -109.05, accuracyM: 10, capturedAt: NOW - 1000, ...o });
  const good: LocationDraft = { ...EMPTY_DRAFT, name: 'Library restroom', fix: fix(), attestedPublic: true };

  it('builds a proposal WITHOUT coordinates and returns the device position separately', () => {
    const r = buildProposal({ ...good, fee: false, wheelchair: null }, 'new', NOW);
    expect(r).toEqual({ ok: true, proposed: { name: 'Library restroom', fee_required: false }, note: null, position: { latitude: 44.5, longitude: -109.05, accuracyM: 10 } });
    if (r.ok) expect(r.proposed).not.toHaveProperty('latitude');
  });
  it('rejects a missing fix', () => {
    const r = buildProposal({ ...good, fix: null }, 'new', NOW);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/current location/);
  });
  it.each([
    ['too imprecise', { accuracyM: 51 }], ['zero accuracy', { accuracyM: 0 }], ['negative accuracy', { accuracyM: -1 }], ['NaN accuracy', { accuracyM: NaN }],
    ['NaN latitude', { latitude: NaN }], ['out-of-range latitude', { latitude: 95 }], ['out-of-range longitude', { longitude: 181 }],
    ['null island', { latitude: 0, longitude: 0 }], ['stale fix', { capturedAt: NOW - 200_000 }],
  ])('rejects %s', (_n, o) => expect(buildProposal({ ...good, fix: fix(o as Partial<LocationFix>) }, 'new', NOW).ok).toBe(false));
  it('accepts exactly 50 m and a fix just inside the age limit', () => {
    expect(buildProposal({ ...good, fix: fix({ accuracyM: 50, capturedAt: NOW - 119_000 }) }, 'new', NOW).ok).toBe(true);
  });
  it('still requires attestation and a name', () => {
    expect(buildProposal({ ...good, attestedPublic: false }, 'new', NOW).ok).toBe(false);
    expect(buildProposal({ ...good, name: ' ' }, 'new', NOW).ok).toBe(false);
  });
  it('blocks private residences and links', () => {
    expect(buildProposal({ ...good, name: 'My house bathroom' }, 'new', NOW).ok).toBe(false);
    expect(buildProposal({ ...good, note: 'visit http://x.example' }, 'new', NOW).ok).toBe(false);
  });
  it('fixProblem explains each failure', () => {
    expect(fixProblem(null, NOW)).toMatch(/current location/);
    expect(fixProblem(fix({ accuracyM: 80 }), NOW)).toMatch(/80 m/);
    expect(fixProblem(fix(), NOW)).toBeNull();
  });
});

describe('buildProposal: corrections to existing restrooms are not blocked by the GPS rule', () => {
  it('needs a change and attestation, but no location', () => {
    expect(buildProposal({ ...EMPTY_DRAFT, attestedPublic: true }, 'edit').ok).toBe(false);
    expect(buildProposal({ ...EMPTY_DRAFT, attestedPublic: true, fee: true }, 'edit')).toMatchObject({ ok: true, proposed: { fee_required: true }, position: null });
    expect(buildProposal({ ...EMPTY_DRAFT, fee: true }, 'edit').ok).toBe(false);
  });
  it('an optional fix updates the pin; a poor one is refused', () => {
    const now = 5_000;
    const f = { latitude: 44.5, longitude: -109.05, accuracyM: 12, capturedAt: now };
    expect(buildProposal({ ...EMPTY_DRAFT, attestedPublic: true, fix: f }, 'edit', now)).toMatchObject({ ok: true, proposed: { latitude: 44.5, longitude: -109.05 } });
    expect(buildProposal({ ...EMPTY_DRAFT, attestedPublic: true, fix: { ...f, accuracyM: 500 } }, 'edit', now).ok).toBe(false);
  });
});

describe('preferences and errors', () => {
  it('sanitizes untrusted preferences', () => {
    expect(sanitizePreferences({ mode: 'evil', transport: 'teleport', displayName: '<b>' })).toEqual({ mode: 'plain', transport: 'walk', displayName: null });
    expect(sanitizePreferences({ mode: 'risque', transport: 'bike', displayName: ' Sam ' })).toEqual({ mode: 'risque', transport: 'bike', displayName: 'Sam' });
    expect(sanitizePreferences(null).mode).toBe('plain');
  });
  it('maps backend errors without leaking raw text', () => {
    expect(accountErrorMessage({ code: '53400', message: 'favorites limit reached' })).toMatch(/up to 5/);
    expect(accountErrorMessage({ code: '53400', message: 'too many pending submissions' })).toMatch(/pending/);
    expect(accountErrorMessage({ code: '54000', message: 'rate limit exceeded for report' })).toMatch(/later/);
    expect(accountErrorMessage({ code: '22023', message: 'too far from the restroom to check in' })).toMatch(/150 meters/);
    expect(accountErrorMessage({ code: '28000', message: 'not authenticated' })).toMatch(/sign in/i);
    // Nearby/duplicate proposals are never rejected by the server any more, so there is no message for them.
    expect(accountErrorMessage({ code: '22023', message: 'restroom already listed nearby' })).toBe('Some details weren’t accepted. Check them and try again.');
    expect(accountErrorMessage({ code: '22023', message: 'location not accurate enough' })).toMatch(/accurate/);
    expect(accountErrorMessage({ code: '22023', message: 'current location required' })).toMatch(/current location/);
    expect(accountErrorMessage({ code: '54000', message: 'submissions paused' })).toMatch(/paused/);
    expect(accountErrorMessage({ message: 'SELECT secret_table violates' })).toBe('Something went wrong. Please try again.');
  });
});

describe('uncertain write outcomes (R3 correction)', () => {
  it('treats only the known authoritative rejection codes as confirmed rejections', () => {
    for (const code of ['22023', '28000', '42501', '53400', '54000', '55000', 'PGRST301', 'PGRST302']) expect(isUncertainOutcome({ code, message: 'x' })).toBe(false);
    expect([...AUTHORITATIVE_REJECTION_CODES].sort()).toEqual(['22023', '28000', '42501', '53400', '54000', '55000', 'PGRST301', 'PGRST302']);
  });
  it('keeps transport, gateway, internal and unknown codes uncertain', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'UND_ERR_SOCKET', '57014', '40001', '40P01', '08006', '53300', 'XX000', 'PGRST000', 'PGRST003', '502', '504', 'P0001', 'SOMETHING_NEW', '']) {
      expect(isUncertainOutcome({ code, message: 'x' })).toBe(true);
    }
    expect(isUncertainOutcome({ message: 'TypeError: Failed to fetch' })).toBe(true);
    expect(isUncertainOutcome({ message: 'boom', status: 502 })).toBe(true);
    expect(isUncertainOutcome({ message: 'denied', status: 401 })).toBe(true);
    expect(isUncertainOutcome(null)).toBe(true);
    expect(isUncertainOutcome(undefined)).toBe(true);
  });
  it('never claims that nothing happened when the outcome is unknown', () => {
    for (const m of [uncertainWriteMessage('your report was sent'), UNCERTAIN_DELETE_MESSAGE]) {
      expect(m).toMatch(/couldn’t confirm/);
      expect(m).not.toMatch(/nothing (was|is)|wasn’t (sent|saved|deleted)|not (sent|saved|deleted)/i);
    }
    expect(uncertainWriteMessage('your report was sent')).toMatch(/never resend automatically/);
  });
  it('does not conclude deletion (or its absence) from a failed sign-in', () => {
    expect(UNCERTAIN_DELETE_MESSAGE).not.toMatch(/if not,? it was deleted|it was deleted\.|account is gone|has been deleted/i);
    expect(UNCERTAIN_DELETE_MESSAGE).toMatch(/can’t tell us on its own/);
    expect(UNCERTAIN_DELETE_MESSAGE).toMatch(/don’t assume either way/);
    // the only conclusion drawn is the logically sound one: a SUCCESSFUL sign-in proves the account exists
    expect(UNCERTAIN_DELETE_MESSAGE).toMatch(/If you can sign in, the account still exists/);
  });
});
