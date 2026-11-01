import { describe, expect, it, vi } from 'vitest';
import {
  completeAuthCallback, requestPasswordReset, setNewPassword, signInWithApple, signInWithEmail, signInWithGoogleNative,
  signInWithGoogleWeb, signOut, signUpWithEmail, type AuthClientLike,
} from './authService';

// Fake auth backend: no network. Records calls so tests can assert what was (not) sent.
function fake(overrides: Partial<AuthClientLike['auth']> = {}) {
  const ok = { data: { session: { x: 1 }, url: 'https://provider.test/auth', user: null }, error: null };
  const auth: AuthClientLike['auth'] = {
    signInWithPassword: vi.fn(async () => ok),
    signUp: vi.fn(async () => ({ ...ok, data: { session: null } })),
    signOut: vi.fn(async () => ({ error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ error: null })),
    updateUser: vi.fn(async () => ({ error: null })),
    signInWithOAuth: vi.fn(async () => ok),
    exchangeCodeForSession: vi.fn(async () => ({ error: null })),
    signInWithIdToken: vi.fn(async () => ({ error: null })),
    ...overrides,
  } as AuthClientLike['auth'];
  return { client: { auth } as AuthClientLike, auth };
}
const GOOD_PW = 'correct horse battery staple';

describe('email sign-in', () => {
  it('validates before calling the backend', async () => {
    const { client, auth } = fake();
    expect((await signInWithEmail(client, 'nope', GOOD_PW)).ok).toBe(false);
    expect((await signInWithEmail(client, 'a@b.co', '')).ok).toBe(false);
    expect(auth.signInWithPassword).not.toHaveBeenCalled();
  });
  it('signs in, trimming the email', async () => {
    const { client, auth } = fake();
    expect(await signInWithEmail(client, ' a@b.co ', GOOD_PW)).toEqual({ ok: true });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.co', password: GOOD_PW });
  });
  it('shows one generic message for bad credentials and survives network failures', async () => {
    const bad = fake({ signInWithPassword: vi.fn(async () => ({ data: { session: null }, error: { code: 'invalid_credentials' } })) });
    expect(await signInWithEmail(bad.client, 'a@b.co', 'wrongpassword')).toEqual({ ok: false, message: 'Email or password is incorrect.' });
    const down = fake({ signInWithPassword: vi.fn(async () => { throw new Error('Network request failed'); }) });
    const r = await signInWithEmail(down.client, 'a@b.co', GOOD_PW);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toContain('connection');
  });
});

describe('email sign-up', () => {
  it('enforces the password policy client-side and reports email confirmation', async () => {
    const { client, auth } = fake();
    expect((await signUpWithEmail(client, 'a@b.co', 'short', 'openstall://auth/callback')).ok).toBe(false);
    expect((await signUpWithEmail(client, 'a@b.co', 'Password123', 'openstall://auth/callback')).ok).toBe(false);
    expect(auth.signUp).not.toHaveBeenCalled();
    expect(await signUpWithEmail(client, 'a@b.co', GOOD_PW, 'openstall://auth/callback')).toEqual({ ok: true, needsEmailConfirmation: true });
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'a@b.co', password: GOOD_PW, options: { emailRedirectTo: 'openstall://auth/callback' } });
  });
  it('signed in immediately when confirmations are off', async () => {
    const { client } = fake({ signUp: vi.fn(async () => ({ data: { session: { x: 1 } }, error: null })) });
    expect(await signUpWithEmail(client, 'a@b.co', GOOD_PW, 'x')).toEqual({ ok: true, needsEmailConfirmation: false });
  });
});

describe('password reset / update', () => {
  it('answers identically for any valid email (no account enumeration) but surfaces rate limits', async () => {
    const { client } = fake();
    expect(await requestPasswordReset(client, 'a@b.co', 'x')).toEqual({ ok: true });
    const limited = fake({ resetPasswordForEmail: vi.fn(async () => ({ error: { status: 429 } })) });
    expect((await requestPasswordReset(limited.client, 'a@b.co', 'x')).ok).toBe(false);
    const other = fake({ resetPasswordForEmail: vi.fn(async () => ({ error: { message: 'User not found' } })) });
    expect(await requestPasswordReset(other.client, 'a@b.co', 'x')).toEqual({ ok: true });
    expect((await requestPasswordReset(client, 'bad', 'x')).ok).toBe(false);
  });
  it('validates a new password before sending it', async () => {
    const { client, auth } = fake();
    expect((await setNewPassword(client, 'short')).ok).toBe(false);
    expect(auth.updateUser).not.toHaveBeenCalled();
    expect(await setNewPassword(client, GOOD_PW)).toEqual({ ok: true });
  });
});

describe('callback handling (PKCE only)', () => {
  const code = 'abcdEFGH1234-_.~';
  it('exchanges a valid code and rejects tokens, errors, and foreign paths without calling the backend', async () => {
    const { client, auth } = fake();
    expect(await completeAuthCallback(client, `openstall://auth/callback?code=${code}`)).toEqual({ ok: true });
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith(code);
    for (const url of ['openstall://auth/callback#access_token=a&refresh_token=b', 'openstall://auth/callback?error=access_denied', 'openstall://other?code=' + code, 'garbage']) {
      expect((await completeAuthCallback(client, url)).ok).toBe(false);
    }
    expect((auth.exchangeCodeForSession as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
});

describe('Google', () => {
  it('native: opens the provider URL in an auth session, then exchanges the returned code', async () => {
    const { client, auth } = fake();
    const open = vi.fn(async () => ({ type: 'success', url: 'openstall://auth/callback?code=abcdEFGH1234' }));
    expect(await signInWithGoogleNative(client, 'openstall://auth/callback', open)).toEqual({ ok: true });
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'openstall://auth/callback', skipBrowserRedirect: true } });
    expect(open).toHaveBeenCalledWith('https://provider.test/auth', 'openstall://auth/callback');
    expect(auth.exchangeCodeForSession).toHaveBeenCalledWith('abcdEFGH1234');
  });
  it('native: a dismissed browser is a quiet cancel, not an error', async () => {
    const { client, auth } = fake();
    const r = await signInWithGoogleNative(client, 'x', async () => ({ type: 'cancel' }));
    expect(r).toMatchObject({ ok: false, cancelled: true });
    expect(auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });
  it('native: a disabled provider shows a friendly message', async () => {
    const { client } = fake({ signInWithOAuth: vi.fn(async () => ({ data: { url: null }, error: { code: 'provider_disabled' } })) });
    const r = await signInWithGoogleNative(client, 'x', vi.fn());
    expect(!r.ok && r.message).toContain('not available');
  });
  it('web: redirects without skipping the browser redirect', async () => {
    const { client, auth } = fake();
    await signInWithGoogleWeb(client, 'http://localhost:8081/auth/callback');
    expect(auth.signInWithOAuth).toHaveBeenCalledWith({ provider: 'google', options: { redirectTo: 'http://localhost:8081/auth/callback' } });
  });
});

describe('Apple', () => {
  const deps = (token: string | null = 'id-token') => ({
    randomHex: vi.fn(async () => 'raw-nonce'),
    sha256Hex: vi.fn(async (v: string) => `sha(${v})`),
    requestCredential: vi.fn(async () => ({ identityToken: token })),
  });
  it('sends the HASHED nonce to Apple and the RAW nonce to the backend', async () => {
    const { client, auth } = fake();
    const d = deps();
    expect(await signInWithApple(client, d)).toEqual({ ok: true });
    expect(d.requestCredential).toHaveBeenCalledWith('sha(raw-nonce)');
    expect(auth.signInWithIdToken).toHaveBeenCalledWith({ provider: 'apple', token: 'id-token', nonce: 'raw-nonce' });
  });
  it('handles cancel quietly and a missing token as an error without calling the backend', async () => {
    const { client, auth } = fake();
    const cancel = deps();
    cancel.requestCredential.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'ERR_REQUEST_CANCELED' }));
    expect(await signInWithApple(client, cancel)).toMatchObject({ ok: false, cancelled: true });
    expect((await signInWithApple(client, deps(null))).ok).toBe(false);
    expect(auth.signInWithIdToken).not.toHaveBeenCalled();
  });
});

describe('sign out', () => {
  it('signs out and reports failures generically', async () => {
    expect(await signOut(fake().client)).toEqual({ ok: true });
    const bad = fake({ signOut: vi.fn(async () => ({ error: { message: 'boom internal detail' } })) });
    const r = await signOut(bad.client);
    expect(!r.ok && r.message).not.toContain('internal');
  });
});
