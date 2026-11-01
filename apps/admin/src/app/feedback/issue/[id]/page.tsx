import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CATEGORIES, PLATFORMS, feedbackAdminError, parseId, type IssueView } from '@/lib/feedback';
import { requireAdminSession } from '@/lib/requireAdmin';
import { approveDraft, saveDraft } from '../../actions';

export default async function FeedbackIssue({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const id = parseId((await params).id);
  if (!id) notFound();
  const sp = await searchParams;
  const db = await requireAdminSession();
  const got = await db.rpc('admin_feedback_issue_get', { p_issue: id });
  if (got.error) return (<main className="wrap"><h1>Issue</h1><p role="alert">{feedbackAdminError(got.error)}</p><p><Link href="/feedback">Back to the list</Link></p></main>);
  const issue = got.data as IssueView;
  const d = issue.latest_draft;
  const preview = d?.approved ? await db.rpc('admin_feedback_export_preview', { p_issue: id }) : null;
  const exp = (preview?.data ?? null) as { title: string; body: string; version: number; publication_key: string } | null;

  return (
    <main className="wrap">
      <p><Link href="/feedback">Back to the list</Link></p>
      <h1>{issue.title}</h1>
      {sp.notice ? <p role="status">{sp.notice.slice(0, 200)}</p> : null}
      {sp.error ? <p role="alert">{sp.error.slice(0, 300)}</p> : null}
      <p>{issue.summary}</p>
      <p className="muted">Covers {issue.items} feedback item(s). No submitter or raw user text is stored on an issue.</p>

      <h2>Sanitized publication draft</h2>
      <p className="muted">A fixed template of allowlisted fields written in your own words. An edit is a NEW version and must be approved again by a different administrator. Nothing is sent anywhere from here.</p>
      {d ? <p>Latest version: {d.version} · {d.approved ? 'APPROVED' : 'not approved'}{d.author_is_me ? ' · you wrote it, so another administrator must approve it' : ''}</p> : <p className="muted">No draft yet.</p>}
      {d && !d.approved ? (
        <form action={approveDraft}>
          <input type="hidden" name="issue" value={issue.id} /><input type="hidden" name="version" value={d.version} /><input type="hidden" name="hash" value={d.hash} />
          <button type="submit" disabled={d.author_is_me}>Approve version {d.version}</button>
        </form>
      ) : null}
      <form action={saveDraft}>
        <input type="hidden" name="issue" value={issue.id} />
        <fieldset>
          <legend>New draft version</legend>
          <label>Title <input name="title" minLength={5} maxLength={100} required defaultValue={issue.title.slice(0, 100)} /></label>
          <label>Category{' '}<select name="category" defaultValue="bug">{CATEGORIES.map((c) => (<option key={c.value} value={c.value}>{c.label}</option>))}</select></label>
          <label>Problem (your words) <textarea name="problem" minLength={10} maxLength={300} required /></label>
          <label>Safe steps to reproduce (optional) <textarea name="repro" maxLength={500} /></label>
          <label>Expected and actual (optional) <textarea name="expected_actual" maxLength={300} /></label>
          <label>Platform{' '}<select name="platform" defaultValue=""><option value="">(unknown)</option>{PLATFORMS.map((p) => (<option key={p} value={p}>{p}</option>))}</select></label>
          <label>App version (optional) <input name="app_version" pattern="[0-9]{1,3}(\.[0-9]{1,3}){0,3}" /></label>
          <label>Acceptance hint (optional) <textarea name="hint" maxLength={300} /></label>
          <button type="submit">Save as a new version</button>
        </fieldset>
      </form>

      {exp ? (
        <section aria-label="Approved export preview">
          <h2>Approved preview (version {exp.version})</h2>
          <p className="muted">This exact text is eligible to be copied into a reviewed GitHub issue by hand. The private publication key is {exp.publication_key}. No GitHub credential exists in this app and nothing is created automatically.</p>
          <h3>{exp.title}</h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{exp.body}</pre>
        </section>
      ) : null}
    </main>
  );
}
