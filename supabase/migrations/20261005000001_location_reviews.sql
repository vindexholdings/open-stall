-- Validator/review workflow (admin tooling seed, later part of Phase 3 moderation).
-- A reviewer's decision is recorded as FIRST-PARTY provenance, separately from any source row:
--   * location_reviews: private audit log of every decision (who, when, what, previous state).
--   * location_sources: when the reviewer confirms a restroom exists, an 'open_stall' source row is
--     added (not primary). Existing source rows (e.g. OSM) are NEVER deleted or altered.
-- A location becomes Verified ONLY when the reviewer explicitly confirms it personally with a date.
-- "Does not exist" -> status 'closed' (hidden; imports never republish a closed record).
-- Unknown stays null. service_role only; no client role can read or call any of this.

create table public.location_reviews (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  reviewer text not null check (char_length(btrim(reviewer)) between 1 and 120),
  existence text not null check (existence in ('exists', 'not_exists', 'unsure')),
  access text not null check (access in ('public_free', 'customers_only', 'key_required', 'unknown', 'independent')),
  key_required boolean,
  purchase_required boolean,
  fee_required boolean,
  wheelchair_accessible boolean,
  gender_neutral boolean,
  baby_changing boolean,
  has_hot_water boolean,
  cold_water_only boolean,
  notes text check (notes is null or char_length(notes) <= 1000),
  personally_verified boolean not null default false,
  verified_on date,
  -- Canonical state before this review (audit / manual undo).
  previous jsonb not null,
  resulting_status text not null check (resulting_status in ('candidate', 'unverified', 'verified', 'closed')),
  created_at timestamptz not null default now(),
  constraint location_reviews_personal_needs_exists_and_date check (
    not personally_verified or (existence = 'exists' and verified_on is not null)
  )
);
create index location_reviews_location_idx on public.location_reviews (location_id, created_at desc);

alter table public.location_reviews enable row level security;
revoke all on table public.location_reviews from public, anon, authenticated;

create or replace function public.apply_location_review(
  p_location uuid,
  p_reviewer text,
  p_existence text,
  p_access text,
  p_wheelchair boolean,
  p_gender_neutral boolean,
  p_baby_changing boolean,
  p_hot_water boolean,
  p_cold_only boolean,
  p_notes text,
  p_personally_verified boolean,
  p_verified_on date,
  p_key_required boolean default null,
  p_purchase_required boolean default null,
  p_fee_required boolean default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  loc public.locations%rowtype;
  personal boolean := coalesce(p_personally_verified, false);
  new_status text;
  apply_facts boolean := false;
  key_v boolean; purch_v boolean; fee_v boolean; hot_v boolean; cold_v boolean;
  v_verified boolean;
  v_last timestamptz;
  rid uuid;
begin
  if p_existence not in ('exists', 'not_exists', 'unsure') then raise exception 'invalid existence' using errcode = '22023'; end if;
  if p_access not in ('public_free', 'customers_only', 'key_required', 'unknown', 'independent') then raise exception 'invalid access' using errcode = '22023'; end if;
  if p_reviewer is null or char_length(btrim(p_reviewer)) not between 1 and 120 then raise exception 'reviewer required' using errcode = '22023'; end if;
  if personal and (p_existence <> 'exists' or p_verified_on is null) then
    raise exception 'personal verification requires existence=exists and a date' using errcode = '22023';
  end if;
  if p_verified_on is not null and p_verified_on > current_date + 1 then raise exception 'verification date is in the future' using errcode = '22023'; end if;
  if p_hot_water is true and p_cold_only is true then raise exception 'hot water and cold-water-only conflict' using errcode = '22023'; end if;

  select * into loc from public.locations where id = p_location for update;
  if not found then raise exception 'unknown location' using errcode = '22023'; end if;
  if loc.status = 'pending' then raise exception 'pending submissions are moderated separately' using errcode = '22023'; end if;

  if p_existence = 'not_exists' then
    new_status := 'closed';
  elsif p_existence = 'unsure' then
    new_status := loc.status;
  elsif personal then
    new_status := 'verified'; apply_facts := true;
  elsif loc.status = 'verified' then
    new_status := 'verified'; apply_facts := true;
  else
    new_status := 'unverified'; apply_facts := true;
  end if;
  if new_status = 'unverified' and loc.possible_duplicate_of is not null then
    raise exception 'resolve the possible-duplicate flag before making this public' using errcode = '22023';
  end if;

  -- Facts: the reviewer's answers are written exactly; unknown is null.
  key_v := case p_access when 'public_free' then false when 'key_required' then true when 'independent' then p_key_required else null end;
  purch_v := case p_access when 'public_free' then false when 'customers_only' then true when 'independent' then p_purchase_required else null end;
  fee_v := case p_access when 'public_free' then false when 'independent' then p_fee_required else null end;
  if p_cold_only is true then hot_v := false; cold_v := true;
  elsif p_hot_water is true then hot_v := true; cold_v := null;
  else hot_v := p_hot_water; cold_v := null; end if;

  if new_status = 'verified' then
    v_verified := true;
    v_last := case when personal then (p_verified_on::timestamp + interval '12 hours') at time zone 'UTC' else loc.last_verified_at end;
  elsif p_existence = 'unsure' then
    v_verified := loc.restroom_verified; v_last := loc.last_verified_at;
  else
    v_verified := false; v_last := null;
  end if;

  insert into public.location_reviews (
    location_id, reviewer, existence, access, key_required, purchase_required, fee_required, wheelchair_accessible, gender_neutral, baby_changing,
    has_hot_water, cold_water_only, notes, personally_verified, verified_on, previous, resulting_status
  ) values (
    p_location, btrim(p_reviewer), p_existence, p_access, key_v, purch_v, fee_v, p_wheelchair, p_gender_neutral, p_baby_changing,
    p_hot_water, p_cold_only, nullif(btrim(coalesce(p_notes, '')), ''), personal, case when personal then p_verified_on end,
    jsonb_build_object(
      'status', loc.status, 'restroom_evidence', loc.restroom_evidence, 'restroom_verified', loc.restroom_verified,
      'last_verified_at', loc.last_verified_at, 'wheelchair_accessible', loc.wheelchair_accessible,
      'gender_neutral', loc.gender_neutral, 'baby_changing', loc.baby_changing, 'has_hot_water', loc.has_hot_water,
      'has_cold_water', loc.has_cold_water, 'key_required', loc.key_required, 'purchase_required', loc.purchase_required,
      'fee_required', loc.fee_required, 'manually_edited_at', loc.manually_edited_at),
    new_status
  ) returning id into rid;

  -- First-party provenance, separate from (and never replacing) any existing source row.
  if p_existence = 'exists' then
    insert into public.location_sources (
      location_id, source, source_reference, license, attribution, source_latitude, source_longitude,
      evidence, tags, is_primary, last_seen_at
    ) values (
      p_location, 'open_stall', 'review/' || rid::text,
      'Open Stall original data (first-party review)', null, loc.latitude, loc.longitude, 'explicit',
      jsonb_build_object('review_id', rid, 'reviewer', btrim(p_reviewer), 'personally_verified', personal,
                         'verified_on', case when personal then p_verified_on end),
      false, now()
    );
  end if;

  update public.locations set
    status = new_status,
    restroom_evidence = case when p_existence = 'exists' then 'explicit' else loc.restroom_evidence end,
    restroom_verified = v_verified,
    last_verified_at = v_last,
    wheelchair_accessible = case when apply_facts then p_wheelchair else loc.wheelchair_accessible end,
    gender_neutral = case when apply_facts then p_gender_neutral else loc.gender_neutral end,
    baby_changing = case when apply_facts then p_baby_changing else loc.baby_changing end,
    has_hot_water = case when apply_facts then hot_v else loc.has_hot_water end,
    has_cold_water = case when apply_facts then cold_v else loc.has_cold_water end,
    key_required = case when apply_facts then key_v else loc.key_required end,
    purchase_required = case when apply_facts then purch_v else loc.purchase_required end,
    fee_required = case when apply_facts then fee_v else loc.fee_required end,
    -- Any human review protects the record from import overwrites.
    manually_edited_at = coalesce(loc.manually_edited_at, now())
  where id = p_location;

  return jsonb_build_object('review_id', rid, 'status', new_status, 'restroom_verified', v_verified,
                            'public', new_status in ('verified', 'unverified'));
end;
$$;

revoke all on function public.apply_location_review(uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, text, boolean, date, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.apply_location_review(uuid, text, text, text, boolean, boolean, boolean, boolean, boolean, text, boolean, date, boolean, boolean, boolean) to service_role;
