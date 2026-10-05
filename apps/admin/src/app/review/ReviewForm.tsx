'use client';

import { reviewOutcome, type AccessChoice, type ReviewableStatus, type ReviewInput } from '@open-stall/domain';
import { useState } from 'react';

type TriAnswer = 'yes' | 'no' | 'unknown';
export type FormDefaults = {
  access: AccessChoice;
  wheelchair_accessible: TriAnswer;
  gender_neutral: TriAnswer;
  baby_changing: TriAnswer;
  hot_water: TriAnswer;
  cold_water_only: TriAnswer;
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
  action, currentStatus, defaults, today,
}: {
  action: (formData: FormData) => void | Promise<void>;
  currentStatus: ReviewableStatus;
  defaults: FormDefaults;
  today: string;
}) {
  const [existence, setExistence] = useState<ReviewInput['existence'] | ''>('');
  const [personal, setPersonal] = useState(false);
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
        {([['public_free', 'Public / free'], ['customers_only', 'Customers only / purchase required'], ['key_required', 'Key required'], ['unknown', 'Unknown']] as const).map(([v, label]) => (
          <label key={v}>
            <input type="radio" name="access" value={v} defaultChecked={defaults.access === v} required /> {label}
          </label>
        ))}
      </fieldset>

      <div className="stack">
        <strong>3. Amenities</strong>
        <Tri name="wheelchair_accessible" label="Wheelchair accessible" defaultValue={defaults.wheelchair_accessible} />
        <Tri name="gender_neutral" label="Gender neutral" defaultValue={defaults.gender_neutral} />
        <Tri name="baby_changing" label="Baby changing" defaultValue={defaults.baby_changing} />
        <Tri name="hot_water" label="Hot water" defaultValue={defaults.hot_water} />
        <Tri name="cold_water_only" label="Cold water only" defaultValue={defaults.cold_water_only} />
        <small>Pre-filled from what is stored (imported values may be OpenStreetMap-derived). What you save replaces them; Unknown becomes empty.</small>
      </div>

      <label className="stack">
        <strong>4. Notes (private, optional)</strong>
        <textarea name="notes" rows={3} maxLength={1000} />
      </label>

      <div className="stack">
        <strong>5. Verification</strong>
        <label>
          <input type="checkbox" name="personally_verified" checked={personal} onChange={(e) => setPersonal(e.target.checked)} /> I personally verified this restroom
        </label>
        <label>
          Verification date <input type="date" name="verified_on" value={date} max={today} onChange={(e) => setDate(e.target.value)} disabled={!personal} />
        </label>
        <small>Leave unticked unless you have personal, direct knowledge. Only a ticked box plus a date makes it Verified.</small>
      </div>

      <label className="stack">
        <strong>Reviewer</strong>
        <input type="text" name="reviewer" defaultValue={defaults.reviewer} required maxLength={120} />
      </label>

      {preview ? <p className={preview.status === 'verified' ? 'note good' : preview.publicAfter ? 'note warn' : 'note'} role="status"><strong>What saving does:</strong> {preview.message}</p> : null}
      <button type="submit" className="primary">Save review and go to next</button>
    </form>
  );
}
