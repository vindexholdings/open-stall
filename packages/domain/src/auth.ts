/**
 * Pure account/auth rules shared by the app (and testable without a device).
 * Discovery is public; account features and contributions require sign-in.
 */
export const PUBLIC_FEATURES = ['discovery', 'map', 'filters', 'location-detail', 'navigation', 'offline-cache'] as const;
export const AUTH_REQUIRED_FEATURES = ['favorites', 'ratings', 'check-ins', 'submissions', 'reports', 'profile', 'premium'] as const;
export type PublicFeature = (typeof PUBLIC_FEATURES)[number];
export type AuthFeature = (typeof AUTH_REQUIRED_FEATURES)[number];

export function requiresAuth(feature: PublicFeature | AuthFeature): boolean {
  return (AUTH_REQUIRED_FEATURES as readonly string[]).includes(feature);
}

export const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 72; // bcrypt limit used by the auth backend
const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', 'qwerty123', 'qwertyuiop',
  'iloveyou1', 'letmein123', 'welcome123', 'admin1234', 'abc12345', '11111111', 'passw0rd', 'openstall',
]);

/** Returns an error message, or null when the email looks valid. The server remains the authority. */
export function validateEmail(email: string): string | null {
  const e = email.trim();
  if (e.length === 0) return 'Enter your email address.';
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) return 'Enter a valid email address.';
  return null;
}

/** Length-based policy (no composition rules), plus a small common-password check. */
export function validatePassword(password: string, email?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) return 'That password is too common. Choose something harder to guess.';
  if (email && lower === email.trim().toLowerCase()) return 'Your password cannot be your email address.';
  if (/^(.)\1+$/.test(password)) return 'Choose a password with more variety.';
  return null;
}

type AuthErrorLike = { message?: string; code?: string; status?: number } | null | undefined;

/**
 * Friendly, non-leaking message for an auth backend error. Never echoes raw backend text, and does
 * not reveal whether an email has an account.
 */
export function authErrorMessage(err: AuthErrorLike): string {
  const code = (err?.code ?? '').toLowerCase();
  const msg = (err?.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) return 'Email or password is incorrect.';
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) return 'Confirm your email first: check your inbox for the link.';
  if (code.includes('rate_limit') || err?.status === 429 || msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many attempts. Wait a few minutes and try again.';
  }
  if (code === 'weak_password' || msg.includes('password should')) return 'Choose a stronger password (at least 8 characters).';
  if (code === 'signup_disabled' || msg.includes('signups not allowed')) return 'New accounts are not available right now.';
  if (code === 'provider_disabled' || msg.includes('provider is not enabled')) return 'That sign-in method is not available yet.';
  if (msg.includes('network') || msg.includes('fetch')) return 'Could not reach the server. Check your connection and try again.';
  return 'Something went wrong. Please try again.';
}

/** Internal-path-only redirect target (prevents open redirects via a `next` parameter). */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 200) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.includes('\\') || /[\u0000-\u001f\u007f]/.test(next)) return fallback;
  if (next.startsWith('/auth/')) return fallback; // never bounce back into auth screens
  return next;
}

export type AuthCallback =
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

const CODE = /^[A-Za-z0-9._~-]{8,512}$/;

/**
 * Parses an auth return URL (custom scheme, Expo Go, or web). Accepts only the PKCE `code` on the
 * `auth/callback` path; token-in-fragment (implicit flow) responses are rejected.
 */
export function parseAuthCallback(url: string): AuthCallback {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return { kind: 'none' };
  }
  const path = `${u.host}${u.pathname}`.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!(path === 'auth/callback' || path.endsWith('/auth/callback'))) return { kind: 'none' };
  if (/access_token=|refresh_token=/.test(u.hash) || u.searchParams.has('access_token')) {
    return { kind: 'error', message: 'That sign-in link is not supported. Please try again.' };
  }
  if (u.searchParams.get('error') || u.searchParams.get('error_description')) {
    return { kind: 'error', message: 'Sign-in was cancelled or failed. Please try again.' };
  }
  const code = u.searchParams.get('code');
  if (code && CODE.test(code)) return { kind: 'code', code };
  return { kind: 'none' };
}
