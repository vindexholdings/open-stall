-- OS-204 favorites (free cap), OS-205 ratings + structured observations + check-ins.

-- ---------------------------------------------------------------- favorites
create table public.favorites (
  user_id uuid not null references auth.users (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, location_id)
);
alter table public.favorites enable row level security;
revoke all on table public.favorites from public, anon, authenticated;

-- Free accounts: 5 favorites (PRD). Premium (unlimited) replaces this function in OS-502.
create or replace function public.favorite_limit(p_user uuid)
returns integer
language sql
stable
set search_path = ''
as $$ select 5 $$;
revoke all on function public.favorite_limit(uuid) from public, anon, authenticated;

create or replace function public.add_favorite(p_location uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  loc public.locations%rowtype;
  lim integer;
  n integer;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended('favorites:' || uid::text, 0));
  select * into loc from public.locations where id = p_location;
  if not found or not public.is_publicly_displayable(loc.status, loc.restroom_evidence, loc.restroom_verified) then
    raise exception 'location not available' using errcode = '22023';
  end if;
  lim := public.favorite_limit(uid);
  if exists (select 1 from public.favorites where user_id = uid and location_id = p_location) then
    select count(*) into n from public.favorites f join public.locations l on l.id = f.location_id
      where f.user_id = uid and public.is_publicly_displayable(l.status, l.restroom_evidence, l.restroom_verified);
    return jsonb_build_object('added', false, 'count', n, 'limit', lim);
  end if;
  -- Hidden (no longer public) favorites do not count toward the cap, so nobody is stuck at the limit.
  select count(*) into n from public.favorites f join public.locations l on l.id = f.location_id
    where f.user_id = uid and public.is_publicly_displayable(l.status, l.restroom_evidence, l.restroom_verified);
  if n >= lim then
    raise exception 'favorites limit reached' using errcode = '53400', detail = lim::text;
  end if;
  perform public.enforce_rate_limit(uid, 'favorite_add', 60, interval '1 day');
  insert into public.favorites (user_id, location_id) values (uid, p_location);
  return jsonb_build_object('added', true, 'count', n + 1, 'limit', lim);
end;
$$;

create or replace function public.remove_favorite(p_location uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.favorites where user_id = uid and location_id = p_location;
end;
$$;

-- The caller's favorites that are still public, newest first. Coordinates are optional, used only to
-- compute distance for this response, and never stored.
create or replace function public.list_my_favorites(p_lat double precision default null, p_lng double precision default null)
returns setof public.public_location
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if (p_lat is not null or p_lng is not null)
     and (p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180) then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  return query
    select (public.public_location_row(l,
             case when p_lat is not null then public.distance_m(p_lat, p_lng, l.latitude, l.longitude) end)).*
    from public.favorites f join public.locations l on l.id = f.location_id
    where f.user_id = uid and public.is_publicly_displayable(l.status, l.restroom_evidence, l.restroom_verified)
    order by f.created_at desc
    limit 200;
end;
$$;

-- ---------------------------------------------------------------- ratings
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  -- Presentation mode when rated; the stored value is always the numeric 1-5.
  mode text not null default 'plain' check (mode in ('plain', 'risque')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, location_id)
);
create index reviews_location_idx on public.reviews (location_id);
create trigger reviews_set_updated_at before update on public.reviews
  for each row execute function public.set_updated_at();

-- Structured, factual observations only (no free text in v1).
create table public.review_observations (
  review_id uuid not null references public.reviews (id) on delete cascade,
  observation text not null check (observation in ('clean', 'dirty', 'supplies_stocked', 'supplies_missing', 'easy_to_find', 'hard_to_find')),
  primary key (review_id, observation)
);
alter table public.reviews enable row level security;
alter table public.review_observations enable row level security;
revoke all on table public.reviews, public.review_observations from public, anon, authenticated;

create or replace function public.recompute_location_rating(p_location uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.locations l set
    average_rating = (select round(avg(r.rating)::numeric, 2) from public.reviews r where r.location_id = p_location),
    rating_count = (select count(*) from public.reviews r where r.location_id = p_location)
  where l.id = p_location
$$;
revoke all on function public.recompute_location_rating(uuid) from public, anon, authenticated;

create or replace function public.reviews_aggregate_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_location_rating(coalesce(new.location_id, old.location_id));
  return null;
end;
$$;
revoke all on function public.reviews_aggregate_trigger() from public, anon, authenticated;
create trigger reviews_aggregate after insert or update or delete on public.reviews
  for each row execute function public.reviews_aggregate_trigger();

create or replace function public.submit_review(p_location uuid, p_rating integer, p_mode text, p_observations text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  loc public.locations%rowtype;
  obs text[] := coalesce(p_observations, '{}');
  rid uuid;
  o text;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_rating is null or p_rating not between 1 and 5 then raise exception 'rating must be 1-5' using errcode = '22023'; end if;
  if p_mode not in ('plain', 'risque') then raise exception 'invalid mode' using errcode = '22023'; end if;
  if cardinality(obs) > 6 then raise exception 'too many observations' using errcode = '22023'; end if;
  foreach o in array obs loop
    if o not in ('clean', 'dirty', 'supplies_stocked', 'supplies_missing', 'easy_to_find', 'hard_to_find') then
      raise exception 'invalid observation' using errcode = '22023';
    end if;
  end loop;
  if ('clean' = any (obs) and 'dirty' = any (obs)) or ('supplies_stocked' = any (obs) and 'supplies_missing' = any (obs))
     or ('easy_to_find' = any (obs) and 'hard_to_find' = any (obs)) then
    raise exception 'contradictory observations' using errcode = '22023';
  end if;
  select * into loc from public.locations where id = p_location;
  if not found or not public.is_publicly_displayable(loc.status, loc.restroom_evidence, loc.restroom_verified) then
    raise exception 'location not available' using errcode = '22023';
  end if;
  perform public.enforce_rate_limit(uid, 'review', 30, interval '1 day');

  insert into public.reviews (user_id, location_id, rating, mode)
    values (uid, p_location, p_rating, p_mode)
  on conflict (user_id, location_id) do update set rating = excluded.rating, mode = excluded.mode
  returning id into rid;
  delete from public.review_observations where review_id = rid;
  insert into public.review_observations (review_id, observation)
    select rid, x from (select distinct unnest(obs) as x) d;
  return jsonb_build_object('review_id', rid, 'rating', p_rating);
end;
$$;

create or replace function public.get_my_review(p_location uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  return (select jsonb_build_object('rating', r.rating, 'mode', r.mode,
            'observations', coalesce((select jsonb_agg(o.observation order by o.observation) from public.review_observations o where o.review_id = r.id), '[]'::jsonb))
          from public.reviews r where r.user_id = uid and r.location_id = p_location);
end;
$$;

create or replace function public.delete_my_review(p_location uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare uid uuid := auth.uid();
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  delete from public.reviews where user_id = uid and location_id = p_location;
end;
$$;

-- ---------------------------------------------------------------- check-ins
create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index checkins_user_idx on public.checkins (user_id, created_at desc);
create index checkins_location_idx on public.checkins (location_id, user_id, created_at desc);
alter table public.checkins enable row level security;
revoke all on table public.checkins from public, anon, authenticated;

-- The device sends its position ONLY to prove it is at the restroom; the position is checked and
-- discarded, never stored. Anti-abuse: within 150 m, once per location per 12 h, at most 10 a day.
create or replace function public.check_in(p_location uuid, p_lat double precision, p_lng double precision)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  loc public.locations%rowtype;
  cid uuid;
begin
  if uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  select * into loc from public.locations where id = p_location;
  if not found or not public.is_publicly_displayable(loc.status, loc.restroom_evidence, loc.restroom_verified) then
    raise exception 'location not available' using errcode = '22023';
  end if;
  if public.distance_m(p_lat, p_lng, loc.latitude, loc.longitude) > 150 then
    raise exception 'too far from the restroom to check in' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('checkin:' || uid::text || ':' || p_location::text, 0));
  if exists (select 1 from public.checkins where user_id = uid and location_id = p_location and created_at > now() - interval '12 hours') then
    raise exception 'already checked in here recently' using errcode = '54000';
  end if;
  perform public.enforce_rate_limit(uid, 'checkin', 10, interval '1 day');
  insert into public.checkins (user_id, location_id) values (uid, p_location) returning id into cid;
  return jsonb_build_object('checkin_id', cid);
end;
$$;

revoke all on function public.add_favorite(uuid), public.remove_favorite(uuid), public.list_my_favorites(double precision, double precision),
  public.submit_review(uuid, integer, text, text[]), public.get_my_review(uuid), public.delete_my_review(uuid),
  public.check_in(uuid, double precision, double precision) from public, anon, authenticated;
grant execute on function public.add_favorite(uuid), public.remove_favorite(uuid), public.list_my_favorites(double precision, double precision),
  public.submit_review(uuid, integer, text, text[]), public.get_my_review(uuid), public.delete_my_review(uuid),
  public.check_in(uuid, double precision, double precision) to authenticated;
