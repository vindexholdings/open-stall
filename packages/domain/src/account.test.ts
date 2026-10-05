import { describe, expect, it } from 'vitest';
import {
  EMPTY_DRAFT, accountErrorMessage, buildProposal, sanitizePreferences, toggleObservation, validateDisplayName,
  validateFreeText, validateRating, validateReport, looksResidential, ratingChoiceLabel, type LocationDraft,
} from './account';

const good: LocationDraft = { ...EMPTY_DRAFT, name: 'Library restroom', latitude: 44.5, longitude: -109.05, attestedPublic: true };

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

describe('buildProposal', () => {
  it('builds a new-location proposal, omitting unknowns', () => {
    const r = buildProposal({ ...good, fee: false, wheelchair: null }, 'new');
    expect(r).toEqual({ ok: true, proposed: { name: 'Library restroom', latitude: 44.5, longitude: -109.05, fee_required: false }, note: null });
  });
  it('requires attestation, name and coordinates for new', () => {
    const r = buildProposal({ ...EMPTY_DRAFT }, 'new');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/name.*|Confirm/);
    expect(buildProposal({ ...good, attestedPublic: false }, 'new').ok).toBe(false);
    expect(buildProposal({ ...good, latitude: null, longitude: null }, 'new').ok).toBe(false);
  });
  it('rejects bad coordinates and half pairs', () => {
    expect(buildProposal({ ...good, latitude: 95 }, 'new').ok).toBe(false);
    expect(buildProposal({ ...good, longitude: null }, 'new').ok).toBe(false);
  });
  it('blocks private residences and links', () => {
    expect(buildProposal({ ...good, name: 'My house bathroom' }, 'new').ok).toBe(false);
    expect(buildProposal({ ...good, note: 'visit http://x.example' }, 'new').ok).toBe(false);
  });
  it('edit requires at least one change and attestation', () => {
    expect(buildProposal({ ...EMPTY_DRAFT, attestedPublic: true }, 'edit').ok).toBe(false);
    expect(buildProposal({ ...EMPTY_DRAFT, attestedPublic: true, fee: true }, 'edit')).toMatchObject({ ok: true, proposed: { fee_required: true } });
    expect(buildProposal({ ...EMPTY_DRAFT, fee: true }, 'edit').ok).toBe(false);
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
    expect(accountErrorMessage({ message: 'SELECT secret_table violates' })).toBe('Something went wrong. Please try again.');
  });
});
