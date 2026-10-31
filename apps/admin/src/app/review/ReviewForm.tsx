'use client';

import { CONDITION_OPTIONS, RESTROOM_TYPES, reviewOutcome, type ReviewableStatus, type ReviewInput } from '@open-stall/domain';
import { useState } from 'react';

type TriAnswer = 'yes' | 'no' | 'unknown';
export type FormDefaults = {
  key_required: TriAnswer;
  customers_only: TriAnswer;
  family_bathroom: TriAnswer;
  fee_required: TriAnswer;
  wheelchair_accessible: TriAnswer;
  gender_neutral: TriAnswer;
  baby_changing: TriAnswer;
  hot_water: TriAnswer;
  cold_water: TriAnswer;
  reviewer: string;
};

const TRI: { value: TriAnswer; label: string }[] = [
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' },
  { value: 'unknown', label: 'Unknown' },
];

function Tri({ name, label, defaultValue }: { name: string; label: string; defaultValue: TriAnswer }) {
  return (
    <fieldset className="row">
      <legend>{label}</legend>
      {TRI.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} value={o.value} defaultChecked={defaultValue === o.value} /> {o.label}
        </label>
      ))}
    </fieldset>
  );
}

export function ReviewForm({
  action, currentStatus, defaults, today, savingAvailable, detailsAvailable,
}: {
  action: (formData: FormData) => void | Promise<void>;
  currentStatus: ReviewableStatus;
  defaults: FormDefaults;
  today: string;
  savingAvailable: boolean;
  detailsAvailable: boolean;
}) {
  const [existence, setExistence] = useState<ReviewInput['existence'] | ''>('');
  const [personal, setPersonal] = useState(false);
  const [rating, setRating] = useState('');
  const [date, setDate] = useState(today);

  const preview = existence
    ? reviewOutcome(currentStatus, {
        reviewer: defaults.reviewer, existence, access: 'unknown', wheelchair_accessible: null, gender_neutral: null,
        baby_changing: null, hot_water: null, cold_water_only: null, notes: null,
        personally_verified: personal && existence === 'exists', verified_on: personal ? date : null,
      })
    : null;

  return (
    <form action={action} className="card form">
      <fieldset className="stack">
        <legend>1. Does the restroom exist?</legend>
        {([['exists', 'Yes, a restroom exists here'], ['not_exists', 'No, there is no restroom here (hide it)'], ['unsure', 'Unsure (record notes only)']] as const).map(([v, label]) => (
          <label key={v}>
            <input type="radio" name="existence" value={v} required checked={existence === v} onChange={() => setExistence(v)} /> {label}
          </label>
        ))}
      </fieldset>

      <fieldset className="stack">
        <legend>2. Access</legend>
        <input type="hidden" name="access_mode" value="independent" />
        <p>Select each requirement separately; more than one can apply.</p>
        <fieldset className="stack" disabled={!detailsAvailable}>
          <Tri name="customers_only" label="For customer use only" defaultValue={defaults.customers_only} />
        </fieldset>
        <Tri name="key_required" label="Key required" defaultValue={defaults.key_required} />
        <Tri name="fee_required" label="Restroom fee required" defaultValue={defaults.fee_required} />
      </fieldset>

      <div className="stack">
        <strong>3. Amenities</strong>
        <Tri name="wheelchair_accessible" label="Wheelchair accessible" defaultValue={defaults.wheelchair_accessible} />
        <Tri name="gender_neutral" label="Gender neutral" defaultValue={defaults.gender_neutral} />
        <fieldset className="stack" disabled={!detailsAvailable}>
          <Tri name="family_bathroom" label="Family bathroom" defaultValue={defaults.family_bathroom} />
        </fieldset>
        <Tri name="baby_changing" label="Baby changing" defaultValue={defaults.baby_changing} />
        <Tri name="hot_water" label="Hot water" defaultValue={defaults.hot_water} />
        <fieldset className="stack" disabled={!detailsAvailable}>
          <Tri name="cold_water" label="Cold water" defaultValue={defaults.cold_water} />
        </fieldset>
        <small>Pre-filled from what is stored (imported values may be OpenStreetMap-derived). What you save replaces them; Unknown becomes empty.</small>
      </div>

      {!detailsAvailable ? <p className="note warn" role="status">New review fields need the visit-details database update. You can still save the original review fields; the new fields are disabled until installed.</p> : null}
      <fieldset className="stack" disabled={!detailsAvailable}>
        <legend>4. Restroom reviewed</legend>
        <label>Restroom type
          <select name="restroom_type" defaultValue="unknown">
            {RESTROOM_TYPES.map((v) => <option key={v} value={v}>{({ unknown: 'Not specified', men: 'Men’s', women: 'Women’s', all_gender: 'All gender', family: 'Family', single_occupancy: 'Single occupancy' })[v]}</option>)}
          </select>
        </label>
        <small>Which restroom did you check on this visit? Family availability is recorded separately above.</small>
      </fieldset>

      <fieldset className="stack" disabled={!detailsAvailable}>
        <legend>5. Cleanliness and condition</legend>
        <label>Cleanliness score
          <select name="cleanliness_score" defaultValue="">
            <option value="">Not rated</option>
            <option value="1">1 — Very dirty</option><option value="2">2 — Needs cleaning</option>
            <option value="3">3 — Average</option><option value="4">4 — Clean</option><option value="5">5 — Very clean</option>
          </select>
        </label>
        {Object.entries(CONDITION_OPTIONS).map(([name, options]) => (
          <label key={name}>{({ seats: 'Toilet seats', mirrors: 'Mirrors', stall_doors: 'Stall doors', toilet_paper: 'Toilet paper', floor: 'Floor' } as Record<string, string>)[name]}
            <select name={name} defaultValue="unknown">
              {options.map((v) => <option key={v} value={v}>{({ unknown: 'Unknown', clean: 'Clean', dirty: 'Dirty', not_applicable: 'Not applicable', missing: 'No mirror', broken: 'Broken', working: 'Working', available: 'Available', out: 'Out of toilet paper' } as Record<string, string>)[v]}</option>)}
            </select>
          </label>
        ))}
        <Tri name="cleaning_log" label="Posted cleaning / inspection log" defaultValue="unknown" />
        <small>These describe this visit. They start unknown each time because conditions can change.</small>
      </fieldset>

      <fieldset className="stack" disabled={!detailsAvailable}>
        <legend>6. Review</legend>
        <fieldset className="row stars">
          <legend>Overall rating (optional)</legend>
          <label><input type="radio" name="rating" value="" checked={rating === ''} onChange={() => setRating('')} /> Not rated</label>
          {[1, 2, 3, 4, 5].map((n) => <label key={n} aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}><input type="radio" name="rating" value={n} checked={rating === String(n)} onChange={() => setRating(String(n))} /> <span aria-hidden="true">{'★'.repeat(n)}</span></label>)}
        </fieldset>
        <label className="stack">
          <strong>Public comment (optional)</strong>
          <textarea name="public_comment" rows={3} maxLength={1000} placeholder="What would help someone visiting this restroom?" />
        </label>
        <small>Shown with your username when public reviews launch. No photo or proof is required. Earlier private notes stay private.</small>
      </fieldset>
      <details>
        <summary>Private admin note (optional)</summary>
        <textarea name="notes" rows={2} maxLength={1000} aria-label="Private admin note" />
      </details>

      <div className="stack">
        <strong>7. Visit</strong>
        <label>
          <input type="checkbox" name="personally_verified" checked={personal} onChange={(e) => setPersonal(e.target.checked)} /> Visited in person
        </label>
        <label>
          Visit date <input type="date" name="verified_on" value={date} max={today} onChange={(e) => setDate(e.target.value)} disabled={!personal} />
        </label>
        <small>An in-person visit makes this Verified. Reviewing source information alone keeps it Unverified.</small>
      </div>

      <label className="stack">
        <strong>Username</strong>
        <input type="text" name="reviewer" defaultValue={defaults.reviewer} required maxLength={120} />
        <small>A display name for this review. Your review history is tied to your signed-in admin account.</small>
      </label>

      {preview && savingAvailable ? <p className={preview.status === 'verified' ? 'note good' : preview.publicAfter ? 'note warn' : 'note'} role="status"><strong>What saving does:</strong> {preview.message}</p> : null}
      {!savingAvailable ? <p className="note warn" role="status">Preview only. Nothing you enter is saved or marked Verified yet.</p> : null}
      <button type="submit" className="primary" disabled={!savingAvailable}>{savingAvailable ? 'Save review and go to next' : 'Saving unavailable'}</button>
    </form>
  );
}
