-- OS-206 / OS-207 / OS-208 / OS-209: contributions (new location + edit submissions), reports, account deletion.
-- Same model as the rest of the account layer: no table access; SECURITY DEFINER functions that act only
-- on auth.uid(), validate every field, and rate-limit. Submissions are NEVER public; an admin must
-- approve them (Phase 3) before anything reaches `locations`. No photos in v1.

-- ---------------------------------------------------------------- shared text safety
-- Rejects links, emails and handles in free text (spam / contact-harvesting / doxxing).
create or replace function public.free_text_ok(t text, p_max integer)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select t is not null
    and char_length(btrim(t)) between 1 and p_max
    and t !~ '[<>[:cntrl:]]'
    and lower(t) !~ '(https?:|www\.|\.com|\.net|\.org|\.io|[a-z0-9._-]+@[a-z0-9.-]+|\+?[0-9][0-9 ().-]{8,})'
$$;

-- Conservative private-residence heuristic. A hit blocks a submission outright (OS-208).
create or replace function public.looks_residential(t text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(t) ~ '(\m(my|our|his|her|their)\s+(house|home|apartment|apt|condo|place|yard|garage|porch|bathroom|restroom)\M|\mresidence\M|\mresidential\M|\mprivate\s+(home|house|residence|bathroom|restroom|property)\M|\mmy\s+neighbo)', false)
$$;

-- ---------------------------------------------------------------- submissions
create table public.submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('new_location', 'edit_location')),
  location_id uuid references public.locations (id) on delete cascade,
  -- Whitelisted, validated fields only (see validate_proposed).
  proposed jsonb not null,
  note text check (note is null or char_length(note) <= 300),
  attested_public boolean not null check (attested_public),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  possible_duplicate_of uuid references public.locations (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint submissions_edit_has_location check ((kind = 'edit_location') = (location_id is not null))
);
create index submissions_user_idx on public.submissions (user_id, created_at desc);
create index submissions_pending_idx on public.submissions (status, created_at) where status = 'pending';
alter table public.submissions enable row level security;
revoke all on table public.submissions from public, anon, authenticated;

-- Allowed keys and types. Unknown keys are rejected rather than ignored so clients cannot smuggle fields.
create or replace function public.validate_proposed(p jsonb, p_new boolean)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  out jsonb := '{}'::jsonb;
  text_keys text[] := array['name','address_line','city','region','postal_code','access_location','opening_hours'];
  bool_keys text[] := array['wheelchair_accessible','gender_neutral','baby_changing','has_hot_water','has_cold_water','key_required','purchase_required','fee_required'];
  lim integer;
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'invalid submission' using errcode = '22023'; end if;
  for k, v in select * from jsonb_each(p) loop
    if k = any(text_keys) then
      if jsonb_typeof(v) <> 'string' then raise exception 'invalid field %', k using errcode = '22023'; end if;
      lim := case k when 'name' then 120 when 'postal_code' then 20 when 'city' then 120 when 'region' then 120 else 300 end;
      if not public.free_text_ok(v #>> '{}', lim) then raise exception 'invalid field %', k using errcode = '22023'; end if;
      out := out || jsonb_build_object(k, btrim(v #>> '{}'));
    elsif k = any(bool_keys) then
      if jsonb_typeof(v) <> 'boolean' then raise exception 'invalid field %', k using errcode = '22023'; end if;
      out := out || jsonb_build_object(k, v);
    elsif k in ('latitude', 'longitude') then
      if jsonb_typeof(v) <> 'number' then raise exception 'invalid field %', k using errcode = '22023'; end if;
      if abs((v #>> '{}')::float8) > (case k when 'latitude' then 90 else 180 end) then
        raise exception 'invalid field %', k using errcode = '22023';
      end if;
      out := out || jsonb_build_object(k, v);
    else
      raise exception 'unknown field %', k using errcode = '22023';
    end if;
  end loop;
  if p_new and not (out ? 'name' and out ? 'latitude' and out ? 'longitude') then
    raise exception 'name and coordinates required' using errcode = '22023';
  end if;
  if not p_new and out = '{}'::jsonb then raise exception 'no changes' using errcode = '22023'; end if;
  if (out ? 'latitude') <> (out ? 'longitude') then raise exception 'latitude and longitude go together' using errcode = '22023'; end if;
  return out;
end;
$$;

create or replace function public.submit_location(p_proposed jsonb, p_attested boolean, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  clean jsonb;
  dup uuid;
  pending_n integer;
  sid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_attested is not true then raise exception 'attestation required' using errcode = '22023'; end if;
  clean := public.validate_proposed(p_proposed, true);
  if p_note is not null and not public.free_text_ok(p_note, 300) then raise exception 'invalid note' using errcode = '22023'; end if;
  if public.looks_residential(clean::text) or public.looks_residential(p_note) then
    raise exception 'private residences cannot be submitted' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('submissions:' || uid::text, 0));
  select count(*) into pending_n from public.submissions where user_id = uid and status = 'pending';
  if pending_n >= 10 then raise exception 'too many pending submissions' using errcode = '53400'; end if;
  perform public.enforce_rate_limit(uid, 'submission', 5, interval '1 day');
  -- Flag (never merge) a likely duplicate within 75 m with a matching normalised name.
  select l.id into dup from public.locations l
    where l.status <> 'closed'
      and public.distance_m(l.latitude, l.longitude, (clean->>'latitude')::float8, (clean->>'longitude')::float8) < 75
      and public.normalize_name(l.name) = public.normalize_name(clean->>'name')
    limit 1;
  insert into public.submissions (user_id, kind, proposed, note, attested_public, possible_duplicate_of)
    values (uid, 'new_location', clean, p_note, true, dup) returning id into sid;
  return sid;
end;
$$;

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
  select count(*) into pending_n from public.submissions where user_id = uid and status = 'pending';
  if pending_n >= 10 then raise exception 'too many pending submissions' using errcode = '53400'; end if;
  perform public.enforce_rate_limit(uid, 'submission', 5, interval '1 day');
  insert into public.submissions (user_id, kind, location_id, proposed, note, attested_public)
    values (uid, 'edit_location', p_location, clean, p_note, true) returning id into sid;
  return sid;
end;
$$;

-- Own submissions only (status + what was proposed). Never other users' rows.
create or replace function public.list_my_submissions()
returns table (id uuid, kind text, location_id uuid, proposed jsonb, status text, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return query select s.id, s.kind, s.location_id, s.proposed, s.status, s.created_at
    from public.submissions s where s.user_id = uid order by s.created_at desc limit 50;
end;
$$;

create or replace function public.withdraw_my_submission(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.submissions where id = p_id and user_id = uid and status = 'pending';
end;
$$;

-- ---------------------------------------------------------------- reports (OS-207)
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  issue_type text not null check (issue_type in
    ('closed','wrong_location','wrong_info','unsafe','private_property','not_a_restroom','other')),
  comment text check (comment is null or char_length(comment) <= 300),
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at timestamptz not null default now()
);
create unique index reports_one_open_per_user_issue
  on public.reports (user_id, location_id, issue_type) where status = 'open';
create index reports_open_idx on public.reports (status, created_at) where status = 'open';
alter table public.reports enable row level security;
revoke all on table public.reports from public, anon, authenticated;

create or replace function public.submit_report(p_location uuid, p_issue text, p_comment text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  loc public.locations%rowtype;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_issue is null or p_issue not in ('closed','wrong_location','wrong_info','unsafe','private_property','not_a_restroom','other') then
    raise exception 'invalid issue type' using errcode = '22023';
  end if;
  if p_comment is not null and not public.free_text_ok(p_comment, 300) then raise exception 'invalid comment' using errcode = '22023'; end if;
  select * into loc from public.locations where id = p_location;
  if not found or not public.is_publicly_displayable(loc.status, loc.restroom_evidence, loc.restroom_verified) then
    raise exception 'location not available' using errcode = '22023';
  end if;
  perform public.enforce_rate_limit(uid, 'report', 20, interval '1 day');
  -- A repeated identical open report is a quiet no-op (no duplicate work for moderators).
  insert into public.reports (user_id, location_id, issue_type, comment)
    values (uid, p_location, p_issue, nullif(btrim(p_comment), ''))
    on conflict (user_id, location_id, issue_type) where status = 'open' do nothing;
end;
$$;

-- ---------------------------------------------------------------- account deletion (OS-209)
-- Removes the auth user; every account table cascades (profile, favorites, reviews, check-ins,
-- submissions, reports, action log). Aggregate ratings are recomputed by the reviews trigger.
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
  delete from auth.users where id = uid;
end;
$$;

-- ---------------------------------------------------------------- privileges
revoke all on function public.free_text_ok(text, integer) from public, anon, authenticated;
revoke all on function public.looks_residential(text) from public, anon, authenticated;
revoke all on function public.validate_proposed(jsonb, boolean) from public, anon, authenticated;
revoke all on function public.submit_location(jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.submit_location_edit(uuid, jsonb, boolean, text) from public, anon, authenticated;
revoke all on function public.list_my_submissions() from public, anon, authenticated;
revoke all on function public.withdraw_my_submission(uuid) from public, anon, authenticated;
revoke all on function public.submit_report(uuid, text, text) from public, anon, authenticated;
revoke all on function public.delete_my_account(text) from public, anon, authenticated;
grant execute on function public.submit_location(jsonb, boolean, text) to authenticated;
grant execute on function public.submit_location_edit(uuid, jsonb, boolean, text) to authenticated;
grant execute on function public.list_my_submissions() to authenticated;
grant execute on function public.withdraw_my_submission(uuid) to authenticated;
grant execute on function public.submit_report(uuid, text, text) to authenticated;
grant execute on function public.delete_my_account(text) to authenticated;
