import { parseLocationId, type ReviewableStatus } from '@open-stall/domain';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getLocation, osmLink, parseView } from '@/lib/queue';
import { requireAdmin } from '@/lib/requireAdmin';
import { submitReview } from '../actions';
import { ReviewForm, type FormDefaults } from '../ReviewForm';

export const dynamic = 'force-dynamic';

const tri = (v: boolean | null) => (v === true ? 'yes' : v === false ? 'no' : 'unknown') as 'yes' | 'no' | 'unknown';

export default async function ReviewOne({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string; error?: string; saved?: string }>;
}) {
  await requireAdmin();
  const id = parseLocationId((await params).id);
  if (!id) notFound();
  const sp = await searchParams;
  const view = parseView(sp.view);
  let result;
  try {
    result = await getLocation(id);
  } catch (e) {
    return (
      <main className="wrap">
        <p className="note bad" role="alert">Could not read the database: {(e instanceof Error && e.message) || 'network error (is Supabase reachable?)'}.</p>
      </main>
    );
  }
  const loc = result.loc;
  if (!loc) notFound();
  if (loc.status === 'pending') notFound();

  const defaults: FormDefaults = {
    key_required: tri(loc.key_required),
    customers_only: tri(loc.customers_only ?? null),
    family_bathroom: tri(loc.family_bathroom ?? null),
    fee_required: tri(loc.fee_required),
    wheelchair_accessible: tri(loc.wheelchair_accessible),
    gender_neutral: tri(loc.gender_neutral),
    baby_changing: tri(loc.baby_changing),
    hot_water: tri(loc.has_hot_water),
    cold_water: tri(loc.has_cold_water),
    reviewer: process.env.ADMIN_REVIEWER_NAME ?? '',
  };
  const today = new Date().toISOString().slice(0, 10);
  const mapParams = new URLSearchParams({
    bbox: [Math.max(-180, loc.longitude - 0.004), Math.max(-90, loc.latitude - 0.003), Math.min(180, loc.longitude + 0.004), Math.min(90, loc.latitude + 0.003)].join(','),
    layer: 'mapnik', marker: `${loc.latitude},${loc.longitude}`,
  });
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?${mapParams}`;
  const primary = loc.location_sources.find((s) => s.is_primary) ?? loc.location_sources[0];
  const action = submitReview.bind(null, loc.id, view);

  return (
    <main className="wrap">
      <p><Link href={`/review?view=${view}`}>← Back to list</Link></p>
      <h1>{loc.name}</h1>
      {sp.saved ? <p className="note good" role="status">Saved. Here is the next unreviewed record.</p> : null}
      {!result.reviewsAvailable ? <p className="note warn">Nothing saved: review saving awaits database approval. This form is a preview; entering answers does not review or verify this location.</p> : null}
      {sp.error ? <p className="note bad" role="alert">{sp.error}</p> : null}

      <section className="card">
        <p>
          <span className={`badge ${loc.status === 'verified' ? 'good' : loc.status === 'unverified' ? 'warn' : ''}`}>{loc.status}</span>
          {loc.possible_duplicate_of ? <span className="badge warn">possible duplicate (resolve before publishing)</span> : null}
        </p>
        <iframe className="review-map" title={`Map showing ${loc.name}`} src={mapUrl} loading="lazy" referrerPolicy="no-referrer" />
        <p className="muted map-credit">Map © OpenStreetMap contributors</p>
        <details>
          <summary>Location and source details</summary>
        <p>{[loc.address_line, loc.city, loc.region, loc.postal_code].filter(Boolean).join(', ') || 'No address on file'}</p>
        <p className="muted">{loc.latitude}, {loc.longitude}</p>
        <p className="muted">Last verified: {loc.last_verified_at ?? 'never'} · evidence: {loc.restroom_evidence}</p>
        <details>
          <summary>Imported source data (preserved, never deleted)</summary>
          {loc.location_sources.map((s) => (
            <div key={`${s.source}/${s.source_reference}`} className="src">
              <strong>{s.source}</strong> {s.source_reference}{s.is_primary ? ' (primary)' : ''}
              {osmLink(s.source_reference) ? <> · <a href={osmLink(s.source_reference)!} target="_blank" rel="noreferrer">view on OSM</a></> : null}
              <div className="muted">{s.license}{s.attribution ? ` · ${s.attribution}` : ''}</div>
              {s.tags ? <pre>{JSON.stringify(s.tags, null, 1)}</pre> : null}
            </div>
          ))}
        </details>
        </details>
      </section>

      <ReviewForm action={action} currentStatus={loc.status as ReviewableStatus} defaults={defaults} today={today} savingAvailable={result.reviewsAvailable} detailsAvailable={result.detailsAvailable} />

      {loc.location_reviews.length > 0 ? (
        <section className="card">
          <h2>Review history</h2>
          <ul>
            {[...loc.location_reviews].sort((a, b) => b.created_at.localeCompare(a.created_at)).map((r) => (
              <li key={r.id}>
                {r.created_at.slice(0, 16).replace('T', ' ')} · {r.reviewer} · {r.existence}{r.personally_verified ? ` · visited ${r.verified_on}` : ''} → {r.resulting_status}
                {r.restroom_type && r.restroom_type !== 'unknown' ? ` · ${r.restroom_type.replaceAll('_', ' ')}` : ''}
                {r.rating ? <span aria-label={`${r.rating} stars`}> · {'★'.repeat(r.rating)}</span> : null}
                {r.cleanliness_score ? ` · cleanliness ${r.cleanliness_score}/5` : ''}
                {r.public_comment ? <p>Public comment: {r.public_comment}</p> : null}
                {r.conditions && Object.values(r.conditions).some((value) => value !== 'unknown') ? (
                  <details><summary>Visit conditions</summary><ul>
                    {Object.entries(r.conditions).filter(([, value]) => value !== 'unknown').map(([key, value]) => (
                      <li key={key}>{({ seats: 'Toilet seats', mirrors: 'Mirrors', stall_doors: 'Stall doors', toilet_paper: 'Toilet paper', floor: 'Floor' } as Record<string, string>)[key] ?? key}: {value?.replaceAll('_', ' ')}</li>
                    ))}
                  </ul></details>
                ) : null}
                {r.cleaning_log !== undefined && r.cleaning_log !== null ? <p>Posted cleaning / inspection log: {r.cleaning_log ? 'Yes' : 'No'}</p> : null}
                {r.notes ? <details><summary>Private admin note</summary><p>{r.notes}</p></details> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {primary ? null : <p className="muted">No source rows.</p>}
    </main>
  );
}
