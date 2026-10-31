'use server';

import { parseLocationId, parseReviewDetails, parseReviewForm } from '@open-stall/domain';
import { revalidatePath } from 'next/cache';
import { notFound, redirect } from 'next/navigation';
import { adminErrorMessage } from '@/lib/moderation';
import { getLocation, nextUnreviewed, parseView } from '@/lib/queue';
import { requireAdminSession } from '@/lib/requireAdmin';

/**
 * Saves one review through the signed-in admin's own session. The database function re-checks admin + MFA,
 * records the real admin id as the reviewer identity and appends the audit row. Every call re-checks the session.
 */
export async function submitReview(locationId: string, view: string, formData: FormData): Promise<void> {
  const db = await requireAdminSession();
  const id = parseLocationId(locationId);
  if (!id) notFound();
  const v = parseView(view);
  const fail = (message: string): never => redirect(`/review/${id}?view=${v}&error=${encodeURIComponent(message)}`);

  const parsed = parseReviewForm(formData);
  if (!parsed.ok) fail(parsed.errors.join(' '));
  else {
    const i = parsed.input;
    let current;
    try {
      current = await getLocation(db, id);
    } catch (e) {
      return fail((e instanceof Error && e.message) || 'Could not load this location.');
    }
    if (!current.loc) notFound();
    const details = parseReviewDetails(formData);
    if (!details.ok) fail(details.errors.join(' '));
    else {
      const { error } = await db.rpc('admin_apply_location_review', {
        p_location: id, p_reviewer: i.reviewer,
        p_existence: i.existence, p_personally_verified: i.personally_verified, p_verified_on: i.verified_on,
        p_answers: {
          key_required: i.key_required ?? null, fee_required: i.fee_required ?? null,
          wheelchair_accessible: i.wheelchair_accessible, gender_neutral: i.gender_neutral,
          baby_changing: i.baby_changing, hot_water: i.hot_water, notes: i.notes,
          ...details.details,
        },
      });
      if (error) {
        const missing = /admin_apply_location_review|schema cache|could not find the function/i.test(error.message);
        fail(missing ? 'The required review database update is not installed yet. Nothing was saved.' : adminErrorMessage(error));
      }
    }
  }

  revalidatePath('/review');
  let next: string | null = null;
  try {
    next = await nextUnreviewed(db, v, id);
  } catch {
    // Saved; the list page will explain any later read problem.
  }
  redirect(next ? `/review/${next}?view=${v}&saved=1` : `/review?view=${v}&saved=1`);
}
