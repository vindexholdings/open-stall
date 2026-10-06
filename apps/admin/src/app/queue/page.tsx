import { redirect } from 'next/navigation';
import { adminAccess, adminErrorMessage, REJECTION_REASONS, type AdminStatus } from '@/lib/moderation';
import { sessionClient } from '@/lib/supabase/server';
import { decideSubmission, resolveReport, signOutAdmin } from './actions';

type Item = {
  id: string; kind: 'new_location' | 'edit_location'; location_id: string | null; location_name: string | null;
  proposed: Record<string, unknown>; note: string | null; flags: string[]; possible_duplicate_of: string | null;
  duplicate_submission_ids: string[]; capture_accuracy_m: number | null; created_at: string; held: boolean; is_mine: boolean;
  decisions: { decision: string; reason_code: string | null; note: string | null; at: string }[];
};
type Report = { id: string; location_id: string; location_name: string | null; issue_type: string; comment: string | null; created_at: string; is_mine: boolean };

export default async function Queue({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const { error, notice } = await searchParams;
  const supabase = await sessionClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) redirect('/signin');

  const status = await supabase.rpc('am_i_admin');
  const access = adminAccess(true, (status.data ?? null) as AdminStatus);
  if (access === 'needs_mfa') redirect('/mfa');
  if (access !== 'ok') {
    return (
      <main className="wrap">
        <h1>Not authorized</h1>
        <p>This account is not an administrator.</p>
        <form action={signOutAdmin}><button type="submit">Sign out</button></form>
      </main>
    );
  }

  const [subs, reps] = await Promise.all([supabase.rpc('admin_list_submissions', { p_limit: 50 }), supabase.rpc('admin_list_reports', { p_limit: 50 })]);
  const loadError = subs.error ?? reps.error;
  const items = (subs.data ?? []) as Item[];
  const reports = (reps.data ?? []) as Report[];

  return (
    <main className="wrap">
      <h1>Review queue</h1>
      <form action={signOutAdmin}><button type="submit">Sign out</button></form>
      {notice ? <p role="status">{notice.slice(0, 200)}</p> : null}
      {error ? <p role="alert">{error.slice(0, 300)}</p> : null}
      {loadError ? <p role="alert">{adminErrorMessage(loadError)}</p> : null}

      <h2>Submissions ({items.length})</h2>
      {items.length === 0 ? <p className="muted">Nothing waiting.</p> : null}
      {items.map((it) => (
        <section key={it.id} style={{ borderTop: '1px solid #ccc', paddingTop: 12, marginTop: 12 }}>
          <h3>
            {it.kind === 'new_location' ? 'New restroom' : `Correction to ${it.location_name ?? 'a restroom'}`}
            {it.held ? ' (ON HOLD)' : ''}{it.is_mine ? ' (yours: another admin must decide)' : ''}
          </h3>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(it.proposed, null, 2)}</pre>
          {it.note ? <p>Contributor note: {it.note}</p> : null}
          <p className="muted">
            Submitted {new Date(it.created_at).toLocaleString()}
            {it.capture_accuracy_m ? ` · GPS accuracy ${Math.round(it.capture_accuracy_m)} m` : ''}
            {it.flags.length ? ` · flags: ${it.flags.join(', ')}` : ''}
            {it.possible_duplicate_of ? ` · possible duplicate of ${it.possible_duplicate_of}` : ''}
            {it.duplicate_submission_ids.length ? ` · similar pending: ${it.duplicate_submission_ids.length}` : ''}
          </p>
          {it.decisions.length ? <ul>{it.decisions.map((d) => <li key={d.at}>{d.decision}{d.note ? `: ${d.note}` : ''} ({new Date(d.at).toLocaleString()})</li>)}</ul> : null}
          {it.is_mine ? null : (
            <form action={decideSubmission}>
              <input type="hidden" name="id" value={it.id} />
              <fieldset>
                <legend>Decision</legend>
                <label>Note <input name="note" maxLength={1000} /></label>
                <label>Rejection reason{' '}
                  <select name="reason" defaultValue="">
                    <option value="">(only for reject)</option>
                    {REJECTION_REASONS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
                  </select>
                </label>
                <label>Duplicate of (restroom id) <input name="duplicate_of" /></label>
                <details>
                  <summary>Edit before approving</summary>
                  {['name', 'address_line', 'city', 'region', 'postal_code', 'access_location', 'opening_hours'].map((f) => (
                    <label key={f}>{f} <input name={`edit_${f}`} /></label>
                  ))}
                </details>
                <button name="decision" value="approve">Approve (public, unverified)</button>
                <button name="decision" value="edit_approve">Edit &amp; approve</button>
                <button name="decision" value="reject">Reject</button>
                <button name="decision" value="duplicate">Mark duplicate</button>
                {it.held ? <button name="decision" value="release">Release hold</button> : <button name="decision" value="hold">Hold</button>}
              </fieldset>
            </form>
          )}
        </section>
      ))}

      <h2>Reports ({reports.length})</h2>
      {reports.length === 0 ? <p className="muted">No open reports.</p> : null}
      {reports.map((r) => (
        <section key={r.id} style={{ borderTop: '1px solid #ccc', paddingTop: 12, marginTop: 12 }}>
          <h3>{r.issue_type.replace(/_/g, ' ')} — {r.location_name ?? r.location_id}{r.is_mine ? ' (yours)' : ''}</h3>
          {r.comment ? <p>{r.comment}</p> : null}
          <p className="muted">{new Date(r.created_at).toLocaleString()}</p>
          {r.is_mine ? null : (
            <form action={resolveReport}>
              <input type="hidden" name="id" value={r.id} />
              <label>Note <input name="note" maxLength={1000} /></label>
              <button name="resolution" value="resolved">Resolved</button>
              <button name="resolution" value="dismissed">Dismiss</button>
            </form>
          )}
        </section>
      ))}
    </main>
  );
}
