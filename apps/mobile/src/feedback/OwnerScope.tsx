import { Fragment, type ReactNode } from 'react';
import { useAuth } from '../auth/AuthProvider';

/**
 * Private feedback screens belong to ONE account. The subtree is keyed by the signed-in account's private identity (never rendered or logged), so when
 * the account changes - a direct A -> B replacement, sign-out and sign-in, another tab - React discards the whole subtree in the same render: no old
 * title, status, description, cursor, error, draft, retry key, busy or completion state can be shown to, or acted on by, the next account.
 * A refresh of the SAME account's token does not change the key, so it causes no reset and no new request.
 */
export function OwnerScope({ children, scope = '' }: { children: ReactNode; scope?: string }) {
  const { userId } = useAuth();
  return <Fragment key={`${userId ?? 'none'}:${scope}`}>{children}</Fragment>;
}
