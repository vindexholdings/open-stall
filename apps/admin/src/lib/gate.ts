/**
 * Access gate for the admin/validator pages. Until real admin authorization exists (backlog
 * OS-301: Supabase Auth + independent admin check), these pages work ONLY on a developer's own
 * machine: explicit opt-in env, never on Vercel, and only for localhost Host headers. Every page
 * and action calls requireAdmin(), so replacing this one function later upgrades them all.
 */
export type GateInput = { env: Record<string, string | undefined>; host: string | null };
export type GateResult = { ok: true } | { ok: false; reason: string };

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d{1,5})?$/i;

export function evaluateAccess({ env, host }: GateInput): GateResult {
  if (env.ADMIN_LOCAL_ONLY !== 'true') return { ok: false, reason: 'ADMIN_LOCAL_ONLY is not enabled' };
  if (env.VERCEL || env.VERCEL_ENV || env.VERCEL_URL) return { ok: false, reason: 'hosted deployments are disabled until admin authorization exists' };
  if (!host || !LOCAL_HOST.test(host)) return { ok: false, reason: 'only localhost may use the validator' };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return { ok: false, reason: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required (apps/admin/.env.local)' };
  return { ok: true };
}

export function projectRefFromUrl(url: string): string {
  const m = /^([a-z0-9]+)\.supabase\.co$/.exec(new URL(url).hostname);
  if (!m?.[1]) throw new Error('SUPABASE_URL is not a hosted Supabase URL');
  return m[1];
}

export function parseEnvironmentRef(environmentMd: string): string | null {
  return /^Project ref:\s*([a-z0-9]+)/im.exec(environmentMd)?.[1] ?? null;
}

/** Refuses to talk to any project other than the one recorded in ENVIRONMENT.md. */
export function assertExpectedProject(url: string, environmentMd: string): string {
  const ref = projectRefFromUrl(url);
  const recorded = parseEnvironmentRef(environmentMd);
  if (!recorded) throw new Error('ENVIRONMENT.md has no "Project ref:"; refusing to connect');
  if (ref !== recorded) throw new Error(`SUPABASE_URL project (${ref}) does not match ENVIRONMENT.md (${recorded}); refusing to connect`);
  return ref;
}

/**
 * Session-client guard. Normally identical to assertExpectedProject. For local browser tests ONLY, a
 * loopback backend is allowed when ADMIN_ALLOW_LOCAL_BACKEND=true; any hosted URL must still match ENVIRONMENT.md.
 */
export function assertSessionBackend(url: string, environmentMd: string, env: Record<string, string | undefined>): void {
  const host = new URL(url).hostname;
  if (env.ADMIN_ALLOW_LOCAL_BACKEND === 'true' && (host === '127.0.0.1' || host === 'localhost')) return;
  assertExpectedProject(url, environmentMd);
}
