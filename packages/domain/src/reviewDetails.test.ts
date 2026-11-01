import { describe, expect, it } from 'vitest';
import { parseReviewDetails } from './reviewDetails';
const parse = (values: Record<string, string> = {}) => parseReviewDetails({ get: (key) => ({ existence: 'exists', ...values } as Record<string, string>)[key] ?? null });
describe('visit details', () => {
  it('keeps a family bathroom separate from gender and both water types independent', () => {
    const r = parse({ family_bathroom: 'yes', restroom_type: 'women', cold_water: 'yes', customers_only: 'yes', cleaning_log: 'no' });
    expect(r.ok && r.details).toMatchObject({ family_bathroom: true, restroom_type: 'women', cold_water: true, customers_only: true, cleaning_log: false });
  });
  it('records missing and broken mirrors distinctly and all condition observations', () => {
    const r = parse({ mirrors: 'missing', seats: 'dirty', floor: 'clean', stall_doors: 'broken', toilet_paper: 'out', cleanliness_score: '2', rating: '3' });
    expect(r.ok && r.details).toMatchObject({ rating: 3, cleanliness_score: 2, conditions: { mirrors: 'missing', seats: 'dirty', floor: 'clean', stall_doors: 'broken', toilet_paper: 'out' } });
    expect(parse({ mirrors: 'broken' }).ok).toBe(true);
  });
  it('never publishes an old private note as a comment', () => {
    const r = parse({ notes: 'private earlier observation' });
    expect(r.ok && r.details.public_comment).toBeNull();
  });
  it('allows optional comments without a star rating or documentary evidence', () => {
    const r = parse({ public_comment: '  Useful restroom.  ' });
    expect(r.ok && r.details).toMatchObject({ public_comment: 'Useful restroom.', rating: null, cleanliness_score: null });
  });
  it('rejects invalid scores, conditions, booleans, and oversized comments', () => {
    const invalid: Record<string, string>[] = [{ rating: '6' }, { rating: '2.5' }, { cleanliness_score: '0' }, { mirrors: 'fine' }, { customers_only: 'maybe' }, { public_comment: 'x'.repeat(1001) }, { existence: 'not_exists', rating: '5' }];
    for (const values of invalid) expect(parse(values).ok).toBe(false);
  });
  it('does not carry transient cleanliness conditions into a new visit by default', () => {
    const r = parse();
    expect(r.ok && r.details.conditions).toEqual({ seats: 'unknown', mirrors: 'unknown', stall_doors: 'unknown', toilet_paper: 'unknown', floor: 'unknown' });
  });
});
