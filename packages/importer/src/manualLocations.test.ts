import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCleanupSql, buildInsertScript, buildInsertSql, MAX_MANUAL_RECORDS, validateManualInput, type ManualRecord } from './manualLocations';

// Synthetic in-memory inputs only (clearly marked TEST); nothing here is real data or touches a database.
const now = new Date('2026-10-05T00:00:00Z');
const good = (over: Record<string, unknown> = {}) => ({
  ref: 'dev-test-a01', name: 'TEST Verified Restroom', state: 'verified', latitude: 44.5, longitude: -109.05,
  city: 'Cody', region: 'WY', confirmed_on: '2026-10-04', confirmed_by: 'Test Person',
  original_observation: true, attested_public: true, ...over,
});
const errs = (input: unknown) => {
  const r = validateManualInput(input, now);
  return r.ok ? [] : r.errors;
};

describe('validateManualInput', () => {
  it('accepts a well-formed verified and unverified record', () => {
    const r = validateManualInput([good(), good({ ref: 'dev-test-b02', state: 'unverified', confirmed_on: null, confirmed_by: null, basis: 'Saw the posted sign; access not checked' })], now);
    expect(r.ok).toBe(true);
  });

  it('requires provenance and public-access attestations', () => {
    expect(errs([good({ original_observation: false })]).join()).toContain('original_observation');
    expect(errs([good({ attested_public: undefined })]).join()).toContain('attested_public');
  });

  it('limits the number of records', () => {
    expect(errs(Array.from({ length: MAX_MANUAL_RECORDS + 1 }, (_, i) => good({ ref: `dev-test-xx${i}` }))).join()).toContain('at most');
    expect(errs([]).join()).toContain('non-empty');
    expect(errs('x').join()).toContain('non-empty');
  });

  it('rejects bad refs, duplicates, placeholders and unreal coordinates', () => {
    expect(errs([good({ ref: 'osm/node/1' })]).join()).toContain('ref must look like');
    expect(errs([good(), good()]).join()).toContain('duplicate ref');
    expect(errs([good({ name: 'REPLACE with the name' })]).join()).toContain('placeholder');
    expect(errs([good({ name: 'Sample restroom' })]).join()).toContain('placeholder');
    expect(errs([good({ latitude: 0, longitude: 0 })]).join()).toContain('0,0');
    expect(errs([good({ latitude: 91 })]).join()).toContain('latitude');
    expect(errs([good({ longitude: '12' })]).join()).toContain('longitude');
  });

  it('requires evidence per state: verified needs date + person; unverified needs a basis; no future dates', () => {
    expect(errs([good({ confirmed_on: null })]).join()).toContain('confirmed_on is required');
    expect(errs([good({ confirmed_by: null })]).join()).toContain('confirmed_by is required');
    expect(errs([good({ confirmed_on: '2026-12-31' })]).join()).toContain('future');
    expect(errs([good({ confirmed_on: 'yesterday' })]).join()).toContain('date');
    expect(errs([good({ state: 'unverified', basis: null })]).join()).toContain('basis is required');
    expect(errs([good({ state: 'unverified', basis: 'short' })]).join()).toContain('at least 10');
    expect(errs([good({ state: 'closed' })]).join()).toContain('state must be');
  });

  it('keeps amenity facts three-valued and rejects control characters', () => {
    expect(errs([good({ key_required: 'yes' })]).join()).toContain('key_required');
    expect(errs([good({ name: 'Bad\u0000Name' })]).join()).toContain('control');
    const ok = validateManualInput([good({ wheelchair_accessible: true, fee_required: false })], now);
    expect(ok.ok && ok.records[0]?.wheelchair_accessible).toBe(true);
    expect(ok.ok && ok.records[0]?.baby_changing).toBeNull();
  });

  it('the committed example template can never be applied as-is', () => {
    const example = JSON.parse(readFileSync(new URL('../../../manual-locations.example.json', import.meta.url), 'utf8')) as unknown;
    expect(validateManualInput(example, now).ok).toBe(false);
  });
});

describe('SQL generation', () => {
  const rec = (over: Record<string, unknown> = {}): ManualRecord => {
    const r = validateManualInput([good(over)], now);
    if (!r.ok) throw new Error(r.errors.join());
    return r.records[0]!;
  };

  it('is one atomic, idempotent statement that writes a manual source row with no attribution requirement', () => {
    const sql = buildInsertSql(rec());
    expect(sql).toContain('with new_loc as (');
    expect(sql).toContain('where not exists');
    expect(sql).toContain("'manual'");
    expect(sql).toContain("'verified'");
    expect(sql).toContain('Open Stall original data');
    expect(sql).not.toMatch(/openstreetmap|odbl|osm/i);
  });

  it('verified sets confirmation; unverified claims no Open Stall verification', () => {
    expect(buildInsertSql(rec())).toContain("'2026-10-04T12:00:00Z'::timestamptz");
    const u = buildInsertSql(rec({ state: 'unverified', confirmed_on: null, confirmed_by: null, basis: 'Saw the posted sign; access not checked' }));
    expect(u).toContain("'unverified', 'explicit', false, null");
  });

  it('escapes quotes so hostile text cannot break out of the statement', () => {
    const sql = buildInsertSql(rec({ name: "Joe's'); drop table public.locations;--" }));
    expect(sql).toContain("'Joe''s''); drop table public.locations;--'");
  });

  it('cleanup only targets manual dev-test records', () => {
    const c = buildCleanupSql();
    expect(c).toContain("source = 'manual'");
    expect(c).toContain("like 'dev-test-%'");
    expect(buildInsertScript([rec()])).toContain('Idempotent');
  });
});
