import Link from 'next/link';
import { listView, osmLink, parseView, viewCounts, VIEWS } from '@/lib/queue';
import { requireAdminSession } from '@/lib/requireAdmin';

export const dynamic = 'force-dynamic';

export default async function ReviewList({ searchParams }: { searchParams: Promise<{ view?: string; saved?: string }> }) {
  const db = await requireAdminSession();
  const sp = await searchParams;
  const view = parseView(sp.view);
  let counts, list;
  try {
    [counts, list] = await Promise.all([viewCounts(db), listView(db, view)]);
  } catch (e) {
    return (
      <main className="wrap">
        <h1>Validate seeded locations</h1>
        <p className="note bad" role="alert">Could not load the seeded locations: {(e instanceof Error && e.message) || 'network error (is Supabase reachable?)'}. Check apps/admin/.env.local and your connection.</p>
      </main>
    );
  }
  const rows = list.rows;
  const active = VIEWS.find((v) => v.key === view)!;

  return (
    <main className="wrap">
      <h1>Validate seeded locations</h1>
      <p className="muted">Signed-in administrators only (account + second factor). Nothing becomes Verified unless you say so. <Link href="/queue">Community review queue</Link></p>
      {sp.saved ? <p className="note good" role="status">Saved. {rows.some((r) => r.location_reviews.length === 0) ? 'Next unreviewed record is below.' : 'All records in this view are reviewed.'}</p> : null}
      <nav className="tabs" aria-label="Views">
        {VIEWS.map((v) => (
          <Link key={v.key} href={`/review?view=${v.key}`} className={v.key === view ? 'tab active' : 'tab'} aria-current={v.key === view ? 'page' : undefined}>
            {v.label} ({counts[v.key]})
          </Link>
        ))}
      </nav>
      <p className="muted">{active.hint}</p>
      <table className="table">
        <thead>
          <tr><th>Name</th><th>Address</th><th>Source</th><th>Reviewed</th><th /></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const src = r.location_sources.find((s) => s.is_primary) ?? r.location_sources[0];
            const link = src ? osmLink(src.source_reference) : null;
            return (
              <tr key={r.id}>
                <td><strong>{r.name}</strong>{r.possible_duplicate_of ? <span className="badge warn">possible duplicate</span> : null}</td>
                <td>{[r.address_line, r.city].filter(Boolean).join(', ') || <span className="muted">no address</span>}</td>
                <td>{src ? <>{src.source}{link ? <> · <a href={link} target="_blank" rel="noreferrer">OSM</a></> : null}{src.tags?.amenity ? <span className="muted"> · {src.tags.amenity}{src.tags.shop ? `/${src.tags.shop}` : ''}</span> : null}</> : <span className="muted">none</span>}</td>
                <td>{r.location_reviews.length > 0 ? <span className="badge good">{r.location_reviews.length}×</span> : <span className="muted">not yet</span>}</td>
                <td><Link href={`/review/${r.id}?view=${view}`} className="primary link">Review</Link></td>
              </tr>
            );
          })}
          {rows.length === 0 ? <tr><td colSpan={5} className="muted">Nothing in this view.</td></tr> : null}
        </tbody>
      </table>
    </main>
  );
}
