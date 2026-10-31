import { authErrorMessage, parseAuthCallback, validateEmail, validatePassword } from '@open-stall/domain';

type ErrLike = { message?: string; code?: string; status?: number } | null;
type Res<D = unknown> = Promise<{ data: D; error: ErrLike }>;

/** The subset of the Supabase auth client we use (keeps this layer testable and swappable). */
export interface AuthClientLike {
  auth: {
    signInWithPassword(c: { email: string; password: string }): Res<{ session: unknown | null }>;
    signUp(c: { email: string; password: string; options?: { emailRedirectTo?: string } }): Res<{ session: unknown | null }>;
    signOut(): Promise<{ error: ErrLike }>;
    resetPasswordForEmail(email: string, o?: { redirectTo?: string }): Promise<{ error: ErrLike }>;
    updateUser(a: { password: string }): Promise<{ error: ErrLike }>;
    signInWithOAuth(c: { provider: 'google'; options: { redirectTo: string; skipBrowserRedirect?: boolean } }): Res<{ url: string | null }>;
    exchangeCodeForSession(code: string): Promise<{ error: ErrLike }>;
    signInWithIdToken(c: { provider: 'apple'; token: string; nonce?: string }): Promise<{ error: ErrLike }>;
  };
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; message: string; cancelled?: boolean };
const fail = (message: string): { ok: false; message: string } => ({ ok: false, message });
const fromError = (e: ErrLike) => fail(authErrorMessage(e));

/** Wraps a call so thrown network errors become friendly messages instead of crashes. */
async function guard<R extends { ok: boolean }>(run: () => Promise<R>): Promise<R | { ok: false; message: string }> {
  try {
    return await run();
  } catch (e) {
    return fromError({ message: e instanceof Error ? e.message : String(e) });
  }
}

export const signInWithEmail = (c: AuthClientLike, email: string, password: string): Promise<Result> =>
  guard(async () => {
    const bad = validateEmail(email);
    if (bad) return fail(bad);
    if (password.length === 0) return fail('Enter your password.');
    const { data, error } = await c.auth.signInWithPassword({ email: email.trim(), password });
    if (error) return fromError(error);
    return data.session ? { ok: true } : fail('Something went wrong. Please try again.');
  });

/** `needsEmailConfirmation` is true when the backend requires the emailed link before sign-in. */
export const signUpWithEmail = (c: AuthClientLike, email: string, password: string, redirectTo: string): Promise<Result<{ needsEmailConfirmation: boolean }>> =>
  guard(async () => {
    const badEmail = validateEmail(email);
    if (badEmail) return fail(badEmail);
    const badPassword = validatePassword(password, email);
    if (badPassword) return fail(badPassword);
    const { data, error } = await c.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo } });
    if (error) return fromError(error);
    return { ok: true, needsEmailConfirmation: !data.session };
  });

/** Always reports the same success wording so the response never reveals whether an account exists. */
export const requestPasswordReset = (c: AuthClientLike, email: string, redirectTo: string): Promise<Result> =>
  guard(async () => {
    const bad = validateEmail(email);
    if (bad) return fail(bad);
    const { error } = await c.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    if (error && (error.status === 429 || /rate/i.test(`${error.code} ${error.message}`))) return fromError(error);
    return { ok: true };
  });

export const setNewPassword = (c: AuthClientLike, password: string): Promise<Result> =>
  guard(async () => {
    const bad = validatePassword(password);
    if (bad) return fail(bad);
    const { error } = await c.auth.updateUser({ password });
    return error ? fromError(error) : { ok: true };
  });

export const signOut = (c: AuthClientLike): Promise<Result> =>
  guard(async () => {
    const { error } = await c.auth.signOut();
    return error ? fromError(error) : { ok: true };
  });

/** Completes a PKCE sign-in from a return URL (OAuth or emailed link). Rejects anything unexpected. */
export const completeAuthCallback = (c: AuthClientLike, url: string): Promise<Result> =>
  guard(async () => {
    const parsed = parseAuthCallback(url);
    if (parsed.kind === 'error') return fail(parsed.message);
    if (parsed.kind === 'none') return fail('That sign-in link is not valid. Please try again.');
    const { error } = await c.auth.exchangeCodeForSession(parsed.code);
    return error ? fromError(error) : { ok: true };
  });

export type OpenAuthSession = (url: string, redirectTo: string) => Promise<{ type: string; url?: string }>;

/** Native Google sign-in: system browser session, then PKCE code exchange. */
export const signInWithGoogleNative = (c: AuthClientLike, redirectTo: string, open: OpenAuthSession): Promise<Result> =>
  guard(async () => {
    const { data, error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo, skipBrowserRedirect: true } });
    if (error || !data.url) return fromError(error);
    const result = await open(data.url, redirectTo);
    if (result.type !== 'success' || !result.url) return { ok: false, message: 'Sign-in was cancelled.', cancelled: true };
    return completeAuthCallback(c, result.url);
  });

/** Web Google sign-in: full-page redirect to the provider; the session is picked up on return. */
export const signInWithGoogleWeb = (c: AuthClientLike, redirectTo: string): Promise<Result> =>
  guard(async () => {
    const { error } = await c.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } });
    return error ? fromError(error) : { ok: true };
  });

export interface AppleDeps {
  randomHex(): Promise<string>;
  sha256Hex(value: string): Promise<string>;
  requestCredential(hashedNonce: string): Promise<{ identityToken: string | null }>;
}

/** Native Sign in with Apple: nonce-bound identity token exchanged with the auth backend. */
export const signInWithApple = (c: AuthClientLike, d: AppleDeps): Promise<Result> =>
  guard(async () => {
    const rawNonce = await d.randomHex();
    const hashed = await d.sha256Hex(rawNonce);
    let credential;
    try {
      credential = await d.requestCredential(hashed);
    } catch (e) {
      if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return { ok: false, message: 'Sign-in was cancelled.', cancelled: true };
      throw e;
    }
    if (!credential.identityToken) return fail('Apple did not return a sign-in token. Please try again.');
    const { error } = await c.auth.signInWithIdToken({ provider: 'apple', token: credential.identityToken, nonce: rawNonce });
    return error ? fromError(error) : { ok: true };
  });
