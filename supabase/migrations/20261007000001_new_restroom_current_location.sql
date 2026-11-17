-- Phase 2 correction: new restrooms must be submitted from the contributor's CURRENT location, and
-- junk is filtered before it reaches the moderation queue. Replaces the earlier submit_location
-- (which accepted arbitrary coordinates). Corrections to existing restrooms keep their own rules.
--
-- GPS is one abuse-reduction signal, not proof: the server cannot verify a device's position, so it
-- requires a plausible fix (accuracy <= 50 m) and layers duplicate, rate and pattern controls on top.
-- Privacy: the position is only the proposed restroom's coordinates, stored on that one submission.
-- No contributor trail is kept (action_log holds only action name + time; no coordinates, no device data).
--
-- Thresholds (all in this file so they can be tuned in one place):
--   accuracy                 <= 50 m required (flagged 'low_accuracy' when > 25 m)
--   already-listed           public restroom within 25 m, or within 100 m with the same normalised name -> rejected
--   own duplicate            you already have a pending submission within 30 m (or 100 m, same name) -> rejected
--   coalesce                 another user's pending submission within 30 m (or 100 m, same name) -> your report is
--                            added as a supporter instead of a second moderation item
--   rate                     3 new restrooms per hour, 5 submissions per day, 5 pending new restrooms, 10 pending total
--   repeat rejection         5+ rejected in 30 days and fewer than a quarter approved -> new submissions paused
--   flags (admin triage)     low_accuracy, new_account (< 24 h), implausible_travel (> 5 km/min since your last
--                            new-restroom submission within an hour), near_hidden_candidate (hidden candidate within 25 m)

alter table public.submissions
  add column capture_accuracy_m real check (capture_accuracy_m is null or capture_accuracy_m > 0),
  add column flags text[] not null default '{}';

-- Other users' reports of the same pending place: they strengthen one queue item instead of creating more.
create table public.submission_supporters (
  submission_id uuid not null references public.submissions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (submission_id, user_id)
);
alter table public.submission_supporters enable row level security;
revoke all on table public.submission_supporters from public, anon, authenticated;

-- The old function accepted any coordinates from the client: remove it entirely.
drop function public.submit_location(jsonb, boolean, text);

create or replace function public.submit_location(
  p_proposed jsonb,
  p_lat double precision,
  p_lng double precision,
  p_accuracy_m double precision,
  p_attested boolean,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean jsonb;
  nm text;
  flags text[] := '{}';
  pending_n integer;
  pending_new integer;
  rejected_n integer;
  approved_n integer;
  loc public.locations%rowtype;
  mine uuid;
  other uuid;
  sid uuid;
  last_lat double precision;
  last_lng double precision;
  last_at timestamptz;
  joined timestamptz;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_attested is not true then raise exception 'attestation required' using errcode = '22023'; end if;

  -- Position must come from the device fix, never from the free-form payload.
  if p_proposed is null or jsonb_typeof(p_proposed) <> 'object' then raise exception 'invalid submission' using errcode = '22023'; end if;
  if p_proposed ? 'latitude' or p_proposed ? 'longitude' then
    raise exception 'position must come from your current location' using errcode = '22023';
  end if;
  if p_lat is null or p_lng is null or p_accuracy_m is null
     or not (p_lat between -90 and 90) or not (p_lng between -180 and 180)
     or (p_lat = 0 and p_lng = 0) then
    raise exception 'current location required' using errcode = '22023';
  end if;
  if not (p_accuracy_m > 0 and p_accuracy_m <= 50) then
    raise exception 'location not accurate enough' using errcode = '22023';
  end if;

  clean := public.validate_proposed(p_proposed || jsonb_build_object('latitude', p_lat, 'longitude', p_lng), true);
  nm := public.normalize_name(clean->>'name');
  if p_note is not null and not public.free_text_ok(p_note, 300) then raise exception 'invalid note' using errcode = '22023'; end if;
  if public.looks_residential(clean::text) or public.looks_residential(p_note) then
    raise exception 'private residences cannot be submitted' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('submissions:' || uid::text, 0));

  -- Pause accounts whose submissions keep getting rejected.
  select count(*) filter (where status = 'rejected'), count(*) filter (where status = 'approved')
    into rejected_n, approved_n from public.submissions
    where user_id = uid and kind = 'new_location' and created_at > now() - interval '30 days';
  if rejected_n >= 5 and approved_n * 4 < rejected_n then
    raise exception 'submissions paused' using errcode = '54000';
  end if;

  -- Already listed (public records only, so nothing hidden is revealed).
  select * into loc from public.locations l
    where public.is_publicly_displayable(l.status, l.restroom_evidence, l.restroom_verified)
      and (public.distance_m(l.latitude, l.longitude, p_lat, p_lng) < 25
           or (public.distance_m(l.latitude, l.longitude, p_lat, p_lng) < 100 and public.normalize_name(l.name) = nm))
    order by public.distance_m(l.latitude, l.longitude, p_lat, p_lng) limit 1;
  if found then raise exception 'restroom already listed nearby' using errcode = '22023'; end if;

  -- You already have this one waiting.
  select s.id into mine from public.submissions s
    where s.user_id = uid and s.kind = 'new_location' and s.status = 'pending'
      and (public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 30
           or (public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 100
               and public.normalize_name(s.proposed->>'name') = nm))
    limit 1;
  if mine is not null then raise exception 'you already submitted this restroom' using errcode = '22023'; end if;
  if exists (select 1 from public.submission_supporters ss join public.submissions s on s.id = ss.submission_id
      where ss.user_id = uid and s.status = 'pending'
        and public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 30) then
    raise exception 'you already submitted this restroom' using errcode = '22023';
  end if;

  -- Caps and rate limits.
  select count(*), count(*) filter (where kind = 'new_location') into pending_n, pending_new
    from public.submissions where user_id = uid and status = 'pending';
  if pending_n >= 10 or pending_new >= 5 then raise exception 'too many pending submissions' using errcode = '53400'; end if;
  perform public.enforce_rate_limit(uid, 'new_restroom_hour', 3, interval '1 hour');
  perform public.enforce_rate_limit(uid, 'submission', 5, interval '1 day');

  -- Serialise per ~110 m cell so two simultaneous reports of one place coalesce instead of racing.
  perform pg_advisory_xact_lock(hashtextextended('newloc:' || round(p_lat::numeric, 3)::text || ':' || round(p_lng::numeric, 3)::text, 0));

  -- Someone else already reported this place: add support, no new moderation item.
  select s.id into other from public.submissions s
    where s.kind = 'new_location' and s.status = 'pending' and s.user_id <> uid
      and (public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 30
           or (public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 100
               and public.normalize_name(s.proposed->>'name') = nm))
    order by s.created_at limit 1;
  if other is not null then
    insert into public.submission_supporters (submission_id, user_id) values (other, uid) on conflict do nothing;
    return jsonb_build_object('coalesced', true);
  end if;

  -- Triage flags for the (future) admin queue; none of these block a legitimate contributor.
  if p_accuracy_m > 25 then flags := array_append(flags, 'low_accuracy'); end if;
  select created_at into joined from public.profiles where user_id = uid;
  if joined is null or joined > now() - interval '24 hours' then flags := array_append(flags, 'new_account'); end if;
  select (s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, s.created_at
    into last_lat, last_lng, last_at
    from public.submissions s where s.user_id = uid and s.kind = 'new_location' and s.created_at > now() - interval '1 hour'
    order by s.created_at desc limit 1;
  if last_at is not null
     and public.distance_m(last_lat, last_lng, p_lat, p_lng) > 5000 * greatest(extract(epoch from (now() - last_at)) / 60, 1) then
    flags := array_append(flags, 'implausible_travel');
  end if;
  if exists (select 1 from public.locations l
      where l.status = 'candidate' and public.distance_m(l.latitude, l.longitude, p_lat, p_lng) < 25) then
    flags := array_append(flags, 'near_hidden_candidate');
  end if;

  insert into public.submissions (user_id, kind, proposed, note, attested_public, capture_accuracy_m, flags)
    values (uid, 'new_location', clean, p_note, true, p_accuracy_m, flags) returning id into sid;
  return jsonb_build_object('coalesced', false, 'submission_id', sid);
end;
$$;

-- Corrections to EXISTING restrooms: unchanged rules plus two light controls (no GPS requirement).
create or replace function public.submit_location_edit(p_location uuid, p_proposed jsonb, p_attested boolean, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  loc public.locations%rowtype;
  clean jsonb;
  pending_n integer;
  flags text[] := '{}';
  sid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_attested is not true then raise exception 'attestation required' using errcode = '22023'; end if;
  select * into loc from public.locations where id = p_location;
  if not found or not public.is_publicly_displayable(loc.status, loc.restroom_evidence, loc.restroom_verified) then
    raise exception 'location not available' using errcode = '22023';
  end if;
  clean := public.validate_proposed(p_proposed, false);
  if p_note is not null and not public.free_text_ok(p_note, 300) then raise exception 'invalid note' using errcode = '22023'; end if;
  if public.looks_residential(clean::text) or public.looks_residential(p_note) then
    raise exception 'private residences cannot be submitted' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('submissions:' || uid::text, 0));
  -- One open correction per person per restroom: edit it by withdrawing and resending, not by piling up.
  if exists (select 1 from public.submissions where user_id = uid and kind = 'edit_location' and location_id = p_location and status = 'pending') then
    raise exception 'you already have a pending correction for this restroom' using errcode = '22023';
  end if;
  select count(*) into pending_n from public.submissions where user_id = uid and status = 'pending';
  if pending_n >= 10 then raise exception 'too many pending submissions' using errcode = '53400'; end if;
  perform public.enforce_rate_limit(uid, 'submission', 5, interval '1 day');
  -- Moving a pin a long way is allowed but flagged for the reviewer.
  if clean ? 'latitude' and public.distance_m(loc.latitude, loc.longitude, (clean->>'latitude')::float8, (clean->>'longitude')::float8) > 250 then
    flags := array_append(flags, 'moved_far');
  end if;
  insert into public.submissions (user_id, kind, location_id, proposed, note, attested_public, flags)
    values (uid, 'edit_location', p_location, clean, p_note, true, flags) returning id into sid;
  return sid;
end;
$$;

revoke all on function public.submit_location(jsonb, double precision, double precision, double precision, boolean, text) from public, anon, authenticated;
revoke all on function public.submit_location_edit(uuid, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function public.submit_location(jsonb, double precision, double precision, double precision, boolean, text) to authenticated;
grant execute on function public.submit_location_edit(uuid, jsonb, boolean, text) to authenticated;
