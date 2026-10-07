-- Phase 3A: moderation core. Immutable original submissions, append-only decisions with reviewer
-- provenance, hold / duplicate / reject / approve / edit-and-approve, report resolution, and account
-- deletion that keeps moderated evidence while severing the contributor's identity.
--
-- Owner decisions encoded here (HANDOFF.md): approval may publish a restroom but it stays UNVERIFIED
-- (approval != verification); held items stay `pending` so they keep counting toward pending caps;
-- duplicate is its own resolution and never a rejection reason; admins cannot adjudicate their own
-- submissions or reports; every admin function needs admin_users membership AND an MFA (aal2) session.

-- ---------------------------------------------------------------- submissions: provenance columns
alter table public.submissions
  add column held_at timestamptz,
  -- Plain ids (no FK) so that deleting a location never rewrites decided history.
  add column result_location_id uuid;

alter table public.submissions drop constraint submissions_status_check;
alter table public.submissions add constraint submissions_status_check
  check (status in ('pending', 'approved', 'rejected', 'duplicate'));
alter table public.submissions add constraint submissions_hold_only_pending check (held_at is null or status = 'pending');

-- Decided contributions survive account deletion with the submitter severed.
alter table public.submissions drop constraint submissions_user_id_fkey;
alter table public.submissions alter column user_id drop not null;
alter table public.submissions add constraint submissions_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;
alter table public.reports drop constraint reports_user_id_fkey;
alter table public.reports alter column user_id drop not null;
alter table public.reports add constraint reports_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;
alter table public.reports add column resolved_at timestamptz;

-- The original proposal is evidence: its content cannot change after it is stored.
create or replace function public.protect_original_submission()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'decided submissions are provenance and cannot be deleted' using errcode = '55000';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.kind is distinct from old.kind or new.location_id is distinct from old.location_id
     or new.proposed is distinct from old.proposed or new.note is distinct from old.note
     or new.attested_public is distinct from old.attested_public or new.capture_accuracy_m is distinct from old.capture_accuracy_m
     or new.created_at is distinct from old.created_at
     or (new.user_id is distinct from old.user_id and new.user_id is not null) then
    raise exception 'original submissions are immutable' using errcode = '55000';
  end if;
  if old.status <> 'pending' and new.status is distinct from old.status then
    raise exception 'a decided submission cannot change outcome' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger submissions_protect_original before update or delete on public.submissions
  for each row execute function public.protect_original_submission();

-- ---------------------------------------------------------------- append-only decisions
create table public.moderation_decisions (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.submissions (id) on delete restrict,
  report_id uuid references public.reports (id) on delete restrict,
  decision text not null check (decision in ('approve', 'edit_approve', 'reject', 'duplicate', 'hold', 'release', 'resolve', 'dismiss')),
  reason_code text check (reason_code in ('private_or_residential', 'not_public_or_not_a_restroom', 'insufficient_or_unverifiable',
                                          'invalid_or_inaccurate', 'spam_or_abuse', 'other')),
  note text check (note is null or char_length(note) <= 1000),
  -- Admin edits applied by edit_approve (the original proposal itself stays untouched).
  edits jsonb,
  reviewer_id uuid not null,
  result_location_id uuid,
  duplicate_of_location_id uuid,
  created_at timestamptz not null default now(),
  constraint moderation_decisions_one_target check ((submission_id is null) <> (report_id is null)),
  constraint moderation_decisions_reason_rules check (
    (decision = 'reject') = (reason_code is not null)
    and (reason_code is distinct from 'other' or char_length(btrim(coalesce(note, ''))) >= 3)
  ),
  constraint moderation_decisions_duplicate_link check ((decision = 'duplicate') = (duplicate_of_location_id is not null)),
  constraint moderation_decisions_kind check (
    (submission_id is not null and decision in ('approve', 'edit_approve', 'reject', 'duplicate', 'hold', 'release'))
    or (report_id is not null and decision in ('resolve', 'dismiss'))
  )
);
create index moderation_decisions_submission_idx on public.moderation_decisions (submission_id);
create index moderation_decisions_report_idx on public.moderation_decisions (report_id);
alter table public.moderation_decisions enable row level security;
revoke all on table public.moderation_decisions from public, anon, authenticated;
create trigger moderation_decisions_append_only before update or delete on public.moderation_decisions
  for each row execute function public.reject_append_only_change();
create trigger moderation_decisions_no_truncate before truncate on public.moderation_decisions
  for each statement execute function public.reject_append_only_change();

-- ---------------------------------------------------------------- admin: queue
create or replace function public.admin_list_submissions(p_limit integer default 50)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := public.require_admin();
begin
  return query
    select jsonb_build_object(
      'id', s.id, 'kind', s.kind, 'location_id', s.location_id,
      'location_name', (select l.name from public.locations l where l.id = s.location_id),
      'proposed', s.proposed, 'note', s.note, 'flags', to_jsonb(s.flags),
      'possible_duplicate_of', s.possible_duplicate_of, 'duplicate_submission_ids', to_jsonb(s.duplicate_submission_ids),
      'capture_accuracy_m', s.capture_accuracy_m, 'created_at', s.created_at, 'held', s.held_at is not null,
      'is_mine', s.user_id = uid,
      'decisions', coalesce((select jsonb_agg(jsonb_build_object('decision', d.decision, 'reason_code', d.reason_code, 'note', d.note, 'at', d.created_at) order by d.created_at)
                              from public.moderation_decisions d where d.submission_id = s.id), '[]'::jsonb))
    from public.submissions s
    where s.status = 'pending'
    order by (s.held_at is not null), s.created_at
    limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

create or replace function public.admin_list_reports(p_limit integer default 50)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := public.require_admin();
begin
  return query
    select jsonb_build_object('id', r.id, 'location_id', r.location_id,
      'location_name', (select l.name from public.locations l where l.id = r.location_id),
      'issue_type', r.issue_type, 'comment', r.comment, 'created_at', r.created_at, 'is_mine', r.user_id = uid)
    from public.reports r where r.status = 'open'
    order by r.created_at limit least(greatest(coalesce(p_limit, 50), 1), 100);
end;
$$;

-- ---------------------------------------------------------------- admin: decide a submission
create or replace function public.admin_decide_submission(
  p_id uuid,
  p_decision text,
  p_reason text default null,
  p_note text default null,
  p_edits jsonb default null,
  p_duplicate_of uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_admin();
  s public.submissions%rowtype;
  merged jsonb;
  note_v text := nullif(btrim(coalesce(p_note, '')), '');
  loc_id uuid;
  loc public.locations%rowtype;
  new_status text;
begin
  if p_decision not in ('approve', 'edit_approve', 'reject', 'duplicate', 'hold', 'release') then
    raise exception 'invalid decision' using errcode = '22023';
  end if;
  select * into s from public.submissions where id = p_id for update;
  if not found then raise exception 'submission not found' using errcode = '22023'; end if;
  if s.status <> 'pending' then raise exception 'submission already decided' using errcode = '22023'; end if;
  if s.user_id is not null and s.user_id = uid then
    raise exception 'administrators cannot adjudicate their own submissions' using errcode = '42501';
  end if;

  if p_decision = 'hold' then
    if s.held_at is not null then raise exception 'already on hold' using errcode = '22023'; end if;
    update public.submissions set held_at = now() where id = s.id;
    new_status := 'pending';
  elsif p_decision = 'release' then
    if s.held_at is null then raise exception 'not on hold' using errcode = '22023'; end if;
    update public.submissions set held_at = null where id = s.id;
    new_status := 'pending';
  elsif p_decision = 'reject' then
    if p_reason is null or p_reason not in ('private_or_residential', 'not_public_or_not_a_restroom', 'insufficient_or_unverifiable',
                                            'invalid_or_inaccurate', 'spam_or_abuse', 'other') then
      raise exception 'a valid rejection reason is required' using errcode = '22023';
    end if;
    if p_reason = 'other' and char_length(coalesce(note_v, '')) < 3 then
      raise exception 'a note is required when the reason is other' using errcode = '22023';
    end if;
    update public.submissions set status = 'rejected', held_at = null, reviewed_at = now() where id = s.id;
    new_status := 'rejected';
  elsif p_decision = 'duplicate' then
    if p_duplicate_of is null or not exists (select 1 from public.locations where id = p_duplicate_of) then
      raise exception 'an existing restroom to link as the duplicate is required' using errcode = '22023';
    end if;
    update public.submissions set status = 'duplicate', held_at = null, reviewed_at = now(), result_location_id = p_duplicate_of where id = s.id;
    new_status := 'duplicate';
    loc_id := p_duplicate_of;
  else
    -- approve / edit_approve
    if p_decision = 'edit_approve' then
      if p_edits is null or jsonb_typeof(p_edits) <> 'object' or p_edits = '{}'::jsonb then
        raise exception 'edits are required for edit_approve' using errcode = '22023';
      end if;
      merged := s.proposed || p_edits;
    else
      merged := s.proposed;
    end if;
    merged := public.validate_proposed(merged, s.kind = 'new_location');

    if s.kind = 'new_location' then
      -- Public but UNVERIFIED. The explicit-evidence flag is what the visibility rules require; the source row
      -- records that it came from a community submission that an admin approved.
      insert into public.locations (name, address_line, city, region, postal_code, latitude, longitude, status, restroom_evidence, restroom_verified,
          wheelchair_accessible, gender_neutral, baby_changing, has_hot_water, has_cold_water, key_required, purchase_required, fee_required,
          access_location, opening_hours)
        values (merged->>'name', merged->>'address_line', merged->>'city', merged->>'region', merged->>'postal_code',
          (merged->>'latitude')::float8, (merged->>'longitude')::float8, 'unverified', 'explicit', false,
          (merged->>'wheelchair_accessible')::boolean, (merged->>'gender_neutral')::boolean, (merged->>'baby_changing')::boolean,
          (merged->>'has_hot_water')::boolean, (merged->>'has_cold_water')::boolean, (merged->>'key_required')::boolean,
          (merged->>'purchase_required')::boolean, (merged->>'fee_required')::boolean, merged->>'access_location', merged->>'opening_hours')
        returning id into loc_id;
      insert into public.location_sources (location_id, source, source_reference, license, attribution, source_latitude, source_longitude, evidence, is_primary)
        values (loc_id, 'community_submission', s.id::text, null, null, (merged->>'latitude')::float8, (merged->>'longitude')::float8, 'explicit', true);
    else
      select * into loc from public.locations where id = s.location_id for update;
      if not found or loc.status = 'closed' then raise exception 'location not available' using errcode = '22023'; end if;
      loc_id := loc.id;
      -- Approved corrections are applied as an explicit admin action; the manual-edit trigger marks the record
      -- so importers cannot overwrite it. Status/verification are NOT touched.
      update public.locations set
        name = coalesce(merged->>'name', name), address_line = coalesce(merged->>'address_line', address_line),
        city = coalesce(merged->>'city', city), region = coalesce(merged->>'region', region),
        postal_code = coalesce(merged->>'postal_code', postal_code),
        latitude = coalesce((merged->>'latitude')::float8, latitude), longitude = coalesce((merged->>'longitude')::float8, longitude),
        access_location = coalesce(merged->>'access_location', access_location), opening_hours = coalesce(merged->>'opening_hours', opening_hours),
        wheelchair_accessible = case when merged ? 'wheelchair_accessible' then (merged->>'wheelchair_accessible')::boolean else wheelchair_accessible end,
        gender_neutral = case when merged ? 'gender_neutral' then (merged->>'gender_neutral')::boolean else gender_neutral end,
        baby_changing = case when merged ? 'baby_changing' then (merged->>'baby_changing')::boolean else baby_changing end,
        has_hot_water = case when merged ? 'has_hot_water' then (merged->>'has_hot_water')::boolean else has_hot_water end,
        has_cold_water = case when merged ? 'has_cold_water' then (merged->>'has_cold_water')::boolean else has_cold_water end,
        key_required = case when merged ? 'key_required' then (merged->>'key_required')::boolean else key_required end,
        purchase_required = case when merged ? 'purchase_required' then (merged->>'purchase_required')::boolean else purchase_required end,
        fee_required = case when merged ? 'fee_required' then (merged->>'fee_required')::boolean else fee_required end
      where id = loc.id;
    end if;
    update public.submissions set status = 'approved', held_at = null, reviewed_at = now(), result_location_id = loc_id where id = s.id;
    new_status := 'approved';
  end if;

  insert into public.moderation_decisions (submission_id, decision, reason_code, note, edits, reviewer_id, result_location_id, duplicate_of_location_id)
    values (s.id, p_decision, case when p_decision = 'reject' then p_reason end, note_v, case when p_decision = 'edit_approve' then p_edits end,
            uid, case when p_decision in ('approve', 'edit_approve') then loc_id end, case when p_decision = 'duplicate' then p_duplicate_of end);
  perform public.log_moderation(uid, 'submission_' || p_decision, 'submission', s.id,
    jsonb_build_object('kind', s.kind, 'reason', case when p_decision = 'reject' then p_reason end, 'location_id', loc_id));
  return jsonb_build_object('status', new_status, 'held', p_decision = 'hold', 'location_id', loc_id);
end;
$$;

-- ---------------------------------------------------------------- admin: resolve a report
create or replace function public.admin_resolve_report(p_id uuid, p_resolution text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.require_admin();
  r public.reports%rowtype;
  note_v text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if p_resolution not in ('resolved', 'dismissed') then raise exception 'invalid resolution' using errcode = '22023'; end if;
  select * into r from public.reports where id = p_id for update;
  if not found then raise exception 'report not found' using errcode = '22023'; end if;
  if r.status <> 'open' then raise exception 'report already handled' using errcode = '22023'; end if;
  if r.user_id is not null and r.user_id = uid then
    raise exception 'administrators cannot adjudicate their own reports' using errcode = '42501';
  end if;
  update public.reports set status = p_resolution, resolved_at = now() where id = r.id;
  insert into public.moderation_decisions (report_id, decision, note, reviewer_id)
    values (r.id, case when p_resolution = 'resolved' then 'resolve' else 'dismiss' end, note_v, uid);
  perform public.log_moderation(uid, 'report_' || p_resolution, 'report', r.id, jsonb_build_object('issue_type', r.issue_type, 'location_id', r.location_id));
end;
$$;

-- ---------------------------------------------------------------- contributor-side changes
-- Once any moderation decision exists (hold, release, ...) the submission and its history are evidence and
-- can no longer be withdrawn; only genuinely unmoderated pending submissions can.
create or replace function public.withdraw_my_submission(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.submissions s
    where s.id = p_id and s.user_id = uid and s.status = 'pending' and s.held_at is null
      and not exists (select 1 from public.moderation_decisions d where d.submission_id = s.id);
end;
$$;

-- Deletion removes only genuinely UNMODERATED contributions (pending with no moderation history, open reports).
-- Anything a moderator has acted on (decided, or held/released at any point) is evidence: its original and its
-- append-only decisions stay, with the submitter severed (submissions/reports: user_id becomes NULL via the foreign
-- keys). Active administrators must be disabled by the owner first so decision provenance and the admin roster stay intact.
create or replace function public.delete_my_account(p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_confirm is distinct from 'DELETE' then raise exception 'confirmation required' using errcode = '22023'; end if;
  if exists (select 1 from public.admin_users a where a.user_id = uid and a.disabled_at is null) then
    raise exception 'administrator accounts must be disabled by the owner before deletion' using errcode = '42501';
  end if;
  delete from public.submissions s
    where s.user_id = uid and s.status = 'pending' and s.held_at is null
      and not exists (select 1 from public.moderation_decisions d where d.submission_id = s.id);
  delete from public.reports where user_id = uid and status = 'open';
  delete from auth.users where id = uid;
end;
$$;

-- ---------------------------------------------------------------- privileges
revoke all on function public.protect_original_submission() from public, anon, authenticated;
revoke all on function public.admin_list_submissions(integer) from public, anon, authenticated;
revoke all on function public.admin_list_reports(integer) from public, anon, authenticated;
revoke all on function public.admin_decide_submission(uuid, text, text, text, jsonb, uuid) from public, anon, authenticated;
revoke all on function public.admin_resolve_report(uuid, text, text) from public, anon, authenticated;
revoke all on function public.withdraw_my_submission(uuid) from public, anon, authenticated;
revoke all on function public.delete_my_account(text) from public, anon, authenticated;
grant execute on function public.admin_list_submissions(integer) to authenticated;
grant execute on function public.admin_list_reports(integer) to authenticated;
grant execute on function public.admin_decide_submission(uuid, text, text, text, jsonb, uuid) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text, text) to authenticated;
grant execute on function public.withdraw_my_submission(uuid) to authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
