'use server';

import { parseLocationId, parseReviewDetails, parseReviewForm } from '@open-stall/domain';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { adminDb } from '@/lib/db';
import { getLocation, nextUnreviewed, parseView } from '@/lib/queue';
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

  const current = await getLocation(id);
  if (!current.loc) notFound();
  let error;
  if (current.detailsAvailable) {
    const details = parseReviewDetails(formData);
    if (!details.ok) redirect(`/review/${id}?view=${v}&error=${encodeURIComponent(details.errors.join(' '))}`);
    ({ error } = await adminDb().rpc('apply_location_review_v2', {
      p_location: id, p_reviewer: i.reviewer,
      // Display aliases may change; this stable local-admin identity does not.
      p_reviewer_identity: process.env.ADMIN_REVIEWER_ID || 'local-admin',
      p_existence: i.existence, p_personally_verified: i.personally_verified, p_verified_on: i.verified_on,
      p_answers: {
        key_required: i.key_required ?? null, fee_required: i.fee_required ?? null,
        wheelchair_accessible: i.wheelchair_accessible, gender_neutral: i.gender_neutral,
        baby_changing: i.baby_changing, hot_water: i.hot_water, notes: i.notes,
        ...details.details,
      },
    }));
  } else {
    if (['customers_only', 'family_bathroom', 'cold_water', 'restroom_type', 'rating', 'cleanliness_score', 'public_comment', 'cleaning_log'].some((key) => formData.has(key))) {
      redirect(`/review/${id}?view=${v}&error=${encodeURIComponent('The new review fields need the visit-details database update. Nothing was saved.')}`);
    }
    // Keep original saving operational until the additive migration is applied.
    ({ error } = await adminDb().rpc('apply_location_review', {
      p_location: id, p_reviewer: i.reviewer, p_existence: i.existence, p_access: 'independent',
      p_key_required: i.key_required ?? null, p_purchase_required: current.loc.purchase_required,
      p_fee_required: i.fee_required ?? null, p_wheelchair: i.wheelchair_accessible,
      p_gender_neutral: i.gender_neutral, p_baby_changing: i.baby_changing,
      p_hot_water: i.hot_water,
      p_cold_only: i.hot_water === false && current.loc.has_cold_water === true ? true : null,
      p_notes: i.notes, p_personally_verified: i.personally_verified, p_verified_on: i.verified_on,
    }));
  }

  if (error) {
    const missing = /apply_location_review|schema cache/i.test(error.message);
    const msg = missing
      ? 'The required review database update is not installed yet. Nothing was saved.'
      : `Could not save: ${error.message}`;
    redirect(`/review/${id}?view=${v}&error=${encodeURIComponent(msg)}`);
  }

  revalidatePath('/review');
  const next = await nextUnreviewed(v, id);
  redirect(next ? `/review/${next}?view=${v}&saved=1` : `/review?view=${v}&saved=1`);
}
