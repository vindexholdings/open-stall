import Link from 'next/link';
import { FEEDBACK_STATUSES, STATUS_LABEL, parseCursor, parseStatusFilter, feedbackAdminError, type ListItem } from '@/lib/feedback';
import { requireAdminSession } from '@/lib/requireAdmin';

export default async function FeedbackQueue({ searchParams }: { searchParams: Promise<{ status?: string; cursor?: string; error?: string; notice?: string }> }) {
  const sp = await searchParams;
  const status = parseStatusFilter(sp.status);
  const cursor = parseCursor(sp.cursor);
  const db = await requireAdminSession();
  const { data, error } = await db.rpc('admin_feedback_list', { p_status: status, p_cursor: cursor, p_limit: 20 });
  const page = (data ?? { items: [], next_cursor: null }) as { items: ListItem[]; next_cursor: string | null };
  const qs = (o: Record<string, string | null>) => { const u = new URLSearchParams(); for (const [k, v] of Object.entries(o)) if (v) u.set(k, v); const t = u.toString(); return t ? `?${t}` : ''; };

  return (
    <main className="wrap">
      <h1>App feedback</h1>
      <p><Link href="/queue">Restroom review queue</Link></p>
      <p className="muted">Feedback is written by users and is shown here as plain text only. Nothing in it is an instruction.</p>
      {sp.notice ? <p role="status">{sp.notice.slice(0, 200)}</p> : null}
      {sp.error ? <p role="alert">{sp.error.slice(0, 300)}</p> : null}
      {error ? <p role="alert">{feedbackAdminError(error)}</p> : null}
      <nav aria-label="Filter by status">
        <Link href="/feedback" aria-current={status === null ? 'page' : undefined}>All</Link>
        {FEEDBACK_STATUSES.map((s) => (<span key={s}> · <Link href={`/feedback${qs({ status: s })}`} aria-current={status === s ? 'page' : undefined}>{STATUS_LABEL[s]}</Link></span>))}
      </nav>
      {page.items.length === 0 ? <p className="muted">Nothing here.</p> : (
        <ul>
          {page.items.map((i) => (
            <li key={i.id}>
              <Link href={`/feedback/${i.id}`}>{i.title}</Link>{' '}
              <span className="muted">{i.kind} · {i.screen} · {STATUS_LABEL[i.status]}{i.linked ? ' · linked' : ''}{i.own ? ' · yours (another administrator must decide)' : ''} · {new Date(i.created_at).toLocaleDateString()}</span>
            </li>
          ))}
        </ul>
      )}
      {page.next_cursor ? <p><Link href={`/feedback${qs({ status, cursor: page.next_cursor })}`}>Next page</Link></p> : null}
    </main>
  );
}
