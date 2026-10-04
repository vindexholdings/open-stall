import 'server-only';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { evaluateAccess } from './gate';

/** Call at the top of EVERY admin page and server action. Responds 404 unless the gate passes. */
export async function requireAdmin(): Promise<void> {
  const h = await headers();
  const result = evaluateAccess({ env: process.env, host: h.get('host') });
  if (!result.ok) notFound();
}
