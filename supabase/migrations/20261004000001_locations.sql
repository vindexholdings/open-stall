-- OS-101 (revised v3): canonical locations, separate source/provenance records, import bookkeeping.
-- No data is inserted here. Real-world data arrives only via the reviewed importer, after separate approval.
--
-- Model:
--   locations         canonical Open Stall records (what the app shows). Owned by Open Stall.
--   location_sources  per-source provenance (OSM etc.): raw tags, license, attribution, hashes, freshness.
--                     Many sources may feed one location; sources can be added without redesign.
--   import_runs       one row per importer run (area, scope, completeness) driving safe refresh.
--
-- Visibility/confidence (locations.status):
--   verified   confirmed by Open Stall. Public.        unverified  explicit external evidence. Public, badged.
--   candidate  inferred/held/possible duplicate. Hidden. pending    user submission. Hidden. closed. Hidden.
-- A business existing is never evidence of a publicly accessible restroom.
-- OSM-derived rows remain subject to ODbL regardless of this separation (see IMPORT.md licensing gate).

-- ---------------------------------------------------------------- helpers
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Great-circle distance in meters (documented Haversine fallback; PostGIS can replace behind the public functions).
create or replace function public.distance_m(lat1 double precision, lon1 double precision, lat2 double precision, lon2 double precision)
returns double precision language sql immutable parallel safe set search_path = '' as $$
  select 2 * 6371008.8 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  )))
$$;

create or replace function public.normalize_name(t text)
returns text language sql immutable parallel safe set search_path = '' as $$
  select regexp_replace(lower(coalesce(t, '')), '[^a-z0-9]+', '', 'g')
$$;

-- {south, west, north, east}, all numbers, in range, south<north, west<east.
create or replace function public.valid_bounds(b jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
begin
  if jsonb_typeof(b) is distinct from 'object' then return false; end if;
  if jsonb_typeof(b->'south') is distinct from 'number' or jsonb_typeof(b->'west') is distinct from 'number'
     or jsonb_typeof(b->'north') is distinct from 'number' or jsonb_typeof(b->'east') is distinct from 'number' then
    return false;
  end if;
  return (b->>'south')::float8 between -90 and 90 and (b->>'north')::float8 between -90 and 90
     and (b->>'west')::float8 between -180 and 180 and (b->>'east')::float8 between -180 and 180
     and (b->>'south')::float8 < (b->>'north')::float8 and (b->>'west')::float8 < (b->>'east')::float8;
end;
$$;

-- ---------------------------------------------------------------- import_runs
create table public.import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source ~ '^[a-z][a-z0-9_]{1,31}$'),
  area_name text,
  -- Standard shape: {"south":..,"west":..,"north":..,"east":..}
  bounds jsonb not null check (public.valid_bounds(bounds)),
  -- What this run queried, e.g. {"include_candidates": true}. Finalize only judges what was queried.
  scope jsonb not null default '{"include_candidates": true}'::jsonb,
  -- True only if the importer fetched/replayed the WHOLE area successfully. Finalize requires it.
  complete boolean not null default false,
  tool_version text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  stats jsonb
);

-- ---------------------------------------------------------------- locations (canonical)
create table public.locations (
  id uuid primary key default gen_random_uuid(),

  name text not null check (char_length(btrim(name)) between 1 and 200),
  address_line text check (address_line is null or char_length(address_line) <= 300),
  city text check (city is null or char_length(city) <= 120),
  region text check (region is null or char_length(region) <= 120),
  postal_code text check (postal_code is null or char_length(postal_code) <= 20),
  country_code text not null default 'US' check (country_code ~ '^[A-Z]{2}$'),

  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),

  status text not null default 'candidate'
    check (status in ('candidate', 'pending', 'unverified', 'verified', 'closed')),
  -- 'explicit': a source states a public restroom; 'inferred': place type often has one.
  restroom_evidence text not null default 'none'
    check (restroom_evidence in ('none', 'inferred', 'explicit')),
  restroom_verified boolean not null default false,
  last_verified_at timestamptz,

  -- Nullable booleans: NULL means unknown, which is different from false.
  wheelchair_accessible boolean,
  gender_neutral boolean,
  baby_changing boolean,
  has_hot_water boolean,
  has_cold_water boolean,
  key_required boolean,
  purchase_required boolean,
  fee_required boolean,
  access_location text check (access_location is null or char_length(access_location) <= 300),
  -- Raw source text (e.g. OSM opening_hours); shown as "may be inaccurate".
  opening_hours text check (opening_hours is null or char_length(opening_hours) <= 300),

  average_rating numeric(3, 2) check (average_rating is null or average_rating between 1 and 5),
  rating_count integer not null default 0 check (rating_count >= 0),

  -- Set automatically when anyone other than the importer edits a record (see trigger).
  manually_edited_at timestamptz,
  -- Conservative duplicate flag. NEVER auto-merged; an admin resolves it.
  possible_duplicate_of uuid references public.locations (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint locations_verified_requires_confirmation check (
    status <> 'verified' or (restroom_verified and last_verified_at is not null)
  ),
  constraint locations_only_verified_claim_verification check (
    not restroom_verified or status in ('verified', 'closed')
  ),
  constraint locations_unverified_requires_explicit_evidence check (
    status <> 'unverified' or restroom_evidence = 'explicit'
  ),
  constraint locations_duplicate_not_self check (possible_duplicate_of is distinct from id),
  -- A flagged possible duplicate must not be publicly listed as unverified.
  constraint locations_duplicate_not_public_unverified check (
    possible_duplicate_of is null or status <> 'unverified'
  )
);

comment on table public.locations is
  'Canonical restroom locations. No direct public access; clients use nearby_locations/get_public_location.';

create index locations_status_lat_lng_idx on public.locations (status, latitude, longitude);
create index locations_possible_duplicate_idx on public.locations (possible_duplicate_of)
  where possible_duplicate_of is not null;

create trigger locations_set_updated_at
  before update on public.locations
  for each row execute function public.set_updated_at();

-- Any edit to substantive fields by anyone but the importer marks the record as manually edited,
-- which makes future imports leave it alone. Importer functions set open_stall.importer = 'on'
-- (transaction-local). Rating aggregates are excluded so rating updates never lock a record.
create or replace function public.protect_manual_edits()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('open_stall.importer', true), '') = 'on' then
    return new;
  end if;
  if (new.name, new.address_line, new.city, new.region, new.postal_code, new.country_code,
      new.latitude, new.longitude, new.status, new.restroom_evidence, new.restroom_verified,
      new.wheelchair_accessible, new.gender_neutral, new.baby_changing, new.has_hot_water,
      new.has_cold_water, new.key_required, new.purchase_required, new.fee_required,
      new.access_location, new.opening_hours, new.possible_duplicate_of)
     is distinct from
     (old.name, old.address_line, old.city, old.region, old.postal_code, old.country_code,
      old.latitude, old.longitude, old.status, old.restroom_evidence, old.restroom_verified,
      old.wheelchair_accessible, old.gender_neutral, old.baby_changing, old.has_hot_water,
      old.has_cold_water, old.key_required, old.purchase_required, old.fee_required,
      old.access_location, old.opening_hours, old.possible_duplicate_of) then
    new.manually_edited_at = coalesce(new.manually_edited_at, now());
  end if;
  return new;
end;
$$;

create trigger locations_protect_manual_edits
  before update on public.locations
  for each row execute function public.protect_manual_edits();

-- ---------------------------------------------------------------- location_sources (provenance)
create table public.location_sources (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null references public.locations (id) on delete cascade,
  -- Open set: new sources need no schema change.
  source text not null check (source ~ '^[a-z][a-z0-9_]{1,31}$'),
  source_reference text not null check (char_length(source_reference) between 1 and 200),
  license text,
  attribution text,
  -- Source's own view of the record (not public).
  source_latitude double precision not null check (source_latitude between -90 and 90),
  source_longitude double precision not null check (source_longitude between -180 and 180),
  evidence text not null check (evidence in ('inferred', 'explicit')),
  tags jsonb,
  content_hash text,
  -- When the SOURCE last changed this object (e.g. OSM timestamp); no editor identity is stored.
  source_edited_at timestamptz,
  -- Why a record is held hidden despite evidence (e.g. 'recent_edit').
  hold_reason text,
  -- Canonical fields are refreshed from the primary source only.
  is_primary boolean not null default true,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz,
  last_seen_run uuid references public.import_runs (id) on delete set null,
  missing_since timestamptz,
  unique (source, source_reference)
);

create unique index location_sources_one_primary_idx
  on public.location_sources (location_id) where is_primary;
create index location_sources_location_idx on public.location_sources (location_id);
create index location_sources_area_idx on public.location_sources (source, source_latitude, source_longitude);
