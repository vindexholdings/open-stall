import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CATEGORIES, PLATFORMS, PUBLICATION_LABEL, REPORT_OUTCOMES, eligibilityMessage, feedbackAdminError, parseId, parsePublication, type IssueView } from '@/lib/feedback';
import { requireAdminSession } from '@/lib/requireAdmin';
import { approveDraft, beginPublication, reportPublication, requestPublication, saveDraft } from '../../actions';

export default async function FeedbackIssue({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; notice?: string }> }) {
  const id = parseId((await params).id);
  if (!id) notFound();
  const sp = await searchParams;
  const db = await requireAdminSession();
  const got = await db.rpc('admin_feedback_issue_get', { p_issue: id });
  if (got.error) return (<main className="wrap"><h1>Issue</h1><p role="alert">{feedbackAdminError(got.error)}</p><p><Link href="/feedback">Back to the list</Link></p></main>);
  const issue = got.data as IssueView;
  const d = issue.latest_draft;
  // The export is requested only for a CURRENTLY eligible version; any refusal is shown, never swallowed.
  const preview = d?.eligible ? await db.rpc('admin_feedback_export_preview', { p_issue: id }) : null;
  const exp = (preview?.data ?? null) as { title: string; body: string; version: number; publication_key: string } | null;
  const previewError = preview?.error ? feedbackAdminError(preview.error) : null;
  const pubRes = d ? await db.rpc('admin_feedback_publication_get', { p_issue: id }) : null;
  const pub = parsePublication(pubRes?.data ?? null);
  const pubError = pubRes?.error ? feedbackAdminError(pubRes.error) : null;
  const inProgress = pub.status === 'awaiting_transfer' || pub.status === 'uncertain' || pub.status === 'conflict';
  const canRequest = Boolean(d?.eligible) && (pub.status === 'none' || pub.status === 'failed' || (pub.status === 'published' && pub.version !== d?.version));
  const ineligible = d?.approved && !d.eligible ? eligibilityMessage(d.block) ?? 'This version is approved, but it is not eligible for export right now.' : null;

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
      {d ? <p>Latest version: {d.version} · {d.approved ? (d.eligible ? 'APPROVED and eligible for export' : 'approved earlier, NOT eligible for export now') : 'not approved'}{d.author_is_me ? ' · you wrote it, so another administrator must approve it' : ''}</p> : <p className="muted">No draft yet.</p>}
      {ineligible ? <p role="alert">{ineligible}</p> : null}
      {previewError ? <p role="alert">{previewError}</p> : null}
      {d && d.approved && !d.eligible ? (
        <section aria-label="Approved version, no longer eligible">
          <h3>Exact text of version {d.version} (private to administrators, history only)</h3>
          <p><strong>{d.title}</strong></p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{d.body}</pre>
        </section>
      ) : null}
      {d && !d.approved ? (
        <section aria-label="Draft awaiting review">
          <h3>Exact text to review (version {d.version}, private to administrators)</h3>
          <p className="muted">This is the complete title and body that would become public. An automatic check removes links, e-mail addresses, numbers runs, coordinates and unusual characters, but it cannot recognize a personal name or a street address. Reading it is the review.</p>
          <p><strong>{d.title}</strong></p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{d.body}</pre>
          <form action={approveDraft}>
            <input type="hidden" name="issue" value={issue.id} /><input type="hidden" name="version" value={d.version} /><input type="hidden" name="hash" value={d.hash} />
            <label><input type="checkbox" name="reviewed" value="yes" required disabled={d.author_is_me} /> I read this exact text and it contains no personal information (names, places, accounts) or anything unsafe.</label>
            <button type="submit" disabled={d.author_is_me}>Approve version {d.version}</button>
          </form>
        </section>
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


      <section aria-label="Publication to GitHub">
        <h2>Publication to GitHub</h2>
        <p className="muted">
          This app holds no GitHub credential and never creates an issue. A person transfers the exact packet below through the existing authorized connector, to {pub.repo} only, and the result is
          verified here. A timeout is never proof that nothing was created: the state becomes uncertain and must be reconciled by the reference below before any retry. Publishing does not approve any work.
        </p>
        {pubError ? <p role="alert">{pubError}</p> : null}
        <p role="status">State: {PUBLICATION_LABEL[pub.status]}{pub.attempts ? ` · attempts: ${pub.attempts}` : ''}{pub.version ? ` · snapshot version ${pub.version}` : ''}</p>
        {pub.status === 'published' && pub.issue_url ? <p>GitHub issue {pub.issue_number} in {pub.repo} (verified read-back): {pub.issue_url}</p> : null}
        {pub.marker ? <p className="muted">Public reference: {pub.marker}</p> : null}
        {!d ? <p className="muted">Write and approve a sanitized draft first.</p> : null}
        {d && !d.eligible && pub.status !== 'published' ? <p className="muted">{eligibilityMessage(d.block) ?? 'Only a currently approved, eligible version can be requested.'}</p> : null}
        {pub.status === 'published' && d && pub.version !== d.version && !d.eligible ? <p className="muted">A newer version exists. Once an independent administrator approves it, it can be requested as an update of the same GitHub issue.</p> : null}
        {canRequest ? (
          <form action={requestPublication}>
            <input type="hidden" name="issue" value={issue.id} />
            <button type="submit">{pub.status === 'published' ? `Request an update of GitHub issue ${pub.issue_number}` : 'Request publication of the approved snapshot'}</button>
          </form>
        ) : null}
        {pub.status === 'ready' ? (
          <form action={beginPublication}>
            <input type="hidden" name="issue" value={issue.id} />
            <button type="submit">Prepare the transfer packet</button>
          </form>
        ) : null}
        {inProgress && pub.packet ? (
          <>
            <h3>Transfer packet (version {pub.packet.version}): {pub.packet.operation === 'update' ? `update GitHub issue ${pub.packet.issue_number}` : 'create a new issue'} in {pub.packet.repo}</h3>
            <p className="muted">Transfer exactly this title and body, unchanged. Do not add anything. Then paste back what GitHub shows now.</p>
            <p><strong>{pub.packet.title}</strong></p>
            <pre style={{ whiteSpace: 'pre-wrap' }}>{pub.packet.body}</pre>
            {pub.status !== 'conflict' ? null : <p role="alert">The last result could not be verified. Record verified evidence (or reconcile) to resolve it.</p>}
            <form action={reportPublication}>
              <input type="hidden" name="issue" value={issue.id} />
              <fieldset>
                <legend>Record the result</legend>
                <label>What happened{' '}<select name="outcome" defaultValue={pub.status === 'awaiting_transfer' ? (pub.packet.operation === 'update' ? 'updated' : 'created') : 'found'}>{REPORT_OUTCOMES.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}</select></label>
                <label>Repository <input name="repo" defaultValue={pub.repo} /></label>
                <label>Issue number <input name="number" inputMode="numeric" pattern="[0-9]*" /></label>
                <label>Read-back title <input name="rb_title" /></label>
                <label>Read-back body <textarea name="rb_body" rows={8} /></label>
                <button type="submit">Record result</button>
              </fieldset>
            </form>
          </>
        ) : null}
      </section>
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
