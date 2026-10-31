import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Geocode } from './census';
import { buildResearchCleanupSql, buildResearchInsertSql, MAX_RESEARCH_RECORDS, validateResearchInput, type ResearchRecord } from './researchedLocations';

// Synthetic in-memory inputs only (clearly TEST); not real records.
const now = new Date('2026-10-05T00:00:00Z');
const good = (over: Record<string, unknown> = {}) => ({
  ref: 'os111-test-aaa', name: 'TEST Station', street: '100 Test St', city: 'Testville', region: 'WY', postal_code: '82414',
  evidence_url: 'https://station-corp.test/store/100', evidence_summary: 'Store page states restrooms are available.',
  researched_on: '2026-10-04', researched_by: 'Test Person',
  evidence_is_public_web_source: true, no_map_database_content: true, ...over,
});
const errs = (input: unknown) => {
  const r = validateResearchInput(input, now);
  return r.ok ? '' : r.errors.join(' | ');
};
const geo: Geocode = { latitude: 44.5, longitude: -109.05, matchedAddress: "100 TEST ST, O'TEST, WY, 82414", benchmark: 'Public_AR_Current', retrievedAt: '2026-10-05T00:00:00.000Z' };

describe('validateResearchInput', () => {
  it('accepts a complete researched record', () => {
    expect(validateResearchInput([good()], now).ok).toBe(true);
  });

  it('never allows Verified and requires the honest attestations', () => {
    expect(errs([good({ state: 'verified' })])).toContain('never Verified');
    expect(errs([good({ state: 'unverified' })])).toBe('');
    expect(errs([good({ evidence_is_public_web_source: false })])).toContain('evidence_is_public_web_source');
    expect(errs([good({ no_map_database_content: undefined })])).toContain('no_map_database_content');
  });

  it('requires evidence: https page, not a map database, summary, date, researcher', () => {
    expect(errs([good({ evidence_url: 'http://x.test/a' })])).toContain('https');
    expect(errs([good({ evidence_url: 'not a url' })])).toContain('valid URL');
    for (const host of ['https://www.openstreetmap.org/node/1', 'https://www.google.com/maps/place/x', 'https://maps.apple.com/?q=x', 'https://goo.gl/maps/abc']) {
      expect(errs([good({ evidence_url: host })])).toContain('map database');
    }
    expect(errs([good({ evidence_summary: 'short' })])).toContain('at least 15');
    expect(errs([good({ researched_on: '2026-12-31' })])).toContain('future');
    expect(errs([good({ researched_on: 'soon' })])).toContain('date');
    expect(errs([good({ researched_by: '' })])).toContain('researched_by is required');
  });

  it('rejects placeholders, bad refs/addresses, duplicates and too many records', () => {
    expect(errs([good({ evidence_url: 'REPLACE with the page' })])).toContain('placeholder');
    expect(errs([good({ researched_on: 'YYYY-MM-DD' })])).toContain('date');
    expect(errs([good({ ref: 'dev-test-aaa' })])).toContain('ref must look like os111-');
    expect(errs([good({ postal_code: '1234' })])).toContain('postal_code');
    expect(errs([good({ region: 'Wyoming' })])).toContain('region');
    expect(errs([good(), good()])).toContain('duplicate ref');
    expect(errs(Array.from({ length: MAX_RESEARCH_RECORDS + 1 }, (_, i) => good({ ref: `os111-t${i}x` })))).toContain('at most');
    expect(errs([])).toContain('non-empty');
  });

  it('the committed OS-111 template cannot be applied until evidence is filled in', () => {
    const tpl = JSON.parse(readFileSync(new URL('../../../os111-research-records.json', import.meta.url), 'utf8')) as Record<string, unknown>[];
    expect(tpl.map((r) => r.name)).toEqual(['Maverik', 'Conoco', 'Exxon (Good 2 Go)']);
    expect(validateResearchInput(tpl, now).ok).toBe(false);
    expect(tpl.every((r) => r.state === undefined)).toBe(true);
  });
});

describe('SQL generation', () => {
  const rec = (over: Record<string, unknown> = {}): ResearchRecord => {
    const r = validateResearchInput([good(over)], now);
    if (!r.ok) throw new Error(r.errors.join());
    return r.records[0]!;
  };

  it('writes an UNVERIFIED canonical record plus a separate research source row, atomically and idempotently', () => {
    const sql = buildResearchInsertSql(rec(), geo);
    expect(sql).toContain("'unverified', 'explicit', false, null");
    expect(sql).not.toContain("'verified'");
    expect(sql).toContain("'research'");
    expect(sql).toContain('with new_loc as (');
    expect(sql).toContain('where not exists');
    expect(sql).toContain('os111-test-aaa');
  });

  it('records provenance and clearly tags the record as OS-111 dev/test', () => {
    const sql = buildResearchInsertSql(rec(), geo);
    expect(sql).toContain('os111-dev-test');
    expect(sql).toContain('US Census Bureau Geocoder');
    expect(sql).toContain('https://station-corp.test/store/100');
    expect(sql).toContain('public domain');
    expect(sql).not.toMatch(/openstreetmap|odbl|google/i);
  });

  it('escapes quotes so hostile text cannot break out of the statement', () => {
    const sql = buildResearchInsertSql(rec({ name: "Joe's'); drop table public.locations;--" }), geo);
    expect(sql).toContain("'Joe''s''); drop table public.locations;--'");
    expect(sql).toContain("O''TEST");
  });

  it('cleanup targets only OS-111 research records', () => {
    const c = buildResearchCleanupSql();
    expect(c).toContain("source = 'research'");
    expect(c).toContain("like 'os111-%'");
  });
});
