'use server';

import { parseLocationId, parseReviewForm } from '@open-stall/domain';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { adminDb } from '@/lib/db';
import { nextUnreviewed, parseView } from '@/lib/queue';
import { requireAdmin } from '@/lib/requireAdmin';

/** Saves one review via the service-role-only database function. Every call re-checks the gate. */
export async function submitReview(locationId: string, view: string, formData: FormData): Promise<void> {
  await requireAdmin();
  const id = parseLocationId(locationId);
  if (!id) notFound();
  const v = parseView(view);

  const parsed = parseReviewForm(formData);
  if (!parsed.ok) redirect(`/review/${id}?view=${v}&error=${encodeURIComponent(parsed.errors.join(' '))}`);
  const i = parsed.input;

  const { error } = await adminDb().rpc('apply_location_review', {
    p_location: id,
    p_reviewer: i.reviewer,
    p_existence: i.existence,
    p_access: i.access,
    p_wheelchair: i.wheelchair_accessible,
    p_gender_neutral: i.gender_neutral,
    p_baby_changing: i.baby_changing,
    p_hot_water: i.hot_water,
    p_cold_only: i.cold_water_only,
    p_notes: i.notes,
    p_personally_verified: i.personally_verified,
    p_verified_on: i.verified_on,
  });
  if (error) {
    const missing = /apply_location_review|schema cache/i.test(error.message);
    const msg = missing
      ? 'The review function is not installed on the database yet (migration 20261005000001 awaits approval). Nothing was saved.'
      : `Could not save: ${error.message}`;
    redirect(`/review/${id}?view=${v}&error=${encodeURIComponent(msg)}`);
  }

  revalidatePath('/review');
  const next = await nextUnreviewed(v, id);
  redirect(next ? `/review/${next}?view=${v}&saved=1` : `/review?view=${v}&saved=1`);
}
