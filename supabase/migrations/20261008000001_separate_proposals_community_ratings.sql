-- Phase 2 policy repair (approved 2026-10-05). Applies AFTER 20261007000001 (kept intact, still pending live).
--
-- 1. New-restroom proposals are never rejected or merged because of proximity/name. Every proposal is stored as
--    its own raw row. Likely duplicates are only FLAGGED, privately, for admin review: malls, airports, parks and
--    shared addresses legitimately hold several distinct restrooms in a small area.
--      * possible_duplicate_of          nearest public restroom within 25 m, or within 100 m with the same name
--      * flags 'near_listed_restroom'   same condition (admin triage)
--      * flags 'near_pending_submission' / 'near_own_pending'   another pending proposal nearby (30 m, or 100 m same name)
--      * duplicate_submission_ids       which pending proposals those are (admin only; never returned to any client)
--    The client response is only {submission_id}: it says nothing about neighbours, so pending/other-user data
--    cannot be probed.
--    Spam guard: an EXACT repeat of your own still-pending request (identical cleaned payload, device fix, accuracy
--    and note within 10 minutes: a network retry or double tap) returns the existing submission_id and consumes no
--    quota. Anything that differs, even slightly, is a separate proposal: two units in one building get separate
--    device fixes. Everything else is bounded by the unchanged quotas: accuracy <= 50 m, 3 new/hour,
--    5 submissions/day (shared with corrections), 5 pending new / 10 pending total, repeat-rejection pause.
--    Supporter/coalescing is no longer used. public.submission_supporters (created by 20261007000001) is kept
--    untouched as legacy provenance (it holds rows only if 20261007000001 ran on its own); nothing writes it any more.
-- 2. The public rating (locations.average_rating / rating_count) is community-only: computed from public.reviews.
--    Admin ratings stay in location_reviews as history/provenance and no longer touch the aggregate.
--    Existing stored aggregates are recomputed from community rows below (admin-only places become null / 0).

alter table public.submissions
  add column duplicate_submission_ids uuid[] not null default '{}';

-- ---------------------------------------------------------------- new restroom: separate proposals + private flags
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
  dup_loc uuid;
  mine uuid[];
  others uuid[];
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

  -- Exact retry of your own pending request (lost response / double tap): same item, no quota used.
  select s.id into sid from public.submissions s
    where s.user_id = uid and s.kind = 'new_location' and s.status = 'pending'
      and s.created_at > now() - interval '10 minutes'
      and s.proposed = clean and s.note is not distinct from p_note and s.capture_accuracy_m = p_accuracy_m::real
    order by s.created_at desc limit 1;
  if sid is not null then return jsonb_build_object('submission_id', sid); end if;

  -- Pause accounts whose submissions keep getting rejected (unchanged).
  select count(*) filter (where status = 'rejected'), count(*) filter (where status = 'approved')
    into rejected_n, approved_n from public.submissions
    where user_id = uid and kind = 'new_location' and created_at > now() - interval '30 days';
  if rejected_n >= 5 and approved_n * 4 < rejected_n then
    raise exception 'submissions paused' using errcode = '54000';
  end if;

  -- Caps and rate limits (unchanged).
  select count(*), count(*) filter (where kind = 'new_location') into pending_n, pending_new
    from public.submissions where user_id = uid and status = 'pending';
  if pending_n >= 10 or pending_new >= 5 then raise exception 'too many pending submissions' using errcode = '53400'; end if;
  perform public.enforce_rate_limit(uid, 'new_restroom_hour', 3, interval '1 hour');
  perform public.enforce_rate_limit(uid, 'submission', 5, interval '1 day');

  -- Serialise new proposals (one global lock, always taken after the per-user lock) so that of two simultaneous
  -- reports of one place the later writer sees the earlier, committed one and flags it; no cell boundary can split
  -- them. The earlier row is not retroactively flagged. Volume is low and the section is short; revisit if it ever
  -- becomes a hotspot.
  perform pg_advisory_xact_lock(hashtextextended('newloc', 0));

  -- Flag only, never reject: public records (nothing hidden is revealed to the client or in the flag text).
  select l.id into dup_loc from public.locations l
    where public.is_publicly_displayable(l.status, l.restroom_evidence, l.restroom_verified)
      and (public.distance_m(l.latitude, l.longitude, p_lat, p_lng) < 25
           or (public.distance_m(l.latitude, l.longitude, p_lat, p_lng) < 100 and public.normalize_name(l.name) = nm))
    order by public.distance_m(l.latitude, l.longitude, p_lat, p_lng) limit 1;
  if dup_loc is not null then flags := array_append(flags, 'near_listed_restroom'); end if;

  select coalesce(array_agg(s.id order by s.created_at), '{}') into mine from public.submissions s
    where s.user_id = uid and s.kind = 'new_location' and s.status = 'pending'
      and (public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 30
           or (public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 100
               and public.normalize_name(s.proposed->>'name') = nm));
  select coalesce(array_agg(s.id order by s.created_at), '{}') into others from public.submissions s
    where s.user_id <> uid and s.kind = 'new_location' and s.status = 'pending'
      and (public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 30
           or (public.distance_m((s.proposed->>'latitude')::float8, (s.proposed->>'longitude')::float8, p_lat, p_lng) < 100
               and public.normalize_name(s.proposed->>'name') = nm));
  if cardinality(mine) > 0 then flags := array_append(flags, 'near_own_pending'); end if;
  if cardinality(others) > 0 then flags := array_append(flags, 'near_pending_submission'); end if;

  -- Other triage flags (unchanged); none of these block a legitimate contributor.
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

  insert into public.submissions (user_id, kind, proposed, note, attested_public, capture_accuracy_m, flags,
                                  possible_duplicate_of, duplicate_submission_ids)
    values (uid, 'new_location', clean, p_note, true, p_accuracy_m, flags, dup_loc, mine || others)
    returning id into sid;
  return jsonb_build_object('submission_id', sid);
end;
$$;

revoke all on function public.submit_location(jsonb, double precision, double precision, double precision, boolean, text) from public, anon, authenticated;
comment on table public.submission_supporters is 'Legacy (20261007000001 coalescing). Unused since 20261008000001; kept as provenance.';
grant execute on function public.submit_location(jsonb, double precision, double precision, double precision, boolean, text) to authenticated;

-- ---------------------------------------------------------------- community-only public rating
-- Locks the location row (FOR NO KEY UPDATE: compatible with the key-share lock a review insert already holds, so
-- no deadlock) and only then aggregates, so a concurrent reviewer's committed row is always counted: the SELECT
-- runs in a fresh statement snapshot after the lock is granted.
create or replace function public.recompute_location_rating(p_location uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1 from public.locations where id = p_location for no key update;
  update public.locations l set
    average_rating = (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.location_id = p_location),
    rating_count = (select count(*) from public.reviews r where r.location_id = p_location)
  where l.id = p_location;
end;
$$;
revoke all on function public.recompute_location_rating(uuid) from public, anon, authenticated;

-- Admin visit/review writer: identical to the earlier version except it no longer writes the public aggregate.
create or replace function public.apply_location_review_v2(
  p_location uuid, p_reviewer text, p_reviewer_identity text,
  p_existence text, p_personally_verified boolean, p_verified_on date, p_answers jsonb
)
returns jsonb language plpgsql set search_path = '' as $$
declare
  result jsonb;
  before_loc public.locations%rowtype;
  item text;
  val jsonb;
  cond jsonb;
  typ text := coalesce(p_answers->>'restroom_type', 'unknown');
  stars smallint;
  cleanliness smallint;
  comment_text text := nullif(btrim(coalesce(p_answers->>'public_comment', '')), '');
  rid uuid;
begin
  if p_reviewer_identity is null or char_length(btrim(p_reviewer_identity)) not between 1 and 120 then
    raise exception 'reviewer identity required' using errcode = '22023';
  end if;
  if jsonb_typeof(p_answers) is distinct from 'object' then raise exception 'answers must be an object' using errcode = '22023'; end if;
  for item in select jsonb_object_keys(p_answers) loop
    if item not in ('key_required', 'purchase_required', 'fee_required', 'wheelchair_accessible', 'gender_neutral',
      'baby_changing', 'hot_water', 'cold_water', 'customers_only', 'family_bathroom', 'cleaning_log',
      'restroom_type', 'rating', 'cleanliness_score', 'public_comment', 'notes', 'conditions') then
      raise exception 'unknown answer: %', item using errcode = '22023';
    end if;
  end loop;
  foreach item in array array['key_required', 'purchase_required', 'fee_required', 'wheelchair_accessible',
    'gender_neutral', 'baby_changing', 'hot_water', 'cold_water', 'customers_only', 'family_bathroom', 'cleaning_log'] loop
    val := p_answers->item;
    if val is not null and jsonb_typeof(val) not in ('boolean', 'null') then raise exception 'invalid boolean: %', item using errcode = '22023'; end if;
  end loop;
  if typ not in ('unknown', 'men', 'women', 'all_gender', 'family', 'single_occupancy') then raise exception 'invalid restroom type' using errcode = '22023'; end if;
  foreach item in array array['rating', 'cleanliness_score'] loop
    val := p_answers->item;
    if val is not null and val <> 'null'::jsonb and (jsonb_typeof(val) <> 'number' or (val::text) !~ '^[1-5]$') then
      raise exception 'scores must be whole numbers from 1 to 5' using errcode = '22023';
    end if;
  end loop;
  stars := (p_answers->>'rating')::smallint;
  cleanliness := (p_answers->>'cleanliness_score')::smallint;
  if p_answers ? 'public_comment' and jsonb_typeof(p_answers->'public_comment') not in ('string', 'null') then raise exception 'invalid comment' using errcode = '22023'; end if;
  if char_length(comment_text) > 1000 or regexp_replace(comment_text, E'[\n\r\t]', '', 'g') ~ '[[:cntrl:]]' then raise exception 'invalid public comment' using errcode = '22023'; end if;
  if p_existence <> 'exists' and (stars is not null or cleanliness is not null or comment_text is not null) then
    raise exception 'ratings and comments require an existing restroom' using errcode = '22023';
  end if;
  cond := coalesce(p_answers->'conditions', '{}'::jsonb);
  if jsonb_typeof(cond) is distinct from 'object' then raise exception 'invalid conditions' using errcode = '22023'; end if;
  for item in select jsonb_object_keys(cond) loop
    if jsonb_typeof(cond->item) <> 'string' then raise exception 'invalid condition value' using errcode = '22023'; end if;
    if not (case item
      when 'seats' then cond->>item in ('unknown','clean','dirty','not_applicable')
      when 'mirrors' then cond->>item in ('unknown','clean','dirty','missing','broken')
      when 'stall_doors' then cond->>item in ('unknown','working','broken','not_applicable')
      when 'toilet_paper' then cond->>item in ('unknown','available','out')
      when 'floor' then cond->>item in ('unknown','clean','dirty')
      else false end) then raise exception 'invalid condition: %', item using errcode = '22023';
    end if;
  end loop;

  select * into before_loc from public.locations where id = p_location for update;
  if not found then raise exception 'unknown location' using errcode = '22023'; end if;
  -- Reuse the installed transaction-safe provenance/status function.
  -- Customer-only is separate from purchase-required; do not relabel or overwrite the old fact.
  result := public.apply_location_review(p_location, p_reviewer, p_existence, 'independent',
    (p_answers->>'wheelchair_accessible')::boolean, (p_answers->>'gender_neutral')::boolean,
    (p_answers->>'baby_changing')::boolean, (p_answers->>'hot_water')::boolean,
    null, p_answers->>'notes', p_personally_verified, p_verified_on,
    (p_answers->>'key_required')::boolean, before_loc.purchase_required, (p_answers->>'fee_required')::boolean);
  rid := (result->>'review_id')::uuid;
  update public.location_reviews set
    reviewer_identity = btrim(p_reviewer_identity), reviewer_kind = 'admin',
    customers_only = (p_answers->>'customers_only')::boolean,
    family_bathroom = (p_answers->>'family_bathroom')::boolean,
    has_cold_water = (p_answers->>'cold_water')::boolean, cleaning_log = (p_answers->>'cleaning_log')::boolean,
    restroom_type = typ, rating = stars, cleanliness_score = cleanliness, public_comment = comment_text, conditions = cond,
    previous = previous || jsonb_build_object('customers_only', before_loc.customers_only, 'family_bathroom', before_loc.family_bathroom)
  where id = rid;
  if p_existence = 'exists' then
    update public.locations set customers_only = (p_answers->>'customers_only')::boolean,
      family_bathroom = (p_answers->>'family_bathroom')::boolean,
      has_hot_water = (p_answers->>'hot_water')::boolean, has_cold_water = (p_answers->>'cold_water')::boolean,
      -- An older repeat visit must not move recency backwards.
      last_verified_at = case when p_personally_verified then greatest(before_loc.last_verified_at, last_verified_at) else last_verified_at end
    where id = p_location;
  end if;
  -- The admin rating (stars) is stored in location_reviews above as history only. The public average/count
  -- come from community reviews alone (recompute_location_rating) and are deliberately not touched here.
  return result;
end;
$$;
revoke all on function public.apply_location_review_v2(uuid,text,text,text,boolean,date,jsonb) from public, anon, authenticated;
grant execute on function public.apply_location_review_v2(uuid,text,text,text,boolean,date,jsonb) to service_role;

-- Repair existing stored aggregates: community rows only (admin-only places get no rating / count 0).
update public.locations l set
  average_rating = c.avg_rating,
  rating_count = coalesce(c.n, 0)
from public.locations x
left join (select location_id, round(avg(rating)::numeric, 2) as avg_rating, count(*)::integer as n
           from public.reviews group by location_id) c on c.location_id = x.id
where l.id = x.id
  and (l.average_rating is distinct from c.avg_rating or l.rating_count is distinct from coalesce(c.n, 0));
