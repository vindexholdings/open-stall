import { describe, expect, it } from 'vitest';
import { assertExpectedProject, assertSessionBackend, parseEnvironmentRef, projectRefFromUrl } from './gate';

const env = { SUPABASE_URL: 'https://abcdefghij1234.supabase.co' };

describe('project guard', () => {
  const md = 'Project ref: abcdefghij1234 (approved)\n';
  it('parses refs and only allows the recorded project', () => {
    expect(projectRefFromUrl(env.SUPABASE_URL)).toBe('abcdefghij1234');
    expect(parseEnvironmentRef(md)).toBe('abcdefghij1234');
    expect(assertExpectedProject(env.SUPABASE_URL, md)).toBe('abcdefghij1234');
    expect(() => assertExpectedProject('https://zzzzzzzzzz.supabase.co', md)).toThrow('does not match');
    expect(() => assertExpectedProject(env.SUPABASE_URL, 'nothing')).toThrow('ENVIRONMENT.md');
    expect(() => projectRefFromUrl('https://example.com')).toThrow();
  });
});

describe('assertSessionBackend', () => {
  const md = 'Project ref: abcdefghij1234\n';
  it('accepts only the recorded hosted project', () => {
    expect(() => assertSessionBackend('https://abcdefghij1234.supabase.co', md, {})).not.toThrow();
    expect(() => assertSessionBackend('https://zzzzzzzzzzzzzz.supabase.co', md, {})).toThrow(/does not match/);
  });
  it('a loopback test backend needs the explicit opt-in and never unlocks hosted projects', () => {
    expect(() => assertSessionBackend('http://127.0.0.1:54299', md, {})).toThrow();
    expect(() => assertSessionBackend('http://127.0.0.1:54299', md, { ADMIN_ALLOW_LOCAL_BACKEND: 'true' })).not.toThrow();
    expect(() => assertSessionBackend('https://zzzzzzzzzzzzzz.supabase.co', md, { ADMIN_ALLOW_LOCAL_BACKEND: 'true' })).toThrow(/does not match/);
  });
});
