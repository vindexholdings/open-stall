/**
 * Project guards for the admin app. Authorization itself is the signed-in admin's session plus the
 * database (admin_users membership and an MFA/aal2 session, re-checked inside every admin function);
 * see requireAdmin.ts. These helpers only keep the app from talking to the wrong Supabase project.
 */
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
