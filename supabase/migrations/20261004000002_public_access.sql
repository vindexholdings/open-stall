-- OS-102 (revised v3): NO direct public table access. Public clients use two constrained
-- server-side functions that return only displayable rows and only the fields the app needs.
-- Displayable = verified, or unverified with explicit external evidence (client badges it).
-- Candidates, pending, closed, held and possible-duplicate rows are never returned.

alter table public.locations enable row level security;
alter table public.location_sources enable row level security;
alter table public.import_runs enable row level security;
-- Deliberately NOT forced: the table owner (used by SECURITY DEFINER functions) bypasses RLS,
-- which does not depend on how the platform configures the owner role. No policies exist for
-- anon/authenticated, so even a future accidental table grant would still return no rows.

revoke all on table public.locations from public, anon, authenticated;
revoke all on table public.location_sources from public, anon, authenticated;
revoke all on table public.import_runs from public, anon, authenticated;

-- Helper/trigger functions are internal.
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.protect_manual_edits() from public, anon, authenticated;
revoke all on function public.distance_m(double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.normalize_name(text) from public, anon, authenticated;
revoke all on function public.valid_bounds(jsonb) from public, anon, authenticated;
grant execute on function public.distance_m(double precision, double precision, double precision, double precision) to service_role;
grant execute on function public.normalize_name(text) to service_role;
grant execute on function public.valid_bounds(jsonb) to service_role;

-- What the public API may expose. Deliberately excludes status internals, evidence level,
-- source references/tags/hashes, edit flags, timestamps, country, and duplicate links.
create type public.public_location as (
  id uuid,
  name text,
  address_line text,
  city text,
  region text,
  postal_code text,
  latitude double precision,
  longitude double precision,
  verification text,            -- 'verified' | 'unverified'
  last_verified_at timestamptz,
  opening_hours text,
  fee_required boolean,
  key_required boolean,
  purchase_required boolean,
  wheelchair_accessible boolean,
  gender_neutral boolean,
  baby_changing boolean,
  has_hot_water boolean,
  has_cold_water boolean,
  access_location text,
  average_rating numeric,
  rating_count integer,
  attribution text,             -- required source attribution (e.g. ODbL), may be null
  distance_m double precision   -- null for single-location lookups
);

create or replace function public.is_publicly_displayable(p_status text, p_evidence text, p_verified boolean)
returns boolean language sql immutable parallel safe set search_path = '' as $$
  select (p_status = 'verified' and p_verified)
      or (p_status = 'unverified' and p_evidence = 'explicit' and not p_verified)
$$;
revoke all on function public.is_publicly_displayable(text, text, boolean) from public, anon, authenticated;

-- Nearest displayable locations, ordered by distance, with hard caps on radius and rows.
create or replace function public.nearby_locations(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 8047,
  p_limit integer default 100,
  p_verified_only boolean default false
)
returns setof public.public_location
language plpgsql stable security definer set search_path = ''
as $$
declare
  radius double precision;
  lim integer;
  d_lat double precision;
  d_lng double precision;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  radius := least(greatest(coalesce(p_radius_m, 8047), 1), 100000);
  lim := least(greatest(coalesce(p_limit, 100), 1), 100);
  d_lat := radius / 111320.0;
  d_lng := radius / (111320.0 * greatest(cos(radians(p_lat)), 0.01));

  return query
    with cand as (
      select l.*, public.distance_m(p_lat, p_lng, l.latitude, l.longitude) as dist
      from public.locations l
      where l.latitude between p_lat - d_lat and p_lat + d_lat
        and l.longitude between p_lng - d_lng and p_lng + d_lng
        and public.is_publicly_displayable(l.status, l.restroom_evidence, l.restroom_verified)
        and (not coalesce(p_verified_only, false) or l.status = 'verified')
    )
    select c.id, c.name, c.address_line, c.city, c.region, c.postal_code, c.latitude, c.longitude,
           case when c.status = 'verified' then 'verified' else 'unverified' end,
           c.last_verified_at, c.opening_hours, c.fee_required, c.key_required, c.purchase_required,
           c.wheelchair_accessible, c.gender_neutral, c.baby_changing, c.has_hot_water, c.has_cold_water,
           c.access_location, c.average_rating, c.rating_count,
           (select string_agg(distinct s.attribution, '; ') from public.location_sources s
             where s.location_id = c.id and s.attribution is not null),
           c.dist
    from cand c
    where c.dist <= radius
    order by c.dist, c.name, c.id
    limit lim;
end;
$$;

create or replace function public.get_public_location(p_id uuid)
returns setof public.public_location
language sql stable security definer set search_path = ''
as $$
  select l.id, l.name, l.address_line, l.city, l.region, l.postal_code, l.latitude, l.longitude,
         case when l.status = 'verified' then 'verified' else 'unverified' end,
         l.last_verified_at, l.opening_hours, l.fee_required, l.key_required, l.purchase_required,
         l.wheelchair_accessible, l.gender_neutral, l.baby_changing, l.has_hot_water, l.has_cold_water,
         l.access_location, l.average_rating, l.rating_count,
         (select string_agg(distinct s.attribution, '; ') from public.location_sources s
           where s.location_id = l.id and s.attribution is not null),
         null::double precision
  from public.locations l
  where l.id = p_id
    and public.is_publicly_displayable(l.status, l.restroom_evidence, l.restroom_verified)
$$;

-- The single nearest VERIFIED location within p_max_m (for "Nearest verified" context).
create or replace function public.nearest_verified_location(
  p_lat double precision,
  p_lng double precision,
  p_max_m integer default 80000
)
returns setof public.public_location
language plpgsql stable security definer set search_path = ''
as $$
declare
  max_m double precision;
  d_lat double precision;
  d_lng double precision;
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'invalid coordinates' using errcode = '22023';
  end if;
  max_m := least(greatest(coalesce(p_max_m, 80000), 1), 100000);
  d_lat := max_m / 111320.0;
  d_lng := max_m / (111320.0 * greatest(cos(radians(p_lat)), 0.01));

  return query
    with cand as (
      select l.*, public.distance_m(p_lat, p_lng, l.latitude, l.longitude) as dist
      from public.locations l
      where l.status = 'verified' and l.restroom_verified
        and l.latitude between p_lat - d_lat and p_lat + d_lat
        and l.longitude between p_lng - d_lng and p_lng + d_lng
    )
    select c.id, c.name, c.address_line, c.city, c.region, c.postal_code, c.latitude, c.longitude,
           'verified'::text, c.last_verified_at, c.opening_hours, c.fee_required, c.key_required,
           c.purchase_required, c.wheelchair_accessible, c.gender_neutral, c.baby_changing,
           c.has_hot_water, c.has_cold_water, c.access_location, c.average_rating, c.rating_count,
           (select string_agg(distinct s.attribution, '; ') from public.location_sources s
             where s.location_id = c.id and s.attribution is not null),
           c.dist
    from cand c
    where c.dist <= max_m
    order by c.dist, c.id
    limit 1;
end;
$$;

revoke all on function public.nearby_locations(double precision, double precision, integer, integer, boolean) from public;
revoke all on function public.get_public_location(uuid) from public;
revoke all on function public.nearest_verified_location(double precision, double precision, integer) from public;
grant execute on function public.nearby_locations(double precision, double precision, integer, integer, boolean) to anon, authenticated;
grant execute on function public.get_public_location(uuid) to anon, authenticated;
grant execute on function public.nearest_verified_location(double precision, double precision, integer) to anon, authenticated;
