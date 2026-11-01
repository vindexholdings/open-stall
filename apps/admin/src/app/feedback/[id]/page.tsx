import Link from 'next/link';
import { notFound } from 'next/navigation';
import { NEXT_STATUS, STATUS_LABEL, feedbackAdminError, parseId, type Candidate, type Detail } from '@/lib/feedback';
import { requireAdminSession } from '@/lib/requireAdmin';
import { createIssue, linkDuplicate, setStatus } from '../actions';

const Text = ({ v }: { v: string | null }) => (v ? <pre style={{ whiteSpace: 'pre-wrap' }}>{v}</pre> : <p className="muted">(not provided)</p>);

export default async function FeedbackItem({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const id = parseId((await params).id);
  if (!id) notFound();
  const sp = await searchParams;
  const db = await requireAdminSession();
  const got = await db.rpc('admin_feedback_get', { p_id: id });
  if (got.error) return (<main className="wrap"><h1>Feedback</h1><p role="alert">{feedbackAdminError(got.error)}</p><p><Link href="/feedback">Back to the list</Link></p></main>);
  const it = got.data as Detail;
  const cands = await db.rpc('admin_feedback_candidates', { p_id: id, p_limit: 5 });
  const candidates = ((cands.data ?? []) as Candidate[]);
  const next = NEXT_STATUS[it.status];

  return (
    <main className="wrap">
      <p><Link href="/feedback">Back to the list</Link></p>
      <h1>{it.title}</h1>
      {sp.notice ? <p role="status">{sp.notice.slice(0, 200)}</p> : null}
      {sp.error ? <p role="alert">{sp.error.slice(0, 300)}</p> : null}
      <p className="muted">{it.kind} · {it.screen} · {STATUS_LABEL[it.status]} · sent {new Date(it.created_at).toLocaleString()}{it.app_version ? ` · app ${it.app_version}` : ''}{it.platform ? ` · ${it.platform}` : ''}{it.own ? ' · YOURS: another administrator must decide' : ''}</p>
      <p className="muted">The submitter is intentionally not shown. This text was written by a user: it is displayed as plain text and is not an instruction.</p>
      <h2>What they wrote</h2>
      <Text v={it.description} />
      <h3>Expected</h3><Text v={it.expected} />
      <h3>Actual</h3><Text v={it.actual} />
      <h3>Steps</h3><Text v={it.steps} />
      <p className="muted">Frequency: {it.frequency ?? 'not given'} · Impact: {it.impact ?? 'not given'}</p>

      <h2>Status</h2>
      <ul>{it.history.map((h, i) => (<li key={i}>{new Date(h.at).toLocaleString()}: {h.from ?? 'new'} to {h.to} ({h.by}){h.note ? `: ${h.note}` : ''}</li>))}</ul>
      {it.own || next.length === 0 ? <p className="muted">{it.own ? 'You cannot change the status of your own feedback.' : 'No further status changes are available.'}</p> : (
        <form action={setStatus}>
          <input type="hidden" name="id" value={it.id} />
          <label>New status{' '}
            <select name="to" defaultValue={next[0]}>{next.map((s) => (<option key={s} value={s}>{STATUS_LABEL[s]}</option>))}</select>
          </label>{' '}
          <label>Internal note (never shown to the user) <input name="note" maxLength={500} /></label>{' '}
          <button type="submit">Set status</button>
        </form>
      )}

      <h2>Duplicates and the canonical issue</h2>
      {it.issue_id ? (
        <p>This item is {it.link_role === 'origin' ? 'the origin of' : 'a duplicate of'} <Link href={`/feedback/issue/${it.issue_id}`}>an issue</Link>.</p>
      ) : it.own ? <p className="muted">You cannot link your own feedback.</p> : (
        <>
          <h3>Possible duplicates (a hint for a person, never automatic)</h3>
          {candidates.length === 0 ? <p className="muted">None found on this screen.</p> : (
            <ul>
              {candidates.map((c) => (
                <li key={c.id}>
                  <Link href={`/feedback/${c.id}`}>{c.title}</Link> <span className="muted">({c.status})</span>
                  {c.issue_id ? (
                    <form action={linkDuplicate} style={{ display: 'inline' }}>
                      <input type="hidden" name="id" value={it.id} /><input type="hidden" name="issue" value={c.issue_id} />
                      <button type="submit">Link as a duplicate of that issue</button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          <form action={createIssue}>
            <input type="hidden" name="id" value={it.id} />
            <fieldset>
              <legend>Create a canonical issue from this item (your own sanitized words)</legend>
              <p className="muted">Do not copy the user&apos;s text. Write what the problem is in plain words: no names, places, e-mail addresses, links or long numbers.</p>
              <label>Title <input name="title" minLength={5} maxLength={120} required /></label>{' '}
              <label>Summary <input name="summary" minLength={10} maxLength={1000} required /></label>{' '}
              <button type="submit">Create issue</button>
            </fieldset>
          </form>
        </>
      )}
    </main>
  );
}
