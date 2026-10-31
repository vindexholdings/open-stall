-- Additive admin review fields. Never publishes previous private notes.
-- Public review browsing/submission remains behind the later phase gate.
alter table public.locations
  add column customers_only boolean,
  add column family_bathroom boolean;
alter table public.location_reviews
  add column reviewer_identity text not null default 'local-admin' check (char_length(btrim(reviewer_identity)) between 1 and 120),
  add column reviewer_kind text not null default 'admin' check (reviewer_kind in ('admin', 'user')),
  add column customers_only boolean,
  add column family_bathroom boolean,
  add column has_cold_water boolean,
  add column cleaning_log boolean,
  add column restroom_type text not null default 'unknown' check (restroom_type in ('unknown', 'men', 'women', 'all_gender', 'family', 'single_occupancy')),
  add column rating smallint check (rating between 1 and 5),
  add column cleanliness_score smallint check (cleanliness_score between 1 and 5),
  add column public_comment text check (public_comment is null or char_length(public_comment) <= 1000),
  add column conditions jsonb not null default '{}'::jsonb check (jsonb_typeof(conditions) = 'object');
alter table public.location_reviews alter column created_at set default clock_timestamp();
create index location_reviews_identity_idx on public.location_reviews(location_id, reviewer_identity, created_at desc);
-- Earlier reviews all came from this local admin tool, not separate community users.
-- Username is a display alias; it never determines unique reviewer identity.

create function public.apply_location_review_v2(
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
      else false end) then raise exception 'invalid condition: %', item using errcode = '22023'; end if;
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
  if stars is not null then
    -- One latest dated rating per stable reviewer identity, regardless of display-name changes.
    update public.locations set (average_rating, rating_count) = (
      select avg(rating)::numeric(3,2), count(*)::integer from (
        select distinct on (reviewer_identity) rating from public.location_reviews
        where location_id = p_location and rating is not null and existence = 'exists'
        order by reviewer_identity, coalesce(verified_on, created_at::date) desc, created_at desc, id desc
      ) latest
    ) where id = p_location;
  end if;
  return result;
end;
$$;
revoke all on function public.apply_location_review_v2(uuid,text,text,text,boolean,date,jsonb) from public, anon, authenticated;
grant execute on function public.apply_location_review_v2(uuid,text,text,text,boolean,date,jsonb) to service_role;
-- location_reviews remains private/RLS-protected. Public projection is a later gated change.
