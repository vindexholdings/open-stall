import { describe, expect, it } from 'vitest';
import { assertExpectedProject, evaluateAccess, parseEnvironmentRef, projectRefFromUrl } from './gate';

const env = { ADMIN_LOCAL_ONLY: 'true', SUPABASE_URL: 'https://abcdefghij1234.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k' };

describe('evaluateAccess', () => {
  it('allows only an explicit local opt-in on localhost with credentials', () => {
    expect(evaluateAccess({ env, host: 'localhost:3000' }).ok).toBe(true);
    expect(evaluateAccess({ env, host: '127.0.0.1:3000' }).ok).toBe(true);
    expect(evaluateAccess({ env, host: '[::1]:3000' }).ok).toBe(true);
  });
  it('denies without the opt-in flag (the default on any deployment)', () => {
    expect(evaluateAccess({ env: { ...env, ADMIN_LOCAL_ONLY: undefined }, host: 'localhost:3000' }).ok).toBe(false);
    expect(evaluateAccess({ env: { ...env, ADMIN_LOCAL_ONLY: '1' }, host: 'localhost:3000' }).ok).toBe(false);
  });
  it('denies on Vercel even if the flag is set', () => {
    for (const v of ['VERCEL', 'VERCEL_ENV', 'VERCEL_URL']) {
      expect(evaluateAccess({ env: { ...env, [v]: '1' }, host: 'localhost:3000' }).ok).toBe(false);
    }
  });
  it('denies non-local hosts (LAN, public names, DNS rebinding)', () => {
    for (const host of ['192.168.1.5:3000', 'admin.example.com', 'localhost.evil.com', 'evil.com:3000', '', null]) {
      expect(evaluateAccess({ env, host }).ok).toBe(false);
    }
  });
  it('denies without credentials', () => {
    expect(evaluateAccess({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }, host: 'localhost:3000' }).ok).toBe(false);
    expect(evaluateAccess({ env: { ...env, SUPABASE_URL: undefined }, host: 'localhost:3000' }).ok).toBe(false);
  });
});

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
