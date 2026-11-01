import { describe, expect, it } from 'vitest';
import {
  AUTH_REQUIRED_FEATURES, PUBLIC_FEATURES, authErrorMessage, parseAuthCallback, requiresAuth, safeNextPath, validateEmail, validatePassword,
} from './auth';

describe('feature gating', () => {
  it('discovery stays public; account features and contributions require sign-in', () => {
    for (const f of PUBLIC_FEATURES) expect(requiresAuth(f)).toBe(false);
    for (const f of AUTH_REQUIRED_FEATURES) expect(requiresAuth(f)).toBe(true);
    expect(AUTH_REQUIRED_FEATURES).toEqual(expect.arrayContaining(['favorites', 'submissions', 'ratings', 'reports']));
  });
});

describe('validateEmail / validatePassword', () => {
  it('validates emails', () => {
    expect(validateEmail('')).toContain('Enter');
    expect(validateEmail('not-an-email')).toContain('valid');
    expect(validateEmail('a@b')).toContain('valid');
    expect(validateEmail('a b@c.com')).toContain('valid');
    expect(validateEmail(`${'a'.repeat(250)}@x.com`)).toContain('valid');
    expect(validateEmail('  person@example.com ')).toBeNull();
  });
  it('enforces length, rejects common/identical passwords, accepts passphrases', () => {
    expect(validatePassword('short')).toContain('at least 8');
    expect(validatePassword('x'.repeat(73))).toContain('at most');
    expect(validatePassword('Password123')).toContain('too common');
    expect(validatePassword('person@example.com', 'person@example.com')).toContain('email');
    expect(validatePassword('aaaaaaaaaa')).toContain('variety');
    expect(validatePassword('correct horse battery staple')).toBeNull();
  });
});

describe('authErrorMessage', () => {
  it('maps known errors without leaking backend text or account existence', () => {
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('Email or password is incorrect.');
    expect(authErrorMessage({ message: 'Invalid login credentials' })).toBe('Email or password is incorrect.');
    expect(authErrorMessage({ code: 'email_not_confirmed' })).toContain('Confirm your email');
    expect(authErrorMessage({ status: 429 })).toContain('Too many attempts');
    expect(authErrorMessage({ code: 'over_email_send_rate_limit' })).toContain('Too many attempts');
    expect(authErrorMessage({ code: 'weak_password' })).toContain('stronger');
    expect(authErrorMessage({ code: 'provider_disabled' })).toContain('not available');
    expect(authErrorMessage({ message: 'TypeError: Network request failed' })).toContain('connection');
    const generic = authErrorMessage({ message: 'duplicate key value violates unique constraint users_email_key' });
    expect(generic).toBe('Something went wrong. Please try again.');
    expect(generic).not.toContain('users_email_key');
    expect(authErrorMessage(null)).toBe('Something went wrong. Please try again.');
  });
});

describe('safeNextPath (no open redirects)', () => {
  it('accepts internal paths only', () => {
    expect(safeNextPath('/favorites')).toBe('/favorites');
    expect(safeNextPath('/location/abc?view=1')).toBe('/location/abc?view=1');
    for (const bad of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined, '/a\nb', '/auth/sign-in', 'x'.repeat(300)]) {
      expect(safeNextPath(bad as string)).toBe('/');
    }
    expect(safeNextPath('//evil.com', '/home')).toBe('/home');
  });
});

describe('parseAuthCallback', () => {
  const code = 'abcdEFGH1234-_.~';
  it('accepts the PKCE code on the callback path for custom scheme, Expo Go and web URLs', () => {
    for (const u of [`openstall://auth/callback?code=${code}`, `exp://192.168.1.2:8081/--/auth/callback?code=${code}`, `http://localhost:8081/auth/callback?code=${code}`, `https://app.example.com/auth/callback/?code=${code}`]) {
      expect(parseAuthCallback(u)).toEqual({ kind: 'code', code });
    }
  });
  it('ignores other paths and malformed codes', () => {
    expect(parseAuthCallback(`openstall://location/abc?code=${code}`)).toEqual({ kind: 'none' });
    expect(parseAuthCallback(`openstall://xauth/callback?code=${code}`)).toEqual({ kind: 'none' });
    expect(parseAuthCallback('openstall://auth/callback?code=short')).toEqual({ kind: 'none' });
    expect(parseAuthCallback('openstall://auth/callback?code=<script>alert(1)</script>')).toEqual({ kind: 'none' });
    expect(parseAuthCallback('not a url')).toEqual({ kind: 'none' });
  });
  it('rejects implicit-flow tokens and surfaces provider errors generically', () => {
    expect(parseAuthCallback('openstall://auth/callback#access_token=abc&refresh_token=def').kind).toBe('error');
    expect(parseAuthCallback('openstall://auth/callback?access_token=abc').kind).toBe('error');
    const err = parseAuthCallback('openstall://auth/callback?error=access_denied&error_description=secret+detail');
    expect(err.kind).toBe('error');
    expect(JSON.stringify(err)).not.toContain('secret');
  });
});
